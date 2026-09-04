/**
 * Mine real edit episodes from archived attribution snapshots.
 *
 * Every mission phase captured byte-exact copies of the app files it touched,
 * so consecutive phases where a file's bytes changed are a real BEFORE/AFTER
 * pair produced by an actual model edit that the foreman then validated (or
 * rejected). These are far better curriculum material than synthetic fault
 * injection: they carry the task's real intent, the real diff shape, and the
 * real outcome.
 *
 * This module only *discovers and classifies* episodes. It never runs a model.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, relative } from "node:path";
import { dataDir } from "../paths.mjs";
import { scanStructure } from "../mission/jsxStructure.mjs";
import { checkTsSyntax } from "../mission/syntax.mjs";

const MISSIONS = join(dataDir, "missions");

/** Task families the curriculum wants to cover. */
export const FAMILIES = {
  SINGLE_FILE_APPLY: "single-file apply",
  TWO_FILE_COORDINATED: "two-file coordinated edit",
  CRITIC_REVISION: "critic-requested revision",
  REPAIR_INVALID_DIFF: "repair after invalid diff",
  SCOPE_CORRECTION: "scope correction",
  UI_LAYOUT: "UI layout adjustment",
  MECHANICAL_IMPORT: "import / mechanical correction",
  MULTI_PASS: "multi-pass edit",
};

function sha(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

function walk(dir, acc = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else acc.push(p);
  }
  return acc;
}

function readMaybe(p) {
  try {
    return existsSync(p) ? readFileSync(p, "utf8") : "";
  } catch {
    return "";
  }
}

/** Ordered phase snapshots for one mission: phase -> relPath -> {hash, abs}. */
function phaseSnapshots(missionDir) {
  const ad = join(missionDir, "attribution");
  if (!existsSync(ad)) return [];
  const phases = readdirSync(ad)
    .filter((f) => {
      try {
        return statSync(join(ad, f)).isDirectory();
      } catch {
        return false;
      }
    })
    .filter((f) => f !== "quarantine")
    .sort();

  const out = [];
  for (const ph of phases) {
    const fdir = join(ad, ph, "files");
    if (!existsSync(fdir)) continue;
    const files = {};
    for (const abs of walk(fdir)) {
      const rel = relative(fdir, abs).split(/[\\/]/).join("/");
      files[rel] = { hash: sha(readFileSync(abs)), abs };
    }
    out.push({ phase: ph, files });
  }
  return out;
}

/**
 * Classify an episode from its diff shape and the phase it came from.
 * Deterministic and conservative: an episode we cannot classify is reported
 * as such rather than forced into a family.
 */
