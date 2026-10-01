// ADB plumbing for the phone control plane: the one place in the hub that runs adb.
//
// Every call goes through execFile with an argv array, so no host shell (cmd.exe or sh) parses it. A
// serial with spaces or parentheses, an adb path with spaces ("C:\Program Files\..."), or user text can no
// longer be re-split or interpreted on the hub machine, and nothing has to be hand-quoted. The DEVICE
// still joins `adb shell` arguments and runs them through its own sh, so callers that forward user text
// quote it for that sh (quoteForDeviceShell in control.ts).
//
// SCREEN_SYNC_ADB_BIN and SCREEN_SYNC_ADB_TARGET are read on every call, not frozen at module load, and
// setAdbRunner() swaps the process runner: together they are the test seam, so unit tests drive the
// whole control path with a scripted fake and never touch a phone.
import { execFile } from "node:child_process";

export type AdbRunOptions = { timeoutMs: number; maxBuffer: number };

/** Runs `bin ...argv` without a shell and resolves with the raw stdout; rejects on a non-zero exit or a timeout. */
export type AdbRunner = (bin: string, argv: string[], opts: AdbRunOptions) => Promise<Buffer>;

export type AdbCallOptions = Partial<AdbRunOptions> & {
  /** A global subcommand such as `devices`: it must not carry the -s/-t target flags. */
  global?: boolean;
};

export type ScreenSize = { width: number; height: number };

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_BUFFER = 64 * 1024 * 1024;
const FALLBACK_SCREEN: ScreenSize = { width: 1080, height: 2400 };

const execFileRunner: AdbRunner = (bin, argv, opts) =>
  new Promise((resolve, reject) => {
    execFile(bin, argv, { encoding: "buffer", timeout: opts.timeoutMs, maxBuffer: opts.maxBuffer }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });

let runner: AdbRunner = execFileRunner;

// The effective target starts as the env pin, but resolveTarget() may pick one at runtime: wireless ADB
// advertises the SAME phone twice (an ip:port serial and an mDNS alias), and a bare `adb` call then fails
// with "more than one device/emulator" while the device list still looks healthy.
let resolvedTarget = "";

// `wm size`, read once for normalized-coordinate conversion.
let cachedScreen: ScreenSize | null = null;

/**
 * Installs `fn` as the process runner (null restores the real execFile runner) and clears every piece of
 * device state cached from adb (the resolved target and the screen size), so each test starts clean.
 */
export function setAdbRunner(fn: AdbRunner | null): void {
  runner = fn ?? execFileRunner;
  resolvedTarget = "";
  cachedScreen = null;
}

/** The adb executable: SCREEN_SYNC_ADB_BIN, else `adb` from PATH. A path with spaces needs no quoting. */
export function adbBin(): string {
  return process.env.SCREEN_SYNC_ADB_BIN || "adb";
}

/** The pinned device (an ADB transport id or a serial) from SCREEN_SYNC_ADB_TARGET, or "" when unpinned. */
export function adbTargetPin(): string {
  return process.env.SCREEN_SYNC_ADB_TARGET || "";
}

/** The device every targeted call addresses: the env pin, else the one resolveTarget() picked, else "". */
export function currentTarget(): string {
  return adbTargetPin() || resolvedTarget;
}

/** A numeric target is a transport id (-t); anything else is a serial (-s), passed as one argv element. */
export function targetArgs(target: string): string[] {
  if (!target) return [];
  return /^\d+$/.test(target) ? ["-t", target] : ["-s", target];
}

/** Runs adb with `argv` (prefixed by the target flags unless `global`) and returns raw stdout. */
export async function adbBuffer(argv: string[], opts: AdbCallOptions = {}): Promise<Buffer> {
  const full = opts.global ? [...argv] : [...targetArgs(currentTarget()), ...argv];
  return runner(adbBin(), full, {
    timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxBuffer: opts.maxBuffer ?? DEFAULT_MAX_BUFFER,
  });
}

/** Runs adb with `argv` and returns stdout as trimmed UTF-8 text. */
export async function adb(argv: string[], opts: AdbCallOptions = {}): Promise<string> {
  return (await adbBuffer(argv, opts)).toString("utf8").trim();
}

/** Serials in the `device` state from `adb devices` output (offline and unauthorized entries are skipped). */
export function parseAdbDevices(stdout: string): string[] {
  return stdout
    .split("\n")
    .slice(1)
    .map((l) => l.trim())
    .filter((l) => l.endsWith("device"))
    .map((l) => l.split(/\s+/)[0])
    .filter(Boolean);
}

/** Which of several online serials to target: the explicit ip:port serial over an mDNS alias, else the first. */
export function chooseTarget(serials: string[]): string {
  const wireless = serials.find((s) => /^\d+\.\d+\.\d+\.\d+:\d+$/.test(s));
  return wireless || serials[0];
}

/**
 * Lists the online devices (`adb devices`, a global call) and, when nothing is pinned and more than one is
 * online, remembers the one later calls target. Returns the serials and the effective target.
 */
export async function resolveTarget(): Promise<{ serials: string[]; target: string }> {
  const serials = parseAdbDevices((await adbBuffer(["devices"], { global: true })).toString("utf8"));
  if (!adbTargetPin() && serials.length > 1) resolvedTarget = chooseTarget(serials);
  return { serials, target: currentTarget() };
}

/**
 * The first WxH in `wm size` output, or null. With an override set, Android prints the Physical line
 * first, so the physical size wins (today's behaviour).
 */
export function parseWmSize(text: string): ScreenSize | null {
  const m = text.match(/(\d+)x(\d+)/);
  return m ? { width: Number(m[1]), height: Number(m[2]) } : null;
}

/** The screen size for normalized coordinates: read once from `wm size`, 1080x2400 when it cannot be parsed. */
export async function screenSize(): Promise<ScreenSize> {
  if (cachedScreen) return cachedScreen;
  cachedScreen = parseWmSize(await adb(["shell", "wm", "size"])) ?? { ...FALLBACK_SCREEN };
  return cachedScreen;
}
