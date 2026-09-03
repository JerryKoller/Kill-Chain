---
{
  "id": "fire-panel-map-overnight",
  "title": "Read-only map of Fire Command panel files and store reads",
  "goal": "List existing Fire Command panel/module files (not the 15k view dump) with which Zustand stores they read. Identify 2–4 file presentation-only clusters that are NOT Gate/Macro, ModuleEnableToggle, or drum-fill. Read-only. No production edits. If no cluster is defensible, VERDICT: NOT_READY.",
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
    "Table of real .tsx files that exist",
    "Store reads named from evidence",
    "Zero or one 2–4 file cluster; no Option A/B/C",
    "Do not invent DrivePanel.tsx or .vue",
    "Do not name parked files as edit targets",
    "VERDICT: READY only if a cluster is defensible; otherwise NOT_READY"
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

# Panel map (read-only)

Prefer split-out panel files under src/components/FireCommand/*.tsx, not inventing files that live only inside FireCommandView.

If the only honest answer is that no new 2–4 file overnight live mission is defensible, say NOT_READY.
