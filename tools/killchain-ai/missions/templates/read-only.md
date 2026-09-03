---
{
  "id": "read-only-template",
  "title": "Read-only investigation (template)",
  "goal": "Replace with the question to answer. No production edits.",
  "level": 0,
  "allowedPaths": [],
  "readOnlyPaths": ["src/**"],
  "acceptance": [
    "Findings cite existing paths and symbols",
    "Uncertainties are explicit",
    "No production files modified"
  ],
  "validation": { "required": [], "optional": [], "restoreTsbuildinfo": true },
  "maxPhases": 4,
  "maxRetriesPerPhase": 2,
  "maxWallClockMs": 7200000,
  "maxModelCalls": 12,
  "proposalRounds": 1,
  "checkpointPolicy": "state-only",
  "commitPolicy": "none",
  "corpus": "if-stale"
}
---

Read-only mission. The runner will still require investigate → plan → critic → proposal, then stop.
