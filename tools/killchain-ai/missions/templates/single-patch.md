---
{
  "id": "single-patch-template",
  "title": "Single logical patch (template)",
  "goal": "Replace with one pre-bounded patch.",
  "level": 1,
  "allowedPaths": ["src/state/exampleStore.ts"],
  "readOnlyPaths": ["src/lib/appHealth.ts"],
  "acceptance": [
    "Exactly the authorized patch",
    "No drive-by cleanup",
    "typecheck passes"
  ],
  "validation": {
    "required": ["typecheck"],
    "optional": ["build"],
    "restoreTsbuildinfo": true
  },
  "maxPhases": 2,
  "maxRetriesPerPhase": 3,
  "maxWallClockMs": 3600000,
  "maxModelCalls": 12,
  "proposalRounds": 1,
  "checkpointPolicy": "state-only",
  "commitPolicy": "none",
  "corpus": "if-stale",
  "diff": { "maxFiles": 3, "maxInsertions": 80, "warnOnly": false }
}
---

Level 1: one logical patch. Proposal-before-write is mandatory. Keep `allowedPaths` to the actual file(s).
