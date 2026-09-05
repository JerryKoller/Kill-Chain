import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { nightDir, fingerprintParked, shaFile, singularityAbs, AUDIO_PLAYGROUND } from "./yard.mjs";
import { gitCapture, gitRun } from "../git.mjs";
import { sanitizeGlText } from "./probeShape.mjs";

function yn(v) {
  if (v === true) return "yes";
  if (v === false) return "no";
  if (v == null || v === "") return "n/a";
  return String(v);
}

export function writeMorningReport(state) {
  const parkedEnd = fingerprintParked();
  const git = gitCapture();
  const porcelain = gitRun(["status", "--porcelain"], { allowFail: true }) || "";
  const items = [
    ["1. starting HEAD", state.start?.commit || state.start?.head],
    ["2. starting dirty files", (state.start?.porcelain || "").trim() || "(clean)"],
    ["3. parked UI starting hashes", JSON.stringify(state.start?.parked, null, 2)],
    ["4. creative checkpoint 1 hash", state.cp1],
    ["5. fallback-cleanup result", state.phase1?.result],
    ["6. calls spent on cleanup", state.phase1?.calls],
    ["7. telemetry changes", state.phase2?.summary],
    ["8. actual WebGL failure stage", state.phase3?.stage],
    ["9. shader/program logs summary", state.phase3?.logSummary],
    ["10. pipeline repair attempts", state.phase4?.attempts],
    ["11. pipeline checkpoints", (state.phase4?.checkpoints || []).join(", ") || "none"],
    ["12. whether real WebGL was restored", yn(state.realWebgl)],
    ["13. first real WebGL screenshot", state.screenshots?.["03"] || "none"],
    ["14. total Qwen calls", state.totals?.qwenCalls],
    ["15. total Grok interventions", state.totals?.grokInterventions],
    ["16. teacher interventions", state.totals?.teacherInterventions],
    ["17. number of creative hypotheses", state.phase5?.hypothesesTried],
    ["18. number of actual edits", state.totals?.edits],
    ["19. accepted candidates", state.phase5?.accepted],
    ["20. reverted candidates", state.phase5?.reverted],
    ["21. invalid candidates", state.phase5?.invalid],
    ["22. repair attempts", state.totals?.repairAttempts],
    ["23. repair spirals prevented", state.totals?.spiralsPrevented],
    ["24. sidecar-file violations", state.totals?.sidecars],
    ["25. preservation-guard triggers", state.totals?.guardRejects],
    ["26. typecheck results", JSON.stringify(state.validation?.typecheck || [])],
    ["27. build results", JSON.stringify(state.validation?.build || [])],
    ["28. performance observations", state.performance || "not chased; MAX_PIXELS left in place"],
    ["29. screenshot list", (state.screenshotList || []).join("\n")],
    ["30. visual diary summary", state.diarySummary],
    ["31. local visual-critic observations", JSON.stringify(state.visualCritic || [], null, 2)],
    ["32. Grok visual assessments", state.grokVisual || "setup + deferred overnight frames; human is final judge"],
    ["33. best candidate", state.best?.name],
    ["34. best candidate checkpoint/hash", state.best?.sha],
    ["35. baseline vs final qualitative comparison", state.best?.compare],
    ["36. exact singularity.ts diff summary", state.diffSummary],
    ["37. production files changed", state.productionChanged],
    ["38. tooling files changed", state.toolingChanged],
    ["39. scope violations", state.totals?.scopeViolations],
    ["40. production drift", state.productionDrift],
    ["41. parked UI ending hashes", JSON.stringify(parkedEnd, null, 2)],
    ["42. audio-playground untouched confirmation", `path=${AUDIO_PLAYGROUND}\nstart=${state.start?.audioPlaygroundPorcelain || ""}\nend=${state.end?.audioPlaygroundPorcelain || ""}`],
    ["43. final Git state", `${git.branch} ${git.short} dirty=${git.dirty}\n${porcelain}`],
    ["44. whether anything was committed", "no (commitPolicy none; overnight did not commit)"],
    ["45. whether anything was pushed", "no"],
    ["46. current Robo Puppy status", state.puppyStatus],
    ["47. actual autonomy level achieved", state.autonomyLevel],
    ["48. biggest Robo Puppy weakness observed", state.lessons?.puppyWeakness],
    ["49. biggest foreman weakness observed", state.lessons?.foremanWeakness],
    ["50. what was learned about creative autonomy", state.lessons?.creative],
    ["51. whether Robo Puppy deserves another creative subsystem mission", state.lessons?.anotherMission],
    ["52. what the human should look at first in the morning", state.lookFirst],
  ];
  const success = state.successLevel || "unscored";
  const md = [
    "# Singularity night shift — morning report",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Success level: **${success}**`,
    `Current singularity.ts sha256: \`${shaFile(singularityAbs())}\``,
    "",
    ...items.flatMap(([k, v]) => [`## ${k}`, "", String(v ?? "n/a"), ""]),
  ].join("\n");
  const out = join(nightDir(), "MORNING_REPORT.md");
  writeFileSync(out, sanitizeGlText(md), "utf8");
  return out;
}

export function scoreSuccess(state) {
  const p1 = state.phase1?.ok;
  const identified = Boolean(state.phase3?.stage);
  const real = Boolean(state.realWebgl);
  const accepted = Number(state.phase5?.accepted || 0);
  const hypotheses = Number(state.phase5?.hypothesesTried || 0);
  if (real && hypotheses >= 4 && accepted >= 1) return "LEVEL 4 — major milestone (verify visually; do not inflate)";
  if (real && accepted >= 2) return "LEVEL 3 — creative win";
  if (real) return "LEVEL 2 — engineering win";
  if (state.cp1 && identified && (p1 || state.phase1?.result)) return "LEVEL 1 — useful failure";
  return "BELOW LEVEL 1 — see report";
}
