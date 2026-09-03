---
{
  "id": "fire-level3-overnight-dryrun-4",
  "title": "Level 3 dry-run: existing files only, not a tour",
  "goal": "READ-ONLY plan for a future 5–10 file feature spanning existing UI + at most helpers, without AudioEngine/DSP. Every named path must exist today. Not a Fire Command tour. No production edits.",
  "level": 0,
  "allowedPaths": [],
  "preserveDirtyPaths": [
    "src/components/FireCommand/GatePanel.tsx",
    "src/components/FireCommand/MacroPanel.tsx",
    "src/components/FireCommand/fireUiKit.tsx",
    "src/components/FireCommand/ModuleEnableToggle.tsx"
  ],
  "readOnlyPaths": [
    "src/components/FireCommand/**"
  ],
  "forbiddenPaths": [
    "src/audio/**",
    "electron/**",
    "package.json"
  ],
  "acceptance": [
    "INSPECTED existing src/ files only",
    "Exact file list of 5–10 existing paths, none invented",
    "Not FireCommandView.tsx as the whole plan",
    "Architecture map, callers, risks, validation, audio boundary",
    "If no coherent 5–10 file candidate exists, VERDICT: NOT_READY",
    "No production edits"
  ],
  "validation": { "required": [], "optional": [] },
  "maxPhases": 6,
  "maxRetriesPerPhase": 2,
  "maxWallClockMs": 1800000,
  "maxModelCalls": 18,
  "sessionTimeoutMs": 720000,
  "proposalRounds": 1,
  "checkpointPolicy": "state-only",
  "commitPolicy": "none",
  "corpus": "if-stale"
}
---

# Level 3 dry-run 4 (read-only)

Previous dry-runs either invented files (.vue, AccordionController) or produced a Fire Command tour.

This pass:

- MCP-first.
- Name 5–10 files that **already exist** (helpers + viz + maybe one store is too much — prefer UI helpers only).
- Do not invent AccordionModeState, EditorShell, DrivePanel.tsx, .vue files.
- Do not plan live Level 3 execution.
- If you cannot prove a bounded existing-file plan, VERDICT: NOT_READY.

No production edits.
