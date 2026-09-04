# Teaching Results — deterministic evidence vs the archived TSX failure

The central experiment of the audit. Question: **can better evidence make the
cheap local worker succeed where it previously failed?**

The honest answer is *partly*, and not in the way that was expected. Recording
both halves.

## The fixture

`tools/killchain-ai/data/missions/fire-drum-fill-preview-live/attribution/009-repair/`
— the real broken `DrumMachine.tsx` from the mission that blocked after four
repair cycles. Both `qwen3.5:9b` and `nemotron-3.5-lightning:30b-a3b` previously
failed to repair it.

### What is actually wrong with it (diagnosed during this audit)

TypeScript emits 10 diagnostics, the loudest being an "unexpected token" around
line 372 and `TS17008` on `<EditorToolbarGroup>` at line **304** — 68 lines
earlier. The true fault is two orphaned closers:

- line 320 opens `{(fillOpen || fillPreview) && (`
- line 371 correctly closes it with `)}`
- line 372 is a **duplicate `)}` that closes nothing**
- line 373 is a **`</div>` whose `<div className="relative">` opener was deleted**

So an earlier edit removed an opening tag and left its closer, then added a
surplus expression closer. Nothing in the compiler output says "you have two
closers too many"; the model had to derive delimiter balance across 70+ lines by
eye, and that is what both models got wrong.

## What was built instead of fixing the file

Per instruction, the discovered repair was **not** applied. It was turned into a
mechanism:

- `src/mission/jsxStructure.mjs` — a recovering TSX scanner that reports surplus
  closers, unclosed openers, out-of-order closing tags, transposed closer pairs,
  the open frame stack at the divergence, the expected closer sequence, and a
  per-line paren/brace/tag depth ledger.
- `src/mission/identifierGate.mjs` — a single-file scope checker that reports
  identifiers bound nowhere, with the real in-scope candidates.

Correctness bar before either was allowed to advise a repair: **zero false
positives on 397 repo sources** (`scanRepo.mjs`, `scanIdents.mjs`). Both reach
100%. Getting there found five real scanner bugs (nested `${}`, `//` inside
template literals, regex literals containing quotes/brackets, `<K extends ...>`
type parameter lists, and JSX elements with explicit type arguments).

On the archived fixture the packet reports:

```
FIRST STRUCTURAL DIVERGENCE: line 372 (surplus-closer)
MECHANICAL SHAPE: 1 surplus closer, 0 unclosed openers.
The file has TOO MANY closers. The minimal repair DELETES surplus closers.
- line 372: `}` closes NOTHING (bare delimiter in JSX child text)
- lines 373 and 374: `</div>` and `</EditorToolbarGroup>` are TRANSPOSED.
  Either swap them, or an opening `<div>` between line 304 and 373 was deleted
  and its closer was left behind.
EXPECTED CLOSER SEQUENCE AT LINE 372: </EditorToolbarGroup> then </div> ...
```

That last inference is mechanically derived and is exactly what happened.

## The A/B

`kc-ai repair-bench --attempts 6 --rounds 2`. Identical model
(`ollama/qwen3.5:9b`), identical fixture bytes, identical round budget and
timeout. Arms differ **only** in whether the prompt carries the structural
packet. Each attempt gets a private fixture copy; production hashes verified
before and after (`productionDrift: []`).

23 local model sessions, ~15 minutes wall clock.

| Metric | baseline (compiler only) | assisted (+ structural packet) |
|---|---|---|
| Repaired (parses + balanced) | **1/6** | **1/6** |
| Attempts that ended **worse** than they started | **2/6** | **0/6** |
| Attempts that improved | 4/6 | 5/6 |
| Rounds that regressed | **4/11 (36%)** | **1/12 (8%)** |
| Mean residual anomalies (fixture starts at 5) | **3.8** | **2.3** |
| Worst-case final TS diagnostics (from 10) | **90** | **9** |
| Feature markers preserved | 6/6 | 6/6 |
| Median seconds per round | 24.1 | 30.0 |
| Unix tool violations | 1 | **10** |
| Rounds with no edit at all | 0 | 2 |

## What this means

**The packet did not raise the success rate.** 1/6 in both arms. A 9B model
still cannot reliably execute a two-part structural repair in two rounds, even
when told exactly what is unbalanced. Anyone hoping better context alone unlocks
this class of work should read that number.

**The packet did eliminate repair degradation**, which is the more consequential
result. Baseline drove the file from 10 diagnostics to **90** on one attempt and
ended worse than it started on two of six. Assisted never ended worse than it
started, and its worst case (9 diagnostics) was still better than the input.
Round-level regression fell from 36% to 8%.

That matters because the production loop has rollback and retry budgets.
Degradation is what converts a one-line bug into a blocked mission: each damaged
round consumes a retry, corrupts the buffer the next round reads, and eventually
exhausts the budget. That is precisely the archived
`fire-drum-fill-preview-live` failure — four repair cycles, progressively worse
state, `validation retries exhausted`.

So the honest summary: **better evidence did not make the worker smarter; it made
the worker safer.** Combined with the new `RESTORE_AND_REAPPLY` escalation, the
system now both degrades less often and recovers deterministically when it does.

## Where the teacher (Opus) helped and did not help

Helped:

- Diagnosed a failure that two local models and the previous prompt design had
  not: the compiler's loudest diagnostic (line 304) is 68 lines from the fault.
- Identified that the archived mission's actual block was `TS2552` invented
  identifiers, not JSX at all — a class the fast syntax gate deliberately skips.
  This was misattributed as "the JSX repair problem" before this audit.
- Converted both insights into deterministic analyzers rather than fixes.

Did not help:

- Could not make the local model reliably apply a two-part structural repair.
  Teaching improved safety, not capability, on this fixture.
- The larger prompt made tool discipline **worse** (10 unix violations vs 1) and
  produced two no-edit rounds. Context volume has a real cost.

## Follow-ups this created

1. The assisted prompt is ~16k chars vs ~5.8k. Trim it: the per-line depth
   ledger is likely the least valuable section and the largest.
2. Investigate the unix-violation regression — a longer prompt appears to push
   the model toward shell tools despite the discipline header.
3. Re-run at `--attempts 20` overnight for a statistically meaningful success
   rate. n=6 can only support the regression claim, which is large enough to
   survive it (4/11 vs 1/12).
4. Test a **single-fault** variant: give the model one orphaned closer instead
   of two. If success jumps, the limit is multi-edit execution, not diagnosis,
   and the loop should be told to fix one divergence per round.
