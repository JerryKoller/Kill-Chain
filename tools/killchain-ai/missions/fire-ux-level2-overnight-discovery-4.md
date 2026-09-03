---
{
  "id": "fire-ux-level2-overnight-discovery-4",
  "title": "LEVEL 2 discovery 4: one existing 2–4 file presentation cluster",
  "goal": "Identify exactly one coherent presentation-only Fire Command workflow using exactly 2–4 EXISTING .tsx files with real imports/callers. Not Gate/Macro overflow, not ModuleEnableToggle contrast, not drum-fill preview. If none is defensible, VERDICT: NOT_READY. Read-only.",
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
    "Exactly one workflow or an explicit NOT_READY",
    "If READY: exactly 2, 3, or 4 existing .tsx files",
    "Each named file must exist on disk",
    "No Option A/B/C menu",
    "No invented files, no .vue",
    "Do not treat inner FireCommandView functions (DrivePanel, OscAPanel, GatePanel-in-view) as separate files",
    "Do not name parked GatePanel.tsx MacroPanel.tsx fireUiKit.tsx ModuleEnableToggle.tsx as edit targets",
    "Do not name FireCommandView.tsx as an edit target (too large)",
    "Presentation-only; no store/audio/DSP",
    "Final line exactly VERDICT: READY or VERDICT: NOT_READY"
  ],
  "validation": { "required": [], "optional": [] },
  "maxPhases": 6,
  "maxRetriesPerPhase": 2,
  "maxWallClockMs": 2400000,
  "maxModelCalls": 16,
  "sessionTimeoutMs": 720000,
  "proposalRounds": 1,
  "checkpointPolicy": "state-only",
  "commitPolicy": "none",
  "corpus": "if-stale"
}
---

# LEVEL 2 discovery 4 (strict, read-only)

Previous overnight discoveries failed as live candidates:
- 1-file + Option A/B/C
- grab-bag / disagreeing file lists
- invented `DrivePanel.tsx` (DrivePanel is a function **inside** `FireCommandView.tsx`, around line 11933 — there is no DrivePanel.tsx)
- honest NOT_READY on a panel-map (acceptable)

`GatePanel` and `MacroPanel` also exist both as helper modules **and** as inner functions in `FireCommandView.tsx`. Do not confuse those.

Use Kill Chain MCP (`search`, `symbol`, `callers`) first. Glob `src/components/FireCommand/*.tsx` for real filenames.

Pick **one** small existing cluster such as a panel helper + its StageViz + a shared chrome file, only if they already import each other and the change would be presentation-only.

If you cannot defend exactly one 2–4 file workflow with caller evidence, write VERDICT: NOT_READY. That is a valid successful discovery.

Do not list a menu. Do not invent files. Do not edit production.
