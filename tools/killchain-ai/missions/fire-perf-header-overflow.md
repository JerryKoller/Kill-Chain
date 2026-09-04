---
{
  "id": "fire-perf-header-overflow",
  "title": "Fire Command performance panel header overflow UX",
  "goal": "Improve presentation of Fire Command performance-panel headers and character-strip labels so Gate/Macro quick-actions fit without overflow and long FcChip labels do not spill their tooltips, without changing store semantics, click handlers, or audio.",
  "level": 2,
  "allowedPaths": [
    "src/components/FireCommand/fireUiKit.tsx",
    "src/components/FireCommand/fcChip.tsx",
    "src/components/FireCommand/GatePanel.tsx",
    "src/components/FireCommand/MacroPanel.tsx"
  ],
  "readOnlyPaths": [
    "src/components/FireCommand/FireCommandView.tsx",
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
    "Existing enable/click/keyboard/focus behavior remains unchanged",
    "No state action signature changes",
    "No audio/DSP/routing/persistence changes",
    "No new dependency or invented APIs",
    "Reuse existing Fire Command visual language",
    "Section.right header slot does not overflow Pin/Lock/Solo or quick-actions on Gate and Macro panels",
    "FcChip long labels truncate visually while keeping full accessible name/title",
    "Gate and Macro presentation changes form one coherent header/label overflow fix",
    "Do not restyle unrelated panels; ScenesPanel/ScalePanel are out of scope unless already imported only",
    "Typecheck passes",
    "Build passes",
    "Diff contains only the four authorized files",
    "Final critic maps the diff to these criteria and names at least one visual/a11y regression it investigated",
    "Human visual review remains required"
  ],
  "validation": {
    "required": ["typecheck", "build"],
    "optional": [],
    "restoreTsbuildinfo": true
  },
  "maxPhases": 8,
  "maxRetriesPerPhase": 3,
  "maxWallClockMs": 7200000,
  "maxModelCalls": 36,
  "sessionTimeoutMs": 720000,
  "proposalRounds": 1,
  "checkpointPolicy": "state-only",
  "commitPolicy": "none",
  "corpus": "if-stale",
  "diff": {
    "maxFiles": 4,
    "maxInsertions": 120,
    "warnOnly": true
  },
  "ux": {
    "workflow": "Open Fire Command Gate and Macro performance panels; header quick-actions and character-strip labels should stay readable without overflow",
    "manualReview": "Human must screenshot Gate and Macro headers: overflow, tooltip on a long chip label, keyboard focus on header actions. Automated typecheck/build is not visual proof."
  }
}
---

# Fire Command performance panel header overflow (LEVEL 2 LIVE)

This mission was selected by local Qwen discovery (`fire-ux-level2-workflow-discovery`). Cursor must not invent a different UX solution.

## Authorized files only

- `src/components/FireCommand/fireUiKit.tsx` — `Section` / `Section.right` header slot
- `src/components/FireCommand/fcChip.tsx` — chip label/tooltip presentation
- `src/components/FireCommand/GatePanel.tsx` — representative performance panel applying the header/strip pattern
- `src/components/FireCommand/MacroPanel.tsx` — second panel, same workflow, distinct instance

Do not edit `ScenesPanel`, `ScalePanel`, stores, AudioEngine, or `ModuleEnableToggle.tsx`.

## One decision (from discovery)

Bound `Section.right` so header actions do not overflow; truncate long character-strip labels visually while preserving accessible names; compact Gate/Macro header/meter spacing enough to reduce forced scroll. Presentation only.

Pick exact class/markup in the proposal after inspecting current source. Do not offer Option A/B/C.

## Validation

Runner runs `npm run typecheck` then `npm run build`. Do not claim they passed unless the runner did. Do not commit.
