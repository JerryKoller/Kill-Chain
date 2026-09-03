---
{
  "id": "fire-ux-level2-overnight-discovery-3",
  "title": "LEVEL 2 discovery 3: one 2–4 file presentation workflow",
  "goal": "Identify exactly one coherent presentation-only Fire Command workflow involving exactly 2–4 EXISTING UI files. Not Gate/Macro overflow, not ModuleEnableToggle contrast, not drum-fill preview. Critic must FAIL Option A/B/C, 1-file missions, and grab-bags. Read-only.",
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
    "Exactly one workflow",
    "Exactly 2, 3, or 4 existing .tsx files with real caller relationships",
    "No Option A/B/C",
    "No invented files or .vue",
    "Do not name parked GatePanel/MacroPanel/fireUiKit/ModuleEnableToggle as edit targets",
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

# LEVEL 2 discovery (strict)

READ-ONLY. Cursor will not implement a UX you leave ambiguous.

If you cannot name one defensible 2–4 file workflow with evidence, VERDICT: NOT_READY.
Do not list a menu of enhancements.
