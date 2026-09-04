# Three Experiments — results

Run after committing the trainer infrastructure. One of the three produced a
clear win, one is implemented but unmeasured, and one **failed to reproduce**
and should not be adopted.

---

## Experiment 1 — one divergence per repair round: **INCONCLUSIVE**

Hypothesis (from the edit curriculum): the limit on the archived two-fault
`DrumMachine.tsx` is multi-edit execution, not diagnosis. Single-fault fixtures
scored 4/6 against that file's 1/6, so decomposing the hard case into a series
of single-fault repairs should lift it.

Implementation: a `sequential` arm that names exactly one divergence per round,
forbids fixing any other visible fault, and re-scans between rounds.

**Two runs of the identical configuration disagreed completely.**

| | Run 1 | Run 2 |
|---|---|---|
| Repaired (parses + sound) | **5/6** | **0/6** |
| Strict success (repaired **and** feature preserved) | **3/6** | **0/6** |
| Rounds used | 15 | 24 |
| Rounds with no edit | 1 | 6 |
| Ever regressed | 1 | 1 |
| Unix violations | 50 | 42 |

The only code difference between runs was the feature-preservation guard, which
fired **once**. Everything else is model nondeterminism.

Pooled across both runs: **3/12 repaired, 3/12 strict** — against baseline and
assisted at **1/6 each (2/12)**. That is not a distinguishable effect.

**Verdict: do not adopt sequential repair on this evidence.** The apparent 5×
win in run 1 was noise. This is the headline result of these experiments, and
it is a negative one.

### Two further findings, both worth acting on

**Deleting the feature to satisfy the parser.** In run 1, 2 of 6 attempts
"repaired" the file by deleting the feature-bearing JSX — `FILL_PERSONAS`,
`acceptDrumFillPreview`, `revertDrumFillPreview` and four other markers. One
attempt deleted **1233 lines**, essentially the whole component, and the
unguarded bench scored it as a repair. That is why the headline 5/6 is really
3/6.

The prompt likely encouraged it: it instructed *"if the named fault is a
surplus closer, DELETE it"*, which is mechanically correct for a delimiter and
catastrophic when over-applied to a block.

A deterministic feature-preservation guard is now in place: a round that drops
a marker the file started with is rejected and rolled back to that round's
starting bytes. This is the right shape of fix — the foreman verifies rather
than trusting the model — and it belongs in the runner's repair loop, keyed off
the symbols named in the approved proposal.

**The success metric and the divergence metric disagree.** Several rounds
reported `divergences 1->0 progress` while `repaired=false`, because
`divergenceCount` excludes cascade entries while `scan.ok` does not. A file can
show zero independent faults and still fail the structural gate. The reported
numbers above use the strict gate, but the per-round progress log overstates
progress and should be reconciled.

### What this means methodologically

**n=6 on this fixture is too small to conclude anything about success rate.**
Any single-run success-rate claim from `repair-bench` needs replication,
including the earlier assisted-arm regression finding (4/11 vs 1/12 rounds).
That one rests on a rounds-level metric with more samples and a larger effect,
so it is more likely to survive — but it has not been replicated and should not
be treated as settled.

Recommended: 20+ attempts per arm, run overnight, before any repair-policy
decision.

---

## Experiment 2 — restore-then-reapply: **NOT EXERCISED** (rerun completed)

The Tier-5 rerun was run with the policy active. Same 6 tasks, same model, same
budgets.

| | Before (no restore) | After (policy active) |
|---|---|---|
| First-try accepted | 2/6 | 3/6 |
| **Final accepted** | **4/6** | **4/6** |
| Empty edits | 2 | 2 |
| Tutor-recovered | 2 | 1 |
| Production drift | 0 | 0 |

**The policy never fired.** `restoredBeforeTutor` is `false` for all six tasks
and the restore log line appears zero times: no attempt regressed in this run,
so there was nothing to roll back. In the earlier run `mech-03` went 1 → 2
diagnostics and *would* have triggered it; this time `mech-03` made no edit at
all on round one.

