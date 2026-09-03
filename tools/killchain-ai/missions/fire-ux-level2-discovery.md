---
{
  "id": "fire-ux-level2-discovery",
  "title": "Fire Command LEVEL 2 UX discovery (read-only)",
  "goal": "Identify one coherent Fire Command user workflow whose UI presentation is distributed across 2–4 existing components and would benefit from a focused UX improvement without changing application state semantics or audio behavior.",
  "level": 0,
  "allowedPaths": [],
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
    "Identifies current visual language with file/symbol evidence",
    "States concrete user friction, not a vibe",
    "Names exactly 2–4 existing UI files as later-edit candidates",
    "Explains why each of those files is necessary for one coherent change",
    "Lists explicit non-goals (audio, stores, persistence, MIDI, DSP, Mission State)",
    "Proposes acceptance criteria a human could verify visually",
    "Every referenced src path exists; no invented symbols",
    "Does not pick only ModuleEnableToggle.tsx (that LEVEL 1 patch is parked separately)",
    "Does not present Option A/B/C for the operator to choose",
    "Does not recommend a Fire Command-wide redesign",
    "Does not edit production files"
  ],
  "validation": { "required": [], "optional": [], "restoreTsbuildinfo": true },
  "maxPhases": 6,
  "maxRetriesPerPhase": 3,
  "maxWallClockMs": 7200000,
  "maxModelCalls": 24,
  "sessionTimeoutMs": 720000,
  "proposalRounds": 1,
  "checkpointPolicy": "state-only",
  "commitPolicy": "none",
  "corpus": "if-stale",
  "ux": {
    "workflow": "Qwen must choose one real Fire Command presentation workflow after evidence",
    "manualReview": "Human reads FINAL_REPORT.md. No screenshots in this discovery pass."
  }
}
---

# Fire Command LEVEL 2 discovery — local Qwen only

READ-ONLY. Do not edit production files. Cursor/Composer must not choose the UX solution.

## Already done (out of scope)

`src/components/FireCommand/ModuleEnableToggle.tsx` already had a LEVEL 1 live visual patch (parked, uncommitted). Do **not** propose that one-file toggle as the LEVEL 2 mission.

## Suitable categories

- module/header visual hierarchy
- navigation/discovery within one Fire Command workflow
- selected/active/inactive visual feedback (beyond the parked enable toggle)
- control grouping and readability
- empty-state/prompt clarity
- status/feedback presentation
- repetitive interaction friction fixable in presentation components

## Unsuitable

Persistence, DSP, FireCommandSynth, AudioEngine, MIDI behavior, sequencer timing, source ownership, Mission State, store architecture, new product functionality, app-wide restyle.

## Required investigation output

1. Kill Chain retrieval first
2. Inspect actual components
3. Trace direct callers
4. State/actions involved (READ-ONLY)
5. Current visual language
6. User friction
7. Exactly 2–4 **existing** UI files
8. Why each file is necessary
9. Explicit non-goals
10. Acceptance criteria
11. Evidence for every referenced file/symbol

Visible final TEXT must include:

```
WORKFLOW: <one sentence>
FILES (exactly 2–4 existing paths):
- path — why necessary
CURRENT FRICTION:
PROPOSED PRESENTATION CHANGE (one decision, not A/B/C):
NON-GOALS:
ACCEPTANCE:
```

The 2–4 later-edit files must have **distinct roles** (for example shared primitive + panel + header/empty-state), not the same className/font-size tweak copied between sibling `*Panel.tsx` strips.

A 1px typography/tracking-only change is **not** LEVEL 2. If that is all you find, VERDICT: BLOCK rather than invent a second file.
