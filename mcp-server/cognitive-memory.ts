// ScreenSync Cognitive Memory & Auto-Learning Engine (Enhanced Multi-Condition Model)
// Direct human-mind & child cognitive development model:
// 1. Sensory Perception & Condition Probes (Is flame lit? Is steam rising? Proximity warmth test?)
// 2. State-Dependent Episodic Memory (Recognizing environment before acting)
// 3. Semantic Memory (Abstract facts & framework rules)
// 4. Adaptive Procedural Memory (Playbooks with conditional branches)

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DATA_DIR, log } from "./config.js";
import { runHippocampalConsolidation, type ConsolidationReport } from "./cognitive-consolidation.js";
import { speculativeWarm, globalCircuitBreaker, type SpeculativeWarmResult } from "./cognitive-warming.js";
import { healPlaybookStep, type HealCandidate, type HealResult } from "./cognitive-healer.js";

export interface PlaybookStep {
  step: number;
  name: string;
  tool: string;
  args?: Record<string, unknown>;
  codeSnippet?: string;
  expectedOutcome?: string;
}

export interface StateProbe {
  signal: string;
  selector?: string;
  expected: "present" | "absent" | "matches";
  pattern?: string;
  humanAnalogy: string;
}

export interface PlaybookBranch {
  name: string;
  conditionDescription: string;
  whenSignal: string;
  skipToStep?: number;
  alternateSteps?: PlaybookStep[];
}

export interface ProceduralPlaybook {
  id: string;
  name: string;
  domain: string;
  intent: string;
  description: string;
  environmentalProbes: StateProbe[];
  preconditions: string[];
  steps: PlaybookStep[];
  branches?: PlaybookBranch[];
  successCount: number;
  lastExecutedAt?: string;
  targetDurationSeconds?: number;
}

export interface DomainPitfall {
  id: string;
  domain: string;
  symptom: string;
  rootCause: string;
  conditionTrigger?: string;
  antiPattern: string;
  provenSolution: string;
  codeSnippet?: string;
  discoveredAt: string;
}

export interface DomainSemanticMemory {
  domain: string;
  framework?: string;
  authRequired?: boolean;
  cspRestricted?: boolean;
  preferredInputMethod?: "execCommand" | "fill" | "type" | "cdp";
  keySelectors?: Record<string, string>;
  lastVerifiedAt?: string;
}

export interface ExecutionEpisode {
  id: string;
  timestamp: string;
  domain: string;
  intent: string;
  profile?: string;
  conditionSignals?: Record<string, boolean>;
  success: boolean;
  durationMs: number;
  pitfallsEncountered?: string[];
  notes?: string;
}

export interface CognitiveMemoryData {
  version: "1.1.0";
  updatedAt: string;
  domains: Record<string, DomainSemanticMemory>;
  playbooks: Record<string, ProceduralPlaybook>;
  pitfalls: Record<string, DomainPitfall[]>;
  episodes: ExecutionEpisode[];
}

const MEMORY_FILE = path.join(DATA_DIR, "cognitive-memory.json");