export function classifyEpisode({ phase, before, after, fileCount, rel, missionStatus }) {
  const beforeLines = before.split(/\r?\n/);
  const afterLines = after.split(/\r?\n/);
  let changed = 0;
  const max = Math.max(beforeLines.length, afterLines.length);
  for (let i = 0; i < max; i += 1) if (beforeLines[i] !== afterLines[i]) changed += 1;

  const importsBefore = (before.match(/^import\b/gm) || []).length;
  const importsAfter = (after.match(/^import\b/gm) || []).length;
  const classishChange = /className=|style=\{\{|gap-|max-w-|min-w-|truncate|tracking-|text-\[/.test(
    afterLines.filter((l, i) => l !== beforeLines[i]).join("\n"),
  );

  const beforeBroken = !scanStructure(before, { jsx: rel.endsWith(".tsx") }).ok
    || !checkTsSyntax(rel, before).ok;
  const afterSound = scanStructure(after, { jsx: rel.endsWith(".tsx") }).ok
    && checkTsSyntax(rel, after).ok;

  if (/repair/.test(phase) && beforeBroken) return FAMILIES.REPAIR_INVALID_DIFF;
  if (beforeBroken && afterSound) return FAMILIES.REPAIR_INVALID_DIFF;
  if (importsBefore !== importsAfter) return FAMILIES.MECHANICAL_IMPORT;
  if (fileCount >= 2) return FAMILIES.TWO_FILE_COORDINATED;
  if (/revise|revision/.test(String(missionStatus?.missionId || "")) || /critic/.test(phase)) {
    return FAMILIES.CRITIC_REVISION;
  }
  if (classishChange) return FAMILIES.UI_LAYOUT;
  if (changed > 0) return FAMILIES.SINGLE_FILE_APPLY;
  return null;
}

/**
 * Discover every real BEFORE/AFTER episode in the archive.
 * An episode is a consecutive pair of phase snapshots where a file's bytes
 * changed, plus the mission context needed to state the task.
 */
export function mineEpisodes({ minChangedLines = 1, maxChangedLines = 400 } = {}) {
  if (!existsSync(MISSIONS)) return [];
  const episodes = [];

  for (const id of readdirSync(MISSIONS)) {
    const dir = join(MISSIONS, id);
    let spec = null;
    let status = null;
    try {
      spec = JSON.parse(readMaybe(join(dir, "mission.json")) || "null");
      status = JSON.parse(readMaybe(join(dir, "status.json")) || "null");
    } catch {
      /* keep going: a malformed mission is not fatal to mining */
    }
    if (!spec) continue;

    const snaps = phaseSnapshots(dir);
    if (snaps.length < 2) continue;
    const proposal = readMaybe(join(dir, "PROPOSAL.md"));
    const plan = readMaybe(join(dir, "PLAN.md"));
    const finalCritic = readMaybe(join(dir, "FINAL_CRITIC.md"));

    for (let i = 1; i < snaps.length; i += 1) {
      const prev = snaps[i - 1];
      const cur = snaps[i];
      const changedFiles = [];
      for (const [rel, info] of Object.entries(cur.files)) {
        const was = prev.files[rel];
        if (!was || was.hash === info.hash) continue;
        changedFiles.push({ rel, beforeAbs: was.abs, afterAbs: info.abs });
      }
      if (!changedFiles.length) continue;

      for (const cf of changedFiles) {
        let before;
        let after;
        try {
          before = readFileSync(cf.beforeAbs, "utf8");
          after = readFileSync(cf.afterAbs, "utf8");
        } catch {
          continue;
        }
        const bl = before.split(/\r?\n/);
        const al = after.split(/\r?\n/);
        let changed = 0;
        for (let k = 0; k < Math.max(bl.length, al.length); k += 1) if (bl[k] !== al[k]) changed += 1;
        if (changed < minChangedLines || changed > maxChangedLines) continue;

        const family = classifyEpisode({
          phase: cur.phase,
          before,
          after,
          fileCount: changedFiles.length,
          rel: cf.rel,
          missionStatus: status,
        });
        if (!family) continue;

        episodes.push({
          id: `${id}::${cur.phase}::${cf.rel.split("/").pop()}`,
          missionId: id,
          phase: cur.phase,
          fromPhase: prev.phase,
          rel: cf.rel,
          family,
          changedLines: changed,
          filesInPhase: changedFiles.length,
          beforeAbs: cf.beforeAbs,
          afterAbs: cf.afterAbs,
          goal: spec.goal || "",
          acceptance: spec.acceptance || [],
          allowedPaths: spec.allowedPaths || [],
          missionState: status?.state || "?",
          hasProposal: proposal.length > 0,
          proposalChars: proposal.length,
          planChars: plan.length,
          criticChars: finalCritic.length,
          // Was the AFTER state mechanically sound? A broken AFTER makes a poor
          // gold target but an excellent repair fixture.
          afterSound: scanStructure(after, { jsx: cf.rel.endsWith(".tsx") }).ok
            && checkTsSyntax(cf.rel, after).ok,
          beforeSound: scanStructure(before, { jsx: cf.rel.endsWith(".tsx") }).ok
            && checkTsSyntax(cf.rel, before).ok,
        });
      }
    }
  }
  return episodes;
}

export function summarize(episodes) {
  const byFamily = {};
  const byMission = {};
  for (const e of episodes) {
    byFamily[e.family] = (byFamily[e.family] || 0) + 1;
    byMission[e.missionId] = (byMission[e.missionId] || 0) + 1;
  }
  return {
    total: episodes.length,
    families: Object.keys(byFamily).length,
    byFamily,
    missions: Object.keys(byMission).length,
    byMission,
    usableAsGold: episodes.filter((e) => e.afterSound).length,
    usableAsRepairFixture: episodes.filter((e) => !e.beforeSound).length,
  };
}
