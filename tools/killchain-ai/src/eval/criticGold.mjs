/**
 * Gold labels for the critic replay benchmark.
 *
 * Authored by Opus 5 (senior model) by reading the archived critic text, the
 * mission spec, and the archived session tool calls. Qwen does not label its
 * own benchmark.
 *
 * Every entry below was labelled only after the underlying artifact was
 * actually read. Cases that were not read are deliberately left unlabelled
 * rather than guessed, so the benchmark's ground truth stays trustworthy even
 * though that keeps n smaller.
 *
 * Labels:
 *  SHOULD_PASS          grounded critic whose PASS is justified
 *  SHOULD_FAIL          a real problem exists; recovery work is required
 *  SHOULD_BLOCK         needs a human decision; no model retry is correct
 *  FORMAT_ONLY_FAILURE  substance present, contract shape absent; a cheap
 *                       targeted reshape is the correct recovery
 *  NEEDS_MORE_EVIDENCE  claims are ungrounded or reference nonexistent code;
 *                       targeted retrieval correction required
 */

const RAW = [
  // ---------------------------------------------------------------- FORMAT ONLY
  [
    "cover-store-readonly-overnight#final",
    "SHOULD_PASS",
    "Fully grounded review: real paths with line ranges (coverStore.ts:1-111, sourceArbiter.ts:65-93), "
    + "a concrete leak risk (URL.createObjectURL accumulation), and mitigation evidence (LRU eviction "
    + "calling revokeObjectURL). It states its verdict as '## VERDICT READY'. "
    + "RELABEL NOTE: first labelled FORMAT_ONLY_FAILURE, then corrected. A gold label must describe the "
    + "correct outcome, not what the legacy parser could see. The verdict word is present and the review "
    + "is grounded, so PASS is the right disposition; the colon requirement was the defect. Recorded here "
    + "so the relabel is auditable rather than silent.",
  ],
  [
    "repair-store-readonly-overnight#final",
    "FORMAT_ONLY_FAILURE",
    "Has VERDICT: READY, real evidence (zero getEngine()/Reconstructor calls), an acceptance checklist "
    + "and a stated uncertainty. It names repairStore.ts but never as a full repo path, so the INSPECTED "
    + "field cannot be verified. Correct recovery is 'restate INSPECTED with verified full paths', not a re-plan.",
  ],

  // -------------------------------------------------------- NEEDS MORE EVIDENCE
  [
    "fire-level3-overnight-dryrun#plan",
    "NEEDS_MORE_EVIDENCE",
    "Cites src/audioEngine.ts and src/stateManager.ts. Neither exists; the real file is "
    + "src/audio/AudioEngine.ts. Classic real-concept/invented-path error. Zero tool calls at the plan phase.",
  ],
  [
    "fire-level3-overnight-dryrun#final",
    "NEEDS_MORE_EVIDENCE",
    "Invents three .tsx paths, four .vue files (this is a React app — wrong stack entirely), and marks two "
    + "existing files as NEW. Multiple independent factuality failures.",
  ],
  [
    "fire-level3-overnight-dryrun-3#plan",
    "NEEDS_MORE_EVIDENCE",
    "Invents src/state/AccordionModeState.ts, src/controllers/AccordionController.ts, "
    + "src/components/EditorShell/EditorShell.tsx and src/components/CollapseToggle.tsx, and also omits a "
    + "parseable verdict. Reference failure dominates the format failure.",
  ],
  [
    "fire-perf-header-overflow#final",
    "NEEDS_MORE_EVIDENCE",
    "Level 2 final review citing src/styles.css, which does not exist, with zero tool calls. The mission "
    + "was archived as BLOCKED on 'critic-no-tools'; the deeper problem is the invented path.",
  ],
  [
    "fire-ux-level2-overnight-discovery-3#plan",
    "NEEDS_MORE_EVIDENCE",
    "Cites src/components/FireCommand/DrivePanel.tsx as a real file. DrivePanel is an inner function of "
    + "FireCommandView, not a sibling module. Real symbol, invented file.",
  ],
  [
    "fire-ux-level2-overnight-discovery-3#final",
    "NEEDS_MORE_EVIDENCE",
    "Same invented DrivePanel.tsx path, now in the final review, with zero tool calls.",
  ],
  [
    "fire-ux-level2-overnight-discovery-6#plan",
    "NEEDS_MORE_EVIDENCE",
    "Repeats the DrivePanel.tsx invention. Recurrence across missions is what makes this a lesson rather "
    + "than an anecdote.",
  ],
  [
    "fire-ux-level2-overnight-discovery-6#final",
    "NEEDS_MORE_EVIDENCE",
    "Same invented inner-panel path in the final review.",
  ],
  [
    "fire-ux-level2-overnight-discovery-7#plan",
    "NEEDS_MORE_EVIDENCE",
    "Invents both DelayPanel.tsx and DrivePanel.tsx. The model's own verdict was NOT_READY, so its judgement "
    + "was directionally right while its references were not.",
  ],
  [
    "helper-shadow-readonly-overnight#plan",
    "NEEDS_MORE_EVIDENCE",
    "Cites src/Commands/FireCommandView.tsx. The real path is under src/components/. Wrong directory, "
    + "right filename — precisely the case where naming the verified location is the whole correction.",
  ],
  [
    "pilot-fire-ux-plan#final",
    "NEEDS_MORE_EVIDENCE",
    "Invents ModuleEnableToggleBase.tsx and HomeBandContent.tsx, the two canonical archived hallucinations, "
    + "with zero tool calls.",
  ],
  [
    "repair-store-readonly-overnight-2#final",
    "NEEDS_MORE_EVIDENCE",
    "Not a critic output at all: it is a file report answering whether repairStore.ts imports AudioEngine. "
    + "No verdict, no risk, no review. There is no substance to reshape, so a format repair here would "
    + "force the model to fabricate a verdict. Must NOT be format-repaired.",
  ],

  // ------------------------------------------------------------------ SHOULD PASS
  [
    "fire-module-enable-feedback-live#plan",
    "SHOULD_PASS",
    "Real path with line range (ModuleEnableToggle.tsx:104-121), the actual current rgba values, a concrete "
    + "contrast risk, and evidence that click semantics and aria-pressed are untouched. Used 2 tools.",
  ],
  [
    "fire-module-enable-feedback-live#final",
    "SHOULD_PASS",
    "Quotes the applied diff values (0.30/0.65/0.75 vs 0.18/0.42/0.45), checks click semantics, keyboard "
    + "and focus by line number, and confirms no audio/state/persistence changes. The reference success.",
  ],
  [
    "fire-perf-header-overflow-live#final",
    "SHOULD_PASS",
    "Level 2 final review with real inspected paths and evidence, 2 tool calls.",
  ],
  [
    "fire-perf-header-overflow-revise#final",
    "SHOULD_PASS",
    "The decisive grounded-no-tool case: zero tool calls, but it cites the actual Git diff it was given, "
    + "with file and line numbers that match CURRENT.diff, and correctly concludes the claimed defects do "
    + "not exist in HEAD. Requiring redundant reads here buys nothing.",
  ],
  [
    "fire-drum-fill-preview-live#plan",
    "SHOULD_PASS",
    "Strong MCP-grounded review: a table of real paths, real line numbers, and a correct negative finding "
    + "(PianoRoll has zero generateDrumFill callers). The mission later failed on a mechanical apply error, "
    + "which is not a plan-critic failure.",
  ],

  // ----------------------------------------------------------------- SHOULD BLOCK
  [
    "fire-osc-header-right-1280#plan",
    "SHOULD_BLOCK",
    "Correct product BLOCK and an archived success. It measured slot metrics (overflowX: 0, clipped: false) "
    + "across 1280/1366/1440 and refused to invent work. A model retry would be the wrong response.",
  ],
];

export const GOLD = {};
for (const [id, label, why] of RAW) GOLD[id] = { label, why };

export const GOLD_COUNTS = RAW.reduce((acc, [, label]) => {
  acc[label] = (acc[label] || 0) + 1;
  return acc;
}, {});
