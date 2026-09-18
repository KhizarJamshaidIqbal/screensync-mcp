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

> [!IMPORTANT]
> **MANDATORY IRON RULE: Learn, Record & Update INSTANTLY (NO DEFERRAL — User-Ordered 2026-09-19)**
> Never wait until the end of the session or conversation to register learning!
> The exact instant you discover a DOM quirk, solve a disabled button state, pierce a Shadow DOM boundary, or succeed on a sequence, call `web_learn` immediately, evolve maturity via `web_cognitive_maturation`, and run `web_consolidate` so knowledge is instantly persistent.

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

### 10. Hippocampal SWR Replay, Episodic Recall & Cognitive Hygiene (Architecture 6.0)

#### A. Offline SWR Replay & Counterfactual Simulation (`web_cognitive_replay`)
Replay execution traces at 15x acceleration during idle periods to discover vulnerabilities and auto-synthesize fallback branches *before* live execution:
```javascript
const replay = await callTool('web_cognitive_replay', {
  domain: 'x.com',
  autoSynthesizeBranch: true,
  counterfactualScenarios: [
    { type: 'unexpected_modal', modalSelector: 'div[data-testid="confirmationSheetConfirm"]' },
    { type: 'network_spike', latencyMs: 3500 },
    { type: 'dom_mutation', modifiedSelector: 'button[data-testid="tweetButtonInline"]' }
  ]
});
// Automatically discovers modal interruption vulnerabilities and generates self-healing branches!
```

#### B. Tulving's Autobiographical Episodic Memory Query (`web_episodic_query`)
Query past biographical experiences across domains, tabs, and time:
```javascript
const history = await callTool('web_episodic_query', {
  domain: 'x.com',
  intent: 'post',
  outcome: 'success'
});
// Retrieves full autobiographical context: latency trends, probes observed, and lessons learned.
```

#### C. Cognitive Store Hygiene & Autocleaning (`web_cognitive_hygiene`)
Profile data quality and prune orphan branches while strictly honoring `accidental_data_loss_prevention`:
```javascript
// Step 1: Health audit
const audit = await callTool('web_cognitive_hygiene', { domain: 'x.com', action: 'profile' });

// Step 2: Safe autoclean
if (!audit.data.healthy) {
  await callTool('web_cognitive_hygiene', { domain: 'x.com', action: 'autoclean' });
}
```

### 11. Architecture 7.0: Developmental Epistemology & Recognition-Primed Decision (DE-RPD)

#### A. Piagetian Object Permanence (`web_object_permanence`)
Tracks elements scrolled out of view or occluded in dynamic DOMs, calculating exact scroll delta vectors to restore them into view:
```javascript
const perm = await callTool('web_object_permanence', {
  domain: 'x.com',
  selector: '#post-tweet-btn',
  action: 'resolve',
  currentViewport: { width: 1280, height: 720, scrollX: 0, scrollY: 0 }
});
// If element was observed at top: 1250px, recommends scroll deltaY: 1250px!
```

#### B. Theory of Mind & Anti-Bot Cadence (`web_theory_of_mind`)
Projects server suspicion scores and humanizes typing/clicking cadences (Gaussian jitter, Bezier mouse paths) to prevent bot detection:
```javascript
const tom = await callTool('web_theory_of_mind', {
  domain: 'x.com',
  actionCountInLastMinute: 45,
  hasCaptchaOrWafDetected: false
});
// Yields threatAssessment: 'elevated_monitoring', recommendedKeystrokeDelayMs: { mean: 95, stdDev: 25 }
```

#### C. Cognitive Reversibility & Transactional Undo (`web_cognitive_undo`)
Classifies actions into REVERSIBLE, CONDITIONAL, or IRREVERSIBLE_DESTRUCTIVE and auto-synthesizes rollback DAGs (Ctrl+Z, uncheck):
```javascript
const undo = await callTool('web_cognitive_undo', {
  targetTool: 'web_fill',
  args: { selector: '#compose-text', value: 'Hello' }
});
// category: 'REVERSIBLE', inverseAction: { tool: 'web_key', args: { key: 'z', ctrl: true } }
```

#### D. Klein's Recognition-Primed Decision (`web_rpd_prototype`)
Instantly categorizes visited pages into archetypes (Rich Feed, Data Table, Wizard, Dashboard, Auth Checkpoint) with pre-calibrated motor strategies:
```javascript
const rpd = await callTool('web_rpd_prototype', { url: 'https://x.com/home' });
// archetype: 'ARCHETYPE_RICH_FEED', recommendedInputMethod: 'execCommand', sensoryRateMs: 500
```

---

### 12. Architecture 8.0: Ontogenetic Cognitive Maturation & Property Graph Lineage (OCM-PGL)

