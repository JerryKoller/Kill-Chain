---
{
  "id": "fire-ux-level2-overnight-discovery",
  "title": "Fire Command LEVEL 2 overnight discovery (read-only)",
  "goal": "Identify one coherent Fire Command presentation-only workflow involving exactly 2–4 existing UI files, different from Gate/Macro header overflow, ModuleEnableToggle contrast, and drum-fill preview. Real callers only. No production edits.",
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
    "src/state/fireSequencerStore.ts"
  ],
  "forbiddenPaths": [
    "src/audio/**",
    "src/state/**",
    "electron/**",
    "src/lib/sourceArbiter.ts",
    "src/audio/AudioEngine.ts",
    "package.json"
  ],
  "acceptance": [
    "Uses Kill Chain MCP retrieval and inspects actual existing components",
    "Traces direct caller relationships for the chosen workflow",
    "Names exactly 2–4 existing UI files as later-edit candidates",
    "Does not pick Gate/Macro overflow, ModuleEnableToggle-only, FcChip truncation, or drum-fill preview",
    "Does not invent files or callbacks",
    "Does not present Option A/B/C for the operator",
    "Does not edit production files"
  ],
  "validation": { "required": [], "optional": [], "restoreTsbuildinfo": true },
  "maxPhases": 4,
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

# Overnight LEVEL 2 discovery

READ-ONLY. Cursor must not choose the workflow.

Out of scope: Gate/Macro overflow, parked ModuleEnableToggle, fcChip truncation, drum-fill preview (blocked twice).

Prefer: status clarity, selection state, panel navigation, active/inactive presentation, empty-state clarity, compact header grouping, feedback after an existing action.
