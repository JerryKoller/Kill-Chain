# Future Training Dataset Design

**No fine-tuning today.** This is the dataset we would want, and the thresholds
that must be met before building it.

## What must NOT go into weights

These change on every commit. They belong in retrieval and mission state, and
training on them guarantees a model that is confidently out of date:

- current repository file contents and file lists
- the current caller graph
- exact locations of architecture (which file holds `claimSource` today)
- mutable product requirements and preset tunings
- current Git state, branch names, dirty files
- specific line numbers

The audit's own evidence supports this: RAG/MCP already produced the major
retrieval gains, and `RETRIEVAL_INVENTED` blocks were caused by *existence*
errors that a deterministic check catches — not by missing knowledge.

## What WOULD benefit from training

Behavioural specialization, not Kill Chain memorization:

| Skill | Why weights help |
|---|---|
| Execute instead of describe | `APPLY_EMPTY` is a habit, not a knowledge gap |
| Emit mechanically valid patches | Indentation/brace/import shape is stylistic muscle memory |
| Fix one fault per round | The A/B suggests multi-edit execution is the limiting factor |
| Cite evidence before claiming | Directly attacks architectural overclaims |
| Windows/MCP tool discipline | 109 violation files, `bash` attempted 228× — pure habit |
| Stay in scope | Deterministic to check, cheap to teach |
| Escalate instead of guessing | Knowing when to stop is a learned behaviour |
| Emit the visible report contract | 83% of missions had `visibleTextMisses > 0` |

## Task families

Each example is built from real archived artifacts, never synthesized prose.

| Family | Input | Target | Source of truth |
|---|---|---|---|
| **A** evidence → plan | investigation + retrieval refs | the plan that later passed the critic gate **and** validated | `PLAN.md` of COMPLETE missions |
| **B** diagnostic → repair proposal | compiler text + structural packet | the diagnosis whose apply round reached `repaired` | `REPAIR_DIAGNOSIS.md` where gates then passed |
| **C** approved proposal → applied patch | proposal + target file windows | the exact diff that passed syntax + typecheck | `attribution/*-edit` snapshots |
| **D** bad diff → critic findings | a diff that later failed a gate | the finding that names the real fault | pair failing diffs with their gate errors |
| **E** tool failure → recovery | a failed `bash`/`grep` call | the MCP/PowerShell call that succeeded next | `UNIX_VIOLATIONS_*.md` + following tool call |
| **F** invented symbol → verification | the unresolved name + scope analysis | the correct in-scope identifier | `identifierGate` output + the fix |
| **G** scope ambiguity → BLOCK | an underspecified mission brief | a correct BLOCK with reasoning | `fire-drum-fill-preview-retry`, `fire-osc-header-right-1280` |
| **H** architecture ambiguity → escalation | an invariant conflict | a correct teacher escalation | teacher packets with validated responses |

Family **G** deserves emphasis: `fire-osc-header-right-1280` is a *positive*
example. The critic measured the layout, found no clipping, and returned BLOCK
after 4 model calls. Correct refusals are training data.

## Dataset hygiene

- Every example must carry the deterministic gate result that made it a
  positive or negative. No human "this looks good" labels.
- Deduplicate by mission and by target file; the archive is dominated by 42
  `*-readonly-overnight` missions with near-identical structure, and letting
  them dominate would train a report template, not a skill.
- Hold out entire missions, never individual phases from a mission that also
  appears in training.
- Strip absolute paths and machine-specific text.
- No hidden reasoning traces — explicit outputs only.

## Go / No-Go criteria

Do **not** start LoRA/QLoRA work until all of the following hold:

1. **≥200 validated episodes** in the experience database, with ≥40 in the
   target behaviour class. Current: ~0 (the schema was defined in this audit).
2. **A held-out benchmark exists and has baseline scores.** See
   `HELD_OUT_EVAL_PLAN.md`. Current: designed, not yet populated.
3. **The failure is behavioural, not mechanical.** If a deterministic gate can
   own it, build the gate instead. Two of this audit's biggest wins
   (`jsxStructure`, `identifierGate`) would have been wasted as training data.
4. **≥50 live editing missions of history at Level B/C**, so the failure
   distribution is stable rather than anecdotal. Current: 8 editing missions total.
5. Dataset quality checks pass: no duplicates, no contamination, no path leakage.

Then the tuned model must **improve**:

- first-edit mechanical validity (syntax gate pass on the first apply)
- repair success rate on held-out fixtures
- scope compliance
- tool discipline (unix violations per mission)
- visible report contract compliance

without regressing:

- repository retrieval quality
- tool-calling reliability through OpenCode
- latency (a slower worker is a worse worker for long-horizon runs)
- general coding ability

**If improvement is not measurable on the held-out suite, discard the tune.**

## Is fine-tuning justified today?

**No.** Three reasons, in order of weight:

1. There is no held-out benchmark with baseline scores, so improvement would be
   unmeasurable and the tune unfalsifiable.
2. The dominant archived failures were mechanical or contractual, and this audit
   removed two whole classes with deterministic code. More remain (execution
   contract, reporting contract). Deterministic wins are cheaper, faster, and
   auditable.
3. n is far too small. 8 editing missions and 1 `APPLY_EMPTY` incident cannot
   distinguish a persistent behavioural deficit from noise.

Revisit after the next 20–30 Level B/C missions have populated the experience
database.
