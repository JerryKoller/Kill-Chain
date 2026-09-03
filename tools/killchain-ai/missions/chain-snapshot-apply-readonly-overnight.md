---
{
  "id": "chain-snapshot-apply-readonly-overnight",
  "title": "Read-only: applyChain vs audioStore engine pairing",
  "goal": "Read src/lib/chainSnapshot.ts applyChain. For each audioStore/eqStore/airspace/dimension call, note whether that store action calls getEngine in the same file. Read-only. No production edits. Do not call applyChain.",
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
    "src/state/eqStore.ts",
    "src/state/airspaceStore.ts",
    "src/state/dimensionStore.ts"
  ],
  "forbiddenPaths": [
    "src/audio/**",
    "electron/**",
    "package.json"
  ],
  "acceptance": [
    "applyChain is not silent-only",
    "Name store actions it calls",
    "Which of those actions call getEngine",
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

# applyChain engine pairing (read-only)

The session-snapshot map called applyChain silent-only. That is likely wrong because audioStore.replaceParams pairs with getEngine. Prove it from source. Do not edit. Do not invoke applyChain.
