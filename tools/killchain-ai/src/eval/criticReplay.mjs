/**
 * Critic replay benchmark.
 *
 * Re-evaluates archived critic outputs through both the old gate and the
 * tutorized gate, and scores both against Opus-authored gold labels.
 *
 * Faithfulness rules:
 *  - Tool lists come from the archived session JSONL, not guesses.
 *  - `suppliedEvidence` reflects what the real prompt actually contained:
 *    the final critic received the Git diff; the plan critic did not.
 *    A plan that merely names a file is not evidence of that file's contents.
 *  - Nothing is re-run through a model. This is a pure gate experiment, so it
 *    is deterministic and repeatable.
 */

import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "../paths.mjs";
import { evaluateCriticGate } from "../mission/critic.mjs";
import { classifyGateFailure, TUTOR, hasSubstanceFor } from "../mission/tutor.mjs";
import { parseOpenCodeJsonl } from "../mission/opencode.mjs";
import { GOLD } from "./criticGold.mjs";

const MISSIONS = join(repoRoot, "tools/killchain-ai/data/missions");
const OUT = join(repoRoot, "tools/killchain-ai/data/overnight/critic-replay");

function read(p) {
  try {
    return existsSync(p) ? readFileSync(p, "utf8") : "";
  } catch {
    return "";
  }
}

/** Tools actually used by the session that produced this critic artifact. */
function toolsForPhase(missionDir, phaseMatch) {
  const sdir = join(missionDir, "sessions");
  if (!existsSync(sdir)) return { tools: [], retries: 0 };
  let tools = [];
  let retries = 0;
  for (const f of readdirSync(sdir)) {
    if (!f.endsWith(".jsonl")) continue;
    const stripped = f.replace(/^\d+-/, "").replace(/\.jsonl$/, "");
    if (!phaseMatch.test(stripped)) continue;
    if (/-empty-retry$/.test(stripped)) retries += 1;
    const parsed = parseOpenCodeJsonl(read(join(sdir, f)));
    for (const t of parsed.tools || []) {
      const name = typeof t === "string" ? t : t.tool;
      if (name && !tools.includes(name)) tools.push(name);
    }
  }
  return { tools, retries };
}

export function collectCases() {
  if (!existsSync(MISSIONS)) return [];
  const cases = [];
  for (const id of readdirSync(MISSIONS)) {
    const dir = join(MISSIONS, id);
    const specRaw = read(join(dir, "mission.json"));
    if (!specRaw) continue;
    let spec;
    try {
      spec = JSON.parse(specRaw);
    } catch {
      continue;
    }
    const plan = read(join(dir, "PLAN.md"));
    const proposal = read(join(dir, "PROPOSAL.md"));
    const diff = read(join(dir, "CURRENT.diff"));

    const planCritic = read(join(dir, "PLAN_CRITIC.md"));
    if (planCritic.trim()) {
      const { tools, retries } = toolsForPhase(dir, /^plan-critic/);
      cases.push({
        id: `${id}#plan`,
        missionId: id,
        phase: "plan",
        criticText: planCritic,
        planText: plan,
        proposalText: "",
        // The plan critic prompt carries only the plan text. Not authoritative.
        suppliedEvidence: "",
        spec,
        tools,
        archivedEmptyRetries: retries,
      });
    }

    const finalCritic = read(join(dir, "FINAL_CRITIC.md"));
    if (finalCritic.trim()) {
      const { tools, retries } = toolsForPhase(dir, /^final/);
      cases.push({
        id: `${id}#final`,
        missionId: id,
        phase: "final",
        criticText: finalCritic,
        planText: plan,
        proposalText: proposal,
        // The final prompt embeds the real Git diff — authoritative evidence.
        suppliedEvidence: diff,
        spec,
        tools,
        archivedEmptyRetries: retries,
      });
    }
  }
  return cases;
}

/**
 * The verdict patterns the parser recognized BEFORE this engagement.
 * Kept verbatim so the baseline arm stays faithful after the parser was
 * widened to accept `## VERDICT READY`.
 */
function legacyVerdictParses(raw) {
  const t = String(raw || "");
  return /VERDICT:\s*\**\s*`*(PASS|FAIL|BLOCK|READY|NOT_READY)`*/i.test(t)
    || /#{1,3}\s*VERDICT\s*\n+\s*\**\s*`*(PASS|FAIL|BLOCK|READY|NOT_READY)`*/i.test(t)
    || /\*\*VERDICT:\*\*\s*`*(PASS|FAIL|BLOCK|READY|NOT_READY)`*/i.test(t);
}

