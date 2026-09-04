---
{
  "id": "fire-osc-header-right-1280",
  "title": "Fire Command Section.right headers at 1280 — observed layout risk",
  "goal": "At 1280px and nearby desktop widths, inspect Fire Command headers that use Section.right heavily (Oscillator A/B/C table browsers and Drive/Vintage FSeg rows). Determine whether controls clip, crowd, or require horizontal scrolling. If and only if a real measurable defect exists, apply a scoped presentation-only 2–4 file fix that keeps compact headers without globally removing overflow-x-auto. If the measurements show no clip and no lost necessary scrolling, BLOCK instead of inventing CSS.",
  "level": 2,
  "allowedPaths": [
    "src/components/FireCommand/fireUiKit.tsx",
    "src/components/FireCommand/FireCommandView.tsx"
  ],
  "preserveDirtyPaths": [
    "src/components/FireCommand/GatePanel.tsx",
    "src/components/FireCommand/MacroPanel.tsx",
    "src/components/FireCommand/ModuleEnableToggle.tsx"
  ],
  "readOnlyPaths": [
    "src/components/FireCommand/GatePanel.tsx",
    "src/components/FireCommand/MacroPanel.tsx",
    "src/components/FireCommand/ModuleEnableToggle.tsx",
    "src/state/fireCommandStore.ts",
    "src/state/fireSequencerStore.ts"
  ],
  "forbiddenPaths": [
    "src/audio/**",
    "src/state/**",
    "electron/**",
    "package.json"
  ],
  "acceptance": [
    "Start from the observed 1280 header-layout risk and the BEFORE metrics in this brief — do not invent a new product problem",
    "Do not globally change Section.right unless you prove the same defect across all measured callers (Osc A/B/C and Drive at 1440/1366/1280)",
    "Do not restore or re-apply min-w-0 max-w-xs shrink-0 as a global Section.right class",
    "Do not remove overflow-x-auto unless every measured caller has overflowX 0 and would still not need scrolling in COMPACT",
    "Parked GatePanel.tsx MacroPanel.tsx ModuleEnableToggle.tsx bytes must remain unchanged",
    "No src/state writes, no audio/DSP, no persistence, no new dependencies, no new files",
    "OscATableBrowser / OscBTableBrowser / OscCTableBrowser / FSeg live inside FireCommandView.tsx — do not invent OscAPanel.tsx or DrivePanel.tsx",
    "Existing Pin/Lock/Solo/focus/click behavior unchanged",
    "If no defensible 2–4 file fix is proven by the metrics, inspect-only proposal and BLOCK — do not broaden scope",
    "Typecheck and build pass if any authorized file is edited",
    "Exact allowlist only"
  ],
  "validation": {
    "required": ["typecheck", "build"],
    "optional": [],
    "restoreTsbuildinfo": true
  },
  "maxPhases": 10,
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
    "maxInsertions": 80,
    "warnOnly": false
  },
  "ux": {
    "workflow": "Open Fire Command SYNTH → SRC (Oscillator A/B/C) and FX (Drive). At 1280/1366/1440, header right-slot controls must remain visible without clipping and without losing needed horizontal scroll.",
    "currentBehavior": "Section.right is max-w-[55%] overflow-x-auto (HEAD restored). A rejected Qwen candidate had changed this globally to min-w-0 max-w-xs shrink-0. That global change is not live.",
    "visualCriteria": [
      "Osc A/B/C wavetable ‹ select › remains fully usable at 1280",
      "Drive Soft/Tube/Fold/Hard/Fuzz FSeg remains fully usable at 1280",
      "Pin/Lock/Solo still fit beside the right slot"
    ],
    "interactionCriteria": [
      "No dead clicks",
      "Keyboard focus rings unchanged"
    ],
    "manualReview": "Human reviews 5174 if Qwen produces an authorized diff. No auto-commit."
  }
}
---

# Fire Command Section.right at 1280 (observed, not invented)

This mission starts from a human-observed risk, not from open-ended discovery.

A previous Qwen candidate changed `Section.right` **globally** in `fireUiKit.tsx`:

- FROM: `max-w-[55%] overflow-x-auto`
- TO: `min-w-0 max-w-xs shrink-0`

That change did nothing useful on Gate (`right` is only `8/16`). It was **rejected** and `fireUiKit.tsx` was restored to exact HEAD bytes via `gitShowHead` + `restoreCheckpointFiles` (no Composer edit, no `git checkout`). SHA-256 now `3a1d5f14d0c2b70147c697a5daa1e2d53365899b991c5c12a7e35add0e126790`.

Parked (do not touch): GatePanel, MacroPanel, ModuleEnableToggle.

## DETERMINISTIC BEFORE METRICS (diagnostic Chrome @ 5174)

HEAD live layout (`max-w-[55%] overflow-x-auto`):

At **1280** (header ~836px):

| module | clusterW | slotW | overflowX | overflowCss | maxWidth | visible controls |
|---|---:|---:|---:|---|---|---|
| osc.a | 304 | 167 | 0 | auto | 55% | 3/3 |
| osc.b | 304 | 167 | 0 | auto | 55% | 3/3 |
| osc.c | 304 | 167 | 0 | auto | 55% | 3/3 |
| fx.drive | 394 | 217 | 0 | auto | 55% | 5/5 |

1366 and 1440: same overflowX 0; slot widths unchanged; header grows (922 / 996). Drive is the widest right slot.

Rejected global `max-w-xs` (captured before restore, **not live**):

| module @1280 | slotW | overflowX | overflowCss | maxWidth | visible |
|---|---:|---:|---|---|---|
| osc.a | 178 | 0 | visible | 320px | 3/3 |
| fx.drive | 268 | 0 | visible | 320px | 5/5 |

Under that rejected class, nothing clipped in this capture either, but **horizontal overflow scrolling was removed** (`overflowCss: visible`). Drive's slot (268) is still under 320, so the cap was not yet binding. That is why a global `max-w-xs` was too much blast radius for an unproven benefit.

`fx.vintage` did not mount in the diagnostic pass — still inspect `Vintage Age` `right={<FSeg bitDepth>}` in `FireCommandView.tsx`. Also inspect `FLfoWave` header-right callers in the same file.

Full JSON: `tools/killchain-ai/data/overnight/section-right/head-overflow-auto/metrics.json` and `.../proposed-max-w-xs/metrics.json`.

## What you must do

INVESTIGATE (MCP first): `Section` in `fireUiKit.tsx`; inner `OscATableBrowser` / `OscBTableBrowser` / `OscCTableBrowser` / `FSeg` / `FLfoWave` in `FireCommandView.tsx`. Count `right=` callers. Do not invent `*Panel.tsx` files.

PLAN: either a **scoped** 2–4 file presentation fix that preserves needed `overflow-x-auto`, or **inspect-only BLOCK** if these widths do not clip and no caller needs a change.

Do not list Option A/B/C. Do not ask the operator to choose.

EDIT only authorized files, only if the proposal names them as edit targets with evidence.

No commit. No push.
