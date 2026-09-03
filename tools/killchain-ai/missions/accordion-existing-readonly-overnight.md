---
{
  "id": "accordion-existing-readonly-overnight",
  "title": "Read-only map of EXISTING accordion mode",
  "goal": "Accordion already exists: fireCommandStore.accordionMode / setAccordionMode, fireUiKit Section collapse, FireBreadcrumb ACCORDION toggle, FireCommandPalette. Map callers. Do not invent AccordionController or AccordionModeState. Read-only. No production edits. Not a live Level 2.",
  "level": 0,
  "allowedPaths": [],
  "preserveDirtyPaths": [
    "src/components/FireCommand/GatePanel.tsx",
    "src/components/FireCommand/MacroPanel.tsx",
    "src/components/FireCommand/fireUiKit.tsx",
    "src/components/FireCommand/ModuleEnableToggle.tsx"
  ],
  "readOnlyPaths": [
    "src/state/fireCommandStore.ts",
    "src/components/FireCommand/fireUiKit.tsx",
    "src/components/FireCommand/FireBreadcrumb.tsx",
    "src/components/FireCommand/FireCommandPalette.tsx"
  ],
  "forbiddenPaths": [
    "src/audio/**",
    "electron/**",
    "package.json"
  ],
  "acceptance": [
    "Cite existing symbols only",
    "MCP callers of setAccordionMode",
    "Note persistence accordionModeV2 if present",
    "No invented files",
    "No production edits",
    "VERDICT: READY or NOT_READY"
  ],
  "validation": { "required": [], "optional": [] },
  "maxPhases": 6,
  "maxRetriesPerPhase": 2,
  "maxWallClockMs": 1800000,
  "maxModelCalls": 14,
  "sessionTimeoutMs": 720000,
  "proposalRounds": 1,
  "checkpointPolicy": "state-only",
  "commitPolicy": "none",
  "corpus": "if-stale"
}
---

# Existing accordion (read-only)

Level 3 dry-run 3 invented AccordionController.ts. That was wrong.
Map the real implementation. Do not plan a rewrite. Do not edit fireCommandStore (it pairs UI prefs with engine elsewhere — read only).
