# Training Audit — Kill Chain autonomous agent

Date: 2026-09-03 · Auditor: Cursor/Opus 5 as senior trainer · Branch:
`ai/kill-chain-agent` · Production application code written by the auditor:
**zero**.

---

## The headline, including the part that corrects the brief

The archive was aggregated by actual blocking reason across all 71 missions with
a persisted status (56 COMPLETE, 15 BLOCKED, 652 local model calls). The result
does not match the assumed priority order:

| Actual block reason | Missions | Share of blocks |
|---|---|---|
| **Critic / reporting contract failure** (`missing-verdict`, `NOT_READY`, `critic-no-tools`, `no-inspected-files`) | **8** | **53%** |
| Invented files | 3 (1 overlapping) | 20% |
| Scope violation (`outside-allowed`) | 1 | 7% |
| Empty edit | 1 | 7% |
| Validation retries exhausted (the JSX case) | 1 | 7% |
| Model-call budget | 1 | 7% |
| **Correct product BLOCK — a success** | 1 | 7% |

And the counters that did *not* fire, across all 71 missions:

```
syntaxFailures:          0
transactionalRollbacks:  0
automaticRestores:       0
```

**The syntax gate never fired in the entire archive.** The broken-TSX problem
that framed this session is real, but it is *one mission* —
`fire-drum-fill-preview-live` — not a recurring aggregate pattern. Meanwhile the
critic/reporting contract failed hard enough to block eight missions, and 31 of
71 missions (44%) needed at least one critic retry (35 retries total) even
though the gate already retries once for plan critics and twice for final
critics.

I built the JSX and identifier machinery first because the brief prioritized it,
and that work is real and tested. But if you only act on one finding from this
audit, act on this one: **the highest-frequency failure in your archive is the
critic failing to emit a parseable, evidence-bearing verdict.** It is also the
cheapest to fix, because the failures are contract-shaped
(`missing-verdict`, `no-inspected-files`, `critic-no-tools`), and contract-shaped
failures are deterministically detectable and field-targeted repairable.

Second-loudest signal: **292 unix-tool violations and 241 MCP-first misses
across 652 model calls** — roughly 0.45 and 0.37 per call. Tool discipline is
not an occasional impulse; it is the model's default reflex.

---

## 1–2. What was inspected and how much evidence

Read: `AGENTS.md`, the full `tools/killchain-ai/**` tree, the 15-state mission
machine (`machine.mjs`), `runner.mjs` (~1300 lines), `prompts.mjs`,
`schema.mjs`, `syntax.mjs`, `preflight.mjs`, `opencode.mjs`, the retrieval stack
(`retrieve/hybrid.mjs`, `embeddings.mjs`, `pack.mjs`, `queryExpand.mjs`,
`mcp.mjs`), the corpus builders, `audioLab/scanInvariants.mjs` (16 scanners) and
`scanPersistence.mjs`, `ui/` (cdp, metrics, screenshot, pngStats,
scanFireCommand), and the eval harness.

Evidence sampled: **71 mission status records**, their PLANs, PROPOSALs, critic
outputs, attribution snapshots and checkpoints; **177 unix-violation artifacts**
(`bash` appearing 337 times); the `lightning-bench` report *and* raw sessions;
and the archived broken `DrumMachine.tsx` with its 10 compiler diagnostics. Then
**23 fresh local model sessions** run during the audit for the A/B.

## 3. Main systemic strengths

The safety substrate is genuinely good and should not be touched. SHA-256
baselines, exact-byte snapshots, phase deltas, read-only phase enforcement,
transactional rollback, foreign-dirt preservation and mission-owned dirt
attribution all work — 71 missions, 652 model calls, and **zero corrupted
worktrees**. Failures are bounded. `fire-osc-header-right-1280` measured a
layout, found no clipping, and correctly refused to invent work in 4 calls. That
is a system behaving well.

Retrieval is also solved well enough. The brief's own conclusion holds: RAG/MCP
produced the major gains and repository knowledge is not the bottleneck.

## 4. Main systemic weaknesses

1. **Contract compliance is the binding constraint**, not reasoning. The model
   frequently does the work and then fails to *report* it in the shape the gate
   requires (53% of blocks).