/** Old behaviour: strict tool requirement, no evidence waiver, no tutoring. */
export function runOldGate(c) {
  const gate = evaluateCriticGate({
    criticText: c.criticText,
    planText: c.planText,
    proposalText: c.proposalText,
    spec: c.spec,
    tools: c.tools,
    phase: c.phase,
    // Old gate had no concept of supplied evidence.
  });
  // Model the pre-fix parser: a colonless verdict was simply not seen.
  if (!legacyVerdictParses(c.criticText)) {
    const errors = [...new Set(["missing-verdict", ...gate.errors])];
    return { pass: false, errors, verdict: null, disposition: "REPLAN", gate, legacyVerdictMiss: true };
  }
  return {
    pass: gate.pass,
    errors: gate.errors,
    verdict: gate.modelVerdict,
    // Old recovery: any gate failure re-ran the whole phase, and exhausting
    // maxRetriesPerPhase blocked the mission.
    disposition: dispositionOld(gate),
    gate,
  };
}

function dispositionOld(gate) {
  if (gate.modelVerdict === "BLOCK") return "BLOCK";
  if (gate.pass) return "PASS";
  return "REPLAN"; // full phase re-run, then BLOCK if budget exhausted
}

/** Tutorized behaviour: grounded evidence rule + format/substantive split. */
export function runNewGate(c) {
  const gate = evaluateCriticGate({
    criticText: c.criticText,
    planText: c.planText,
    proposalText: c.proposalText,
    spec: c.spec,
    tools: c.tools,
    phase: c.phase,
    suppliedEvidence: c.suppliedEvidence,
  });
  const cls = classifyGateFailure(gate);
  return {
    pass: gate.pass,
    errors: gate.errors,
    verdict: gate.modelVerdict,
    kind: cls.kind,
    formatOnly: cls.formatOnly,
    missingFields: cls.missingFields,
    // Recoverable without re-running the phase: the model reshapes content it
    // already produced. Only counts when the substance is actually present.
    formatRepairable: cls.formatOnly
      && cls.missingFields.length > 0
      && cls.missingFields.every((f) => hasSubstanceFor(f, c.criticText)),
    disposition: dispositionNew(gate, cls, c),
    gate,
  };
}

function dispositionNew(gate, cls, c) {
  if (gate.modelVerdict === "BLOCK") return "BLOCK";
  if (gate.pass) return "PASS";
  if (cls.kind === TUTOR.CRITIC_FORMAT) {
    const repairable = cls.missingFields.length > 0
      && cls.missingFields.every((f) => hasSubstanceFor(f, c.criticText));
    return repairable ? "FORMAT_REPAIR" : "TUTOR_RETRY";
  }
  if (cls.kind === TUTOR.PRODUCT_AMBIGUITY) return "BLOCK";
  if (cls.kind === TUTOR.INVALID_REFERENCE || cls.kind === TUTOR.SCOPE) return "TUTOR_RETRY";
  return "REPLAN";
}

/**
 * Score a disposition against a gold label.
 * FORMAT_REPAIR and TUTOR_RETRY are both "recoverable" outcomes; the gold
 * label says whether recovery (rather than PASS or BLOCK) was correct.
 */
export function score(disposition, gold) {
  const d = String(disposition);
  switch (gold) {
    case "SHOULD_PASS":
      return d === "PASS" ? "correct" : (d === "BLOCK" ? "false-block" : "unnecessary-retry");
    case "SHOULD_BLOCK":
      return d === "BLOCK" ? "correct" : "false-pass-or-retry";
    case "FORMAT_ONLY_FAILURE":
      // Correct handling is any cheap targeted recovery — a reshape or a
      // one-field re-ask. Passing it unchecked is unsafe; blocking or
      // re-planning the phase is disproportionate.
      if (d === "FORMAT_REPAIR" || d === "TUTOR_RETRY") return "correct";
      if (d === "PASS") return "false-pass";
      if (d === "BLOCK") return "false-block";
      return "expensive-recovery";
    case "NEEDS_MORE_EVIDENCE":
      if (d === "TUTOR_RETRY" || d === "REPLAN") return "correct";
      if (d === "PASS") return "false-pass";
      return d === "BLOCK" ? "false-block" : "expensive-recovery";
    case "SHOULD_FAIL":
      if (d === "REPLAN" || d === "TUTOR_RETRY") return "correct";
      if (d === "PASS") return "false-pass";
      return d === "BLOCK" ? "false-block" : "expensive-recovery";
    default:
      return "unlabelled";
  }
}

