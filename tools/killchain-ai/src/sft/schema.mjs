export const TASK_TYPES = [
  "rejected-promise",
  "stale-state",
  "race",
  "timer-cleanup",
  "resource-leak",
  "persistence",
  "store-engine-sync",
  "source-ownership",
  "mission-state",
  "safe-ui",
  "typescript",
  "error-handling",
  "regression-prevention",
  "refusal-dsp",
  "refusal-mission-priority",
  "refusal-claimSource",
  "refusal-rewireFront",
];

export const APPROVAL_CLASSES = ["safe", "human-approval", "refuse"];

export const PROTOCOL_SECTIONS = [
  "investigation",
  "relevant_files",
  "confirmed_facts",
  "competing_hypothesis",
  "disproof",
  "root_cause",
  "smallest_safe_fix",
  "expected_diff",
  "validation",
  "final_report",
];

export const SYSTEM_PROMPT = `You are a Kill Chain coding specialist. Follow the Kill Chain AI constitution (AGENTS.md) exactly.

PRIMARY OBJECTIVE: improve Kill Chain safely, incrementally, and measurably.

HARD INVARIANTS:
1. Only rewireFront() may mutate front routing gains.
2. Only claimSource() may decide playback ownership.
3. Only MISSION STATE may react to source changes.
4. Live audio-tap nodes must be disconnected in finally blocks.
5. Intervals and requestAnimationFrame loops must be cleaned up.
6. Store writes and matching AudioEngine calls must occur in the same synchronous action.
7. Persistence failures must call reportStorageFailure.
8. Preserve the one-audible-source rule.
9. Preserve the one-high-rate-FFT-pipeline design unless explicitly authorized.

MISSION STATE PRIORITY (do not change without approval):
manual override > saved source memory > Auto-Lock > Auto-Flatten

Do not autonomously alter DSP algorithms, EQ curves, correction profiles, gain staging, limiter/compressor behavior, transient processing, saturation, restoration, spatialization, 3D, crossovers, loudness targets, or preset tuning. You may investigate and propose, then ask.

Never claim a test passed unless you actually ran it.

Before changing code: investigate, locate files, read architecture, determine validation, make the smallest change. Actively try to disprove the initial diagnosis. Distinguish confirmed behavior from speculation.

This constitution is sourced from AGENTS.md (Kill-Chain-AI). Do not invent replacement rules.`;

export function assistantFromProtocol(p) {
  return [
    `## Investigation`,
    p.investigation,
    ``,
    `## Relevant files / symbols`,
    p.relevant_files,
    ``,
    `## Confirmed facts`,
    p.confirmed_facts,
    ``,
    `## Competing hypothesis`,
    p.competing_hypothesis,
    ``,
    `## Attempt to disprove`,
    p.disproof,
    ``,
    `## Root cause`,
    p.root_cause,
    ``,
    `## Smallest safe fix`,
    p.smallest_safe_fix,
    ``,
    `## Expected diff`,
    p.expected_diff,
    ``,
    `## Validation`,
    p.validation,
    ``,
    `## Final report`,
    p.final_report,
  ].join("\n");
}

export function parseProtocol(text) {
  const out = {};
  const labels = {
    investigation: "Investigation",
    relevant_files: "Relevant files / symbols",
    confirmed_facts: "Confirmed facts",
    competing_hypothesis: "Competing hypothesis",
    disproof: "Attempt to disprove",
    root_cause: "Root cause",
    smallest_safe_fix: "Smallest safe fix",
    expected_diff: "Expected diff",
    validation: "Validation",
    final_report: "Final report",
  };
  const keys = Object.keys(labels);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const header = labels[key];
    const re = new RegExp(`##\\s*${header}\\s*\\n([\\s\\S]*?)(?=\\n##\\s*|$)`, "i");
    const m = text.match(re);
    out[key] = m ? m[1].trim() : "";
  }
  return out;
}
