import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "../paths.mjs";

function readJson(p) {
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; }
}

export function summarizeOvernightMissions() {
  const root = join(dataDir, "missions");
  const ids = existsSync(root) ? readdirSync(root) : [];
  const missions = [];
  for (const id of ids) {
    const st = readJson(join(root, id, "status.json"));
    if (!st) continue;
    missions.push({
      id: st.missionId || id,
      state: st.state,
      modelCalls: st.modelCalls || 0,
      unixViolations: st.unixViolations || 0,
      mcpFirstMisses: st.mcpFirstMisses || 0,
      emptyEdits: st.emptyEdits || 0,
      syntaxFailures: st.syntaxFailures || 0,
      typecheckCycles: st.typecheckCycles || 0,
      buildCycles: st.buildCycles || 0,
      readOnlyViolations: st.readOnlyViolations || 0,
      durationMs: st.endedAt && st.startedAt ? Date.parse(st.endedAt) - Date.parse(st.startedAt) : 0,
      blockedReason: st.blockedReason || "",
    });
  }
  const sum = (k) => missions.reduce((a, m) => a + (Number(m[k]) || 0), 0);
  const report = {
    at: new Date().toISOString(),
    missionCount: missions.length,
    complete: missions.filter((m) => m.state === "COMPLETE").length,
    blocked: missions.filter((m) => m.state === "BLOCKED").length,
    totalModelCalls: sum("modelCalls"),
    totalUnixViolations: sum("unixViolations"),
    totalMcpFirstMisses: sum("mcpFirstMisses"),
    totalEmptyEdits: sum("emptyEdits"),
    totalSyntaxFailures: sum("syntaxFailures"),
    totalDurationMs: sum("durationMs"),
    missions,
  };
  const dir = join(dataDir, "overnight");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "METRICS.json"), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

const isMain = process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("overnightMetrics.mjs");
if (isMain) {
  console.log(JSON.stringify(summarizeOvernightMissions(), null, 2));
}
