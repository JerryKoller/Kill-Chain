---
{
  "id": "fire-level3-overnight-dryrun-2",
  "title": "LEVEL 3 dry-run retry: existing TSX files only (read-only)",
  "goal": "Plan a coherent future Fire Command feature spanning approximately 5–10 EXISTING .ts/.tsx files (UI + state + helpers). React/TypeScript only. Never .vue. Do not mark existing files as NEW FILE. Do not touch AudioEngine/DSP/sourceArbiter/rewireFront/Mission State/sequencer timing/persistence format. Read-only. No production edits.",
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
    "src/state/fireCommandStore.ts",
    "src/state/fireSequencerStore.ts",
    "src/state/uiStore.ts",
    "src/lib/fireHistory.ts",
    "src/lib/fireClipboard.ts",
    "src/components/FireCommand/fireNavigate.ts",
    "src/lib/fireModuleUsage.ts"
  ],
  "forbiddenPaths": [
    "src/audio/**",
    "electron/**",
    "src/lib/sourceArbiter.ts",
    "package.json"
  ],
  "acceptance": [
    "Architecture map with callers/callees from MCP",
    "Exact existing .ts/.tsx file list (about 5–10); glob/read proved they exist",
    "No .vue paths anywhere",
    "Existing files are never labeled NEW FILE",
    "Phased plan, acceptance, risks, validation matrix, checkpoints",
    "State ownership named",
    "Explicit audio boundary: no AudioEngine/DSP",
    "Final critic last line exactly: VERDICT: READY or VERDICT: NOT_READY",
    "No production edits",
    "Do not present Option A/B/C for the operator",
    "Do not plan Gate/Macro overflow, ModuleEnableToggle contrast, or drum-fill preview"
  ],
  "validation": { "required": [], "optional": [] },
  "maxPhases": 6,
  "maxRetriesPerPhase": 2,
  "maxWallClockMs": 5400000,
  "maxModelCalls": 24,
  "sessionTimeoutMs": 720000,
  "proposalRounds": 1,
  "checkpointPolicy": "state-only",
  "commitPolicy": "none",
  "corpus": "if-stale"
}
---

# LEVEL 3 dry-run retry (overnight)

This repository is React + TypeScript. Files end in `.tsx` or `.ts`. Vue `.vue` SFCs do not exist here.

`src/state/fireCommandStore.ts` already exists. Do not call it a NEW FILE.

READ-ONLY. No production edits. Cursor must not author the feature.

Use MCP first. Name only files you globbed or read.

Final critic MUST end with a line that is exactly one of:
VERDICT: READY
VERDICT: NOT_READY
No backticks around the verdict word.
