# Teacher Lift — measured

Tests the future architecture directly: `LOCAL WORKER + REMOTE TEACHER`. Opus
played the teacher; Qwen performed every repair.

## The escalation ladder, measured end to end

Nine real editing tasks (`EDIT_CURRICULUM_RESULTS.md`), one model
(`ollama/qwen3.5:9b`), identical fixture bytes at every stage:

| Stage | Accepted | Delta |
|---|---|---|
| Qwen, first attempt | **5/9 (56%)** | — |
| + foreman tutoring packet | **7/9 (78%)** | +2 recovered |
| + Opus teacher, Level 1 | **9/9 (100%)** | +2 rescued |
| Opus teacher, Level 2 | not needed | 0 |

- **Foreman tutoring recovered 2 of 4** first-round failures with no senior
  model involved. That is the cheap tier working.
- **Opus teacher Level 1 rescued 2 of 2** remaining failures — diagnosis,
  evidence and repair strategy only, with **no finished source and no literal
  patch text**.
- **Level 2 (explicit localized patch guidance) was never required.**

Teacher lift over the tutored foreman: **+22 percentage points (78% → 100%)**,
on 2 cases. Small n, but both were cases the local loop had already failed
twice.

## Why the lift is attributable to guidance

The comparison is clean by construction. Round 1 of each task already ran from
**identical fresh fixture bytes with the same deterministic structural packet**
and failed. The teacher round adds exactly one variable: the senior diagnosis,
evidence and strategy text. Both teacher rounds also restore the fixture first,
but so did round 1, so restore is not the differentiator — round 1 *was* a
restore-fresh attempt.

## What the teacher actually said

Both responses were authored after reading only the failing file's structural
packet and source window, which is what a remote teacher will receive.

**`mech-03-MacroPanel`** — the local loop had made the file worse (1 → 2
diagnostics) by stacking a repair on a damaged buffer:

> Two closing tags are now missing, not one. The scan reports 0 surplus closers
> and 2 unclosed openers; the first divergence is the `</div>` on line 79, which
> is the component's final return closer, so the missing closers are before it.
> Do not edit your current buffer further — start from the file as given.
> Exactly one `</div>` was missing originally. Walk the nesting down to line 79,
> find the single level whose closer is absent, add that one line, delete
> nothing.

**`mech-05-fireUiKit`** — the local loop had produced zero edits twice:

> A `<button>` opened on line 160 is never closed. The `}` on line 177 cannot
> close anything because it is blocked by that open button frame, and line 175
> is `) : (`, which ends the true branch of a ternary — so the closing tag must
> appear before that branch ends. Insert one closing tag on its own line
> immediately before `) : (`. You must actually call an edit tool: two attempts
> produced no file modification at all.

Both were fixed in a single round (31s and 11s).

## Cost / benefit

Cheap tiers first, and it matters:

| Tier | Cost | Recovered |
|---|---|---|
| Deterministic gate + structural packet | 0 senior calls | 5/9 outright |
| Foreman tutoring packet | 0 senior calls | 2 of 4 failures |
| Opus teacher Level 1 | 2 senior calls | 2 of 2 failures |

Two senior calls for the final 22 percentage points. If that ratio holds, a
remote teacher is invoked roughly **once per 4–5 editing tasks at tier 5**, and
essentially **never at tier 1** (3/3 first try, no escalation).

That is an affordable escalation rate, and it is the number to watch: if a
future teacher is being called more than ~1 in 10 missions at Level B/C, the
mission briefs are underspecified rather than the worker being weak.

## Validation of the remote-teacher concept

**Validated, with a caveat.**

What works: the packet/response contract is sufficient. Both teacher responses
were producible from the packet alone, and both were advisory — the foreman
decided what entered execution, and Qwen performed every mutation. The
`validateTeacherResponse()` gate rejects a teacher for citing files that do not
exist, recommending paths outside `allowedPaths`, or naming symbols absent from
the cited files, so an unaudited remote model is held to the same factuality
bar as the student.

The caveat: both rescued cases were `MECHANICAL_SYNTAX`. This experiment does
**not** show that a teacher helps with semantic, architectural, or product
ambiguity — only that senior structural guidance converts a stuck mechanical
repair into a success. Those other classes remain untested.

## What a remote teacher should and should not receive

Should receive: the failure classification, compiler output, the structural and
scope packets, the minimal source windows, the plan and proposal, the student's
prior attempts, and subsystem-selected invariants — i.e. the existing teacher
packet, under its size budget, with no whole-file dumps.

Should **not** receive: the repository, write access, authority over the gates,
or the ability to approve its own recommendation. It also should not be asked
to answer anything the compiler or a scanner can answer more cheaply.

## Honest limitations

- 2 teacher cases. This measures the mechanism, not a rate.
- Same failure class in both.
- Opus wrote the guidance with knowledge of the codebase from a prior session,
  which a cold remote teacher would lack. The guidance was derived from the
  packet, but the confound cannot be fully eliminated from within this setup.
- Level 2 was never exercised, so its value is unmeasured.