/**
 * Approximate model-call cost of each recovery path.
 * A REPLAN re-runs the phase and its critic, and repeated re-plans are what
 * exhausted retry budgets and produced the archived BLOCKs.
 */
export const RECOVERY_COST = {
  PASS: 0,
  FORMAT_REPAIR: 1, // one short call, no repo tools, reshape only
  TUTOR_RETRY: 1, // one targeted call in the same phase
  REPLAN: 2, // phase re-run plus its critic, at minimum
  BLOCK: 0, // mission ends; cost is the whole mission, not calls
};

export async function runCriticReplay({ log = console.log, write = true } = {}) {
  const all = collectCases();
  const labelled = all.filter((c) => GOLD[c.id]);
  log(`archived critic artifacts: ${all.length} | gold-labelled: ${labelled.length}`);

  const rows = [];
  for (const c of labelled) {
    const gold = GOLD[c.id];
    const oldR = runOldGate(c);
    const newR = runNewGate(c);
    rows.push({
      id: c.id,
      phase: c.phase,
      level: c.spec.level || 0,
      gold: gold.label,
      why: gold.why,
      toolCount: c.tools.length,
      archivedEmptyRetries: c.archivedEmptyRetries,
      old: { disposition: oldR.disposition, errors: oldR.errors, score: score(oldR.disposition, gold.label) },
      new: {
        disposition: newR.disposition,
        errors: newR.errors,
        kind: newR.kind,
        formatOnly: newR.formatOnly,
        missingFields: newR.missingFields,
        score: score(newR.disposition, gold.label),
      },
    });
  }

  const tally = (which) => {
    const t = {};
    for (const r of rows) t[r[which].score] = (t[r[which].score] || 0) + 1;
    return t;
  };
  const oldTally = tally("old");
  const newTally = tally("new");
  const correct = (t) => t.correct || 0;

  const summary = {
    cases: rows.length,
    archivedArtifacts: all.length,
    old: {
      ...oldTally,
      accuracy: rows.length ? +(correct(oldTally) / rows.length).toFixed(3) : 0,
      falseBlocks: oldTally["false-block"] || 0,
      falsePasses: (oldTally["false-pass"] || 0) + (oldTally["false-pass-or-retry"] || 0),
    },
    new: {
      ...newTally,
      accuracy: rows.length ? +(correct(newTally) / rows.length).toFixed(3) : 0,
      falseBlocks: newTally["false-block"] || 0,
      falsePasses: (newTally["false-pass"] || 0) + (newTally["false-pass-or-retry"] || 0),
    },
    dispositionShift: rows.reduce((acc, r) => {
      const k = `${r.old.disposition}->${r.new.disposition}`;
      acc[k] = (acc[k] || 0) + 1;
      return acc;
    }, {}),
    formatRepairs: rows.filter((r) => r.new.disposition === "FORMAT_REPAIR").length,
    replansAvoided: rows.filter((r) => r.old.disposition === "REPLAN" && r.new.disposition !== "REPLAN").length,
    recoveryCost: {
      old: rows.reduce((n, r) => n + (RECOVERY_COST[r.old.disposition] ?? 0), 0),
      new: rows.reduce((n, r) => n + (RECOVERY_COST[r.new.disposition] ?? 0), 0),
    },
    blocks: {
      old: rows.filter((r) => r.old.disposition === "BLOCK").length,
      new: rows.filter((r) => r.new.disposition === "BLOCK").length,
    },
    passes: {
      old: rows.filter((r) => r.old.disposition === "PASS").length,
      new: rows.filter((r) => r.new.disposition === "PASS").length,
    },
  };

  log("");
  log(`old gate accuracy: ${summary.old.accuracy}  (false blocks ${summary.old.falseBlocks}, false passes ${summary.old.falsePasses})`);
  log(`new gate accuracy: ${summary.new.accuracy}  (false blocks ${summary.new.falseBlocks}, false passes ${summary.new.falsePasses})`);
  log(`format repairs enabled: ${summary.formatRepairs} | full re-plans avoided: ${summary.replansAvoided}`);
  log("");
  for (const r of rows) {
    const changed = r.old.disposition !== r.new.disposition ? " *" : "  ";
    log(`${changed}${r.id.padEnd(52)} gold=${r.gold.padEnd(21)} old=${r.old.disposition.padEnd(13)} new=${r.new.disposition}`);
  }

  if (write) {
    mkdirSync(OUT, { recursive: true });
    writeFileSync(join(OUT, "replay.json"), JSON.stringify({ summary, rows }, null, 2));
    log(`\nwrote ${join(OUT, "replay.json")}`);
  }
  return { summary, rows };
}