2. **Tool discipline is a reflex problem** (0.45 violations/call) and the current
   header-based prompting does not fix it.
3. **Live editing evidence is extremely thin.** Only 1 mission in the archive
   captured a PRE_EDIT snapshot. Autonomy claims above Level 1 are not supported
   by data.
4. **The critic praises rather than disproves** — `critic-no-tools` blocked a
   mission, meaning the critic reviewed code without reading any.
5. **83.1% of missions (59/71) had `visibleTextMisses > 0`** — real work done
   internally, inadequate visible output.

## 5–8. Failure taxonomy, and who owns each class

Full taxonomy in [`FAILURE_TAXONOMY.md`](./FAILURE_TAXONOMY.md), implemented in
`src/mission/failureClass.mjs`.

| Class | Owner | Verdict |
|---|---|---|
| `REPORTING_FAILURE` / critic contract | **Orchestration** | Deterministic: strict template + field-targeted re-ask. Highest leverage. |
| `TOOL_DISCIPLINE` | **Model habit** | Partly deterministic (block the tool), partly a training target |
| `RETRIEVAL_INVENTED` | Orchestration | **Now deterministic** — existence checks + `identifierGate` |
| `MECHANICAL_SYNTAX` | Model limitation | **Now deterministic assistance** — `jsxStructure` |
| `APPLY_EMPTY` | Orchestration | Deterministic detection exists; execution contract needs work |
| `SCOPE_VIOLATION` | Orchestration | Already deterministic and working |
| `PRODUCT_AMBIGUITY` | Neither | Correct human BLOCK — keep |
| `SEMANTIC_FAILURE` | Model limitation | Needs tests, not prompts |

The organizing principle this audit would defend: **if a gate can detect a
failure, a gate can usually also localize it — and localization is what the 9B
model cannot do for itself.** Detection without localization just blocks.

## 9. Apply-plan disconnect

3 empty-edit events and 3 `describedButDidNotApply` across the archive, with one
mission (`fire-drum-fill-preview-retry`) blocked outright on
`apply-discipline: EMPTY_EDIT`. Small n, but the mechanism is clear: the edit
prompt still carries architectural context, so the session re-enters planning
mode. Recommendation in §15.

## 10–13. JSX repair: diagnosis, mechanism, and the retest

Full detail in [`OPUS_TEACHING_RESULTS.md`](./OPUS_TEACHING_RESULTS.md).

**Diagnosis.** The fixture has two orphaned closers: a duplicate `)}` at line
372 and a `</div>` at 373 whose opener was deleted. TypeScript's loudest
diagnostic points at line **304**, 68 lines away. Both models had to derive
delimiter balance across 70 lines by eye. That is the failure — not reasoning.

**Mechanism built** (the repair was deliberately *not* applied):
`jsxStructure.mjs`, a recovering TSX scanner reporting surplus closers, unclosed
openers, transposed closer pairs, the open frame stack at the divergence, and
the expected closer sequence. Correctness bar: **zero false positives on 397
repo sources.** Reaching that found five real scanner bugs (nested `${}`, `//`
inside template literals, regex literals containing brackets, `<K extends …>`
type parameter lists, JSX with explicit type arguments).

**Retest** — `repair-bench`, `qwen3.5:9b`, identical fixture bytes and round
budget, n=6 per arm, 23 sessions:

| | baseline | assisted |
|---|---|---|
| Repaired | 1/6 | 1/6 |
| **Ended worse than start** | **2/6** | **0/6** |
| **Rounds regressed** | **4/11 (36%)** | **1/12 (8%)** |
| Mean residual anomalies (start 5) | 3.8 | **2.3** |
| Worst final TS diagnostics (start 10) | **90** | **9** |
| Unix violations | 1 | **10** |

**Did Qwen finally repair it? No — 1/6, unchanged.** A 9B model still cannot
execute a two-part structural repair in two rounds even when told exactly what
is unbalanced.

**But degradation was eliminated.** Baseline drove the file from 10 to 90
diagnostics on one attempt; assisted never ended worse than it started.
Degradation is the mechanism that turned this specific bug into a blocked
mission (four repair cycles, progressively worse state, `validation retries
exhausted`). So the packet did not make the worker smarter — it made it safer,
which is what the retry-budget architecture actually needs.

