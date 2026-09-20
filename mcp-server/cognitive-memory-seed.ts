// ScreenSync Cognitive Memory - first-run seed data.
//
// Used ONLY when no memory file exists yet (or the old one was quarantined as unreadable).
// It was split out of cognitive-memory.ts, which had passed the 500-line ceiling.
// A file that parses is never replaced with this seed - see CognitiveMemoryStore.load().

import type { CognitiveMemoryData } from "./cognitive-memory.js";

export function getDefaultSeededMemory(): CognitiveMemoryData {
  return {
    version: "1.3.0",
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
        // Shipped with the build and hand-verified, so it is a fast path from the first run.
        status: "verified",
        provenance: "seed",
        verifications: [],
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
    reflections: {},
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