function getDefaultSeededMemory(): CognitiveMemoryData {
  return {
    version: "1.1.0",
    updatedAt: new Date().toISOString(),
    domains: {
      "x.com": {
        domain: "x.com",
        framework: "Draft.js / Lexical ContentEditable",
        authRequired: true,
        cspRestricted: true,
        preferredInputMethod: "execCommand",
        keySelectors: {
          editor: 'div[data-testid="tweetTextarea_0"]',
          tweetButton: 'button[data-testid="tweetButton"]',
          tweetArticle: 'article[data-testid="tweet"]',
          tweetText: 'div[data-testid="tweetText"]',
          userName: 'div[data-testid="User-Name"]',
          accountSwitcher: 'div[data-testid="SideNav_AccountSwitcher_Button"]',
          discardConfirm: 'div[data-testid="confirmationSheetConfirm"]'
        },
        lastVerifiedAt: "2026-09-18T10:43:12.000Z"
      }
    },
    playbooks: {
      "x_publish_post": {
        id: "pb_x_publish_post",
        name: "x_publish_post",
        domain: "x.com",
        intent: "post",
        description: "Condition-aware composition and publishing on X (Twitter). Checks environmental signals before firing motor steps.",
        environmentalProbes: [
          {
            signal: "flame_is_lit_auth_active",
            selector: 'div[data-testid="SideNav_AccountSwitcher_Button"]',
            expected: "present",
            humanAnalogy: "Like checking if stove burner is on and gas supply is active (user is authenticated)"
          },
          {
            signal: "pan_already_on_fire_compose_open",
            selector: 'div[data-testid="tweetTextarea_0"]',
            expected: "present",
            humanAnalogy: "Like checking if the pan is already on the flame (compose modal is already open, skip navigation)"
          },
          {
            signal: "food_burning_unsaved_draft_dialog",
            selector: 'div[data-testid="confirmationSheetConfirm"]',
            expected: "absent",
            humanAnalogy: "Like checking if an old burnt pan is blocking the burner (unsaved draft dialog must be cleared first)"
          },
          {
            signal: "stove_in_cupboard_logged_out",
            selector: 'a[href="/login"]',
            expected: "absent",
            humanAnalogy: "Like the stove being cold and unplugged (user is logged out, stop and authenticate)"
          }
        ],
        branches: [
          {
            name: "fast_skip_modal_open",
            conditionDescription: "Compose modal is already open in DOM (pan is already on fire)",
            whenSignal: "pan_already_on_fire_compose_open",
            skipToStep: 4
          },
          {
            name: "clear_burnt_draft",
            conditionDescription: "Unsaved draft dialog is active, must clear before posting",
            whenSignal: "food_burning_unsaved_draft_dialog",
            alternateSteps: [
              {
                step: 0,
                name: "Discard Stuck Draft",
                tool: "web_click",
                args: { selector: 'div[data-testid="confirmationSheetConfirm"]' },
                expectedOutcome: "Old draft dialog dismissed"
              }
            ]
          }
        ],
        preconditions: [
          "Target window must be focused (web_window { action: 'focus', windowId })",
          "Specify profile: 'epsoldev@gmail.com' for multi-profile isolation",
          "Environmental probe: auth session must be active"
        ],
        steps: [
          {
            step: 1,
            name: "Focus Target Window",
            tool: "web_window",
            args: { action: "focus" },
            expectedOutcome: "Window is active and responsive"
          },
          {
            step: 2,
            name: "Navigate to Compose Modal",
            tool: "web_navigate",
            args: { url: "https://x.com/compose/post" },
            expectedOutcome: "Compose modal loaded"
          },
          {
            step: 3,
            name: "Wait for ContentEditable Editor",
            tool: "web_wait_for",
            args: { selector: 'div[data-testid="tweetTextarea_0"]', timeoutMs: 5000 },
            expectedOutcome: "Editor container is ready in DOM"
          },
          {
            step: 4,
            name: "Atomic Text Injection via execCommand",
            tool: "web_eval",
            codeSnippet: "const el = document.querySelector('div[data-testid=\\\"tweetTextarea_0\\\"]'); el.focus(); document.execCommand('selectAll', false, null); document.execCommand('delete', false, null); document.execCommand('insertText', false, postText); el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: '' }));",
            expectedOutcome: "Text entered and tweetButton enabled (disabled = false)"
          },
          {
            step: 5,
            name: "Click Post Button",
            tool: "web_eval",
            codeSnippet: "const btn = document.querySelector('button[data-testid=\\\"tweetButton\\\"]'); btn.click();",
            expectedOutcome: "Post submitted"
          },
          {
            step: 6,
            name: "Verify Live Tweet on Profile Feed",
            tool: "web_navigate",
            args: { url: "https://x.com/{profileUsername}" },
            expectedOutcome: "Top tweet in feed matches published text"
          }
        ],
        successCount: 2,
        lastExecutedAt: "2026-09-18T10:43:12.000Z",
        targetDurationSeconds: 15
      }
    },
    pitfalls: {
      "x.com": [
        {
          id: "pitfall_x_draftjs_fill",
          domain: "x.com",
          symptom: "Using web_fill or setting innerText leaves tweetButton disabled (aria-disabled=\"true\").",
          rootCause: "Draft.js / Lexical requires browser native input events and contentEditable execCommand to synchronize internal React state.",
          conditionTrigger: "When typing into ContentEditable editor div[data-testid=\"tweetTextarea_0\"]",
          antiPattern: "web_fill({ selector: 'div[data-testid=\\\"tweetTextarea_0\\\"]', text })",
          provenSolution: "Focus editor, execCommand('selectAll'), execCommand('delete'), execCommand('insertText', false, text), dispatch InputEvent('input').",
          discoveredAt: "2026-09-18T10:30:00.000Z"
        },
        {
          id: "pitfall_x_csp_eval",
          domain: "x.com",
          symptom: "web_eval fails with Content Security Policy violation in main world.",
          rootCause: "x.com sends strict CSP headers forbidding eval() in page world.",
          conditionTrigger: "Evaluating expressions in MAIN world",
          antiPattern: "Running arbitrary eval in MAIN world without fallback.",
          provenSolution: "Use CDP Runtime.evaluate or extension ISOLATED world script injection.",
          discoveredAt: "2026-09-18T10:25:00.000Z"
        },
        {
          id: "pitfall_x_unfocused_screenshot",
          domain: "x.com",
          symptom: "web_screenshot times out or fails on background window.",
          rootCause: "Chrome captureVisibleTab requires the target window to be active/focused.",
          conditionTrigger: "When window state is unfocused/minimized",
          antiPattern: "Capturing tab while target window is minimized or unfocused.",
          provenSolution: "Call web_window({ action: 'focus', windowId }) before capture.",
          discoveredAt: "2026-09-18T10:15:00.000Z"
        },
        {
          id: "pitfall_x_multi_profile_crosstalk",
          domain: "x.com",
          symptom: "Operating wrong browser profile when multiple windows are open.",
          rootCause: "ScreenSync tool calls route to first connected browser if profile is omitted.",
          conditionTrigger: "When multiple browser instances are connected",
          antiPattern: "web_navigate({ url: 'https://x.com' }) without profile argument.",
          provenSolution: "Always pass profile: 'epsoldev@gmail.com' (or target profile).",
          discoveredAt: "2026-09-18T09:40:00.000Z"
        }
      ]
    },
    episodes: [
      {
        id: "ep_20260918_x_post_v19",
        timestamp: "2026-09-18T10:43:12.000Z",
        domain: "x.com",
        intent: "post",
        profile: "epsoldev@gmail.com",
        conditionSignals: {
          flame_is_lit_auth_active: true,
          pan_already_on_fire_compose_open: false,
          food_burning_unsaved_draft_dialog: false
        },
        success: true,
        durationMs: 14500,
        pitfallsEncountered: [
          "pitfall_x_draftjs_fill",
          "pitfall_x_csp_eval",
          "pitfall_x_unfocused_screenshot"
        ],
        notes: "ScreenSync v1.9 announcement published successfully to @EpsolDev."
      }
    ]
  };
}

