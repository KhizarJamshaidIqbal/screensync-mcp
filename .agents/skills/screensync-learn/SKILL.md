---
name: screensync-learn
description: Autonomous cognitive learning skill modeled after human child cognitive development and neuroscience. Use when an agent discovers a new site quirk, encounters a DOM pitfall, or masters an automation sequence — persists learned patterns, updates procedural playbooks, transfers skills cross-domain via associative graph, and consolidates memory.
---

# ScreenSync Cognitive Learning — Human Mind 1:1 Learning Model

This skill encodes the **Human Mind Cognitive Learning Protocol** for AI agents operating through ScreenSync. Just as a child learns through sensory probing, trial, negative imprinting (pitfalls), and motor proceduralization, an agent operating web applications must never repeat errors or relearn mastered motor routines from scratch.

---

## 🧠 The Human Mind 1:1 Neuro-Cognitive Architecture

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                HUMAN CHILD COGNITION                                   │
│  Aankhein / Sensory Probes       Prefrontal Cortex              Neocortex / Memory     │
│  "Stove par aag jal rahi hai?   "Haath mat lagao,        "Kali cheez (stove) garam    │
│   Kya tawa pehle se garam hai?   sidha chimtay se        hogi to jalaye gi!            │
│   Kya koi draft jal raha hai?"   uthana seekho!"          Chimta use karo (Playbook)!" │
└───────────────────────────┬────────────────────────────────────────────┬───────────────┘
                            │ 1:1 Translation                            │
┌───────────────────────────▼────────────────────────────────────────────▼───────────────┐
│                           SCREENSYNC COGNITIVE AGENT                                   │
│  Sensory Environmental Probes    Prefrontal Fast-Path Engine     Cognitive Store       │
│  • web_warm / web_contract_check • Dynamic Branch Skipping       • Pitfalls (Negative) │
│  • Probe: Auth active? Modal on? • Direct atomic execCommand     • Playbooks (Gold)    │
│  • Scan: Dirty uncommitted form? • Circuit Breaker Guard         • Associative Graph   │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 🛠️ Step-by-Step Autonomous Learning Workflow

### 1. Before Action: Sensory Probing & Recall (Warm-Up)
Always probe the environment before touching the DOM:
```javascript
// Step 1: Pre-flight warming & environmental signal probe
const warm = await callTool('web_warm', {
  domain: 'x.com',
  intent: 'post',
  profile: 'epsoldev@gmail.com'
});

// Step 2: Contract check to ensure no unsaved user forms get destroyed
const contract = await callTool('web_contract_check', {
  domain: 'x.com',
  url: currentTab.url,
  detectedDirtyFields: activeDirtyFields
});
if (!contract.data.safe) {
  // Respect user work: do not navigate away blindly!
}
```

### 2. During Action: Fast-Path Execution
If a verified playbook exists, execute it directly in `< 15 seconds`:
```javascript
const recall = await callTool('web_recall', { domain: 'x.com', intent: 'post' });
if (recall.data.recommendedPlaybook) {
  // Execute verified steps (e.g. execCommand insertText for Draft.js/Lexical)
}
```

### 3. On Error: Negative Imprinting (Inhibitory Pitfall Memory)
When an action fails (e.g., button remains disabled, selector missing, CSP violation):
**Never retry the same failing action in a loop!** Imprint the pitfall immediately into memory:
```javascript
await callTool('web_learn', {
  action: 'pitfall',
  domain: 'x.com',
  data: {
    symptom: 'web_fill leaves tweetButton disabled (aria-disabled="true")',
    rootCause: 'Draft.js requires browser native InputEvent and execCommand to sync React state',
    conditionTrigger: 'Typing into ContentEditable editor div[data-testid="tweetTextarea_0"]',
    antiPattern: 'web_fill({ selector: "...", text })',
    provenSolution: 'Focus editor, execCommand("insertText", false, text), dispatch InputEvent("input")'
  }
});
```

### 4. On Success: Procedural Playbook Compilation
When a new workflow succeeds through novel exploration, compile it into a reusable playbook with environmental probes and branches:
```javascript
await callTool('web_learn', {
  action: 'playbook',
  domain: 'x.com',
  intent: 'post',
  data: {
    name: 'x_publish_post',
    description: 'Condition-aware composition and publishing on X',
    environmentalProbes: [
      { signal: 'auth_active', selector: 'div[data-testid="SideNav_AccountSwitcher_Button"]', expected: 'present' },
      { signal: 'compose_open', selector: 'div[data-testid="tweetTextarea_0"]', expected: 'present' }
    ],
    branches: [
      { name: 'skip_compose_nav', whenSignal: 'compose_open', skipToStep: 4 }
    ],
    steps: [
      { step: 1, tool: 'web_window', args: { action: 'focus' } },
      { step: 2, tool: 'web_navigate', args: { url: 'https://x.com/compose/post' } },
      { step: 3, tool: 'web_wait_for', args: { selector: 'div[data-testid="tweetTextarea_0"]' } },
      { step: 4, tool: 'web_eval', codeSnippet: '...' },
      { step: 5, tool: 'web_eval', codeSnippet: 'document.querySelector("button[data-testid=\'tweetButton\']").click();' }
    ]
  }
});
```

