---
{
  "id": "apply-chain-callers-readonly-overnight",
  "title": "Read-only map of applyChain callers",
  "goal": "Map src/lib/chainSnapshot.ts applyChain and every applyChain( call. Read-only. Do not edit chain snapshots, AudioEngine, or Mission State.",
  "level": 0,
  "allowedPaths": [],
  "preserveDirtyPaths": [
    "src/components/FireCommand/GatePanel.tsx",
    "src/components/FireCommand/MacroPanel.tsx",
    "src/components/FireCommand/fireUiKit.tsx",
    "src/components/FireCommand/ModuleEnableToggle.tsx"
  ],
  "readOnlyPaths": [
    "src/lib/chainSnapshot.ts",
    "src/state/audioStore.ts",
    "src/state/missionStateStore.ts",
    "src/state/missionLogStore.ts",
    "src/state/sessionSnapshotsStore.ts"
  ],
  "forbiddenPaths": [
    "src/audio/**",
    "electron/**",
    "package.json"
  ],
  "acceptance": [
    "INSPECTED: src/lib/chainSnapshot.ts",
    "List applyChain( call sites",
    "Whether each caller is silent UI or engine-coupled",
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

# applyChain callers (read-only)

Quote `export function applyChain` and every `applyChain(` call. Session snapshot restore is not silent-only if applyChain writes the engine. Do not edit production. End with VERDICT: READY or NOT_READY.