export class CognitiveMemoryStore {
  private data: CognitiveMemoryData | null = null;

  public load(): CognitiveMemoryData {
    if (this.data) return this.data;
    try {
      if (existsSync(MEMORY_FILE)) {
        const raw = readFileSync(MEMORY_FILE, "utf8");
        const parsed = JSON.parse(raw);
        if (
          parsed &&
          parsed.version === "1.1.0" &&
          Array.isArray(parsed.playbooks?.["x_publish_post"]?.environmentalProbes) &&
          parsed.playbooks["x_publish_post"].environmentalProbes.length > 0
        ) {
          this.data = parsed;
          return this.data!;
        }
      }
    } catch (e) {
      log("WARN", "Failed to read cognitive memory, initializing fresh", { error: String(e) });
    }
    this.data = getDefaultSeededMemory();
    this.save();
    return this.data;
  }

  public save(): void {
    if (!this.data) return;
    try {
      mkdirSync(DATA_DIR, { recursive: true });
      this.data.updatedAt = new Date().toISOString();
      writeFileSync(MEMORY_FILE, JSON.stringify(this.data, null, 2), "utf8");
    } catch (e) {
      log("ERROR", "Failed to save cognitive memory", { error: String(e) });
    }
  }

  public normalizeDomain(input?: string): string {
    if (!input) return "";
    try {
      const u = new URL(input.startsWith("http") ? input : `https://${input}`);
      return u.hostname.replace(/^www\./, "").toLowerCase();
    } catch {
      return String(input).replace(/^www\./, "").toLowerCase();
    }
  }

  public recall(cue: {
    domain?: string;
    url?: string;
    intent?: string;
    profile?: string;
    detectedSignals?: Record<string, boolean>;
  }) {
    const data = this.load();
    const domain = this.normalizeDomain(cue.domain || cue.url);
    const intent = (cue.intent || "").toLowerCase();

    const domainFacts = domain ? (data.domains[domain] || null) : null;
    const domainPitfalls = domain ? (data.pitfalls[domain] || []) : [];

    const matchingPlaybooks = Object.values(data.playbooks).filter((pb) => {
      if (domain && this.normalizeDomain(pb.domain) !== domain) return false;
      if (intent && pb.intent.toLowerCase() !== intent) return false;
      return true;
    });

    const hasPlaybook = matchingPlaybooks.length > 0;
    let recommendedPlaybook: ProceduralPlaybook | null = hasPlaybook ? matchingPlaybooks[0] : null;
    let selectedBranch: PlaybookBranch | null = null;

    if (recommendedPlaybook && cue.detectedSignals) {
      const matched = recommendedPlaybook.branches?.find(
        (b) => cue.detectedSignals?.[b.whenSignal] === true
      );
      if (matched) selectedBranch = matched;
    }

    return {
      found: Boolean(domainFacts || domainPitfalls.length > 0 || hasPlaybook),
      domain,
      intent: intent || undefined,
      domainFacts,
      pitfalls: domainPitfalls,
      recommendedPlaybook,
      selectedBranch,
      environmentalProbes: recommendedPlaybook?.environmentalProbes || [],
      fastPathAvailable: Boolean(recommendedPlaybook),
      estimatedSeconds: selectedBranch?.skipToStep ? 5 : (recommendedPlaybook?.targetDurationSeconds || 15)
    };
  }

