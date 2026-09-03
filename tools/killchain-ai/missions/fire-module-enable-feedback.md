---
{
  "id": "fire-module-enable-feedback",
  "title": "Fire Command module enable visual feedback",
  "goal": "Improve visual enable/disable feedback on the Fire Command module enable control so a user can immediately tell whether a module is active, without changing underlying Fire Command behavior, click semantics, persistence, or audio.",
  "level": 1,
  "allowedPaths": [
    "src/components/FireCommand/ModuleEnableToggle.tsx"
  ],
  "readOnlyPaths": [
    "src/components/FireCommand/FireCommandView.tsx",
    "src/components/FireCommand/FireCommandPalette.tsx"
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
    "Enabled vs disabled state is visually obvious at a glance",
    "Existing enable/disable behavior remains unchanged",
    "Existing click/interaction semantics remain unchanged",
    "No AudioEngine/DSP/routing/source-ownership changes",
    "No persistence change",
    "No Fire Command state-machine change",
    "No new dependency",
    "No drive-by redesign of surrounding panels",
    "Reuse existing Kill Chain visual language where possible",
    "Maintain keyboard/focus/accessibility behavior already present",
    "TypeScript remains clean",
    "Diff remains narrow enough for human UI review"
  ],
  "validation": {
    "required": ["typecheck", "build"],
    "optional": [],
    "restoreTsbuildinfo": true
  },
  "maxPhases": 4,
  "maxRetriesPerPhase": 3,
  "maxWallClockMs": 5400000,
  "maxModelCalls": 20,
  "sessionTimeoutMs": 720000,
  "proposalRounds": 1,
  "checkpointPolicy": "state-only",
  "commitPolicy": "none",
  "corpus": "if-stale",
  "diff": {
    "maxFiles": 2,
    "maxInsertions": 80,
    "warnOnly": true
  },
  "ux": {
    "workflow": "Glance at a Fire Command module enable control and know on/off without hunting",
    "manualReview": "Human must screenshot enabled vs disabled in the running app. Automated typecheck/build is not visual proof."
  }
}
---

# Fire Command module enable visual feedback

This is the first live application mission for the local runner. Investigate current `ModuleEnableToggle` styling yourself. Do not invent a redesign of Fire Command.

Pick exactly one conservative visual contrast change in the proposal. Do not present Option A/B/C for the operator. Human visual acceptance is after the live diff, not a design-choice gate.

## Allowed edit

Only `src/components/FireCommand/ModuleEnableToggle.tsx` unless a dry-run proves exactly one additional **existing** UI caller/container is required for a presentation-only change. Do not edit stores, AudioEngine, DSP, electron, or package.json.

## Out of scope

AudioEngine, claimSource, rewireFront, fireCommandStore, fireSequencerStore, Mission State, persistence, new files unless labeled NEW FILE and still inside allowed paths.

## Validation

The runner will run `npm run typecheck` then `npm run build`. Do not claim they passed unless the runner did.

## Visual limit

You cannot see the rendered app. Describe the visual change in the proposal. Leave appearance for human review. Do not restyle in circles.
