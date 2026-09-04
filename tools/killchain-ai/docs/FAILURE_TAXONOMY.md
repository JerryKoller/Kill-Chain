# Failure Taxonomy

Canonical failure classes for the Kill Chain autonomous mission runner.
Implemented in `src/mission/failureClass.mjs`; every class below is produced by
deterministic signals (git delta, scanner output, compiler codes, gate errors),
never by reading model prose for a verdict.

The point of the taxonomy is that **the foreman should respond differently
depending on failure class**. Escalating on retry count alone is what produced
the archived repair spiral.

## Evidence base

Derived from a census of all 71 archived missions in
`tools/killchain-ai/data/missions/`:

| Outcome | Count | Share |
|---|---|---|
| COMPLETE | 56 | 78.9% |
| BLOCKED | 15 | 21.1% |
| FAILED | 0 | 0% |

| Level | Missions | Complete | Success rate |
|---|---|---|---|
| 0 (read-only / discovery) | 63 | 52 | 82.5% |
| 1 (single-file UI edit) | 2 | 2 | 100% |
| 2 (multi-file live edit) | 6 | 2 | **33.3%** |

Live multi-file editing is the bottleneck. Read-only investigation is close to
solved; the loss happens between "correct proposal" and "validated diff".

## The classes

| Class | Deterministic signal | Default action | Escalates to |
|---|---|---|---|
| `MECHANICAL_SYNTAX` | scanner reports delimiter/JSX imbalance | `STRUCTURAL_REPAIR` | `RESTORE_AND_REAPPLY`, then teacher |
| `INVENTED_SYMBOL` | TS2304/2552/2551/2307/2305, or the scope gate | `SCOPE_REPAIR` | `RESTORE_AND_REAPPLY` |
| `SEMANTIC_TYPE` | syntax/validation failure with sound structure | `FOCUSED_REPAIR` | teacher |
| `APPLY_EMPTY` | zero git delta in a write phase | `STRONG_APPLY` | block on the third |
| `APPLY_DIVERGENT` | wrote files the proposal did not authorize | `FOCUSED_REPAIR` | replan |
| `SCOPE_VIOLATION` | paths outside `allowedPaths` | `BLOCK` | — |
| `RETRIEVAL_INVENTED` | referenced repo paths that do not exist | `ENRICH_RETRIEVAL` | replan |
| `PRODUCT_AMBIGUITY` | zero delta + proposal argues the premise is false | `BLOCK` | human |
| `REPORTING_FAILURE` | `missing-verdict`, `critic-no-tools`, thin text | `REEMIT_REPORT` | block on the second |
| `CRITIC_SUBSTANTIVE` | evidenced critic objection | `REPLAN` | teacher |
| `VALIDATION_OTHER` | tests/build failed for another reason | `FOCUSED_REPAIR` | teacher |
| `BUDGET_EXHAUSTED` | model calls / wall clock / phases | `TEACHER` | human |
| `INFRASTRUCTURE` | tool/provider/process failure | retry once | human |

## Classifying the archived BLOCKs

All 15 BLOCKED missions, reclassified:

| Class | Count | Missions |
|---|---|---|
| `REPORTING_FAILURE` | 4 | `fire-level3-overnight-dryrun`, `repair-store-readonly-overnight`, `repair-store-readonly-overnight-2`, `fire-perf-header-overflow` |
| `RETRIEVAL_INVENTED` | 3 | `helper-shadow-readonly-overnight`, `fire-ux-level2-overnight-discovery-7`, `fire-level3-overnight-dryrun-3` |
| `CRITIC_SUBSTANTIVE` | 4 | `accordion-existing-readonly-overnight`, `fire-panel-map-overnight`, `fire-ux-level2-overnight-discovery-4`, `fire-osc-header-right-1280` |
| `MECHANICAL_SYNTAX` + `INVENTED_SYMBOL` | 1 | `fire-drum-fill-preview-live` |
| `PRODUCT_AMBIGUITY` | 1 | `fire-drum-fill-preview-retry` |
| `SCOPE_VIOLATION` | 1 | `fire-ux-level2-discovery` |
| `BUDGET_EXHAUSTED` | 1 | `cover-store-readonly-overnight` |

### What that reclassification changes

Four of fifteen blocks (27%) were **`REPORTING_FAILURE`** — the model did the
engineering and lost the mission on output format. `repair-store-readonly-overnight`
produced a 7,822-character investigation and then blocked on
`no-inspected-files`. Treating this as a replan wastes the work; the correct
response is to ask only for the missing contract fields.

Exactly one mission was `PRODUCT_AMBIGUITY`
(`fire-drum-fill-preview-retry`), and it consumed three identical apply retries.
Its proposal said `PROPOSAL: NO CHANGES REQUIRED — The UI ambiguity described in
the mission brief does not exist.` No number of apply retries can fix a mission
whose premise the model rejects; that is a human decision, so the classifier
routes it straight to BLOCK.

Only **one** of fifteen blocks was a genuine code-quality failure.

## Model problem vs orchestration problem

| Failure | Where it actually lives |
|---|---|
| `MECHANICAL_SYNTAX` | **Orchestration.** A 9B model counting delimiters across 80 lines is the wrong tool. Solved deterministically by `jsxStructure.mjs`. |
| `INVENTED_SYMBOL` | **Orchestration.** The file's own imports answer it. Solved deterministically by `identifierGate.mjs`. |
| `RETRIEVAL_INVENTED` | **Orchestration.** Existence is checkable; the gate already catches most, and it correctly caused 3 blocks. |
| `REPORTING_FAILURE` | **Orchestration.** Format compliance should never terminate a mission that produced real evidence. |
| `PRODUCT_AMBIGUITY` | **Neither.** Genuinely a human decision. The bug was retrying it. |
| `APPLY_EMPTY` | **Model**, partly mitigable by execution-phase contract design. |
| `SEMANTIC_TYPE` | **Model.** Real reasoning; the right place for a teacher. |
| `CRITIC_SUBSTANTIVE` | **Model.** Critic quality is the main gate on higher autonomy. |

The dominant lesson: **most archived failures were not reasoning failures.**
They were mechanical or contractual failures that deterministic code can own.

## Escalation invariants

1. Never repeat an action that has already failed twice on the same class.
2. A repeated `MECHANICAL_SYNTAX` failure **restores the pre-edit bytes** and
   re-applies the approved patch, instead of mutating a file that previous
   repair attempts already damaged.
3. `SCOPE_VIOLATION` and `PRODUCT_AMBIGUITY` never retry.
4. Level ≥ 4 (audio) never gets a blind local retry.
5. Teacher output is advisory and is validated against the repository before it
   can influence an execution phase.
