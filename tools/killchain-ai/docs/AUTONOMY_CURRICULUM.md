# Autonomy Curriculum

Promotion is earned from evidence, never from "a mission happened to finish".

## Current proven level

From the 71-mission archive:

| Level | Missions | Complete | Verdict |
|---|---|---|---|
| 0 read-only investigation | 63 | 52 (82.5%) | **Proven** |
| 1 single-file UI edit | 2 | 2 (100%) | **Proven but thin** (n=2) |
| 2 multi-file live edit | 6 | 2 (33.3%) | **Not proven** |

Proven autonomy today is **Level 1**: a single-file, presentation-only patch
with validation. `fire-module-enable-feedback-live` is the reference success —
15 model calls, 6.9 minutes, one file, zero unix violations, validation passed.

## Ladder

| Level | Scope | Promotion criteria |
|---|---|---|
| **A** | Single-file exact patch from an approved proposal | 8/10 missions COMPLETE, 0 scope violations, ≤1 empty-edit event |
| **B** | Single component: investigate → propose → patch | 8/10 COMPLETE, every referenced path exists, critic PASS with evidence |
| **C** | 2–4 file presentation work | 7/10 COMPLETE, 0 attempts end worse than start, ≤1 teacher escalation per 10 |
| **D** | Iterative UI with DOM/layout metrics | 7/10 COMPLETE **and** measured criteria met, ≥1 self-revision from metric feedback |
| **E** | UI plus isolated (non-engine) state | 7/10 COMPLETE, 0 store/engine pairing violations |
| **F** | Multi-phase state/helper feature with checkpoints | 6/10 COMPLETE across ≥3 phases, ≥1 successful checkpoint recovery |
| **G** | Fire logic with no engine mutations | 6/10 COMPLETE, invariant scanners clean, 0 `getEngine` misuse |
| **H** | Audio-adjacent diagnostics (read-only) | 9/10 COMPLETE, every invariant claim backed by a scanner result |
| **I** | AudioEngine work | Gated on `AUDIO_AUTONOMY_PREREQUISITES.md` — not open |

## Hard promotion rules

1. **A mission that finishes is not evidence of competence.** Count only
   missions whose validation actually ran and passed.
2. **No promotion while a level's regression metric is non-zero.** Specifically:
   attempts that end structurally worse than they started must be 0 before
   moving from C upward.
3. **Demote on two consecutive failures at the current level.**
4. `REPORTING_FAILURE` blocks do not count against a level (they are the
   foreman's bug, not the worker's) but they do count against the *foreman's*
   readiness.
5. Level D requires the metric loop, not screenshots alone. DOM metrics are not
   visual judgement.

## Next 10 recommended missions

Ordered to build evidence at Level B/C without touching state or audio.

1. **B** — `ModuleEnableToggle` disabled-state contrast (live). Reference task
   with a known-good outcome; re-run under the new gates to confirm no regression.
2. **B** — `PatternSelect` truncation at 1280px: investigate, measure, patch one file.
3. **B** — `EditorToolbarGroup` label alignment: single-file, measurable.
4. **C** — Fire Command header overflow at 1440px across 2 files (the
   `fire-perf-header-overflow-live` follow-up, which previously took 33 calls).
5. **C** — Unify `editor-toolbar` spacing tokens across 3 panels.
6. **C** — Consistent focus-visible ring across `FireCommand` buttons (3–4 files).
7. **D** — Sequencer grid density with DOM metrics as the acceptance signal.
8. **D** — Drum lane label column width driven by measured overflow.
9. **B** — Repair-loop probe: deliberately seed a single orphaned closer in a
   fixture and confirm the worker fixes it in one round (validates the
   one-fault-per-round hypothesis from `OPUS_TEACHING_RESULTS.md`).
10. **E** — `useFireCollapsed` persistence read path only, no engine calls.

Do not queue a Level 2B/state/audio mission until items 1–8 produce the
promotion evidence above.

## Long-horizon curriculum

Elapsed time is not the metric. **Useful autonomous continuation** is.

| Target | Structure | Success signal |
|---|---|---|
| 30 min | 1 mission, 2 phases | Completes without human input |
| 1 hour | 1 mission, 3–4 phases, ≥1 checkpoint | Recovers from ≥1 gate failure unaided |
| 2 hours | 2–3 queued missions | ≥1 context reset survived; ≤1 teacher escalation |
| 4 hours | 4–6 queued missions, ≥1 deliberate process kill | Resumes from checkpoint with no lost work |
| 8 hours | Overnight queue with mixed levels | ≥70% COMPLETE, 0 scope violations, 0 corrupted worktrees, ≤10% human intervention |

Measure per run: independent phases completed, successful self-revisions, error
recoveries, context resets survived, checkpoint recoveries, safe BLOCKs (a
correct BLOCK is a success), and the percentage of wall time that required a
human or teacher.

## Safe task self-selection

The agent may eventually choose its own work, but only from a **pre-bounded**
pool. Every backlog candidate must carry:

```
id, title, level, priority
risk: low | medium | high
allowedPaths: [...]
forbiddenPaths: [...]
acceptanceEvidence: [what deterministic result proves this done]
dependsOn: [ids]
humanReviewRequired: bool
observedEvidence: [link to the real reported issue]
```

Rules: the agent picks only from candidates at or below its proven level; it may
never author a new candidate; `risk: high` and `humanReviewRequired` candidates
require explicit authorization; and a candidate without `observedEvidence` is
not eligible — this is what stops "refactor the architecture because the queue
was empty".
