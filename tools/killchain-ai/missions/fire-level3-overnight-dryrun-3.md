---
{
  "id": "fire-level3-overnight-dryrun-3",
  "title": "LEVEL 3 dry-run 3: one future workflow, existing files only",
  "goal": "Plan ONE coherent future Fire Command feature using about 5–10 EXISTING .ts/.tsx files. Not a product tour. Not Gate/Macro overflow, ModuleEnableToggle contrast, or drum-fill. React/TSX only. No .vue. Do not label existing files NEW FILE. No AudioEngine/DSP/sourceArbiter/rewireFront/Mission State/sequencer timing/persistence-format. Read-only. No production edits. Do not ask the operator which option to pick.",
  "level": 0,
  "allowedPaths": [],
  "preserveDirtyPaths": [
    "src/components/FireCommand/GatePanel.tsx",
    "src/components/FireCommand/MacroPanel.tsx",
    "src/components/FireCommand/fireUiKit.tsx",
    "src/components/FireCommand/ModuleEnableToggle.tsx"
  ],
  "readOnlyPaths": [
    "src/components/FireCommand/**",
    "src/state/uiStore.ts",
    "src/lib/fireHistory.ts",
    "src/lib/fireClipboard.ts"
  ],
  "forbiddenPaths": [
    "src/audio/**",
    "electron/**",
    "src/lib/sourceArbiter.ts",
    "package.json"
  ],
  "acceptance": [
    "One workflow, not a tour of Fire Command",
    "5–10 existing files proved via glob/MCP",
    "No parked GatePanel/MacroPanel/fireUiKit/ModuleEnableToggle as edit targets",
    "No FireCommandView.tsx as the primary edit (too large) unless only cited as caller",
    "No .vue, no Option A/B/C, no would-you-like-me-to",
    "Phased plan, risks, validation, audio boundary",
    "VERDICT: READY or NOT_READY",
    "No production edits"
  ],
  "validation": { "required": [], "optional": [] },
  "maxPhases": 6,
  "maxRetriesPerPhase": 2,
  "maxWallClockMs": 5400000,
  "maxModelCalls": 20,
  "sessionTimeoutMs": 720000,
  "proposalRounds": 1,
  "checkpointPolicy": "state-only",
  "commitPolicy": "none",
  "corpus": "if-stale"
}
---

# LEVEL 3 dry-run 3 (planning only)

Previous dry-run-2 was a Fire Command tour / grab-bag. Do not repeat that.

Pick one future feature (example categories: empty-state for an existing panel, selection-state presentation, compact grouping of an already extracted panel+viz+chrome set). Prove files exist. If you cannot, VERDICT: NOT_READY.

Do not execute. Do not edit production.
