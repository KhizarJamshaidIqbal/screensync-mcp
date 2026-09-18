# ScreenSync Cognitive Memory & Anti-Regression Invariant

## 1. The Cognitive Pre-Flight Rule (Never Re-Invent the Wheel)
Before interacting with or automating any complex, interactive, or stateful web domain (e.g. X/Twitter, LinkedIn, WordPress, GitHub, Stripe, Shopify):
- **ALWAYS** call `web_recall { domain, intent }` first.
- If a procedural playbook is returned, **DO NOT explore or guess from scratch**. Execute the fast-path playbook directly.
- Target execution time for recurring learned tasks: **under 1 minute**.
- Inspect retrieved `pitfalls` and `antiPattern` warnings before executing any script or DOM manipulation.

## 2. Mandatory Cognitive Learning & Imprinting
Whenever an agent encounters and resolves a non-trivial obstacle:
- Examples: custom rich-text editor (Draft.js/Lexical/Slate/Monaco), CSP restrictions, shadow DOM barriers, React controlled component state, window focus requirements, multi-profile routing.
- The agent **MUST** call `web_learn` immediately upon successful verification to persist:
  1. `action: "pitfall"` — Document the symptom, root cause, the anti-pattern to avoid, and the proven fix.
  2. `action: "playbook"` — Document the end-to-end verified multi-step sequence.
  3. `action: "fact"` — Update domain framework quirks and key selectors.

## 3. Human Mind Memory Progression
- **Sensory/Working**: Observe live page perception (`web_page_observe` / `web_aria_snapshot`).
- **Episodic**: Retain historical runs and execution traces.
- **Semantic**: Abstracted domain facts and selector maps.
- **Procedural**: Automated motor playbooks (`web_recall`).
