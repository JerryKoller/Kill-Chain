---
{
  "id": "fire-ux-level2-overnight-discovery-7",
  "title": "Level 2 discovery: mutual-import helper pair with named friction",
  "goal": "Identify one presentation-only Fire Command workflow using 2–4 EXISTING files that already import each other (for example a *Panel.tsx helper and its *StageViz.tsx). Name one overflow, truncation, empty-copy, or inactive-contrast friction with a quoted line. Read-only. No production edits.",
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
    "INSPECTED at least two existing files that import each other",
    "Quoted friction line (overflow, truncation, empty copy, or contrast)",
    "Not GatePanel, MacroPanel, fireUiKit, ModuleEnableToggle, DrumMachine, PatternSelect, SequencerPanel, FireCommandView",
    "No Option A/B/C. No invented files.",
    "If no mutual-import pair with real friction, VERDICT: NOT_READY",
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

# Level 2 discovery 7 (read-only)

Use Kill Chain MCP. Use `ui fire-map` knowledge: sibling `*Panel.tsx` files are often helpers for inner functions in FireCommandView; `panelVizPairs` such as HarmonyPanel.tsx → HarmonyStageViz exist.

Do not restyle unrelated meters across Width+Human. Do not invent files. If you cannot quote a real friction in a mutual-import pair, VERDICT: NOT_READY.

No production edits. No live implementation in this mission.
