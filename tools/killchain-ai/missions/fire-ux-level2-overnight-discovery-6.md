---
{
  "id": "fire-ux-level2-overnight-discovery-6",
  "title": "Level 2 discovery: one extracted Fire Command panel pair",
  "goal": "Identify one coherent presentation-only Fire Command workflow using exactly 2–4 EXISTING sibling files under src/components/FireCommand/. Must name one real user-visible friction. Read-only. No production edits.",
  "level": 0,
  "allowedPaths": [],
  "preserveDirtyPaths": [
    "src/components/FireCommand/GatePanel.tsx",
    "src/components/FireCommand/MacroPanel.tsx",
    "src/components/FireCommand/fireUiKit.tsx",
    "src/components/FireCommand/ModuleEnableToggle.tsx"
  ],
  "readOnlyPaths": [
    "src/components/FireCommand/**"
  ],
  "forbiddenPaths": [
    "src/audio/**",
    "src/state/**",
    "electron/**",
    "package.json"
  ],
  "acceptance": [
    "INSPECTED: at least two existing src/components/FireCommand/*.tsx files that are not GatePanel, MacroPanel, fireUiKit, ModuleEnableToggle, DrumMachine, PatternSelect, SequencerPanel, or FireCommandView",
    "Name one user-visible friction (overflow, empty copy, inactive contrast, selection clarity) with evidence from those files",
    "Do not invent files. DrivePanel.tsx does not exist.",
    "Do not list Option A/B/C. Do not ask the operator to choose.",
    "If no defensible 2-4 file workflow exists, VERDICT: NOT_READY",
    "No production edits"
  ],
  "validation": { "required": [], "optional": [] },
  "maxPhases": 6,
  "maxRetriesPerPhase": 2,
  "maxWallClockMs": 1800000,
  "maxModelCalls": 16,
  "sessionTimeoutMs": 720000,
  "proposalRounds": 1,
  "checkpointPolicy": "state-only",
  "commitPolicy": "none",
  "corpus": "if-stale"
}
---

# Level 2 discovery 6 (read-only)

Previous discoveries failed because they invented files, asked the operator, required bidirectional imports, or named Harmony without friction.

This pass:

- Use Kill Chain MCP first.
- Only existing files under `src/components/FireCommand/`.
- Prefer extracted `*Panel.tsx` siblings (Width, Glue, Human, Harmony, Scenes, …) that import each other or a viz helper.
- Forbidden reuse: Gate/Macro/toggle/fireUiKit (parked), drum-fill files, FireCommandView.tsx (too large).
- One workflow. One friction. No Option menus.
- If you cannot prove a 2–4 file presentation-only mission, write VERDICT: NOT_READY.

Do not edit production. Do not propose AudioEngine, DSP, sequencer timing, or store changes.
