# Edit Curriculum — design and results

The archive contained 70 read-only missions and essentially **one** real editing
mission, yet the roadmap discusses multi-hour autonomous development. This
curriculum exists to close that evidence gap safely.

Harness: `src/eval/editCurriculum.mjs` · CLI: `kc-ai edit-curriculum`,
`kc-ai teacher-round`

## Task sources (real, not invented)

| Tier | Kind | n | Source |
|---|---|---|---|
| 1 | `apply` | 3 | Validated Qwen-authored changes parked in the worktree. Fixture = committed bytes; the approved proposal is derived from the real change; the gold result is hidden from the executor. This is task family C — approved proposal → exact applied patch. |
| 5 | `mechanical` | 6 | One real closing delimiter deleted from a real production file, chosen deterministically and verified to actually break the parse. Reproduces the archive's dominant mechanical failure under controlled conditions. |

The mechanical tier was designed to test a specific open hypothesis from the
first audit: **that a 9B model can repair one structural fault but not two.**
The archived `DrumMachine.tsx` has two orphaned closers and Qwen scored 1/6 on
it. These fixtures have exactly one missing closer each.

## Isolation, and a real safety bug it caught

Every task runs in its own sandbox with production hashes verified after **each
task**, aborting the run on drift.

The first sandbox design placed work directories under
`tools/killchain-ai/data/overnight/`, i.e. inside the repository. That was
unsafe: OpenCode walks up to find the project root, found the real repo, and
resolved the relative path against **production**. The session log shows the
model reading and attempting to edit the real
`src/components/FireCommand/ModuleEnableToggle.tsx`. It only failed because the
edit tool's `oldString` did not match.

Sandboxes now live in the OS temp directory, outside the repo. The same task
then went from 74s of confusion to a **12-second first-try pass**. Worth
recording as a lesson: an agent sandbox nested inside the target repository is
not a sandbox.

**Production drift across all runs: 0.**

## Results — `ollama/qwen3.5:9b`, 9 tasks, 2 rounds max

| Metric | Value |
|---|---|
| First-edit application rate (nonzero delta) | **7/9 (0.78)** |
| First-edit mechanical validity | 5/9 (0.56) |
| First-edit acceptance | 5/9 (0.56) |
| Acceptance after foreman tutoring | **7/9 (0.78)** |
| Acceptance after Opus teacher Level 1 | **9/9 (1.00)** |
| Empty edits | 2 |
| Tutor-recovered failures | 2 of 4 |
| Teacher-rescued failures | 2 of 2 |
| Teacher Level 2 needed | **0** |
| Production drift | 0 |

### By tier

| Tier | n | First-try accepted | After tutoring | Empty edits |
|---|---|---|---|---|
| 1 — apply approved proposal | 3 | **3/3** | 3/3 | 0 |
| 5 — single-fault mechanical repair | 6 | 2/6 | 4/6 | 2 |

## What this establishes

**The apply-plan disconnect is not intrinsic.** Tier 1 went 3/3 on the first
attempt, in 10–17 seconds each, with zero empty edits and zero collateral
damage. When the execution prompt carries only the approved change, the
preselected file, and a mutation-tool requirement — and no architectural
context to re-litigate — the local model applies patches reliably. This is the
strongest available evidence that the execution contract described in the first
audit is the right fix.

**The one-fault hypothesis is confirmed.** Single-fault mechanical repair
reached **4/6 (67%)** against the archived two-fault file's **1/6 (17%)**, with
the same model, the same round budget, and the same structural evidence. The
limiting factor on the hard archived fixture is multi-edit execution, not
diagnosis. Practical consequence: **the repair loop should fix one divergence
per round** and re-scan between edits, rather than asking for a complete repair.

**Tutoring recovers half of first-round failures.** 2 of 4. Notably `mech-02`
was an empty edit on round 1 and the empty-edit correction packet recovered it
to a full pass — the packet's terse, execution-only, "do not write a plan file"
framing did what a generic retry had not.

## Honest negatives

- **The empty-edit packet is not reliable.** It recovered `mech-02` and failed
  on `mech-05`, which produced zero edits across two consecutive rounds. 1 of 2
  is not a solved failure mode.
- **The tutored round degraded one file.** `mech-03` went from 1 diagnostic to
  2 after tutoring because this harness applies the correction on top of the
  damaged buffer. The runner has `RESTORE_AND_REAPPLY` for exactly this; the
  curriculum harness did not, and reproduced the archived degradation pattern
  immediately. Tutoring without the restore policy is not enough.
- **Tool telemetry is unreliable.** Several rounds report `tools: 0` while the
  file demonstrably changed, so `parseOpenCodeJsonl` is under-counting tool
  calls. Grading is done on file bytes, which is why the results are still
  trustworthy — but any metric derived from tool counts should be treated as
  suspect.
- **The collateral-damage metric is only meaningful for the apply tier.** A
  line-based diff counts every line after an insertion as changed, so it
  overstates damage for mechanical tasks. Apply-tier collateral was 0.
- **n is small.** 9 tasks, one attempt each. The tier-1 result (3/3) and the
  single-fault result (4/6 vs 1/6) are suggestive, not settled. Model
  nondeterminism is visible: `mech-01` passed first try in an isolated smoke run
  and failed round 1 in the batch.

## Recommended next steps

1. Wire `RESTORE_AND_REAPPLY` into the curriculum harness so tutored rounds
   start from clean bytes, then re-measure the tier-5 numbers.
2. Change the repair prompt to request **one divergence per round**, and re-run
   the archived two-fault `DrumMachine.tsx` under that policy. If it lifts 1/6
   materially, that is the single biggest repair-loop win available.
3. Expand tier 1 to 8–10 tasks to firm up the execution-contract result, then
   implement the stripped `EDITING` prompt in the runner.
4. Investigate `mech-05`-style repeated empty edits: two identical no-op rounds
   suggests the model decided the file was already correct, which is a
   diagnosis-trust problem rather than an obedience problem.
