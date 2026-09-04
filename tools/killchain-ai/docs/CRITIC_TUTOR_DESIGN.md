# Tutoring Gates — design

The first audit's central finding was that **the gates are graders when they
should be tutors**. The foreman already knew which field was absent, which path
was invented, and which paths were authorized — then discarded all of it and
either re-ran the whole phase or blocked the mission.

This document describes the mechanism that replaces that.

## The shape

Every gate failure now follows:

```
DETECT  ->  LOCALIZE  ->  EXPLAIN  ->  CONSTRAINED RETRY
```

instead of `DETECT -> generic retry / BLOCK`. The carrier is a
**CorrectionPacket** (`src/mission/tutor.mjs`), built from deterministic gate
output only. It never re-sends the mission brief, and it always states what is
forbidden as explicitly as what is required — the archived failures show the
model will happily "fix" a scope error by editing somewhere else, or fix an
empty edit by writing a longer explanation.

Packet fields:

```
FAILURE_CLASS · FAILED_GATE · WHAT_WAS_EXPECTED · WHAT_WAS_OBSERVED
EXACT_MISSING_FIELDS · INVALID_REFERENCES · NEAREST_VALID_REFERENCES
VERIFIED_SYMBOL_LOCATIONS · ALLOWED_PATHS · FORBIDDEN_PATHS
RELEVANT_EVIDENCE · REQUIRED_NEXT_ACTION · PROHIBITED_NEXT_ACTIONS
RETRY_BUDGET · YOUR_PREVIOUS_OUTPUT
```

Only the fields relevant to the specific failure are emitted, so packets stay
small.

## Failure kinds and their recovery paths

`classifyGateFailure()` maps a gate result to exactly one kind, with a fixed
precedence so a mixed failure never gets the cheap treatment:

```
PRODUCT_AMBIGUITY  >  INVALID_REFERENCE  >  SCOPE  >  CRITIC_SUBSTANTIVE  >  CRITIC_FORMAT
```

| Kind | Recovery |
|---|---|
| `CRITIC_FORMAT` | Reshape the model's own output. No repo tools, no re-judgement. |
| `CRITIC_SUBSTANTIVE` | Address the specific findings; the critic found something real. |
| `INVALID_REFERENCE` | Re-propose using verified targets, with the true symbol locations supplied. |
| `SCOPE` | Revise inside the allowlist, or state that the goal needs authorization and stop. |
| `EMPTY_EDIT` | Execution-only retry. Terse and imperative. |
| `VALIDATION` | Repair the primary failure only, with localized windows. |
| `PRODUCT_AMBIGUITY` | Human BLOCK. Never a model retry. |

The precedence matters. Archived `fire-level3-overnight-dryrun-3` failed with
both `missing-verdict` *and* invented files; treating that as a formatting
problem would have produced a well-formatted hallucination.

## The critic contract, and why format failure is separated

Format failure and substantive failure previously shared one recovery path: the
phase was re-run. That is why 8 of 15 archived BLOCKs were contract problems
rather than engineering problems.

Now a pure format failure gets a **format repair**: the model receives its own
prior output and is asked only to add the labelled lines. It is explicitly
forbidden from re-investigating, revising its judgement, or adding findings.

The critical safety property: **a format repair must never become a fabrication
vector.** Two protections:

1. `hasSubstanceFor(field, text)` checks whether the content for a field is
   actually present before a reshape is attempted. Archived
   `repair-store-readonly-overnight-2` is the counterexample — it is not a
   critic output at all, just a file report about imports. Asking it to "add a
   VERDICT" would force it to invent one. That case is deliberately routed away
   from format repair.
2. When a required field has no support, the packet demands the literal token
   `MISSING` rather than a guess, and the foreman then requests that evidence
   separately.

## The grounded-no-tool policy

The old rule was `NO TOOLS = INVALID CRITIC` at level ≥ 1. The brief asked
whether that should survive. It should not, as stated — but the honest finding
is narrower than expected.

New rule, in `criticGroundingOk()`:

> A critic is grounded when **either** it inspected the repository itself,
> **or** every path it cites appears verbatim in the authoritative evidence it
> was given.

Tool count is telemetry; evidence quality is the requirement. The decisive case
is archived `fire-perf-header-overflow-revise#final`: zero tool calls, but it
cites the actual Git diff it was handed, with file and line numbers that match
`CURRENT.diff`, and correctly concludes the claimed defects do not exist in
HEAD. Forcing redundant reads there buys nothing.

Two deliberate design choices:

- **A plan that merely names a file is not evidence of that file's contents.**
  `planText` and `proposalText` are therefore *not* accepted as grounding. An
  earlier draft did accept them and immediately turned a correct rejection into
  a pass, which is how that mistake was caught.
- **Every** cited path must be corroborated, not just one. A critic that cites
  one real path from the diff plus one invented path is still ungrounded — which
  is the case the original rule was really protecting against.

Measured honestly: this policy changed **zero** archived outcomes, because the
pre-existing `finalDiffInPrompt` waiver already covered the only affected case.
It is a correctness improvement (it can now catch a critic citing paths absent
from its evidence) rather than a block-rate improvement.

## One brittle-parser false block, fixed

`cover-store-readonly-overnight#final` is a fully grounded review — real paths
with line ranges, a concrete `URL.createObjectURL` leak risk, and mitigation
evidence via LRU eviction. It was rejected because it wrote `## VERDICT READY`
instead of `VERDICT: READY`. The mission then exhausted its model-call budget.

`parseCritic` now accepts the label and value on one line with no colon. A
sweep of all 245 archived critic artifacts found exactly **one** case, so this
is a narrow fix rather than a systemic win — worth doing because it converts a
false rejection into a correct pass at zero model cost, and worth reporting
accurately because it is not the widespread problem it might look like.

## What is deliberately *not* changed

- The gate's *detections* were almost all correct. Every archived
  `invented-files` and `invented-inner-panel` flag inspected during this work
  was a true positive (`src/audioEngine.ts`, four `.vue` files in a React app,
  `DrivePanel.tsx` as a sibling module, `ModuleEnableToggleBase.tsx`). The
  problem was never detection accuracy; it was recovery cost and specificity.
- `PRODUCT_AMBIGUITY` still blocks for a human. `fire-osc-header-right-1280`
  measured the layout, found no clipping, and correctly refused to invent work
  in 4 model calls. That is a success and must keep behaving identically.
- A critic PASS with zero inspected files is still rejected.
