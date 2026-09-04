/**
 * Editing-evidence dashboard.
 *
 * Exists to prevent the specific mistake the first audit uncovered: reading
 * "652 model calls" as 652 development attempts. It separates missions that
 * actually mutated code from missions that only investigated, and reports what
 * the mutating ones achieved.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "../paths.mjs";

const MISSIONS = join(dataDir, "missions");
const CURRICULUM = join(dataDir, "overnight", "edit-curriculum", "results.json");
const OUT = join(dataDir, "overnight", "editing-evidence");

function readJson(p) {
  try {
    return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
  } catch {
    return null;
  }
}

export function collectArchive() {
  if (!existsSync(MISSIONS)) return null;
  const out = {
    missions: 0,
    complete: 0,
    blocked: 0,
    modelCalls: 0,
    readOnlyMissions: 0,
    mutatingMissions: 0,
    mutatingComplete: 0,
    emptyEdits: 0,
    describedButDidNotApply: 0,
    syntaxFailures: 0,
    transactionalRollbacks: 0,
    automaticRestores: 0,
    unixViolations: 0,
    mcpFirstMisses: 0,
    visibleTextMisses: 0,
    missionsWithVisibleTextMiss: 0,
    criticRetries: 0,
    missionsNeedingCriticRetry: 0,
    resumeCount: 0,
    sessionsByPhase: {},
    emptyOutputRetries: 0,
    blockedReasons: [],
  };

  for (const id of readdirSync(MISSIONS)) {
    const dir = join(MISSIONS, id);
    const s = readJson(join(dir, "status.json"));
    if (!s) continue;
    out.missions += 1;
    if (s.state === "COMPLETE") out.complete += 1;
    if (s.state === "BLOCKED") {
      out.blocked += 1;
      out.blockedReasons.push({ id, reason: s.blockedReason || s.failedReason || "?" });
    }
    out.modelCalls += s.modelCalls || 0;
    const mutated = Boolean(s.lastWritePhase) || Boolean(s.preEditCaptured) || (s.emptyEdits || 0) > 0;
    if (mutated) {
      out.mutatingMissions += 1;
      if (s.state === "COMPLETE") out.mutatingComplete += 1;
    } else {
      out.readOnlyMissions += 1;
    }
    out.emptyEdits += s.emptyEdits || 0;
    out.describedButDidNotApply += s.describedButDidNotApply || 0;
    out.syntaxFailures += s.syntaxFailures || 0;
    out.transactionalRollbacks += s.transactionalRollbacks || 0;
    out.automaticRestores += s.automaticRestores || 0;
    out.unixViolations += s.unixViolations || 0;
    out.mcpFirstMisses += s.mcpFirstMisses || 0;
    out.visibleTextMisses += s.visibleTextMisses || 0;
    if ((s.visibleTextMisses || 0) > 0) out.missionsWithVisibleTextMiss += 1;
    out.criticRetries += s.criticRetries || 0;
    if ((s.criticRetries || 0) > 0) out.missionsNeedingCriticRetry += 1;
    out.resumeCount += s.resumeCount || 0;

    const sdir = join(dir, "sessions");
    if (existsSync(sdir)) {
      for (const f of readdirSync(sdir)) {
        if (!f.endsWith(".jsonl")) continue;
        const phase = f.replace(/^\d+-/, "").replace(/\.jsonl$/, "");
        out.sessionsByPhase[phase] = (out.sessionsByPhase[phase] || 0) + 1;
        if (/-empty-retry$/.test(phase)) out.emptyOutputRetries += 1;
      }
    }
  }
  return out;
}

export function report({ log = console.log, write = true } = {}) {
  const a = collectArchive();
  const c = readJson(CURRICULUM);
  if (!a) {
    log("no archive found");
    return null;
  }

  const editSessions = Object.entries(a.sessionsByPhase)
    .filter(([p]) => /^edit/.test(p) || /^repair/.test(p))
    .reduce((n, [, v]) => n + v, 0);

  const lines = [];
  const P = (s) => {
    lines.push(s);
    log(s);
  };

  P("=== ARCHIVED MISSIONS ===");
  P(`missions with a status record   ${a.missions}`);
  P(`  COMPLETE                      ${a.complete}`);
  P(`  BLOCKED                       ${a.blocked}`);
  P(`total local model calls         ${a.modelCalls}`);
  P("");
  P("--- how many actually changed code? ---");
  P(`read-only / investigation only  ${a.readOnlyMissions}`);
  P(`missions that mutated code      ${a.mutatingMissions}   <-- the real editing evidence base`);
  P(`  of which COMPLETE             ${a.mutatingComplete}`);
  P(`edit + repair sessions          ${editSessions}`);
  P("");
  P("--- wasted calls ---");
  P(`empty visible-output retries    ${a.emptyOutputRetries}   (${((a.emptyOutputRetries / Math.max(1, a.modelCalls)) * 100).toFixed(1)}% of all model calls)`);
  P(`critic retries                  ${a.criticRetries} across ${a.missionsNeedingCriticRetry} missions`);
  P(`missions w/ thin visible report ${a.missionsWithVisibleTextMiss} of ${a.missions}`);
  P(`unix violations                 ${a.unixViolations} (${(a.unixViolations / Math.max(1, a.modelCalls)).toFixed(2)}/call)`);
  P(`MCP-first misses                ${a.mcpFirstMisses} (${(a.mcpFirstMisses / Math.max(1, a.modelCalls)).toFixed(2)}/call)`);
  P("");
  P("--- apply / repair health ---");
  P(`empty edits                     ${a.emptyEdits}`);
  P(`described but did not apply     ${a.describedButDidNotApply}`);
  P(`syntax gate failures            ${a.syntaxFailures}`);
  P(`transactional rollbacks         ${a.transactionalRollbacks}`);
  P(`automatic restores              ${a.automaticRestores}`);
  P(`resumes                         ${a.resumeCount}`);

  if (c?.summary) {
    const s = c.summary;
    P("");
    P("=== EDIT CURRICULUM (generated this engagement) ===");
    P(`tasks executed                  ${s.tasks}   (every one a real file mutation attempt)`);
    P(`first-edit application rate     ${s.rates.firstEditApplication}`);
    P(`first-edit mechanical validity  ${s.rates.firstEditValidity}`);
    P(`first-edit acceptance           ${s.rates.firstEditAcceptance}`);
    P(`acceptance after tutoring       ${s.rates.finalAcceptance}`);
    P(`empty edits                     ${s.emptyEdits}`);
    P(`tutor-recovered failures        ${s.tutorRecovered}`);
    P(`production drift                ${s.productionDrift.length}`);
    P("");
    P(`editing attempts before         ${a.mutatingMissions}`);
    P(`editing attempts after          ${a.mutatingMissions + s.tasks}`);
  }

  if (write) {
    mkdirSync(OUT, { recursive: true });
    writeFileSync(join(OUT, "dashboard.json"), JSON.stringify({ at: new Date().toISOString(), archive: a, curriculum: c?.summary || null }, null, 2));
    writeFileSync(join(OUT, "DASHBOARD.txt"), `${lines.join("\n")}\n`);
  }
  return { archive: a, curriculum: c?.summary || null };
}
