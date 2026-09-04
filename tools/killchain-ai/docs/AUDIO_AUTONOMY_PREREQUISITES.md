# Audio Autonomy Prerequisites

**No AudioEngine behaviour was modified during this audit, and Level I remains
closed.** This document defines what the test laboratory must be able to prove
before a model — local or remote — is permitted to attempt audio changes.

## The current state of the lab

`src/audioLab/scanInvariants.mjs` already covers 16 of the 9 hard invariants'
surfaces: `claimSource`, `rewireFront`, timer pairing, tap connects, tap
lifetimes, store/engine coupling, store bridges, auto-flatten, auto-lock, apply
chain, measure-live, Mission State init/stop, stage viz loop, Fire Studio taps,
bounce/export taps, and analysers. Plus `scanPersistence.mjs` for
`reportStorageFailure`.

This is a genuinely valuable asset and more than most projects have. But it has
one decisive limitation:

**The scanners describe. They do not assert.**

Every function returns findings and counts. `scanTapLifetimes` even documents
that a connect without `finally` "is not automatically a leak" because Scope uses
effect cleanup and visualIntel uses a start/stop refcount. The scanners produce
a map for a human or model to interpret; nothing fails.

A descriptive map cannot gate an autonomous edit. If a model deletes a
`finally { tap.disconnect() }`, the scan output changes from one shape to
another and no exit code changes. That is the gap.

## Prerequisite 1 — turn maps into assertions

Each invariant needs a **baseline snapshot plus a delta assertion**: capture the
current scan output as the accepted state, then fail when an edit moves an
invariant in the wrong direction.

| # | Invariant | Deterministic? | Path to an assertion |
|---|---|---|---|
| 1 | Only `rewireFront()` mutates front routing gains | **Yes** | `scanRewireFront` already enumerates writers. Assert the writer set is exactly the baseline set. New writer → fail. |
| 2 | Only `claimSource()` decides playback ownership | **Yes** | Same shape as #1 via `scanClaimSource`. |
| 3 | Mission State is the sole source-change orchestrator | **Partly** | Assert the caller set of the orchestration entry points; ambiguous cases escalate rather than fail. |
| 4 | Live tap nodes disconnect in `finally` | **Yes, per-strategy** | `scanTapLifetimes` already classifies `finally` / `effect-cleanup` / `start-stop`. Assert each file keeps its baseline `kind`. A file dropping to `unknown` is a failure. This is the highest-value conversion. |
| 5 | Intervals and rAF are cleaned up | **Yes** | `scanTimerPairing` already returns `gaps`. Assert `gaps.length` never increases. Nearly free. |
| 6 | Store write + AudioEngine call in the same synchronous action | **Partly** | `scanStoreEngineCoupling` finds the pairs; an AST check that no `await`/`setTimeout` separates them is feasible and should replace the regex. |
| 7 | Persistence failures call `reportStorageFailure` | **Yes** | `scanPersistenceReports` → assert every catch block in a persistence path reports. |
| 8 | One audible source | **No, needs runtime** | Requires an offline-render harness. See prerequisite 2. |
| 9 | One high-rate FFT pipeline | **Yes, structurally** | `scanAnalysers` counts analyser nodes and their poll rates. Assert the high-rate count stays at 1. |

Seven of nine can become hard gates with the scanners that already exist. That
is the cheapest large win available in this codebase and it was deliberately
left undone here because it touches audio-adjacent tooling and deserves its own
reviewed change.

## Prerequisite 2 — an offline render harness

Invariant 8 (and any real DSP verification) cannot be checked structurally. The
lab needs an `OfflineAudioContext` harness that can:

- build the engine graph headlessly
- claim a source, render N seconds, and assert exactly one non-silent path
- render before/after an edit and compare RMS, peak, and spectral centroid
  against tolerances
- detect discontinuities (clicks) at source-switch boundaries
- assert node count returns to baseline after teardown (leak detection)

Until this exists, any model claim of "audio behaviour unchanged" is unverified
assertion. `npm run smoke`, `distort-hunt`, `leak-check`, `soak`, and
`heap-diff` exist and are the right raw material, but they are not wired into
the mission runner's validation ladder as audio-specific gates.

## Prerequisite 3 — proven Level H

The worker must complete **9 of 10 read-only audio diagnostic missions** where
every invariant claim it makes is backed by a scanner result, before any write
mission is considered. The archive currently shows the opposite failure mode:
models inventing save cadence and architectural precedent. Audio is where that
habit becomes dangerous.

## Prerequisite 4 — escalation policy, already in place

`failureClass.mjs` classifies audio-adjacent ambiguity and routes it to
`TEACHER` or `BLOCK` rather than to a retry. The rule that matters:

> **Audio ownership ambiguity never gets a blind local retry.**

A model that cannot determine whether a change belongs in `claimSource` or
`rewireFront` must stop. This is enforced now.

## Route to safely touching AudioEngine

1. Convert invariants 1, 2, 4, 5, 7, 9 into baseline-delta assertions. Add them
   to the validation ladder behind a subsystem check so UI missions are unaffected.
2. Convert invariant 6 from regex to an AST check.
3. Build the offline render harness; establish golden renders for the main
   source paths.
4. Wire `smoke` / `distort-hunt` / `leak-check` into the runner as
   audio-subsystem gates.
5. Run 10 Level H read-only diagnostics; require 9/10 with fully evidenced claims.
6. Open Level I for **read-only-adjacent** work first: comments, types, and
   diagnostics inside audio files, with no behavioural change.
7. Only then permit a bounded behavioural change, with mandatory teacher review
   of the proposal and a human authorization gate.

Realistically this is weeks of tooling work, and steps 1–2 are worth doing
regardless because they protect against *human* regressions too.

## Explicit non-goal

Do not let a model "verify" audio behaviour by listening, describing, or
reasoning. The invariants exist because the failure modes are silent, delayed,
and hard to hear. Only the lab decides.
