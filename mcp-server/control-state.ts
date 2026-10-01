// Screen state for control_status and control_screenshot: is the screen on, is the lock screen up, which app
// has focus, and the display rotation. Read-only `dumpsys power` and `dumpsys window` through the one adb
// runner. The field names differ by Android version and OEM, so every parser reads several spellings and a
// field it cannot find is left out (unknown), never guessed. Nothing here wakes, unlocks or dismisses anything.
import { adb } from "./control-adb.js";
import { parseImageDimensions } from "./storage.js";

export type ScreenState = {
  /** Awake or Dreaming is on; Asleep or Dozing (always-on display) is off. */
  screenOn?: boolean;
  /** mWakefulness as the phone spells it: Awake, Asleep, Dozing, Dreaming. */
  wakefulness?: string;
  /** The lock screen (keyguard) is showing, so a tap reaches it rather than the app. */
  locked?: boolean;
  /** The lock screen needs a PIN, pattern or password. */
  secure?: boolean;
  /** The app whose window has focus (the one behind the lock screen while it is up). */
  foreground?: { package: string; activity: string };
  /** Quarter turns from the natural orientation: 0 portrait, 1 and 3 landscape, 2 upside down. */
  rotation?: number;
};

export type ScreenWarning = { code: "SCREEN_OFF" | "LOCKED" | "LIKELY_BLANK_OR_SECURE"; message: string };

const flag = (text: string, re: RegExp): boolean | undefined => {
  const m = re.exec(text);
  return m ? m[1] === "true" : undefined;
};

/** The first `key=value` line inside the KeyguardServiceDelegate block of `dumpsys window` (Android 8 and later). */
function delegateFlag(text: string, key: string): boolean | undefined {
  const start = text.indexOf("KeyguardServiceDelegate");
  if (start < 0) return undefined;
  return flag(text.slice(start, start + 1500), new RegExp(`\\n\\s*${key}=(true|false)\\b`));
}

/** `dumpsys power`: mWakefulness=Awake|Asleep|Dozing|Dreaming, else `Display Power: state=ON|OFF`. */
export function parsePowerState(text: string): Pick<ScreenState, "screenOn" | "wakefulness"> {
  const wake = /mWakefulness=([A-Za-z]+)/.exec(text)?.[1];
  if (wake) {
    const on = /^(awake|dreaming)$/i.test(wake) ? true : /^(asleep|dozing)$/i.test(wake) ? false : undefined;
    return on === undefined ? { wakefulness: wake } : { screenOn: on, wakefulness: wake };
  }
  const display = /Display Power: state=([A-Z_]+)/.exec(text)?.[1];
  return display ? { screenOn: display === "ON" } : {};
}

/** `.Main` in package `com.x` is `com.x.Main`. */
const fullActivity = (pkg: string, activity: string) => (activity.startsWith(".") ? pkg + activity : activity);

/** `dumpsys window`: the lock screen, the focused app and the rotation. */
export function parseWindowState(text: string): Pick<ScreenState, "locked" | "secure" | "foreground" | "rotation"> {
  const out: ReturnType<typeof parseWindowState> = {};
  // Any spelling that says "showing" wins; "not showing" needs at least one spelling present.
  const seen = [
    flag(text, /isKeyguardShowing=(true|false)/),
    flag(text, /mShowingLockscreen=(true|false)/),
    flag(text, /mDreamingLockscreen=(true|false)/),
    delegateFlag(text, "showing"),
  ].filter((v): v is boolean => v !== undefined);
  if (seen.length) out.locked = seen.includes(true);
  const secure = delegateFlag(text, "secure");
  if (secure !== undefined) out.secure = secure;

  // An app window: Window{hash u0 pkg/activity}. A system window (NotificationShade, a popup) has no slash, and
  // then the focused activity record names the app instead (older Androids nest it in an AppWindowToken).
  const focusedApp = /mFocusedApp=(.*)/.exec(text)?.[1] ?? "";
  const app = /mCurrentFocus=Window\{\S+ \S+ ([\w.]+)\/([\w.$]+)\}/.exec(text) ?? /ActivityRecord\{\S+ \S+ ([\w.]+)\/([\w.$]+)/.exec(focusedApp);
  if (app) out.foreground = { package: app[1], activity: fullActivity(app[1], app[2]) };

  // DisplayRotation's mRotation is the display's own rotation. mCurrentRotation (WindowOrientationListener) is what
  // the sensor proposes, so it is only the fallback for a phone that prints no mRotation.
  const rotation = /\bmRotation=([0-3])\b/.exec(text)?.[1] ?? /mCurrentRotation=(?:ROTATION_)?([0-3])\b/.exec(text)?.[1];
  if (rotation !== undefined) out.rotation = Number(rotation);
  return out;
}

/** Reads the screen state; a dumpsys that fails or prints something unexpected leaves its fields out. */
export async function screenState(): Promise<ScreenState> {
  const [power, window] = await Promise.all([
    adb(["shell", "dumpsys", "power"]).catch(() => ""),
    adb(["shell", "dumpsys", "window"]).catch(() => ""),
  ]);
  return { ...parsePowerState(power), ...parseWindowState(window) };
}

// A near-uniform frame (screen off, a FLAG_SECURE window, which screencap returns black) deflates to a tiny PNG:
// an all-black 1080x2400 frame is about 10 KB, a real screen 100 KB or more. Advisory only.
const BLANK_BYTES_PER_PIXEL = 1 / 100;

/** True when `png` is so small for its size that it is almost certainly one flat colour. */
export function looksBlank(png: Buffer): boolean {
  try {
    const { width, height } = parseImageDimensions(png);
    return width > 0 && height > 0 && png.length < width * height * BLANK_BYTES_PER_PIXEL;
  } catch {
    return false;
  }
}

/** The advisory warnings a screenshot carries. The screenshot is still returned: these never refuse it. */
export function screenshotWarnings(state: ScreenState, png: Buffer): ScreenWarning[] {
  const warnings: ScreenWarning[] = [];
  if (state.screenOn === false) {
    warnings.push({
      code: "SCREEN_OFF",
      message: `The screen is off (${state.wakefulness ?? "display off"}), so this frame is likely black and taps do nothing useful. control_key power wakes it.`,
    });
  }
  if (state.locked) {
    warnings.push({
      code: "LOCKED",
      message: `The lock screen is showing${state.secure ? " and needs a PIN, pattern or password" : ""}: taps reach it, not the app. Ask the user to unlock the phone; never try to unlock it yourself.`,
    });
  }
  if (looksBlank(png)) {
    warnings.push({
      code: "LIKELY_BLANK_OR_SECURE",
      message: `The frame is nearly one flat colour (${png.length} bytes): the screen may be off or blank, or the app blocks capture (FLAG_SECURE frames are black). Check get_ui_hierarchy before acting on it.`,
    });
  }
  return warnings;
}
