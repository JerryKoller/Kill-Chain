---
{
  "id": "autolock-scan-readonly-overnight",
  "title": "Read-only map of autoLockScan callers",
  "goal": "Map src/lib/tractorAutoLock.ts autoLockScan definition and every autoLockScan( call. Confirm Mission State is the production caller. Read-only. Do not edit Tractor, AudioEngine, or Mission State.",
  "level": 0,
  "allowedPaths": [],
  "preserveDirtyPaths": [
    "src/components/FireCommand/GatePanel.tsx",
    "src/components/FireCommand/MacroPanel.tsx",
    "src/components/FireCommand/fireUiKit.tsx",
    "src/components/FireCommand/ModuleEnableToggle.tsx"
  ],
  "readOnlyPaths": [
    "src/lib/tractorAutoLock.ts",
    "src/state/missionStateStore.ts"
  ],
  "forbiddenPaths": [
    "src/audio/**",
    "electron/**",
    "package.json"
  ],
  "acceptance": [
    "INSPECTED: src/lib/tractorAutoLock.ts",
    "INSPECTED: src/state/missionStateStore.ts",
    "List autoLockScan( call sites",
    "Whether extra callers besides Mission State exist",
    "Map-only READY if evidence-backed",
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

# autoLockScan (read-only)

Do not modify Tractor DSP. Quote `export async function autoLockScan` and every `autoLockScan(` call. End with VERDICT: READY or NOT_READY.