### 5. Cross-Domain Skill Transfer (Associative Graph)
When visiting a sister or competitor platform (e.g., `threads.net`, `linkedin.com`):
Do not start from zero trial-and-error! Query the Cognitive Associative Graph to inherit proven recipes:
```javascript
const transfer = await callTool('web_graph_query', {
  domain: 'threads.net',
  intent: 'post',
  transferSkill: true
});
// Automatically inherits Lexical ContentEditable input recipe from x.com!
```

### 6. Metacognitive Reflex & Confidence Calibration (Dual Process System 1 vs 2)
Before execution, evaluate metacognitive confidence:
```javascript
const meta = await callTool('web_metacognition', {
  domain: 'x.com',
  intent: 'post',
  currentLatencyMs: 820
});
// If confidenceScore >= 0.85 -> SYSTEM_1_REFLEX (< 3s fast-path).
// If 0.50 <= confidenceScore < 0.85 -> SYSTEM_2_DELIBERATE (step-by-step perception verification).
// If anomalyDetected: true -> server throttling suspected, timeout automatically adjusted.
```

### 7. Semantic Intent & Selector Similarity Search (BigQuery AI.SIMILARITY pattern)
Resolve fuzzy user requests to canonical playbooks without hardcoded keyword dictionaries:
```javascript
const sim = await callTool('web_similarity_search', {
  intent: 'tweet my thoughts',
  targetElementDescription: 'post button',
  candidates: [{ selector: 'button.submit', text: 'Post Tweet', role: 'button' }]
});
// Resolves canonicalIntent: 'post' (0.98 similarity) and bestMatch: 'button.submit'.
```

### 8. Federated Multi-Profile Catalog (Lakehouse Mesh)
Share verified recipes across isolated browser profiles safely:
```javascript
// Query shared recipes from the federated mesh
const fed = await callTool('web_federated_catalog', { action: 'list_shared', domain: 'x.com' });

// Contribute an anonymized recipe (auto-scrubs emails, JWT tokens, and cookies)
await callTool('web_federated_catalog', {
  action: 'publish',
  domain: 'threads.net',
  intent: 'post',
  recipe: { method: 'execCommand', selector: 'div[contenteditable="true"]' }
});
```

### 9. Neuro-Developmental Stages & Dynamic Scaffolding (Architecture 5.0)
Just as a human develops from infancy to adulthood (Piagetian cognitive stages & Vygotsky ZPD scaffolding), an agent assesses domain mastery level before acting:

```javascript
// Check current developmental stage and active scaffolding constraints
const stage = await callTool('web_cognitive_stage', {
  action: 'get',
  domain: 'x.com'
});
// Response:
// {
//   stage: 'LEVEL_4_FORMAL_OPERATIONAL',
//   level: 4,
//   xp: 125,
//   scaffolding: {
//     perceptionPauseMs: 0,
//     requireHumanConfirm: false,
//     allowBranchSkipping: true,
//     allowCrossDomainTransfer: true,
//     fastPathSystem1Allowed: true
//   }
// }

// After executing an action, report outcome to award XP or trigger Stress Regression:
await callTool('web_cognitive_stage', {
  action: 'evaluate',
  domain: 'x.com',
  outcome: 'success' // or 'failure', 'severe_drift'
});
```

#### The 5 Cognitive Developmental Levels:
1. **Level 1 — Sensorimotor (Infant)**: New/unknown domain (0–19 XP). Maximum scaffolding (`requireHumanConfirm: true`, 3000ms sensory pause, branch skipping disabled).
2. **Level 2 — Preoperational (Toddler)**: Early pattern recognition (20–49 XP). Basic playbook execution, 1500ms perception pause, initial pitfall imprinting.
3. **Level 3 — Concrete Operational (Child)**: Structured multi-branch playbooks (50–99 XP). 500ms pause, form safety contracts (`web_contract_check`), self-healing DOM drift correction.
4. **Level 4 — Formal Operational (Adult)**: Abstract reasoning (100–199 XP). 0ms pause, cross-domain skill transfer (`web_graph_query`), dual-process metacognition, federated mesh sharing.
5. **Level 5 — Sovereign Sage (Master)**: Fully habituated autonomy (200+ XP). Sub-3s atomic reflex (`SYSTEM_1_REFLEX`), zero-shot adaptation.
6. **Stress Regression**: On 3 consecutive failures or severe drift, automatically regresses to Level 2/3 scaffolding to protect user safety and prevent compounding errors.

### 10. Nightly / Post-Run: Hippocampal Consolidation
At session end or during periodic maintenance, trigger consolidation:
```javascript
const report = await callTool('web_consolidate', {});
// Compresses Bronze traces -> Silver metrics -> Gold playbooks.
// Applies LTP (+0.1) to verified paths and LTD (-0.25) to failing paths.
// Sanitizes private tokens/emails from shared swarm wisdom.
```

---

## 🎯 Golden Invariant for Agents
- **Speed**: System 1 Reflex executions complete in **< 3 seconds**; System 2 Deliberate in **< 15 seconds**.
- **Resilience**: Zero blind loops. Circuit breaker trips immediately on bot challenges.
- **Safety**: Never destroy user form state. Always check `web_contract_check`.
- **Privacy**: Zero credential leakage across browser profiles via federated sanitization.
- **Elegance**: Shortest working diff, fewest files, strict 500–600 line limit.

