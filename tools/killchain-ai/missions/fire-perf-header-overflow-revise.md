---
{
  "id": "fire-perf-header-overflow-revise",
  "title": "Revise Gate gap + FcChip truncation after human visual review",
  "goal": "Revise the uncommitted LEVEL 2 Fire Command presentation patch using human visual-review findings: Gate quick-actions gap-[1.25rem] is too wide, and FcChip must not globally truncate every string label over eight characters. Do not change store semantics, click handlers, or audio.",
  "brief": "This is a revision of the already-dirty LEVEL 2 live patch (fire-perf-header-overflow-live). Cursor/Composer must not edit application UI. Local Qwen must revise its own presentation work. ModuleEnableToggle.tsx is baseline-dirty from LEVEL 1 — do not edit or revert it.",
  "level": 2,
  "allowedPaths": [
    "src/components/FireCommand/fireUiKit.tsx",
    "src/components/FireCommand/fcChip.tsx",
    "src/components/FireCommand/GatePanel.tsx",
    "src/components/FireCommand/MacroPanel.tsx"
  ],
  "baselineDirtyPaths": [
    "src/components/FireCommand/ModuleEnableToggle.tsx"
  ],
  "readOnlyPaths": [
    "src/components/FireCommand/FireCommandView.tsx",
    "src/components/FireCommand/ModuleEnableToggle.tsx",
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
    "GateQuickActions gap is gap-1 (4px) or tighter — never gap-[1.25rem] / 20px",
    "FcChip does not globally wrap/truncate every string child longer than 8 characters",
    "Filter Carve Off, Warp Classic/Scramble, Harmony, Scale, and other FcChip labels outside Gate/Macro stay fully readable",
    "If a label still truncates, the chip title/aria-label keeps the full name",
    "Macro strips may keep gap-[0.3rem]; do not copy the 20px Gate quick-action gap",
    "Keep Section.right min-w-0 max-w-xs shrink-0 unless evidence shows it clips Pin/Lock/Solo",
    "Do not edit ModuleEnableToggle.tsx (LEVEL 1 off-state 0.65 is already correct in computed styles)",
    "Existing enable/click/keyboard/focus behavior remains unchanged",
    "No state action signature changes",
    "No audio/DSP/routing/persistence changes",
    "No new dependency or invented APIs",
    "Typecheck passes",
    "Build passes",
    "Diff vs HEAD for this mission's critic view contains only the four authorized files",
    "Final critic names the two visual defects it was asked to fix",
    "Human visual review remains required after this revision"
  ],
  "validation": {
    "required": ["typecheck", "build"],
    "optional": [],
    "restoreTsbuildinfo": true
  },
  "maxPhases": 4,
  "maxRetriesPerPhase": 3,
  "maxWallClockMs": 7200000,
  "maxModelCalls": 28,
  "sessionTimeoutMs": 720000,
  "proposalRounds": 1,
  "checkpointPolicy": "state-only",
  "commitPolicy": "none",
  "corpus": "if-stale",
  "diff": {
    "maxFiles": 4,
    "maxInsertions": 80,
    "warnOnly": true
  },
  "ux": {
    "workflow": "Revise Gate/Macro presentation after human visual rejection of 20px quick-action gaps and global FcChip truncation",
    "manualReview": "Human will re-check Gate+Macro headers at 1440/1366/1280, long chip labels, Gate quick-action spacing, keyboard focus, and the LEVEL 1 module toggle. Automated typecheck/build is not visual proof."
  }
}
---

# Revise Gate gap + FcChip truncation (LEVEL 2 LIVE REVISION)

Human visual review of `fire-perf-header-overflow-live` **rejected two presentation choices**. Cursor must not Composer-rescue the UI. You (local Qwen) revise your own patch in the four authorized files.

The worktree is already dirty with your previous LEVEL 2 edits plus a separate LEVEL 1 `ModuleEnableToggle.tsx` patch. Start from the current files. Do not revert unrelated work.

## Visual findings (measured in the running app)

### 1. Gate quick-actions — `gap-[1.25rem]` HURTS (must fix)

