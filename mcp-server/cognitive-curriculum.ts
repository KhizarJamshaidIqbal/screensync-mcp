// ScreenSync Cognitive Curriculum - what to do next, at the edge of what this domain can already do.
//
// Voyager's automatic curriculum proposes the next task just beyond current ability; Vygotsky calls that
// the zone of proximal development. Both say the same useful thing: the best next step is neither
// something already mastered nor something hopeless.
//
// Everything here is ADVISORY and derived from state the hub already holds - the competence spine, the
// playbook lifecycle, and the real episode history. It proposes; the agent or the human chooses. It
// invents no work: when there is nothing at the edge of ability, it says so rather than padding a list.
//
// Two rules keep the advice trustworthy. It is read as the HUB's own voice, so nothing a caller wrote
// (a playbook name, a domain, an intent) is ever spliced into it raw - see `q`. And a playbook is
// addressed by its hub-issued id, never its name: a pending edit shares its name with the verified
// playbook it would replace, and reporting by name credits the original.

import { globalSpine } from "./cognitive-spine.js";
import { PROMOTE_AFTER_SESSIONS, isFastPath, statusOf } from "./cognitive-skills.js";
import { isInformative } from "./cognitive-reflection.js";
import { cognitiveStore, type CognitiveMemoryData, type ProceduralPlaybook } from "./cognitive-memory.js";

export type StepKind = "verify_candidate" | "refresh_skill" | "earn_level" | "borrow_from_neighbour" | "document_pitfall";

export interface CurriculumStep {
  kind: StepKind;
  /** What to do, in one sentence. Values a caller controls appear only quoted; exact ones are in the fields below. */
  step: string;
  why: string;
  /** Higher is more worth doing now. Used only to order the list. */
  priority: number;
  /** The playbook's hub-issued id: pass exactly this back as data.playbook. */
  playbook?: string;
  intent?: string;
  domain?: string;
}

/** A skill unrehearsed for this long is worth re-running before it is trusted blind. */
const REFRESH_AFTER_DAYS = 21;
const DAY_MS = 86_400_000;
const MAX_QUOTED = 60;

/**
 * A stored string made safe to sit inside a sentence the hub writes. Playbook names, domains and intents
 * are caller-controlled and unbounded; spliced in raw, a name could carry a fake instruction, a forged
 * "[hub notice]" paragraph, or a quote that breaks the call the agent is told to make. Control characters
 * and line breaks go, the length is capped, and JSON quoting escapes what remains, so it reads as a
 * quoted label and cannot end the quote it sits in.
 */
const q = (value: unknown): string => {
  const flat = [...String(value ?? "")]
    .map((ch) => { const c = ch.charCodeAt(0); return c < 32 || (c >= 127 && c < 160) || c === 0x2028 || c === 0x2029 ? " " : ch; })
    .join("").replace(/ {2,}/g, " ").trim();
  return JSON.stringify(flat.length > MAX_QUOTED ? `${flat.slice(0, MAX_QUOTED)}…` : flat);
};

/**
 * Days since a stamp, or null when it cannot be trusted: missing, not a date, or more than a day in the
 * future (a clock stepped back). Treating those as "just used" hid the least-evidenced skills - a migrated
 * legacy playbook has no stamp at all - from the very step meant to check them.
 */
const idleDays = (stamp: string | undefined, now: number): number | null => {
  const t = stamp ? Date.parse(stamp) : NaN;
  if (!Number.isFinite(t)) return null;
  const days = (now - t) / DAY_MS;
  return days < -1 ? null : Math.max(0, days);
};

/** "general" is what learn() files an intent-less playbook under, not a task two sites can share. */
const taskOf = (intent: string | undefined): string => {
  const key = String(intent ?? "").trim().toLowerCase();
  return key === "general" ? "" : key;
};

/**
 * Ranked next steps for a domain. `now` is injected so the ordering is testable.
 */
