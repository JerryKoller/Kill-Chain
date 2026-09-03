---
{
  "id": "helper-shadow-readonly-overnight",
  "title": "Read-only map of WidthPanel helper vs inner WidthPanel",
  "goal": "Prove WidthPanel.tsx is a helper, not the inner WidthPanel() in FireCommandView.tsx. Quote both. Read-only. No production edits.",
  "level": 0,
  "allowedPaths": [],
  "preserveDirtyPaths": [
    "src/components/FireCommand/GatePanel.tsx",
    "src/components/FireCommand/MacroPanel.tsx",
    "src/components/FireCommand/fireUiKit.tsx",
    "src/components/FireCommand/ModuleEnableToggle.tsx"
  ],
  "readOnlyPaths": [
    "src/components/FireCommand/WidthPanel.tsx",
    "src/components/FireCommand/FireCommandView.tsx"
  ],
  "forbiddenPaths": [
    "src/audio/**",
    "src/state/**",
    "electron/**",
    "package.json"
  ],
  "acceptance": [
    "INSPECTED: WidthPanel.tsx and FireCommandView.tsx",
    "Quote export/function in WidthPanel.tsx",
    "Quote inner function WidthPanel( in FireCommandView",
    "State clearly they are not the same edit target",
    "No production edits",
    "VERDICT: READY or NOT_READY"
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

# WidthPanel helper vs inner (read-only)

Do not invent DrivePanel.tsx. Quote the helper file and the inner FireCommandView function. Editing the helper is not editing the inner panel. No production edits. End with VERDICT: READY or NOT_READY.
