---
{
  "id": "pilot-fire-ux-plan",
  "title": "Fire Command UX improvement plan (dry-run pilot)",
  "goal": "Analyze the Fire Command interface and develop a concrete multi-phase UX improvement plan for one coherent user workflow. Map components, state, interactions, and acceptance criteria. Produce file-by-file proposals. Do not edit production files.",
  "level": 0,
  "allowedPaths": [],
  "readOnlyPaths": [
    "src/components/FireCommand/**",
    "src/state/fireCommandStore.ts",
    "src/state/fireSequencerStore.ts"
  ],
  "forbiddenPaths": [],
  "acceptance": [
    "Names a single coherent Fire Command user workflow (not a laundry list of polish)",
    "Maps the components, stores, and interactions that implement that workflow today",
    "States current behavior with file/symbol evidence",
    "Proposes a multi-phase UX improvement with acceptance criteria a human could verify visually",
    "File-by-file proposal lists inspect vs later-edit candidates inside Fire Command UI",
    "Does not recommend AudioEngine, DSP, claimSource, rewireFront, or electron changes",
    "Does not edit production files",
    "Remaining uncertainties are explicit"
  ],
  "validation": { "required": [], "optional": ["typecheck"], "restoreTsbuildinfo": true },
  "maxPhases": 6,
  "maxRetriesPerPhase": 2,
  "maxWallClockMs": 7200000,
  "maxModelCalls": 12,
  "sessionTimeoutMs": 720000,
  "proposalRounds": 2,
  "checkpointPolicy": "state-only",
  "commitPolicy": "none",
  "corpus": "if-stale",
  "ux": {
    "workflow": "Choose one real Fire Command workflow after investigating the current UI",
    "manualReview": "Human reads FINAL_REPORT.md and PROPOSAL.md; no screenshots required this dry-run"
  }
}
---

# Fire Command UX plan — local Qwen dry-run pilot

This mission tests the **local mission runner**, not a production patch.

You (Qwen via OpenCode) must do the investigation and planning. Do not wait for Cursor. Do not edit `src/` or `electron/`.

## Why this is not a five-minute glance

Fire Command is a large UI surface (many panels, stage viz, sequencer, macros, MIDI learn, presets). Pick **one** coherent workflow after mapping the landscape, for example:

- module discovery → enable → hear/see feedback
- sequencer/piano-roll note entry → play scoped to Fire
- preset browse/load → confirm the rack matches
- MIDI learn / knob focus → parameter feedback
- live vs studio layout / panel chrome

You choose **after evidence**, not before.

## Required phases (runner-enforced)

1. Investigate with Kill Chain MCP first. Read real files.
2. Write PLAN.md: one workflow, current vs target, phases, invariants, validation.
3. Critic the plan (separate pass).
4. Proposal round 1: file-by-file map of the current workflow.
5. Proposal round 2: file-by-file UX improvement proposals (still no edits).
6. Final review / FINAL_REPORT narrative.

## Constraints

- Windows. PowerShell if you must use a shell. Prefer MCP.
- Visible final TEXT every pass.
- No junk files.
- No invented architecture or cadence claims.
- If a store is audio-engine-coupled, treat it as a risk area and keep it out of the first real edit mission unless a later human authorizes it.