So this is **not** evidence that rollback-on-regression fails to help. It is
evidence that the rerun did not reproduce the condition the policy exists for.
Reporting it as "no benefit" would be wrong.

The first-try difference (2/6 → 3/6) cannot be attributed to the policy either,
since the first attempt happens before any restore logic runs. That is
nondeterminism again — the same variance that sank Experiment 1.

The one genuinely reassuring signal: **final acceptance was 4/6 in both runs**,
so the tier-5 endpoint is stable across two independent runs even while
individual tasks move around.

To actually test the policy, the fixture set needs tasks that reliably provoke
regression — or the archived two-fault fixture, where the baseline arm regressed
in 2 of 6 attempts.

### Original note (retained)

`countFaults()` measures independent structural faults plus compiler
diagnostics, excluding cascade noise. In the curriculum harness, if a first
attempt raises that count, the fixture is restored to its original bytes and the
tutored round reapplies from clean. Progress is kept; only regression is rolled
back.

Motivation is well evidenced: `mech-03-MacroPanel` went 1 → 2 diagnostics when
a tutored correction was stacked on a damaged buffer, the repair-bench baseline
arm drove a file from 10 to 90 diagnostics, and `fire-drum-fill-preview-live`
blocked after four progressively worse cycles.

**But the curriculum has not been re-run since, so the policy's effect on the
tier-5 numbers is unmeasured.** It is unit-tested (fault counting, regression
detection) and wired, not validated end to end. Re-running
`kc-ai edit-curriculum` is the cheapest outstanding measurement.

---

## Experiment 3 — stripped execution contract: **ADOPTED**

`executePrompt` is now the default for the `EDITING` phase. It carries only the
target files, the approved change, and the requirement to mutate, with explicit
prohibitions on re-planning, explaining, and writing plan files.

Removed from the executor's context: the mission header (goal, acceptance
criteria, up to 6k of brief), the plan, and 4k of "context" — everything needed
to re-litigate the feature instead of applying it.

**Measured on a representative mission spec: 18,313 → 7,968 chars, a 56%
reduction.**

Evidence for the shape: the equivalent prompt scored **3/3 first-try** in the
edit curriculum at 10–17s per task, with zero empty edits and zero collateral
damage. The archive's 147 empty-output retries (22.5% of all model calls) are
the cost this targets.

Tests assert the executor is not handed the goal, the brief, or the acceptance
criteria, so the context cannot silently creep back.

**Caveat: the 56% figure is a prompt-size measurement, not an outcome
measurement.** Whether it actually reduces empty-output retries requires live
missions. The integration suite exercises the new phase label, and the
`3 repeated empty edits → BLOCK` test caught the label change immediately —
which is reassuring about the wiring but says nothing about the effect.

---

## Net position

| Experiment | Status |
|---|---|
| 1 — one divergence per round | **Rejected on current evidence** (did not reproduce) |
| 2 — restore-then-reapply | Implemented and unit-tested; effect unmeasured |
| 3 — stripped execution contract | Adopted; 56% smaller prompt; outcome unmeasured |

Tests: **273 passing**, up from 261. Typecheck clean. Production drift 0 across
both experiment runs.

## Next measurements, in priority order

1. Re-run `kc-ai edit-curriculum` with restore-then-reapply active and compare
   the tier-5 numbers against 2/6 first-try and 4/6 final.
2. Replicate the assisted-vs-baseline regression finding at 20+ attempts before
   relying on it.
3. Run 20+ sequential attempts overnight to settle Experiment 1 properly rather
   than on n=6.
4. Move the feature-preservation guard into the runner's repair loop, keyed off
   the symbols in the approved proposal.
5. Reconcile `divergenceCount` with `scan.ok` so progress logging cannot
   overstate.
