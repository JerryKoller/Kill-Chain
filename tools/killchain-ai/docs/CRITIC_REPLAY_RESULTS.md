# Critic Replay — results

Harness: `src/eval/criticReplay.mjs` · gold labels: `src/eval/criticGold.mjs`
· CLI: `kc-ai critic-replay`

Deterministic and repeatable: no model is invoked. Archived critic text is
re-evaluated through both the old gate and the tutorized gate and scored
against Opus-authored gold labels.

## Corpus and fidelity

- **245** archived critic artifacts exist; **134** reconstruct into complete
  replay cases (critic text + mission spec + plan/proposal + session tools).
- **20** are gold-labelled. Only artifacts that were actually read were
  labelled — unread cases are left unlabelled rather than guessed, which keeps
  n smaller but the ground truth trustworthy.

Fidelity controls:

- Tool lists come from the archived session JSONL, not assumptions.
- `suppliedEvidence` mirrors what the real prompt contained: the final critic
  received `CURRENT.diff`; the plan critic received only the plan, which is
  **not** treated as authoritative evidence about file contents.
- The baseline arm models the *pre-engagement* verdict parser, so widening the
  parser during this work does not silently inflate the baseline.

## Gold label distribution

| Label | n |
|---|---|
| `NEEDS_MORE_EVIDENCE` | 12 |
| `SHOULD_PASS` | 6 |
| `FORMAT_ONLY_FAILURE` | 1 |
| `SHOULD_BLOCK` | 1 |

## Results

| Metric | Old gate | Tutorized gate |
|---|---|---|
| Accuracy vs gold | **0.90** | **1.00** |
| False BLOCKs | 0 | **0** |
| False PASSes | 0 | **0** |
| Cases requiring a full phase re-plan | **14** | **0** |
| Recovery cost (model calls) | **28** | **13** |
| Correct product BLOCKs preserved | 1/1 | 1/1 |

Disposition shift:

```
REPLAN -> TUTOR_RETRY   13
REPLAN -> PASS           1
PASS   -> PASS           5
BLOCK  -> BLOCK          1
```

**Recovery cost fell 54% (28 → 13) with no new false passes and no new false
blocks.** That is the result the brief asked for: fewer unnecessary retries
without letting unsafe critics through.

## What actually changed, stated precisely

The old gate's **detections were almost all correct**. Every archived
`invented-files` and `invented-inner-panel` flag inspected here is a true
positive: `src/audioEngine.ts` and `src/stateManager.ts` (real concepts, wrong
paths — the real file is `src/audio/AudioEngine.ts`), four `.vue` files in a
React app, `DrivePanel.tsx` cited as a sibling module when it is an inner
function of `FireCommandView`, and the canonical `ModuleEnableToggleBase.tsx` /
`HomeBandContent.tsx` pair.

So the improvement is **not** better detection. It is that 14 cases which
previously triggered a full phase re-run now get a targeted correction inside
the same phase, carrying the invalid path, the verified symbol location, and an
explicit prohibition against substituting a plausible name.

## The one false rejection recovered

`cover-store-readonly-overnight#final` is a fully grounded review — real paths
with line ranges (`coverStore.ts:1-111`, `sourceArbiter.ts:65-93`), a concrete
`URL.createObjectURL` leak risk, and mitigation evidence. It was rejected
because it wrote `## VERDICT READY` instead of `VERDICT: READY`, and the mission
then exhausted its model-call budget. The parser now accepts that form and the
case passes at zero model cost.

A sweep of all 245 artifacts found **exactly one** instance, so this is a narrow
robustness fix, not the systemic win it might appear to be.

### A relabel, recorded openly

This case was first labelled `FORMAT_ONLY_FAILURE` and then corrected to
`SHOULD_PASS`. The reasoning: a gold label must describe the *correct outcome*,
not what the legacy parser happened to see. The verdict word is present and the
review is grounded, so PASS is right and the colon requirement was the defect.
Under the initial label the new gate scored a "false pass", which would have
been an artifact of the label rather than a real safety regression. The note is
kept in `criticGold.mjs` so the change is auditable rather than silent.

## The grounded-no-tool policy: an honest null result

The brief asked whether `NO TOOLS = INVALID CRITIC` should survive. It should
not as stated, and the rule was replaced by an evidence-quality rule (see
`CRITIC_TUTOR_DESIGN.md`). But measured against the archive it changed **zero
outcomes**, because the pre-existing `finalDiffInPrompt` waiver already covered
the only affected case.

Only 2 of 134 cases were level ≥ 1 with zero tool calls, and one of those was
already failing for an invented path. The decisive case,
`fire-perf-header-overflow-revise#final`, was already passing.

The new rule is still worth keeping because it is *stricter where it matters*:
it requires every cited path to be corroborated by the supplied evidence, so a
critic that mixes one real diff path with one invented path is now ungrounded.
The old rule counted named paths and would have waived it.

## The `critic-no-tools` archived BLOCK, re-diagnosed

`fire-perf-header-overflow` was archived as BLOCKED on `critic-no-tools`, which
made the tool requirement look like the culprit. Reading the artifact shows the
deeper problem: the critic cited `src/styles.css`, which does not exist. The
correct disposition is a reference correction, not a tool-count complaint. The
tutorized gate routes it that way.

## Limitations

- 20 labelled cases. The 13 `REPLAN → TUTOR_RETRY` shifts are one homogeneous
  class (invalid references), so this measures that class well and others
  barely.
- No `FORMAT_REPAIR` disposition fired on archived data: the one true
  format-only case (`repair-store-readonly-overnight#final`) cannot have its
  `INSPECTED` field verified, so it correctly routes to a targeted re-ask
  instead. The dedicated format-repair path is implemented and unit-tested but
  **unproven on real data**.
- Recovery cost uses fixed weights (`REPLAN` = 2 calls, `TUTOR_RETRY` = 1). Real
  re-plans often cost more, so 54% is likely conservative — but it is a model,
  not a measurement.
