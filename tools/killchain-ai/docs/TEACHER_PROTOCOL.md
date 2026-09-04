# Teacher Protocol

How a senior model escalation works, and why it cannot bypass the foreman.

Implemented in `src/mission/teacherPacket.mjs`. Wired into `runner.mjs` at the
`REPAIRING` state: when `failureClass.mjs` returns the `TEACHER` action, the
foreman writes a packet and BLOCKs with a pointer to it.

Today the teacher is Cursor/Opus. Later it is a remote model (NIM-class). The
contract below is deliberately model-agnostic so that swapping the teacher does
not touch mission architecture.

## Absolute rule

**Teacher output is ADVISORY.**

`validateTeacherResponse()` machine-checks every teacher reply against the
repository before any of it can influence an execution phase. A fluent,
confident, wrong answer from a large model is rejected the same way a local
model's would be. Specifically, the foreman rejects a teacher reply that:

- omits any contract field
- cites files that do not exist (`invented-files`)
- cites files outside the mission's `allowedPaths` (`outside-allowed`)
- names symbols that appear in none of the cited files (`symbols-not-found`)
- gives evidence shorter than 20 characters (`evidence-too-thin`)
- reports a confidence outside `HIGH|MEDIUM|LOW`

This is the guard that keeps "a smarter model said so" from becoming an
authorization to skip scope, baselines, gates, or human review.

## When the foreman escalates

Escalation is driven by failure class, not by frustration:

| Trigger | Rationale |
|---|---|
| `MECHANICAL_SYNTAX` survived a clean pre-edit restore and re-apply | The evidence was sufficient and the worker still could not use it |
| `SEMANTIC_TYPE` / `VALIDATION_OTHER` after 2 focused repairs | Real reasoning is required |
| `CRITIC_SUBSTANTIVE` after 2 replans | The plan may be wrong at the design level |
| `BUDGET_EXHAUSTED` | A human or teacher should decide whether to continue |
| Any failure at level ≥ 4 (audio) | No blind local retries near AudioEngine |

Expected frequency at the current maturity level: roughly **1 escalation per
6–10 live editing missions**, concentrated in multi-file work. Read-only
missions should essentially never escalate.

## The packet

Deterministically assembled. Size-budgeted (`PACKET_BUDGET.totalChars = 120000`)
so escalation can never degenerate into "send the repository".

| Section | Contents |
|---|---|
| `TASK.md` | id, level, goal, acceptance, editable paths, files under repair |
| `MISSION.json` | state, counters, `failureClassCounts`, last escalation |
| `INVARIANTS.md` | **only** the invariants for the touched subsystem (audio / state / ui) |
| `FAILURE.json` | the deterministic classification and its evidence |
| `COMPILER.txt` | exact diagnostics |
| `STRUCTURE.md` | the deterministic structural analysis (surplus/unclosed/mismatch, open frame stack, expected closer sequence) |
| `SCOPE.md` | unresolved identifiers with real in-scope candidates |
| `SOURCE_WINDOWS.txt` | ~90 lines anchored on the real fault line — never whole files |
| `PLAN.md`, `PROPOSAL.md` | what was approved |
| `STUDENT_ATTEMPTS.md` | prior diagnosis + journal |
| `CURRENT_DIFF.patch` | what is actually on disk |
| `QUESTIONS.md` | failure-class-specific questions |
| `CONTRACT.md` | the response contract |
| `MANIFEST.json` | section list, size, budget compliance |

The deterministic analyses are what keep the packet small. A teacher that is
told "line 372 closes nothing and the open stack expects `</EditorToolbarGroup>`"
does not need the other 1,200 lines of the file.

Invariant selection is subsystem-scoped on purpose: a UI packet that ships the
audio invariants invites the teacher to reason about `claimSource` in a mission
that touches a toggle's border colour.

## The response contract

```
DIAGNOSIS: <one sentence: what is actually wrong>
EVIDENCE: <the deterministic analysis / diagnostic lines you relied on>
ROOT_CAUSE: <why it happened, not just what is broken>
FAILED_STUDENT_ASSUMPTION: <the belief the repo contradicts>
RECOMMENDED_REPAIR: <the minimum change, applicable without redesign>
FILES: <comma-separated repo-relative paths that must change>
SYMBOLS: <comma-separated symbols involved, or NONE>
RISKS: <what could regress>
VALIDATION: <the exact gates that must pass>
CONFIDENCE: <HIGH|MEDIUM|LOW>

Optional:
EXACT_PATCH_GUIDANCE: <before/after for a single mechanical edit>
```

`FAILED_STUDENT_ASSUMPTION` is the field that makes a lesson reusable. It forces
the teacher to name the belief that was wrong, which is what generalizes;
"delete line 372" does not.

`EXACT_PATCH_GUIDANCE` is optional and should be the *minimum justified* teacher
response. Handing over finished source teaches nothing and inflates measured
teacher value.

## Lesson extraction

A teacher lesson should outlive its mission, but only when evidence supports it.
Promote a lesson to `LESSONS.md` when it is:

1. derived from `FAILED_STUDENT_ASSUMPTION`, not from the specific fix
2. observed in **two or more** independent missions
3. phrased as a rule the worker can apply without the original context

Bad: `Fix line 841.`

Good: `When the structural scanner reports surplus>0 and unclosed=0, the file
has too many closers: delete one, never add an opener.`

Do not create folklore from one anecdote. One-off observations stay in the
mission's experience record.
