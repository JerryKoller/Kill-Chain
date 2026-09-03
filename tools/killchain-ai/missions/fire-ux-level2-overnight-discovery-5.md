---
{
  "id": "fire-ux-level2-overnight-discovery-5",
  "title": "LEVEL 2 discovery 5: extracted Panel.tsx + StageViz cluster",
  "goal": "Glob src/components/FireCommand/*Panel.tsx. Those extracted panel modules are real files. Inner FireCommandView functions (DrivePanel, OscAPanel, …) are NOT files. Pick exactly one presentation-only workflow using 2–4 EXISTING extracted files. Not Gate/Macro overflow, not ModuleEnableToggle contrast, not drum-fill. One-way imports count. If none, VERDICT: NOT_READY. Read-only.",
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
    "Glob *Panel.tsx before concluding nothing exists",
    "If READY: exactly 2–4 existing files with import evidence",
    "One-way panel→StageViz imports are sufficient; bidirectional is not required",
    "Do not name inner-only functions as files",
    "Do not name parked GatePanel/MacroPanel/fireUiKit/ModuleEnableToggle as edit targets",
    "Do not name FireCommandView.tsx as an edit target",
    "No Option A/B/C",
    "Presentation-only",
    "VERDICT: READY or NOT_READY"
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

# LEVEL 2 discovery 5

The previous discovery concluded NOT_READY because it treated **inner** `FireCommandView.tsx` functions as the only panels.

That is incomplete. Run glob / MCP search for:

`src/components/FireCommand/*Panel.tsx`

Those extracted files exist independently of the inner DrivePanel/OscAPanel/etc. functions.

Also glob `*StageViz.tsx`. A panel file that already imports its StageViz (one-way) is a valid 2-file cluster if a presentation-only workflow is coherent.

Still forbidden as edit targets: parked Gate/Macro/toggle/fireUiKit, FireCommandView.tsx, drum-fill files, anything in src/state or src/audio.

Pick **one** cluster or VERDICT: NOT_READY. No menus. Read-only. No production edits.
