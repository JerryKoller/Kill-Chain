---
{
  "id": "fire-ux-level2-next-discovery",
  "title": "Fire Command LEVEL 2 next-workflow discovery (read-only)",
  "goal": "Identify one coherent Fire Command presentation workflow, different from Gate/Macro header overflow and the parked ModuleEnableToggle contrast patch, whose UI is distributed across 2–4 existing components and has real user friction. Do not edit production files.",
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
    "Identifies existing state/actions READ-ONLY without proposing writes",
    "States concrete user friction with file/symbol evidence, not a vibe",
    "Names exactly 2–4 existing UI files as later-edit candidates",
    "Explains why each of those files is necessary for one coherent change",
    "Does not pick GatePanel.tsx / MacroPanel.tsx header overflow (already revised)",
    "Does not pick only ModuleEnableToggle.tsx (LEVEL 1 parked)",
    "Does not pick global FcChip truncation (reverted; fcChip.tsx matches HEAD)",
    "Does not pick fireUiKit.tsx Section.right unless a different workflow truly owns it",
    "Every referenced src path exists; no invented symbols",
    "Does not present Option A/B/C for the operator to choose",
    "Does not recommend a Fire Command-wide redesign",
    "Does not edit production files"
  ],
  "validation": { "required": [], "optional": [], "restoreTsbuildinfo": true },
  "maxPhases": 6,
  "maxRetriesPerPhase": 3,
  "maxWallClockMs": 3600000,
  "maxModelCalls": 18,
  "sessionTimeoutMs": 720000,
  "proposalRounds": 1,
  "checkpointPolicy": "state-only",
  "commitPolicy": "none",
  "corpus": "if-stale",
  "ux": {
    "workflow": "Qwen must choose one real Fire Command presentation workflow after evidence, excluding Gate/Macro overflow and the parked enable-toggle patch",
    "manualReview": "Human reads FINAL_REPORT.md. Discovery is inspect-only."
  }
}
---

# Fire Command LEVEL 2 next-workflow discovery

READ-ONLY. Do not edit production files. Cursor/Composer must not choose the UX solution.

## Already done (out of scope)

- `ModuleEnableToggle.tsx` LEVEL 1 disabled-contrast patch (parked, dirty, do not touch)
- Gate/Macro header overflow LEVEL 2 + revision (parked dirty: `GatePanel.tsx`, `MacroPanel.tsx`, `fireUiKit.tsx`)
- Global `FcChip` 8-character truncation was tried and **reverted**; `fcChip.tsx` matches HEAD

Do **not** rediscover those.

## Suitable categories

- sequencer/pattern/transport presentation
- mixer/sum-deck readability
- live/harmony/scale/human/width control grouping
- selected/active/inactive feedback in a panel that is not the enable toggle
- empty-state or status copy in an existing panel

## Unsuitable

Persistence, DSP, FireCommandSynth, AudioEngine, MIDI behavior, sequencer timing, source ownership, Mission State, store architecture, new product functionality, app-wide restyle.

## Required investigation output

1. Kill Chain retrieval first
2. Inspect actual components
3. Trace direct callers
4. Name 2–4 existing files for a later LEVEL 2 live edit
5. UX goal + visual acceptance a human can check
6. Visual uncertainty (what typecheck/build cannot prove)
7. Reject invented need
