# Held-Out Evaluation Plan

Any future prompt change, model swap, fine-tune, or teacher policy must beat
this suite. Without it, changes are unfalsifiable — which is the main reason
this audit recommends against fine-tuning today.

## Structure

Three tiers, run in order of cost.

### Tier 1 — deterministic gate fixtures (seconds, no model)

Pure functions over frozen inputs. These protect the gates themselves, since a
broken gate silently poisons every mission. 204 tests currently cover this tier,
including 39 added by this audit.

- `jsxStructure` on the archived broken `DrumMachine.tsx` and on 397 clean repo
  sources: **zero false positives required**, non-negotiable.
- `identifierGate` on 336 clean sources: zero false positives, plus the known
  `TS2552` case from `fire-drum-fill-preview-live` must be caught.
- `failureClass` classification and escalation over the archived signal set.
- `teacherPacket` budget compliance and response validation, including the
  rejection cases (invented file, out-of-scope path, unsupported symbol).

### Tier 2 — single-shot model fixtures (minutes, one session each)

One model call against a frozen fixture copy. Production hashes verified before
and after. This is where `repair-bench` lives.

| Fixture | Class | Metric |
|---|---|---|
| Broken `DrumMachine.tsx` (2 orphaned closers) | `MECHANICAL_SYNTAX` | repaired / progressed / **regressed** |
| Single-fault variant (1 orphaned closer) | `MECHANICAL_SYNTAX` | repaired in one round |
| `TS2552` invented identifier fixture | `INVENTED_SYMBOL` | resolves to the real in-scope name |
| Approved `ModuleEnableToggle` proposal | `APPLY_EMPTY` | nonzero delta in the expected file |
| Nonexistent-sibling retrieval task | `RETRIEVAL_INVENTED` | zero invented paths in the report |
| A diff that failed a gate | `CRITIC_FAILURE` | critic names the real fault |
| Underspecified mission brief | `PRODUCT_AMBIGUITY` | correct BLOCK, not a guess |

The regression column matters as much as the success column. This audit's A/B
found identical success rates (1/6 vs 1/6) but a 4× difference in degradation
(36% vs 8% of rounds), and the degradation number is what predicts blocked
missions.

### Tier 3 — full held-out missions (hours)

Complete mission runs, contamination-controlled. Reserve **10 missions that are
never used for prompt tuning or dataset construction**: 4 at Level B, 4 at Level
C, 2 designed to require a correct BLOCK.

## Metrics and weights

Weighted heavily toward mechanical reality:

| Metric | Weight |
|---|---|
| Patch actually applied (nonzero delta in the expected file) | 20 |
| Mechanical validity (syntax + structural balance on first apply) | 20 |
| Repair success | 15 |
| **No regression** (never ends worse than it started) | 15 |
| File/symbol factuality (every referenced path and symbol exists) | 10 |
| Scope discipline | 8 |
| Typecheck / build / tests | 7 |
| Rollback safety (clean restore after failure, no foreign file damage) | 3 |
| Visible report contract compliance | 2 |
| Prose quality | 0 |

Prose is weighted zero deliberately. The archive contains articulate reports
attached to missions that changed nothing.

## Contamination control

1. Tier 3 missions are recorded in a `HELD_OUT.txt` manifest. Anything on that
   list is excluded from dataset construction and from prompt iteration.
2. Hold out whole missions, never individual phases from a mission whose other
   phases were used for tuning.
3. Fixtures are frozen byte copies with recorded SHA-256. If a fixture's hash
   changes, its historical scores are void.
4. When a Tier 2 fixture has been used to iterate on a prompt, it is
   reclassified as a training fixture and a fresh held-out variant replaces it.

## Baseline scores (2026-09-03)

Established during this audit, `ollama/qwen3.5:9b`:

- Tier 1: 204/204 pass.
- Tier 2, broken `DrumMachine.tsx`, 2 rounds, n=6 per arm:

| | baseline | assisted |
|---|---|---|
| repaired | 1/6 | 1/6 |
| ended worse than start | 2/6 | **0/6** |
| rounds regressed | 4/11 | **1/12** |
| mean residual anomalies (start 5) | 3.8 | **2.3** |
| worst-case final TS diagnostics (start 10) | 90 | **9** |

- Tier 2, remaining fixtures: **not yet run.**
- Tier 3: **not yet built.**

Anything claiming to improve the system must beat the assisted column, and in
particular must not raise the regression numbers.

## Reporting rule

Report `n`. Report the arm that lost. A suite that only ever confirms the latest
change is not an evaluation.
