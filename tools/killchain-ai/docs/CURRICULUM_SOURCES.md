# Curriculum Sources — where real editing exercises actually come from

Written after testing three candidate sources. One was the gold mine I claimed
last session and turned out not to be. Another I dismissed too quickly and it
is the real answer.

## Source 1 — archived attribution snapshots: **not the gold mine**

Last session I identified `attribution/*-edit` byte snapshots as the rich
untapped source. `src/eval/mineEpisodes.mjs` implements that mining properly,
walking every mission's per-phase snapshots and reporting consecutive pairs
where a file's bytes changed.

**Result: 6 episodes, all from a single mission, covering 2 families.**

The reason is structural, not a mining bug:

| Mission | Attribution dir | Editing outcome |
|---|---|---|
| `fire-module-enable-feedback-live` | **none** | succeeded — the reference Level 1 win |
| `fire-module-enable-feedback` | **none** | succeeded |
| `fire-perf-header-overflow-live` | **none** | succeeded |
| `fire-drum-fill-preview-retry` | 9 phases | all edits empty → no byte changes |
| `fire-drum-fill-preview-live` | 20 phases | **the only source of episodes** |

Per-phase byte snapshotting **postdates almost every editing mission in the
archive**. The missions that actually edited code successfully were never
snapshotted, and the one snapshotted mission that did edit is the JSX failure
we have already mined to death.

So my previous recommendation was wrong. `mineEpisodes.mjs` is kept because it
is correct and because snapshotting exists now — every *future* editing mission
will produce episodes automatically, making this a forward-looking harvest
rather than a backward-looking one.

## Source 2 — Git history at commit granularity: **empty**

A scan of 80 commits touching `src/components`, `src/hooks` and `src/lib`
looking for single-file changes of 2–30 lines found **exactly one**. This repo's
history is release-sized commits, so commit-level mining yields nothing.

## Source 3 — Git history at HUNK granularity: **this is the gold mine**

Those same release commits carry **42–314 independent hunks each** in
`src/components` alone, and every hunk is a real, human-authored, shipped
change.

`src/eval/mineHunks.mjs` builds an exercise by reverse-applying one hunk:

```
BEFORE = the committed file with that single hunk undone
AFTER  = the committed file            (hidden gold)
```

**Measured: 107 exercises from 22 commits across 59 files, in 4 families.**

| Family | n |
|---|---|
| single-file apply | 77 |
| import / mechanical correction | 16 |
| UI layout adjustment | 12 |
| critic-requested revision | 2 |

With the round-robin family cap in `buildHunkTasks()`, a 16-task sample draws
evenly rather than being swamped by `single-file apply`, and combined with the
existing tiers gives **6 families in 23 tasks**.

### The patcher is verified, not assumed

An incorrect patcher would silently produce nonsense fixtures, so it is held to
a hard invariant:

> Reverse-applying **every** hunk of a file must reproduce its parent blob
> byte-for-byte.

`selfTest()` checks this against live history: **17/17 files exact, 0
mismatches**, and a 3-commit version runs inside the deterministic suite as a
regression guard. `reverseApplyHunk` also verifies the hunk's expected new-side
content matches before splicing and returns `null` rather than guessing.

### Acceptance is decided against the shipped diff

Not by prose judgement: every line the real change added must be present and
every line it removed must be gone, with exact byte-equality to the gold
recorded separately but not required — a different-but-equivalent edit is still
correct. A guard also rejects wholesale deletion dressed up as an edit
(`afterLines >= 0.8 * beforeLines`), which is the lesson from the sequential
repair arm that "fixed" a file by deleting 1233 lines.

### An honest limitation on goal style

All 107 mined goals are currently **directed**: they name the concrete
before/after values. That is exactly right for the
approved-proposal-to-applied-patch family, which is the apply-plan disconnect we
most want to measure. It is *not* a test of comprehension — a directed goal is
closer to transcription than to engineering.

`goalForHunk()` carries a `style` field and an `intent` path is scaffolded, but
generating intent-level goals at scale needs either human authoring or an LLM
pass, and neither is free. Until then, treat mined-hunk results as measuring
**execution fidelity**, not design ability. The two families that genuinely
need intent-level goals (two-file coordinated, scope correction) cannot be built
from single hunks at all — they require grouping hunks across files from the
same commit, which is the natural next extension.

## Recommended sourcing strategy

| Family | Source |
|---|---|
| single-file apply | mined hunks (abundant) |
| import / mechanical correction | mined hunks (abundant) |
| UI layout adjustment | mined hunks (abundant) |
| critic-requested revision | mined hunks (thin — 2) |
| repair after invalid diff | single-fault injection + the 1 mined repair hunk |
| multi-pass edit | archived `fire-drum-fill-preview-live` episodes |
| two-file coordinated | **needs multi-hunk grouping — not built** |
| scope correction | **needs authored fixtures — not built** |

Reaching the 25–30 diverse target is now a sourcing problem with a known
solution rather than an open question: 107 exercises exist today across 4
families, plus 6 mechanical injections and 3 parked-diff applies. The remaining
two families need the multi-hunk grouping extension.

## Measured results — 14 mined-hunk exercises, `ollama/qwen3.5:9b`

| Metric | Value |
|---|---|
| First-edit application rate | **14/14 (1.00)** |
| First-edit mechanical validity | 13/14 (0.93) |
| First-edit acceptance | **13/14 (0.93)** |
| Acceptance after tutoring | 13/14 (0.93) |
| **Empty edits** | **0** |
| Production drift | 0 |
| Median time per task | ~8s |

**Zero empty edits across 14 tasks**, with the stripped execution contract
active. The archive's baseline for comparison is 147 empty-output retries,
22.5% of all model calls. That is the single most encouraging number of this
session — though see the goal-style caveat above: directed goals make these
execution-fidelity tests, and execution is exactly what the stripped contract
was built to fix, so the result is consistent rather than surprising.

The one failure (`hunk-69119e0-Room3DCanvas-L695`) produced a valid edit that
did not satisfy the acceptance predicate, and tutoring did not recover it in one
round.

### Aggregate editing evidence base

| Tier / source | n | First pass | After tutoring |
|---|---|---|---|
| 1 — parked-diff apply | 3 | 3/3 | 3/3 |
| 2 — mined git hunks | 14 | 13/14 | 13/14 |
| 5 — single-fault injection | 6 | 3/6 | 4/6 |
| **Total distinct exercises** | **23** | **19/23 (83%)** | **20/23 (87%)** |

Plus, from the earlier engagement, Opus teacher Level 1 rescued 2 of the 2
mechanical tasks the tutored loop could not finish.

Against the archive's **one** code-mutating mission, the evidence base is now
23 distinct exercises across 6 families, with zero production drift in every
run.