Honest cost: the larger prompt made tool discipline *worse* (10 violations vs 1)
and produced two no-edit rounds. Context volume is not free.

## 14. Empty-edit findings

Detection works. The remaining gap is that `EDITING` prompts still invite
re-planning. See §15.

## 15. Execution-contract improvements (recommended, not yet implemented)

The audit budget went to the structural/identifier/escalation work. This is the
top remaining orchestration fix and it is deliberately left specified rather
than half-built:

- Strip architectural context from `EDITING`. Ship only: the approved patch
  description, the target file windows, and the mutation-tool requirement.
- Forbid the edit session from emitting a plan. No prose deliverable at all.
- Require one file write per approved change before the session may finish.
- Verify delta immediately and re-ask with a shorter prompt on zero delta,
  rather than counting a retry.

## 16. Repair-loop redesign (implemented)

`REPAIRING` now classifies the failure with `classifyFailure()` and routes via
`escalate()` instead of counting retries:

- `MECHANICAL_SYNTAX` first occurrence → `STRUCTURAL_REPAIR` with the packet
- `MECHANICAL_SYNTAX` repeated → **`RESTORE_AND_REAPPLY`**: restore PRE_EDIT
  bytes and re-apply fresh, rather than mutating damaged output further
- `INVENTED_SYMBOL` → `identifierGate` packet with real in-scope candidates
- `PRODUCT_AMBIGUITY` → human `BLOCK`, never a retry
- Audio ownership ambiguity → `TEACHER`/`BLOCK`, never a blind local retry

The A/B result is the justification: mutate-on-mutate is how a 9B model turns 10
diagnostics into 90.

## 17. Critic redesign (specified — **do this next**)

Given that this is the #1 archived failure, the specified design matters more
than anything else in this document. Replace review prose with an assigned
structure per claim:

```
CLAIM · EVIDENCE (file:line actually read) · COUNTEREXAMPLE SEARCHED · RESULT
```

