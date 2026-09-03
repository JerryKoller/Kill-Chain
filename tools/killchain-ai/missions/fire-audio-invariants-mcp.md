---
{
  "id": "fire-audio-invariants-mcp",
  "title": "Read-only MCP investigation of nine audio invariants",
  "goal": "Using Kill Chain MCP first, document evidence for the nine AGENTS.md audio invariants. Read-only. No production edits. Do not propose AudioEngine/DSP/rewireFront/claimSource/Mission State behavior changes.",
  "level": 0,
  "allowedPaths": [],
  "preserveDirtyPaths": [
    "src/components/FireCommand/GatePanel.tsx",
    "src/components/FireCommand/MacroPanel.tsx",
    "src/components/FireCommand/fireUiKit.tsx",
    "src/components/FireCommand/ModuleEnableToggle.tsx"
  ],
  "readOnlyPaths": [
    "src/audio/**",
    "src/lib/sourceArbiter.ts",
    "src/state/missionStateStore.ts",
    "src/state/playerStore.ts",
    "src/lib/appHealth.ts"
  ],
  "forbiddenPaths": [
    "electron/**",
    "package.json"
  ],
  "acceptance": [
    "MCP-first on investigate/plan",
    "For each of 9 invariants: location, callers, tests if any, gap, assertion idea",
    "No production edits",
    "VERDICT: READY if the map is evidence-backed, else NOT_READY",
    "Do not invent .vue files"
  ],
  "validation": { "required": [], "optional": [] },
  "maxPhases": 6,
  "maxRetriesPerPhase": 2,
  "maxWallClockMs": 3600000,
  "maxModelCalls": 20,
  "sessionTimeoutMs": 720000,
  "proposalRounds": 1,
  "checkpointPolicy": "state-only",
  "commitPolicy": "none",
  "corpus": "if-stale"
}
---

# Audio invariant map (read-only)

Nine invariants:
1. only rewireFront mutates front routing gains
2. only claimSource decides playback ownership
3. MISSION STATE sole source-change automation orchestrator
4. live taps disconnect in finally
5. intervals/rAF cleaned up
6. store writes + matching AudioEngine calls in same synchronous action
7. persistence failures call reportStorageFailure
8. one-audible-source
9. one-high-rate-FFT-pipeline

Use killchain_invariants, callers, tests_for. Cite real paths. No production edits.
