---
{
  "id": "hotkey-store-readonly-overnight",
  "title": "Read-only map of hotkeyStore",
  "goal": "Map src/state/hotkeyStore.ts and whether global hotkeys call claimSource, getEngine, or fire sequencer transport. Read-only. No production edits.",
  "level": 0,
  "allowedPaths": [],
  "preserveDirtyPaths": [
    "src/components/FireCommand/GatePanel.tsx",
    "src/components/FireCommand/MacroPanel.tsx",
    "src/components/FireCommand/fireUiKit.tsx",
    "src/components/FireCommand/ModuleEnableToggle.tsx"
  ],
  "readOnlyPaths": [
    "src/state/hotkeyStore.ts",
    "src/hooks/useGlobalHotkeys.ts"
  ],
  "forbiddenPaths": [
    "src/audio/**",
    "electron/**",
    "package.json"
  ],
  "acceptance": [
    "What hotkeyStore stores vs what the hook executes",
    "claimSource / engine / sequencer if any",
    "Map-only READY if evidence-backed",
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

# hotkeyStore vs useGlobalHotkeys (read-only)

READY means the map is complete. Do not edit hotkeys or AudioEngine.
