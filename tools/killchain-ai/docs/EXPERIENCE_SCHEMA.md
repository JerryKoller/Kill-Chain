# Experience Record Schema

One record per learning episode. Written under
`tools/killchain-ai/data/experience/<mission-id>/<seq>-<failureClass>.json`,
which is gitignored.

**No hidden chain-of-thought.** Only explicit model outputs and artifacts the
foreman already persists. If a field would require reasoning traces, it is not
in the schema.

## Record

```jsonc
{
  "schemaVersion": 1,
  "missionId": "fire-drum-fill-preview-live",
  "seq": 3,
  "at": "2026-09-03T07:58:52.268Z",

  "task": {
    "level": 2,
    "goal": "...",
    "acceptance": ["..."],
    "allowedPaths": ["..."],
    "subsystem": "ui"
  },

  // What retrieval actually returned, so a later run can be compared fairly.
  "retrieval": {
    "tools": ["killchain search", "killchain symbol"],
    "mcpFirst": true,
    "referencedPaths": ["src/components/FireCommand/SequencerPanel.tsx"],
    "pathsThatDidNotExist": []
  },

  "student": {
    "model": "ollama/qwen3.5:9b",
    "plan": "PLAN.md verbatim",
    "proposal": "PROPOSAL.md verbatim",
    "patch": "unified diff of what was actually written",
    "toolCalls": 14,
    "unixViolations": 3,
    "visibleTextMisses": 0
  },

  // Deterministic evidence only. This is the ground truth of the episode.
  "failure": {
    "class": "MECHANICAL_SYNTAX",
    "evidence": ["surplus closer at line 372", "transposed closers at 373/374"],
    "compiler": "src/.../SequencerPanel.tsx(486,15): error TS2552 ...",
    "structure": {
      "surplus": 1, "unclosed": 0, "mismatches": 2, "firstDivergenceLine": 372
    },
    "scope": { "unresolved": ["setActiveSectionId", "fireSequencerStore"] },
    "gates": { "syntax": false, "identifiers": false, "typecheck": false, "build": null }
  },

  "escalation": {
    "action": "RESTORE_AND_REAPPLY",
    "attemptsForClass": 1,
    "teacherInvoked": false
  },

  // Present only when a teacher answered. Contract fields verbatim.
  "teacher": {
    "model": "cursor/opus-5",
    "response": { "DIAGNOSIS": "...", "ROOT_CAUSE": "...", "CONFIDENCE": "HIGH" },
    "validation": { "ok": true, "errors": [] },
    "exactPatchGuidanceGiven": false
  },

  "resolution": {
    "outcome": "REPAIRED",              // REPAIRED | PARTIAL | REGRESSED | BLOCKED
    "roundsUsed": 2,
    "finalPatch": "unified diff",
    "gatesAfter": { "syntax": true, "identifiers": true, "typecheck": true, "build": true },
    "endedWorseThanStart": false,
    "featurePreserved": true
  },

  // Only promoted to LESSONS.md after being observed in >= 2 missions.
  "lesson": {
    "statement": "When surplus>0 and unclosed=0, delete a closer; never add an opener.",
    "derivedFrom": "FAILED_STUDENT_ASSUMPTION",
    "corroboratingMissions": ["fire-drum-fill-preview-live"],
    "promoted": false
  }
}
```

## Recording failures of escalation

A record where `teacher.validation.ok === true` but
`resolution.outcome !== "REPAIRED"` is the most valuable kind: the teacher gave
a well-formed, repository-valid answer and the worker still could not execute
it. That is the signal that the bottleneck is execution, not knowledge — and it
is the population that would justify fine-tuning.

Always write the record, including when escalation fails. A database of only
successes cannot measure teacher value.

## Invariants

1. Gitignored. Generated mission evidence never enters version control.
2. `failure` and `resolution.gatesAfter` come from deterministic gates only.
3. `student.plan` / `student.proposal` are verbatim visible outputs, never
   summaries, so a future dataset builder is not reading a paraphrase.
4. A lesson requires ≥2 corroborating missions before `promoted: true`.
