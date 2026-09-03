---
{
  "id": "ui-feature-template",
  "title": "UI/UX feature (template)",
  "goal": "Describe one coherent user-visible workflow improvement. Replace this goal.",
  "level": 2,
  "allowedPaths": [
    "src/components/FireCommand/**"
  ],
  "readOnlyPaths": [
    "src/state/fireCommandStore.ts",
    "src/state/fireSequencerStore.ts"
  ],
  "forbiddenPaths": [],
  "acceptance": [
    "Named workflow is easier or clearer for a real user",
    "No AudioEngine / DSP / claimSource / rewireFront changes",
    "No persistence-format changes",
    "Typecheck and build pass",
    "Unrelated panels are not restyled as drive-by cleanup"
  ],
  "validation": {
    "required": ["typecheck", "build"],
    "optional": ["smoke"],
    "restoreTsbuildinfo": true
  },
  "maxPhases": 6,
  "maxRetriesPerPhase": 3,
  "maxWallClockMs": 7200000,
  "maxModelCalls": 24,
  "proposalRounds": 1,
  "checkpointPolicy": "state-only",
  "commitPolicy": "none",
  "corpus": "if-stale",
  "diff": {
    "maxFiles": 40,
    "maxInsertions": 2500,
    "warnOnly": true
  },
  "ux": {
    "workflow": "Replace with the user workflow (example: find a module, change a control, see feedback)",
    "currentBehavior": "Replace with what happens today",
    "visualCriteria": [
      "Primary action is findable without hunting",
      "Feedback appears in the same region as the control"
    ],
    "interactionCriteria": [
      "Keyboard/mouse path remains usable",
      "No dead clicks on decorative chrome"
    ],
    "manualReview": "Human should screenshot the before/after workflow in Fire Command."
  }
}
---

# UI/UX feature mission

Replace the JSON fields above. This template is for **bounded UI work** (autonomy level 2).

## UX goal

One coherent workflow, not a grab-bag of polish.

## Current behavior

Cite components and stores. Do not invent cadence or architecture.

## Visual / interaction acceptance

Write observable UI criteria, not vibes.

## Allowed component subtree

Keep `allowedPaths` to the panel/view that owns the workflow. Add helper files only when the plan names them.

## State constraints

- Prefer props/local UI state when the store is audio-coupled.
- If a store is in `STORE_ENGINE_PAIRS` with AudioEngine, do not change engine calls in the same mission unless this is later promoted to audio-critical.
- Store writes that already call AudioEngine must remain in the same synchronous action.

## Validation

`typecheck` + `build`. Add `smoke` only if playback/routing/state machine could be affected.

## Out of scope

AudioEngine, DSP, electron, package.json, Mission State priority order, claimSource, rewireFront.