export function nextSteps(raw: string, mem: CognitiveMemoryData, now: number = Date.now()): { domain: string; level: string; steps: CurriculumStep[]; note?: string } {
  // Normalised, because the tool layer passes the caller's string through: a URL or a www./upper-case
  // host matched nothing at all and reported "nothing to do" for a domain full of drafts.
  const domain = cognitiveStore.normalizeDomain(raw);
  const ev = globalSpine.evaluate(domain, now);
  const mine = Object.values(mem.playbooks).filter((p) => cognitiveStore.normalizeDomain(p.domain) === domain && statusOf(p) !== "deprecated");
  const steps: CurriculumStep[] = [];

  // 1. A candidate one session away from being trusted is the cheapest real progress available.
  for (const pb of mine.filter((p) => statusOf(p) === "candidate")) {
    const sessions = (pb.verifications ?? []).length;
    const runs = pb.successCount ?? 0;
    const remaining = Math.max(1, PROMOTE_AFTER_SESSIONS - sessions);
    steps.push({
      kind: "verify_candidate",
      step: `Run ${q(pb.name)} deliberately, confirm the result with web_expect, then report it with web_learn {action:"outcome", data:{playbook: <this step's "playbook" value>, success:true}}.`,
      why: (runs === 0
        ? `It is an unverified draft: no run of it has been confirmed yet, so it is never offered as a fast path.`
        : `It has ${runs} confirmed run(s) in ${sessions} session(s) and needs a confirmed run in ${remaining} more distinct session(s) to become a fast path.`)
        + (pb.supersedes ? ` It is an edit of a verified playbook, which stays the fast path until this edit is confirmed.` : ""),
      priority: 100 - remaining * 10 + sessions,
      playbook: pb.id,
      intent: pb.intent,
    });
  }

  // 2. A verified skill that needs attention. The forgetting curve applies to the RECORD of a skill as
  //    much as to a memory: sites change underneath a playbook that is never run. And one the hub has
  //    itself stopped offering (a run of reported failures) is the most urgent of all.
  for (const pb of mine.filter((p) => statusOf(p) === "verified")) {
    if (!isFastPath(pb)) {
      steps.push({
        kind: "refresh_skill",
        step: `Re-verify ${q(pb.name)}: run it deliberately, confirm each step with web_expect, and report the outcome with web_learn {action:"outcome", data:{playbook: <this step's "playbook" value>, success:true}}.`,
        why: `It has failed ${pb.consecutiveFailures ?? 0} time(s) in a row, so web_recall no longer offers it as a fast path until a confirmed run clears the streak.`,
        priority: 85,
        playbook: pb.id,
        intent: pb.intent,
      });
      continue;
    }
    const idle = idleDays(pb.lastExecutedAt ?? pb.verifiedAt, now);
    if (idle !== null && idle < REFRESH_AFTER_DAYS) continue;
    steps.push({
      kind: "refresh_skill",
      step: `Re-run the verified playbook ${q(pb.name)} and confirm it still works.`,
      why: idle === null
        ? `Nothing records when it last ran, so there is no way to tell whether it still works; selectors drift and it is being offered as a fast path.`
        : `It has not been exercised for ${Math.round(idle)} days; selectors drift and it is still being offered as a fast path.`,
      priority: idle === null ? 35 : Math.min(80, 40 + idle),
      playbook: pb.id,
      intent: pb.intent,
    });
  }

  // 3. What this domain still needs for its next competence rung, quoted from the spine so the two can
  //    never disagree.
  if (ev.next && ev.next.needs.length > 0) {
    steps.push({
      kind: "earn_level",
      step: `To reach ${ev.next.name} on ${q(domain)}: ${ev.next.needs.join("; ")}.`,
      why: `A full-weight success is an action followed by a passing web_expect, and promotion needs several distinct sessions - one session cannot farm it.`,
      priority: 55,
    });
  }

  // 4. Another domain that has already solved an intent this one is still learning. Real evidence only:
  //    a playbook elsewhere that is verified AND currently working, for an intent this domain has no
  //    working recipe for. A domain with its own working recipe is not "still learning" it.
  const working = new Set(mine.filter(isFastPath).map((p) => taskOf(p.intent)));
  const learning = new Set(mine.map((p) => taskOf(p.intent)).filter((task) => task !== "" && !working.has(task)));
  const neighbours = new Map<string, ProceduralPlaybook>();
  for (const pb of Object.values(mem.playbooks)) {
    const task = taskOf(pb.intent);
    if (!learning.has(task) || !isFastPath(pb) || cognitiveStore.normalizeDomain(pb.domain) === domain) continue;
    const held = neighbours.get(task);
    if (!held || (pb.successCount ?? 0) > (held.successCount ?? 0) || ((pb.successCount ?? 0) === (held.successCount ?? 0) && pb.id < held.id)) neighbours.set(task, pb);
  }
  for (const [task, pb] of neighbours) {
    steps.push({
      kind: "borrow_from_neighbour",
      step: `Read ${q(pb.domain)}'s verified ${q(pb.name)} before working out ${q(task)} here: web_recall with this step's "domain" and "intent" values.`,
      why: `${q(pb.domain)} already has a proven recipe for ${q(task)} and may share the same framework or editor primitive.`,
      priority: 45,
      intent: task,
      domain: pb.domain,
    });
  }

  // 5. A failure nobody wrote down is a failure waiting to happen again. "Failure" means what the reflection
  //    pass means by it: a refusal by the permission layer is not one, including in episodes recorded
  //    before the hub stamped its own verdict on them.
  const recentFailures = mem.episodes.filter((e) => cognitiveStore.normalizeDomain(e.domain) === domain && !e.success && isInformative(e));
  const documented = (mem.pitfalls[domain] ?? []).length;
  if (recentFailures.length >= 2 && documented === 0) {
    steps.push({
      kind: "document_pitfall",
      step: `Record what went wrong on ${q(domain)} with web_learn {action:"pitfall", ...}: ${recentFailures.length} runs have failed and nothing is written down.`,
      why: `A documented pitfall is read back by web_recall before the next attempt; an undocumented one is rediscovered the hard way.`,
      priority: 70,
    });
  }

  steps.sort((a, b) => b.priority - a.priority || a.kind.localeCompare(b.kind) || a.step.localeCompare(b.step));
  return {
    domain,
    level: ev.levelName,
    steps,
    ...(steps.length === 0 ? { note: `Nothing at the edge of ${q(domain)}'s ability right now: no unverified drafts, no stale skills, and no gap the hub can name. Do the work you came to do and the evidence will follow.` } : {}),
  };
}