#### A. Ontogenetic Developmental Stages (`web_cognitive_maturation`)
Tracks domain-specific cognitive age and XP progression from Infant (Level 1) to Sovereign Sage (Level 5):
```javascript
// Step 1: Query or initialize maturity profile
const maturity = await callTool('web_cognitive_maturation', { domain: 'new-site.com' });
// stage: 'STAGE_1_INFANT_SENSORIMOTOR', exploratoryCaution: 'extreme_nociceptive', batching: false

// Step 2: Evolve upon success or demote upon hot-stove burns (trauma)
await callTool('web_cognitive_maturation', {
  domain: 'new-site.com',
  event: { outcome: 'success', xpGain: 150 }
});
// Levels up to 'STAGE_2_CHILD_SYMBOLIC' with relaxed perception pauses!
```

#### B. Epistemic Property Graph & Causal Lineage (`web_epistemic_graph`)
Synthesizes `data-agent-kit-plugin` and BigQuery Graph topologies for web workflows:
```javascript
// Add Page, Component, Action, and Incident nodes with directed edges
await callTool('web_epistemic_graph', {
  action: 'add_node',
  node: { id: 'page_cart', label: 'PAGE', properties: { url: '/cart' } }
});

// Trace backward causal lineage from an error incident to find root cause
const lineage = await callTool('web_epistemic_graph', {
  action: 'trace_lineage',
  targetNodeId: 'incident_checkout_failure'
});
// Returns full provenance DAG back to rootCauseNode!
```

#### C. Epistemic Curiosity Frontier (`web_curiosity_frontier`)
Calculates information gain vs risk to guide safe autonomous exploration:
```javascript
const frontier = await callTool('web_curiosity_frontier', {
  elements: [
    { selector: 'a[href="/insights"]', text: 'Insights', tag: 'a' },
    { selector: 'button.delete-all', text: 'Delete All', tag: 'button' }
  ]
});
// Safely marks 'button.delete-all' as skip_destructive and picks '/insights' for next exploration!
```

#### D. Biological Homeostatic Regulation (`web_homeostatic_regulation`)
Prevents cognitive exhaustion and sensory overload under high DOM or network stress:
```javascript
const homeo = await callTool('web_homeostatic_regulation', {
  domNodeCount: 6500,
  actionsPerMinute: 75,
  recentErrorRate: 0.35,
  averageLatencyMs: 1800,
  threatSuspicionScore: 0.6
});
// If allostaticState: 'OVERLOADED' -> injects calm pause and commands working memory cache flush!
```

---

### 13. Architecture 9.0: Lifespan Cognitive Ontogeny & Epistemic Property Graph 2.0 (LCO-EPG)

#### A. Lifespan Cognitive Development Engine (`web_cognitive_lifespan`)
Tracks real-time cognitive lifespan age (0.1 infant to 50.0 sage), Vygotskian scaffolding levels, and hot-stove pain regressions:
```javascript
const lifespan = await callTool('web_cognitive_lifespan', {
  domain: 'portal.enterprise.internal',
  event: { outcome: 'success', milestoneName: 'auth_workflow_complete' }
});
// Advances cognitiveAgeYears: 2.4 -> 3.6, promotes scaffoldingLevel: 'GUIDED_CHILD' -> 'COLLABORATIVE_YOUTH'!
```

#### B. Property Graph GQL Pattern Matcher & Cycle Detection (`web_graph_pattern_match`)
Queries multi-hop paths across the browser graph and detects infinite redirect loops (synthesizing BigQuery GQL):
```javascript
const match = await callTool('web_graph_pattern_match', {
  startNodeId: 'page_login',
  targetNodeId: 'btn_publish',
  nodes: registeredGraphNodes,
  edges: registeredGraphEdges,
  maxDepth: 5
});
// If cycleDetected: true -> alerts agent to avoid infinite navigation loops!
// Returns shortestSafePath with lowest cumulative risk!
```

#### C. Infant Motor Babbling & Coordinate Calibration (`web_motor_babbling`)
Probes event mechanics on complex SPAs before executing high-speed automation macros:
```javascript
const motor = await callTool('web_motor_babbling', {
  domain: 'app.canva.com',
  targetElementType: 'canvas',
  sampleLatencyMs: 25,
  devicePixelRatio: 2.0
});
// recommendedDispatchType: 'pointer_synthetic', coordinateAccuracy: 0.98
```

#### D. Gentner's Structure-Mapping Analogical Transfer (`web_metaphoric_transfer`)
Transfers mature procedural schemas from familiar platforms to new targets:
```javascript
const transfer = await callTool('web_metaphoric_transfer', {
  sourceDomain: 'x.com',
  targetDomain: 'bsky.app'
});
// Automatically maps composer_editor to div[contenteditable="true"] and transfers verified publishing playbooks!
```

---

### 14. Nightly / Post-Run: Hippocampal Consolidation
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