  public learn(params: {
    action: "playbook" | "pitfall" | "fact" | "episode";
    domain: string;
    intent?: string;
    data: Record<string, any>;
  }) {
    const mem = this.load();
    const domain = this.normalizeDomain(params.domain);
    if (!domain) throw new Error("domain is required for learning");

    let entryId = "";

    switch (params.action) {
      case "playbook": {
        const pb = params.data as Partial<ProceduralPlaybook>;
        const id = pb.id || `pb_${domain.replace(/\./g, "_")}_${pb.name || "custom"}`;
        const playbook: ProceduralPlaybook = {
          id,
          name: pb.name || id,
          domain,
          intent: pb.intent || params.intent || "general",
          description: pb.description || "Learned procedural playbook",
          environmentalProbes: Array.isArray(pb.environmentalProbes) ? pb.environmentalProbes : [],
          branches: Array.isArray(pb.branches) ? pb.branches : [],
          preconditions: Array.isArray(pb.preconditions) ? pb.preconditions : [],
          steps: Array.isArray(pb.steps) ? (pb.steps as PlaybookStep[]) : [],
          successCount: (pb.successCount || 1),
          lastExecutedAt: new Date().toISOString(),
          targetDurationSeconds: pb.targetDurationSeconds || 30
        };
        mem.playbooks[playbook.name] = playbook;
        entryId = id;
        break;
      }
      case "pitfall": {
        const pf = params.data;
        const id = pf.id || `pitfall_${domain.replace(/\./g, "_")}_${Date.now()}`;
        const pitfall: DomainPitfall = {
          id,
          domain,
          symptom: String(pf.symptom || "Unexpected failure"),
          rootCause: String(pf.rootCause || "Unknown root cause"),
          conditionTrigger: pf.conditionTrigger ? String(pf.conditionTrigger) : undefined,
          antiPattern: String(pf.antiPattern || ""),
          provenSolution: String(pf.provenSolution || ""),
          codeSnippet: pf.codeSnippet ? String(pf.codeSnippet) : undefined,
          discoveredAt: new Date().toISOString()
        };
        if (!mem.pitfalls[domain]) mem.pitfalls[domain] = [];
        mem.pitfalls[domain].push(pitfall);
        entryId = id;
        break;
      }
      case "fact": {
        const existing = mem.domains[domain] || { domain };
        mem.domains[domain] = {
          ...existing,
          ...params.data,
          domain,
          lastVerifiedAt: new Date().toISOString()
        };
        entryId = domain;
        break;
      }
      case "episode": {
        const ep = params.data;
        const id = ep.id || `ep_${Date.now()}`;
        const episode: ExecutionEpisode = {
          id,
          timestamp: new Date().toISOString(),
          domain,
          intent: ep.intent || params.intent || "task",
          profile: ep.profile,
          conditionSignals: ep.conditionSignals || {},
          success: Boolean(ep.success),
          durationMs: Number(ep.durationMs) || 0,
          pitfallsEncountered: Array.isArray(ep.pitfallsEncountered) ? ep.pitfallsEncountered : [],
          notes: ep.notes
        };
        mem.episodes.push(episode);
        if (mem.episodes.length > 200) mem.episodes.shift();
        entryId = id;
        break;
      }
      default:
        throw new Error(`Unknown learn action: ${params.action}`);
    }

    this.save();
    return { learned: true, action: params.action, domain, entryId };
  }

  public consolidate(): ConsolidationReport {
    const mem = this.load();
    const { report } = runHippocampalConsolidation(mem);
    this.save();
    return report;
  }

  public warm(params: {
    domain: string;
    intent: string;
    profile?: string;
    detectedSignals?: Record<string, boolean>;
  }): SpeculativeWarmResult {
    return speculativeWarm({ store: this, ...params });
  }

  public heal(params: {
    playbookId: string;
    stepIndex: number;
    failingSelector: string;
    candidate: HealCandidate;
  }): HealResult {
    return healPlaybookStep({ store: this, ...params });
  }
}

export const cognitiveStore = new CognitiveMemoryStore();
