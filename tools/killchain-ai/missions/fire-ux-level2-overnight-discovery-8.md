---
{
  "id": "fire-ux-level2-overnight-discovery-8",
  "title": "Level 2 discovery: pick one existing helper+viz pair or NOT_READY",
  "goal": "From a fixed list of EXISTING Fire Command helper+StageViz pairs, pick at most one pair and quote a real overflow/truncation/empty-copy/inactive-contrast friction line, or VERDICT NOT_READY. Read-only. No production edits.",
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
    "src/state/**",
    "electron/**",
    "package.json"
  ],
  "acceptance": [
    "Only files from the eligible pair list below",
    "Quoted friction line or honest NOT_READY",
    "No DrivePanel.tsx DelayPanel.tsx FilterPanel.tsx or other inner-only names",
    "Not GatePanel MacroPanel fireUiKit ModuleEnableToggle DrumMachine PatternSelect SequencerPanel FireCommandView",
    "No Option A/B/C. No invented files. No restyle-only meters.",
    "No production edits"
  ],
  "validation": { "required": [], "optional": [] },
  "maxPhases": 6,
  "maxRetriesPerPhase": 2,
  "maxWallClockMs": 1800000,
  "maxModelCalls": 16,
  "sessionTimeoutMs": 720000,
  "proposalRounds": 1,
  "checkpointPolicy": "state-only",
  "commitPolicy": "none",
  "corpus": "if-stale"
}
---

# Level 2 discovery 8 (read-only)

Eligible EXISTING pairs (pick at most one):

- ChordPanel.tsx + ChordStageViz.tsx
- HarmonyPanel.tsx + HarmonyStageViz.tsx
- HumanPanel.tsx + HumanStageViz.tsx
- LivePanel.tsx + LiveStageViz.tsx
- MixerPanel.tsx + MixerStageViz.tsx
- ScalePanel.tsx + ScaleStageViz.tsx
- ScenesPanel.tsx + ScenesStageViz.tsx
- ScopePanel.tsx + ScopeStageViz.tsx

Those `*Panel.tsx` files are HELPERS. They are not the inner `*Panel()` functions inside FireCommandView.tsx.

FORBIDDEN filenames (inner FireCommandView functions, not files): DrivePanel.tsx, DelayPanel.tsx, FilterPanel.tsx, OscAPanel.tsx, ReverbPanel.tsx, and any other `*Panel.tsx` that is not in the list above.

If you cannot quote a real user-facing friction line (overflow, truncation, empty copy, inactive contrast) in the chosen pair, VERDICT: NOT_READY.

Do not present Option A/B/C. Do not restyle meters. No live implementation. No production edits.