Then: a `PASS` with zero inspected files is rejected deterministically (already
partly true — `no-inspected-files` and `critic-no-tools` exist as gate errors),
and a `missing-verdict` triggers a **field-targeted re-ask** ("emit only the
VERDICT line") instead of consuming a full critic retry with the whole prompt.
Eight blocked missions would likely have survived that one change.

Per-class obligations (UI: exact files, interaction preservation, focus,
blast radius, measurable layout criteria, declared visual uncertainty; state:
callers, persistence, synchronous engine pairing, high-rate paths; audio:
`claimSource`, `rewireFront`, Mission State orchestration, one-audible-source,
tap cleanup, timer cleanup, FFT architecture) are documented in the taxonomy.

## 18–20. Model roles

Roles are swappable via `src/mission/model.mjs` + the `--model` flag; no
architectural change is needed to substitute a model.

- **EXECUTOR: `qwen3.5:9b`.** Confirmed. Fast, reliable tool execution, better
  operational discipline. The prior benchmark stands; no re-run was warranted.
- **PLANNER: `qwen3.5:9b`**, escalating on risk.
- **CRITIC: `qwen3.5:9b` + deterministic gates** — but the gates are currently
  carrying the critic, not assisting it.
- **SECOND_OPINION: `nemotron-3.5-lightning:30b-a3b`, read-only, selective.**
  Yes, it has a permanent role, but a narrow one: it is far slower, uses
  substantially more unix tooling, and hallucinates filenames — all
  disqualifying for an executor, all tolerable for a read-only dissent whose
  output passes through existence checks anyway.
- **TEACHER: Cursor/Opus today, remote NIM later**, via the packet contract.

## 21–22. Teacher packet and response contract (implemented)

[`TEACHER_PROTOCOL.md`](./TEACHER_PROTOCOL.md) covers both the packet spec and
the response contract; `src/mission/teacherPacket.mjs` implements them.

The packet carries `TASK.md`, `MISSION.json`, `INVARIANTS.md` (subsystem-selected,
not all of them), `FAILURE.json`, `COMPILER.txt`, `STRUCTURE.md`, `SCOPE.md`,
`SOURCE_WINDOWS.txt`, `PLAN.md`, `PROPOSAL.md`, `CURRENT_DIFF.patch`,
`STUDENT_ATTEMPTS.md`, `QUESTIONS.md` — under an enforced size budget, with no
whole-file dumps. Questions are failure-class-specific.

The response requires `DIAGNOSIS`, `EVIDENCE`, `ROOT_CAUSE`,
`FAILED_STUDENT_ASSUMPTION`, `RECOMMENDED_REPAIR`, `FILES`, `SYMBOLS`, `RISKS`,
`VALIDATION`, `CONFIDENCE`. `validateTeacherResponse()` then **rejects the
teacher** for unstructured prose, citing a file that does not exist,
recommending a path outside `allowedPaths`, or naming symbols absent from the
cited files. Teacher output is marked advisory and the foreman decides what
enters execution. A confident, articulate, wrong teacher is now caught by the
same existence checks as the student — which is the property that makes swapping
in an unaudited remote model safe.

## 23–26. Teacher value

Measured, on the one class where a fixture existed: teaching changed **safety,
not success** (regression 36%→8%; success 1/6→1/6). Where Opus helped: finding
that the compiler's loudest diagnostic was 68 lines from the fault; discovering
that the archived mission's real block was `TS2552` invented identifiers rather
than JSX at all (this had been misattributed); converting both into analyzers.
Where Opus did **not** help: making the worker able to execute a multi-part
repair. Do not assume escalation raises success rates — on this evidence it
raises floor quality.

## 27–34. Design deliverables

[`EXPERIENCE_SCHEMA.md`](./EXPERIENCE_SCHEMA.md) ·
[`FUTURE_TRAINING_DATASET.md`](./FUTURE_TRAINING_DATASET.md) ·
[`HELD_OUT_EVAL_PLAN.md`](./HELD_OUT_EVAL_PLAN.md) ·
[`AUTONOMY_CURRICULUM.md`](./AUTONOMY_CURRICULUM.md) (ladder A–I, promotion
criteria, long-horizon 30min→8hr plan, and the pre-bounded task-pool schema that
prevents self-directed rewrites).

UI closed loop: the pieces exist (`ui/cdp.mjs`, `metrics.mjs`, `screenshot.mjs`,
`pngStats.mjs`). The missing link is that DOM metrics are treated as acceptance
when they are only geometry. A local vision critic should be added as a distinct
role that may only *raise* uncertainty, never grant a PASS.

## 35. Audio test lab

[`AUDIO_AUTONOMY_PREREQUISITES.md`](./AUDIO_AUTONOMY_PREREQUISITES.md). Key
finding: the 16 existing scanners **describe rather than assert** — every one
returns findings and counts, and `scanTapLifetimes` explicitly documents that a
missing `finally` is not necessarily a leak. A descriptive map cannot gate an
edit. **7 of the 9 hard invariants can become baseline-delta assertions using
the scanners that already exist** — the cheapest large win available in the
repo, deliberately left for a reviewed change since it touches audio tooling.
Invariant 8 (one audible source) needs an `OfflineAudioContext` harness. Level I
stays closed.

## 36–39. Training

Keep in RAG: file contents, caller graph, architecture locations, mutable product
requirements, Git state, line numbers. Train (eventually): execute-don't-describe,
mechanically valid patches, evidence citation before claims, tool discipline,
scope compliance, escalation timing, and the visible-report contract.

**Is fine-tuning justified today? No.** No held-out baseline exists (so a tune
would be unfalsifiable), the dominant failures are still contract-shaped and
therefore cheaper to fix deterministically, and n is far too small — 1 mission in
the archive captured a PRE_EDIT snapshot. Go/no-go thresholds are in
`FUTURE_TRAINING_DATASET.md`.

## 40–43. Tooling changes and tests

New: `jsxStructure.mjs`, `identifierGate.mjs`, `failureClass.mjs`,
`teacherPacket.mjs`, `model.mjs`, `scanRepo.mjs`, `scanIdents.mjs`,
`eval/repairBench.mjs`, `eval/lightningBench.mjs`.
Modified: `runner.mjs`, `prompts.mjs`, `syntax.mjs`, `schema.mjs`,
`opencode.mjs` (token parsing), `preflight.mjs`, `cli.mjs`, `mission/cli.mjs`,
`opencode.json`.

**Tests: 204 passed, 0 failed** (was 165; **+39**). `npm run typecheck` clean.
No regression. Scanner false-positive suites — 397 files for structure, 336 for
identifiers — run as part of the suite, so the gates cannot silently rot.

## 44–48. Mission status and remaining weaknesses

No new live production mission was run: the audit budget went to the A/B and the
gate work, and per the brief no work was invented to demonstrate activity. The
parked diffs in `GatePanel.tsx`, `MacroPanel.tsx` and `ModuleEnableToggle.tsx`
are **prior Qwen output, not mine** — and the mangled indentation at
`ModuleEnableToggle.tsx:113` is itself a specimen of the mechanical
edit-quality failure mode.

**Cursor/Opus production-code interventions: zero.**

- **Proven autonomy: Level 1.** Single-file presentation patch with validation.
  Level 2 sits at 33% and only 1 archived mission ever captured a PRE_EDIT
  snapshot.
- **Biggest remaining Qwen weakness:** emitting a parseable, evidence-bearing
  verdict — 44% of missions needed a critic retry, and it is the top block cause.
  Multi-part mechanical execution is second.
- **Biggest remaining foreman weakness:** gates *detect* contract failure but
  respond by blocking the mission instead of re-asking for the missing field.
  Eight blocked missions were formatting problems, not engineering problems.

## 49–54. NIM readiness

**Ready.** The packet builder, size budget, and response validator exist and are
tested, and the validator rejects a remote teacher on the same factuality
grounds as the student. Use NIM for: architectural ambiguity, invariant
conflicts, cross-subsystem reasoning, and critic dissent on high-risk plans. Do
**not** use it for: routine edits, syntax repair (deterministic now), retrieval
(RAG is better and cheaper), or anything the compiler can answer. Expected
escalation frequency at Level B/C: **≤1 per 10 missions**; more than that means
the mission briefs are underspecified. Lightning keeps a narrow permanent role
as read-only second opinion. Another executor benchmark is **not** worthwhile
now.

## 55–60. Route forward

**Next milestone: the critic contract.** Strict `CLAIM/EVIDENCE/COUNTEREXAMPLE/
RESULT` template, field-targeted re-ask on `missing-verdict`, and a hard reject
of `PASS` with no inspected files. Then the execution contract (§15). Then run
missions 1–8 from the curriculum to build real Level B/C evidence.

- **2-hour autonomy:** critic contract + execution contract + the 8 curriculum
  missions. Realistically the nearest credible goal.
- **4-hour:** task queue with the pre-bounded schema, checkpoint recovery
  exercised under a deliberate process kill, ≤10% intervention.
- **8-hour:** overnight mixed queue, ≥70% COMPLETE, plus the UI closed loop with
  a vision critic so UI work stops depending on human eyes.
- **AudioEngine:** convert 7 invariants to assertions → AST-check invariant 6 →
  offline render harness → wire smoke/distort-hunt/leak-check as audio gates →
  10 Level H diagnostics at 9/10 → read-only-adjacent Level I → bounded
  behavioural change with teacher review and human authorization.

## 61. What the architecture is getting fundamentally wrong

**The gates are graders when they should be tutors.** The foreman is excellent at
detecting that output is wrong and nearly silent about *where* and *why*. A
`missing-verdict` block, a `NOT_READY`, an `invented-files` rejection — each is a
correct detection followed by a dead end. The 9B model's core deficit is
localization, and the system has all the information needed to localize and
mostly throws it away.

The one place this audit changed that — feeding `jsxStructure`'s localized
findings into the repair prompt — cut round-level regression from 36% to 8%
without changing the model. That is the pattern worth generalizing: **every gate
that can say "no" should be required to say "no, here, because this."**

Secondary: the archive is 70 read-only missions and 1 real editing mission, yet
the roadmap discusses 8-hour autonomous development. The evidence base is far
narrower than the ambition. Run editing missions.