`GateQuickActions` currently uses `gap-[1.25rem]`. Computed `gap` is **20px** at 1440, 1366, and 1280. Original `gap-1` is **4px**. Eight compact 9px buttons (◂ ▸ INV REV EUC RAND ARM SLEEP) with seven 20px gaps add ~112px versus `gap-1`.

The row still fits (~436×20, flex-wrap, no overflowX at those widths), but the spacing is sparse and **opposite of an overflow fix**.

**Required:** change `GateQuickActions` back to `gap-1` or tighter (`gap-[0.3rem]` is acceptable, matching Rate/Depth strips). Do **not** keep 1.25rem / 20px.

Macro quick-actions already use `gap-1`. Macro Helm/All strips use `gap-[0.3rem]` (~4.8px) — leave those unless you find they overflow.

### 2. Global FcChip truncation — wrong scope (must fix)

`FcChip` wraps any **string** child with `length > 8` in `<span className="truncate max-w-[9ch] overflow-hidden">`.

That rule is global. Gate/Macro labels are mostly ≤8 (`Offbeat`, `Stutter`, `Zero`, `Lead`) so they never hit it. Other chips do:

- Filter **`Carve Off`** (9 chars) — confirmed wrapper present (`max-width: 48.5px`). Title is `Harmonic carve: Carve Off`. The span is `display: inline`, so CSS `max-width` does not apply to non-replaced inline boxes; truncation is both the wrong scope **and** mechanically unreliable.
- Warp **`Scramble`** is exactly 8 (no wrap). **`Classic`** is 7.
- Any future/other `FcChip` string >8 (`Sqr Punch`, `Saw Growl`, `Orchestra`, `Notes+Tails`, `Quadrature`, `Key Track`, `Filter Cutoff`, `Chorus Mix`, `CROSSFADE`, …) would inherit the same rule if passed as a string child.

**Required:** remove the global `length > 8` wrapper from `FcChip`. Do not truncate Filter/Warp/Harmony/Scale/workspace chips as a side effect of a Gate/Macro overflow mission. If a specific Gate/Macro label actually overflows, opt in at that call site (for example an `extra` class) and keep `title` / `aria-label` as the full name. Do not invent a new truncation API unless the existing `extra` / `title` props already cover it.

### 3. Headers at 1440 / 1366 / 1280 — keep unless clipping Pin/Lock/Solo

Gate/Macro `Section.right` is the `{openCount}/{n}` readout, **not** the quick-actions. Pin / Lock / Solo live in the Section header (`fireUiKit.tsx`). `min-w-0 max-w-xs shrink-0` on the right slot did not show header overflowX at 1280–1440.

Keep that `Section.right` change. Do not restore `max-w-[55%] overflow-x-auto`. Do not put quick-actions into the header.

### 4. Keyboard (do not regress)

Tab through Gate quick-actions shows a 2px green focus outline. Enter on EUC kept focus. Do not remove `fc-focus` / existing button focus styles.

### 5. Module toggle 0.65 — do not touch

After Sleep → Wake, computed styles are already `color: rgba(255,255,255,0.65)`, `border: rgba(255,255,255,0.3)`, `background: rgba(10,10,10,0.75)`, `aria-pressed: false`. **Do not edit `ModuleEnableToggle.tsx`.** It is listed in `baselineDirtyPaths` / read-only so the runner will treat it as pre-existing LEVEL 1 work.

## Layout facts you must not rediscover incorrectly

- `GateQuickActions` / `MacroQuickActions` sit in the **panel body** signal-path row, not `Section.right`.
- Gate `Section.right` is only `{openCount}/{n}`.
- Rate/Depth/Steps strips already use `gap-[0.3rem]`; character Chop strip still uses `gap-1`.

## One decision

Fix the two rejected choices. Do not offer Option A/B/C. Do not restyle unrelated panels. Do not commit.

## Validation

The runner will run `npm run typecheck` then `npm run build`. Do not claim they passed unless the runner did. Human visual review happens again after you finish.
