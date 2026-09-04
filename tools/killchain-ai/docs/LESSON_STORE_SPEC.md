# Lesson Store

Implementation: `src/mission/lessons.mjs`. Tested by 11 cases in the
deterministic suite.

A teacher lesson should outlive its mission — but a system that turns every
anecdote into a permanent rule accumulates folklore and bloats every prompt.
Two constraints prevent that.

## Constraint 1 — evidence gate

A lesson needs **at least 2 distinct observed cases** before it is eligible for
prompt injection. `supportCount` may never exceed the number of entries in
`evidenceCases`, and the suite enforces both properties. Single-case
observations remain candidates via `candidateLessons()` and are not injected.

Evidence is explicit artifacts only — mission ids, gate error strings,
benchmark results. No hidden reasoning is ever stored.

## Constraint 2 — phase-scoped selection

Lessons are never all injected at once. `selectLessons({ phase, failureClass,
max })` filters by phase, ranks by whether the lesson matches the active failure
class, then by confidence and support, and caps the result (default 3).

This is not premature optimization. The repair A/B measured a real cost to
prompt volume: the larger assisted prompt raised unix-tool violations from 1 to
10 and produced two no-edit rounds. Context is not free, so lessons compete for
a small budget.

Routing:

| Phase | Lessons injected |
|---|---|
| `investigate`, `plan`, `proposal` | path verification, tool discipline |
| `plan-critic`, `final` | critic output contract, path verification |
| `edit` | apply discipline, tool discipline |
| `repair` | restore-before-reapply, one-divergence-per-round, tool discipline |

## Lesson record

```jsonc
{
  "id": "path-not-implied-by-symbol",
  "failureClass": "INVALID_REFERENCE",
  "summary": "corrective behaviour, imperative, specific enough to act on",
  "evidenceCases": ["mission#phase (what was invented)", "..."],
  "supportCount": 8,
  "counterexamples": ["evidence that limits the lesson's scope"],
  "confidence": "low | medium | high",
  "promptTargets": ["plan", "proposal"],
  "lastVerified": "2026-09-03"
}
```

`counterexamples` is deliberately part of the schema. A lesson that has been
contradicted should carry that contradiction rather than be quietly deleted —
see `execution-is-mutation` below.

## Lessons currently stored

All six are corroborated by ≥2 recorded cases.

| id | Class | Support | Confidence |
|---|---|---|---|
| `path-not-implied-by-symbol` | `INVALID_REFERENCE` | 8 | high |
| `one-verdict-line` | `REPORTING_FAILURE` | 4 | high |
| `restore-before-reapply` | `REPAIR_DEGRADATION` | 3 | high |
| `windows-tooling` | `TOOL_DISCIPLINE` | 3 | high |
| `execution-is-mutation` | `APPLY_EMPTY` | 3 | medium |
| `one-divergence-per-round` | `MECHANICAL_SYNTAX` | 2 | medium |

The two highest-value entries, in full:

**`path-not-implied-by-symbol`** — *"Before naming a write or inspect target,
verify the path exists. A real symbol name does not imply a file of the same
name — a component may be an inner function of a larger module."*
Eight cases: `DrivePanel.tsx` four times across three missions, `DelayPanel.tsx`,
`ModuleEnableToggleBase.tsx` / `HomeBandContent.tsx`,
`src/Commands/FireCommandView.tsx`, and `src/audioEngine.ts` /
`src/stateManager.ts`. This is the archive's most repeated factual error and the
lesson is stated as a verification behaviour, not a blacklist of filenames —
blacklists rot, the behaviour does not.

**`restore-before-reapply`** — *"When a repair attempt has already modified a
broken file and validation still fails, restore the pre-edit bytes before the
next attempt."*
Three independent confirmations: the archived four-cycle degradation in
`fire-drum-fill-preview-live`, the repair-bench baseline arm driving a file from
10 to 90 diagnostics, and `mech-03-MacroPanel` in this engagement going 1 → 2
diagnostics when a tutored correction was stacked on a damaged buffer.

**`execution-is-mutation`** is kept at `medium` on purpose. It has 3 supporting
cases, but also a recorded counterexample: curriculum tier 1 applied 3/3 on the
first attempt when the prompt carried only the approved change and the target
file. So the failure is prompt-shaped rather than intrinsic, and the honest
lesson is narrower than "the model won't edit".

## Adding a lesson

1. It must be traceable to ≥2 explicit artifacts.
2. State the **corrective behaviour**, not the incident. `"Fix line 841"` is
   worthless; the generalizable rule is the deliverable.
3. Assign the narrowest `promptTargets` that covers the failure.
4. Record any counterexample and lower the confidence accordingly.
5. Start at `low`/`medium`. Promote only after it survives new missions.
6. Re-verify on a cadence: `lastVerified` going stale is a signal the lesson may
   describe a system that no longer exists.

## Not yet wired

The store and its selection logic are implemented and tested, but lesson text is
**not yet injected into live mission prompts**. That wiring is deliberately
left as a reviewed follow-up: injecting six new lines into every phase prompt
changes the behaviour of every future mission, and given the measured cost of
prompt volume it should be A/B'd against the held-out suite rather than assumed
beneficial.
