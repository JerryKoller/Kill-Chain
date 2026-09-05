import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { repoRoot } from "../paths.mjs";
import { runMission } from "../mission/runner.mjs";
import { parseMissionFile } from "../mission/schema.mjs";
import {
  captureHarnessFrame,
  ensureHarnessServer,
  restartHarnessServer,
} from "../ui/captureHarness.mjs";
import { screenImage, screenVerdict } from "../ui/visualCritic.mjs";
import { describeFirstFail, truthFromProbe, sanitizeGlText, stringifyGlSafe } from "./probeShape.mjs";
import { compareDiagnostics, fingerprintFromProbe } from "./diagnosticFingerprint.mjs";
import {
  NIGHT_ID,
  CP1_SHA,
  SINGULARITY_REL,
  DIAGNOSTIC_SENTENCE,
  nightDir,
  shaFile,
  singularityAbs,
  fingerprintParked,
  copyParkedSnapshot,
  parkedUnchanged,
  ensureCheckpoint1,
  restoreCheckpoint1,
  saveNamedCheckpoint,
  restoreNamedCheckpoint,
  guardNow,
  diagnosticStillPresent,
  quarantineSidecars,
  startingGit,
  seedDiary,
  appendDiary,
  readState,
  writeState,
  logLine,
  audioPlaygroundPorcelain,
  readSingularity,
} from "./yard.mjs";
import { p1FallbackMission, p1TeacherMission, pipelineRepairMission, creativeMission, HYPOTHESES } from "./specs.mjs";
import { writeMorningReport, scoreSuccess } from "./report.mjs";

const PIPELINE_CALL_CAP = 30;
const CLEANUP_CALL_CAP = 16;

function mid(state, base) {
  const r = Number(state.round || 1);
  return r <= 1 ? base : `${base}-r${r}`;
}

function continueState(prev) {
  const round = Number(prev.round || 1) + 1;
  writeFileSync(join(nightDir(), `attempt-${prev.round || 1}.json`), `${JSON.stringify(prev, null, 2)}\n`);
  return {
    ...prev,
    round,
    phase: "setup",
    stop: false,
    fatal: null,
    endedAt: null,
    phase1: {},
    phase2: {},
    phase4: { attempts: 0, checkpoints: [], calls: 0 },
    phase5: { hypothesesTried: 0, accepted: 0, reverted: 0, invalid: 0 },
    toolingQueueDone: false,
    lastKeep: prev.lastKeep || "creative-01",
    lastPipeline: prev.lastPipeline || "creative-01",
  };
}

function blankTotals() {
  return {
    qwenCalls: 0,
    grokInterventions: 0,
    teacherInterventions: 0,
    edits: 0,
    repairAttempts: 0,
    spiralsPrevented: 0,
    sidecars: 0,
    guardRejects: 0,
    scopeViolations: 0,
  };
}

function initState(existing) {
  if (existing?.phase && existing.totals) return existing;
  return {
    nightId: NIGHT_ID,
    startedAt: new Date().toISOString(),
    phase: "setup",
    cp1: CP1_SHA,
    realWebgl: false,
    stop: false,
    fatal: null,
    missions: [],
    screenshotList: [],
    screenshots: {},
    visualCritic: [],
    validation: { typecheck: [], build: [] },
    totals: blankTotals(),
    phase1: {},
    phase2: {},
    phase3: {},
    phase4: { attempts: 0, checkpoints: [], calls: 0 },
    phase5: { hypothesesTried: 0, accepted: 0, reverted: 0, invalid: 0 },
    events: [],
  };
}

function tallyMission(state, status) {
  const calls = Number(status.modelCalls || 0);
  state.totals.qwenCalls += calls;
  state.missions.push({
    id: status.missionId,
    state: status.state,
    calls,
    blocked: status.blockedReason || "",
    failed: status.failedReason || "",
  });
  if (status.typecheckCycles) state.validation.typecheck.push({ id: status.missionId, cycles: status.typecheckCycles });
  if (status.buildCycles) state.validation.build.push({ id: status.missionId, cycles: status.buildCycles });
  return calls;
}

function yardCheck(state) {
  const parked = parkedUnchanged(state.start.parked);
  if (!parked.ok) {
    state.stop = true;
    state.fatal = `parked Fire Command UI changed: ${parked.changed.map((c) => c.path).join(", ")}`;
    throw new Error(state.fatal);
  }
  const q = quarantineSidecars();
  if (q.hits.length) {
    state.totals.sidecars += q.hits.length;
    state.totals.scopeViolations += q.hits.length;
    logLine(state, `SIDECAR quarantined ${q.hits.join(", ")}`);
  }
  return q;
}

async function runOne(state, specPath, log) {
  const parsed = parseMissionFile(specPath);
  if (!parsed.ok) throw new Error(`invalid mission ${specPath}: ${parsed.errors.join("; ")}`);
  const id = parsed.spec.id;
  logLine(state, `MISSION START ${id}`);
  const status = await runMission({ specPath, log });
  tallyMission(state, status);
  yardCheck(state);
  logLine(state, `MISSION END ${id} → ${status.state} calls=${status.modelCalls}`);
  writeState(state);
  return status;
}

function sourceWindow(fail) {
  if (fail?.srcWindow) return sanitizeGlText(fail.srcWindow);
  const src = readSingularity().toString("utf8");
  const lines = src.split(/\n/);
  let idx = lines.findIndex((l) => /\blet\s+target/.test(l));
  if (idx < 0) idx = lines.findIndex((l) => /\blet\s+/.test(l) && !l.trim().startsWith("//") && !l.includes("let gl") && !l.includes("let failed") && !l.includes("let prog") && !l.includes("let uLoc") && !l.includes("let flow"));
  if (idx < 0) return "(no window)";
  const a = Math.max(0, idx - 12);
  const b = Math.min(lines.length, idx + 14);
  return lines.slice(a, b).map((l, i) => `${a + i + 1}| ${l}`).join("\n");
}

async function captureNamed(state, name, log) {
  const t0 = Date.now();
  const server = await ensureHarnessServer({ log });
  const outPath = join(nightDir(), "diary", `${name}.png`);
  const cap = await captureHarnessFrame({ origin: server.origin, outPath, log });
  const meta = { at: new Date().toISOString(), name, ms: Date.now() - t0, cap: {
    ok: cap.ok,
    contextOk: cap.contextOk,
    realPipeline: cap.realPipeline,
    fallbackUsed: cap.fallbackUsed,
    pipelineLabel: cap.pipelineLabel,
    firstFail: cap.firstFail,
    stats: cap.stats,
    error: cap.error,
    probe: cap.status?.probe || null,
  } };
  writeFileSync(join(nightDir(), "diary", `${name}.json`), `${JSON.stringify(meta, null, 2)}\n`);
  state.screenshots[name] = outPath;
  state.screenshotList.push(`${name}.png  label=${cap.pipelineLabel} real=${Boolean(cap.realPipeline)} fail=${describeFirstFail(cap.status?.probe)}`);
  if (cap.realPipeline) state.realWebgl = true;
  writeState(state);
  return { cap, outPath, meta };
}

async function screenMaybe(state, png, tag) {
  try {
    const critic = await screenImage(png);
    const verdict = screenVerdict(critic, { requireCore: true });
    state.visualCritic.push({ tag, critic, verdict });
    writeState(state);
    return { critic, verdict };
  } catch (e) {
    state.visualCritic.push({ tag, error: e.message });
    return { critic: { ok: false, reason: e.message }, verdict: { pass: false, fails: [e.message] } };
  }
}

function diaryEntry(fields) {
  return Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join("\n");
}

async function setup(state, log) {
  state.phase = "setup";
  if (state.start) {
    logLine(state, "SETUP resume — leaving current singularity.ts in place");
    return;
  }
  const dir = nightDir();
  state.start = {
    ...startingGit(),
    parked: copyParkedSnapshot("parked-start"),
  };
  const cp = ensureCheckpoint1();
  saveNamedCheckpoint("creative-01", { role: "CREATIVE CHECKPOINT 1", restored: cp.restored });
  seedDiary();
  state.totals.grokInterventions += 1;
  logLine(state, `SETUP head=${state.start.head} branch=${state.start.branch} cp1=${CP1_SHA} restored=${cp.restored}`);
  appendDiary(diaryEntry({
    TIME: state.startedAt,
    CHECKPOINT: "creative-01",
    HYPOTHESIS: "n/a (preserved candidate 1)",
    MODEL_CALLS: 0,
    DIFF_SUMMARY: "none — starting bytes",
    PIPELINE_STATE: "unknown until phase 2 capture",
    GUARD: guardNow().ok ? "PASS" : "FAIL",
    TYPECHECK: "prior (checkpoint 1)",
    BUILD: "prior (checkpoint 1)",
    LOCAL_VISUAL_CHECK: "see 01-robo-puppy-first-valid.png",
    GROK_REVIEW: "KEEP / PROMISING (human + prior Grok)",
    DECISION: "KEEP",
    WHY: "first valid creative candidate; must never be lost",
  }));
  writeState(state);
  log(`overnight data: ${dir}`);
}

async function phase1(state, log, remain) {
  state.phase = "p1";
  if (remain().calls < 4) {
    state.phase1 = { ok: false, result: "skipped — no call budget" };
    return;
  }
  const specPath = Number(state.round || 1) >= 2
    ? p1TeacherMission({
      id: mid(state, "singularity-night-p1-teacher"),
      lineHint: "(the fillText near the end of fallbackPulse; do not claim it is already gone)",
    })
    : p1FallbackMission({ id: mid(state, "singularity-night-p1-fallback") });
  const status = await runOne(state, specPath, log);
  state.phase1.calls = status.modelCalls;
  const q = quarantineSidecars();
  const guard = guardNow();
  if (!guard.ok) state.totals.guardRejects += 1;
  const cleaned = status.state === "COMPLETE" && !diagnosticStillPresent() && guard.ok && !q.hits.length;
  if (cleaned) {
    const meta = saveNamedCheckpoint("creative-02", { role: "CREATIVE CHECKPOINT 2" });
    const shot = await captureNamed(state, "02-clean-fallback", log);
    const vis = await screenMaybe(state, shot.outPath, "02-clean-fallback");
    state.phase1 = { ...state.phase1, ok: true, result: "PASS — diagnostic sentence removed", sha: meta.sha256 };
    state.lastKeep = "creative-02";
    appendDiary(diaryEntry({
      TIME: new Date().toISOString(),
      CHECKPOINT: "creative-02",
      HYPOTHESIS: "remove fallback diagnostic sentence",
      MODEL_CALLS: status.modelCalls,
      DIFF_SUMMARY: "fallback presentation only (intended)",
      PIPELINE_STATE: shot.cap.pipelineLabel,
      GUARD: "PASS",
      TYPECHECK: status.state,
      BUILD: status.state,
      LOCAL_VISUAL_CHECK: vis.critic?.note || vis.verdict?.fails?.join("; "),
      GROK_REVIEW: "pending screenshot 02-clean-fallback.png",
      DECISION: "KEEP",
      WHY: "mechanical cleanup accepted",
    }));
    logLine(state, "NIGHT [p1] COMPLETE checkpoint=02");
    return;
  }

  logLine(state, `NIGHT [p1] first attempt failed state=${status.state} stillPainted=${diagnosticStillPresent()}`);
  restoreCheckpoint1();
  state.totals.spiralsPrevented += 1;
  if (remain().calls < 4 || (state.phase1.calls || 0) >= CLEANUP_CALL_CAP) {
    state.phase1 = { ...state.phase1, ok: false, result: "FAIL — restored checkpoint 1; no teacher budget" };
    state.lastKeep = "creative-01";
    return;
  }
  state.totals.teacherInterventions += 1;
  state.totals.grokInterventions += 1;
  const src = readSingularity().toString("utf8");
  const line = src.split(/\n/).findIndex((l) => l.includes(DIAGNOSTIC_SENTENCE)) + 1;
  const teacherPath = p1TeacherMission({ lineHint: line > 0 ? `(around line ${line})` : "" });
  const tStatus = await runOne(state, teacherPath, log);
  state.phase1.calls = (state.phase1.calls || 0) + tStatus.modelCalls;
  const guard2 = guardNow();
  const cleaned2 = tStatus.state === "COMPLETE" && !diagnosticStillPresent() && guard2.ok;
  if (cleaned2) {
    const meta = saveNamedCheckpoint("creative-02", { role: "CREATIVE CHECKPOINT 2 after teacher" });
    const shot = await captureNamed(state, "02-clean-fallback", log);
    state.phase1 = { ...state.phase1, ok: true, result: "PASS after teacher", sha: meta.sha256 };
    state.lastKeep = "creative-02";
    appendDiary(diaryEntry({
      TIME: new Date().toISOString(),
      CHECKPOINT: "creative-02",
      HYPOTHESIS: "remove fallback diagnostic sentence (teacher apply)",
      MODEL_CALLS: state.phase1.calls,
      PIPELINE_STATE: shot.cap.pipelineLabel,
      GUARD: "PASS",
      DECISION: "KEEP",
      WHY: "teacher-guided micro cleanup",
    }));
    logLine(state, "NIGHT [p1] COMPLETE after teacher checkpoint=02");
    return;
  }
  restoreCheckpoint1();
  state.lastKeep = "creative-01";
  state.phase1 = { ...state.phase1, ok: false, result: "FAIL — restored checkpoint 1" };
  logLine(state, "NIGHT [p1] RESTORED checkpoint 1");
}

async function phase2(state, log) {
  state.phase = "p2";
  state.totals.grokInterventions += 1;
  log("restarting harness so GL probe is live…");
  await restartHarnessServer({ log });
  const shot = await captureNamed(state, "probe-after-p1", log);
  const probe = shot.cap.status?.probe || shot.meta.cap.probe;
  const truth = truthFromProbe(probe, { webgl2Got: shot.cap.contextOk });
  const evidence = {
    at: new Date().toISOString(),
    truth,
    firstFail: probe?.firstFail || null,
    flags: probe ? {
      WEBGL2_CONTEXT_OK: probe.WEBGL2_CONTEXT_OK,
      SCENE_SHADER_COMPILE_OK: probe.SCENE_SHADER_COMPILE_OK,
      SCENE_PROGRAM_LINK_OK: probe.SCENE_PROGRAM_LINK_OK,
      BRIGHT_PROGRAM_LINK_OK: probe.BRIGHT_PROGRAM_LINK_OK,
      BLUR_PROGRAM_LINK_OK: probe.BLUR_PROGRAM_LINK_OK,
      COMPOSITE_PROGRAM_LINK_OK: probe.COMPOSITE_PROGRAM_LINK_OK,
      FRAMEBUFFER_ALLOC_OK: probe.FRAMEBUFFER_ALLOC_OK,
      SCENE_PASS_EXECUTED: probe.SCENE_PASS_EXECUTED,
      BRIGHT_PASS_EXECUTED: probe.BRIGHT_PASS_EXECUTED,
      BLUR_PASS_EXECUTED: probe.BLUR_PASS_EXECUTED,
      COMPOSITE_PASS_EXECUTED: probe.COMPOSITE_PASS_EXECUTED,
      FALLBACK_USED: probe.FALLBACK_USED,
    } : null,
    shaders: probe?.shaders || [],
    programs: probe?.programs || [],
    draws: probe?.draws || null,
  };
  writeFileSync(join(nightDir(), "evidence", "EVIDENCE.md"), `# Pipeline evidence\n\n\`\`\`json\n${stringifyGlSafe(evidence)}\`\`\`\n`);
  writeFileSync(join(nightDir(), "evidence", "probe.json"), stringifyGlSafe(evidence));
  state.phase2 = {
    summary: "Harness now records per-stage compile/link/FBO/draw. pipelineValid means real passes executed, not merely getContext(webgl2).",
    truth,
  };
  state.phase2Probe = probe;
  logLine(state, `NIGHT [p2] label=${truth.label} firstFail=${describeFirstFail(probe)}`);
}

async function phase3(state, log) {
  state.phase = "p3";
  state.totals.grokInterventions += 1;
  const probe = state.phase2Probe || {};
  const fail = probe.firstFail || null;
  const stage = fail?.stage || (truthFromProbe(probe, {}).realPipeline ? "none — real pipeline" : "unknown");
  const logSummary = describeFirstFail(probe);
  const window = sourceWindow(fail);
  const packet = [
    "# Failure classification",
    "",
    `Stage: ${stage}`,
    "",
    `Log: ${logSummary}`,
    "",
    "Source window:",
    "```",
    window,
    "```",
    "",
    "Context creation is not the primary failure if WEBGL2_CONTEXT_OK is true.",
  ].join("\n");
  writeFileSync(join(nightDir(), "evidence", "CLASSIFICATION.md"), `${packet}\n`);
  state.phase3 = { stage, logSummary, window, fail };
  logLine(state, `NIGHT [p3] stage=${stage}`);
  void log;
}

async function phase4(state, log, remain) {
  state.phase = "p4";
  if (state.realWebgl) {
    logLine(state, "NIGHT [p4] already real — skip");
    return;
  }
  let lastFpSig = null;
  let same = 0;
  let n = 0;
  state.lastPipeline = state.lastKeep || "creative-01";
  while (!state.realWebgl && !state.stop) {
    if (state.phase4.calls >= PIPELINE_CALL_CAP) break;
    if (remain().calls < 6 || remain().ms < 120000) break;
    n += 1;
    const fail = state.phase3?.fail || state.phase2Probe?.firstFail;
    const stage = fail?.stage || "SCENE_SHADER_COMPILE";
    const beforeFp = fingerprintFromProbe({
      firstFail: fail,
      SCENE_SHADER_COMPILE_OK: state.phase2Probe?.SCENE_SHADER_COMPILE_OK === true,
    });
    if (beforeFp.signature === lastFpSig) same += 1;
    else { lastFpSig = beforeFp.signature; same = 1; }
    if (same > 2) {
      state.totals.spiralsPrevented += 1;
      state.phase4.blocker = `same diagnostic signature failed twice: ${beforeFp.signature.slice(0, 180)}`;
      logLine(state, `NIGHT [p4] STOP same fingerprint`);
      break;
    }
    const extra = same === 2 || Number(state.round || 1) >= 2
      ? (/let/i.test(String(fail?.log || ""))
        ? "Teacher: GLSL ES 3.00 does not use JavaScript `let` / `const` in shaders. Use GLSL types (float, vec2, vec3) and ordinary assignment. Also `ro` and `dt` must be declared in GLSL if you assign them."
        : "Teacher: use the compile log literally. Change the smallest GLSL so this stage compiles. Do not rewrite the renderer.")
      : "";
    if (extra) {
      state.totals.teacherInterventions += 1;
      state.totals.grokInterventions += 1;
    }
    const specPath = pipelineRepairMission({
      n,
      id: mid(state, `singularity-night-p4-r${n}`),
      stage,
      log: fail?.log || state.phase3?.logSummary,
      window: sourceWindow(fail),
      extra,
    });
    const before = shaFile(singularityAbs());
    const status = await runOne(state, specPath, log);
    state.phase4.attempts += 1;
    state.phase4.calls += status.modelCalls || 0;
    state.totals.repairAttempts += 1;
    const shot = await captureNamed(state, `pipeline-r${n}`, log);
    const probe = shot.cap.status?.probe;
    state.phase2Probe = probe;
    state.phase3.fail = probe?.firstFail || null;
    state.phase3.stage = probe?.firstFail?.stage || (shot.cap.realPipeline ? "none" : state.phase3.stage);
    const guard = guardNow();
    if (!guard.ok) {
      state.totals.guardRejects += 1;
      restoreNamedCheckpoint(state.lastPipeline);
      state.totals.spiralsPrevented += 1;
      logLine(state, "NIGHT [p4] guard reject — restored last pipeline checkpoint");
      break;
    }
    if (shot.cap.realPipeline) {
      const meta = saveNamedCheckpoint(`pipeline-${String.fromCharCode(64 + n)}`, { role: "real webgl" });
      state.phase4.checkpoints.push(meta.name);
      state.lastPipeline = meta.name;
      state.lastKeep = meta.name;
      const real = await captureNamed(state, "03-first-real-webgl", log);
      await screenMaybe(state, real.outPath, "03-first-real-webgl");
      state.realWebgl = true;
      logLine(state, "NIGHT [p4] REAL WEBGL restored");
      appendDiary(diaryEntry({
        TIME: new Date().toISOString(),
        CHECKPOINT: meta.name,
        HYPOTHESIS: `repair ${stage}`,
        MODEL_CALLS: state.phase4.calls,
        PIPELINE_STATE: "REAL_WEBGL2",
        GUARD: "PASS",
        DECISION: "KEEP",
        WHY: "all meaningful passes executed",
      }));
      break;
    }
    const progressed = compareDiagnostics(beforeFp, fingerprintFromProbe(probe)).progress;
    if (progressed && (status.state === "COMPLETE" || shaFile(singularityAbs()) !== before)) {
      const meta = saveNamedCheckpoint(`pipeline-${String.fromCharCode(64 + n)}`, { role: `progress past ${beforeFp.primary?.ident || stage}` });
      state.phase4.checkpoints.push(meta.name);
      state.lastPipeline = meta.name;
      const afterFp = fingerprintFromProbe(probe);
      logLine(state, `NIGHT [p4] progress ${beforeFp.signature.slice(0, 80)} → ${afterFp.signature.slice(0, 80)}`);
      continue;
    }
    if (shaFile(singularityAbs()) !== before && !progressed) {
      restoreNamedCheckpoint(state.lastPipeline);
      state.totals.spiralsPrevented += 1;
      logLine(state, `NIGHT [p4] no progress on ${stage} — restored ${state.lastPipeline}`);
    }
  }
  if (!state.realWebgl) {
    try { restoreNamedCheckpoint(state.lastPipeline); } catch { restoreCheckpoint1(); }
    state.phase4.blocker = state.phase4.blocker || describeFirstFail(state.phase2Probe);
    logLine(state, `NIGHT [p4] unresolved ${state.phase4.blocker}`);
  }
  state.phase4.done = true;
}

async function phase5(state, log, remain) {
  state.phase = "p5";
  const track = state.realWebgl ? "REAL_WEBGL2" : "FALLBACK";
  logLine(state, `NIGHT [p5] track=${track}`);
  let n = 0;
  let consecutiveRevert = 0;
  for (const hypothesis of HYPOTHESES) {
    if (state.stop) break;
    if (remain().calls < 6 || remain().ms < 180000) break;
    n += 1;
    state.phase5.hypothesesTried = n;
    const specPath = creativeMission({
      n,
      id: mid(state, `singularity-night-p5-h${n}`),
      hypothesis,
      track,
      previousNote: consecutiveRevert ? "Previous candidate was reverted. Try a different implementation, not a pile of extra ideas." : "",
    });
    const keepName = state.lastKeep || "creative-01";
    const status = await runOne(state, specPath, log);
    state.totals.edits += 1;
    const guard = guardNow();
    const q = quarantineSidecars();
    const shotName = `${String(3 + n).padStart(2, "0")}-iteration-${n}`;
    const shot = await captureNamed(state, shotName, log);
    const vis = await screenMaybe(state, shot.outPath, shotName);
    const mechanical = status.state === "COMPLETE" && guard.ok && !q.hits.length;
    const visuallyBroken = shot.cap.stats?.likelyBlack || vis.critic?.visible === false || vis.critic?.brightCore === false;
    if (!mechanical) {
      state.phase5.invalid += 1;
      restoreNamedCheckpoint(keepName);
      consecutiveRevert += 1;
      state.totals.spiralsPrevented += 1;
      logLine(state, `NIGHT [p5] INVALID ${hypothesis.id} — reverted ${keepName}`);
      appendDiary(diaryEntry({
        TIME: new Date().toISOString(),
        CHECKPOINT: keepName,
        HYPOTHESIS: hypothesis.prompt,
        MODEL_CALLS: status.modelCalls,
        PIPELINE_STATE: shot.cap.pipelineLabel,
        GUARD: guard.ok ? "PASS" : formatGuard(guard),
        DECISION: "REVERT",
        WHY: `mechanically invalid (${status.state})`,
      }));
      continue;
    }
    if (visuallyBroken) {
      state.phase5.reverted += 1;
      restoreNamedCheckpoint(keepName);
      consecutiveRevert += 1;
      logLine(state, `NIGHT [p5] REVERT ${hypothesis.id} visual break`);
      appendDiary(diaryEntry({
        TIME: new Date().toISOString(),
        CHECKPOINT: keepName,
        HYPOTHESIS: hypothesis.prompt,
        MODEL_CALLS: status.modelCalls,
        PIPELINE_STATE: shot.cap.pipelineLabel,
        LOCAL_VISUAL_CHECK: vis.critic?.note || vis.verdict?.fails?.join("; "),
        DECISION: "REVERT",
        WHY: "black / missing core / unusable frame",
      }));
      if (consecutiveRevert >= 2 && state.phase5.accepted >= 1) break;
      continue;
    }
    const meta = saveNamedCheckpoint(`creative-h${n}`, { hypothesis: hypothesis.id, track });
    state.lastKeep = meta.name;
    state.phase5.accepted += 1;
    consecutiveRevert = 0;
    if (!state.best || state.phase5.accepted === 1) {
      state.best = { name: meta.name, sha: meta.sha256, hypothesis: hypothesis.id, png: shot.outPath };
    } else {
      state.best = { name: meta.name, sha: meta.sha256, hypothesis: hypothesis.id, png: shot.outPath };
    }
    appendDiary(diaryEntry({
      TIME: new Date().toISOString(),
      CHECKPOINT: meta.name,
      HYPOTHESIS: hypothesis.prompt,
      MODEL_CALLS: status.modelCalls,
      PIPELINE_STATE: shot.cap.pipelineLabel,
      GUARD: "PASS",
      TYPECHECK: "PASS",
      BUILD: "PASS",
      LOCAL_VISUAL_CHECK: vis.critic?.note || "",
      GROK_REVIEW: state.phase5.accepted % 2 === 0 ? "due — recorded for morning" : "skipped (every 2)",
      DECISION: "KEEP",
      WHY: `one hypothesis (${hypothesis.category}) mechanically valid`,
    }));
    logLine(state, `NIGHT [p5] KEEP ${hypothesis.id} ${meta.sha256.slice(0, 12)}`);
  }
  if (state.lastKeep) {
    try { restoreNamedCheckpoint(state.lastKeep); } catch { /* keep current */ }
  }
  state.phase5.done = true;
}

function formatGuard(g) {
  return (g.errors || []).join("; ") || "FAIL";
}

async function toolingQueue(state, log) {
  state.phase = "tooling-queue";
  const lessons = [
    "# Lessons from the singularity night shift",
    "",
    "- One concrete objective per mission. Bundling fallback + shaders + harness invented fields is the failure signature.",
    "- Context OK is not scene execution. Trust per-stage probe flags.",
    "- Sidecar .bak files are always unauthorized. The runner is the backup.",
    "- Creative iteration is KEEP / REVISE / REVERT / UNCERTAIN. Invalid → one repair → revert.",
    `- Track this night: ${state.realWebgl ? "REAL_WEBGL2" : "FALLBACK (honest)"}`,
    `- Unresolved pipeline blocker: ${state.phase4?.blocker || "none"}`,
  ].join("\n");
  writeFileSync(join(nightDir(), "LESSONS.md"), `${lessons}\n`);
  writeFileSync(join(nightDir(), "diary", "compare.json"), `${JSON.stringify({
    at: new Date().toISOString(),
    screenshots: state.screenshotList,
    best: state.best || null,
    realWebgl: state.realWebgl,
  }, null, 2)}\n`);
  state.toolingQueueDone = true;
  log("tooling queue: diary metadata + lessons written");
}

function diffVsCp1() {
  try {
    return execFileSync("git", ["diff", "--no-index", "--stat", join(nightDir(), "checkpoints/creative-01/singularity.ts"), singularityAbs()], {
      cwd: repoRoot,
      encoding: "utf8",
    });
  } catch (e) {
    return String(e.stdout || e.message || e);
  }
}

async function finish(state, log = console.log) {
  state.endedAt = new Date().toISOString();
  state.end = { audioPlaygroundPorcelain: audioPlaygroundPorcelain(), parked: fingerprintParked() };
  state.diffSummary = diffVsCp1();
  state.productionChanged = SINGULARITY_REL;
  state.toolingChanged = "tools/killchain-ai/harness/*, tools/killchain-ai/src/overnight/*, captureHarness probe fields, sidecar policy";
  state.productionDrift = parkedUnchanged(state.start.parked).ok
    ? "parked UI unchanged; only singularity.ts is authorized production"
    : "STOP — parked UI drifted";
  state.puppyStatus = (state.missions || []).slice(-1)[0]?.state || "idle";
  state.successLevel = scoreSuccess(state);
  state.autonomyLevel = `chained ${state.missions.length} bounded missions; Grok interventions=${state.totals.grokInterventions}; Qwen calls=${state.totals.qwenCalls}`;
  state.lessons = {
    puppyWeakness: "still likely to over-scope if a prompt contains more than one concrete objective",
    foremanWeakness: "mission state machine spends ~6 calls before a one-line edit; overnight must not interpret that floor as a spiral",
    creative: "senior decomposition + one hypothesis per iteration is the actual experiment, not a giant shader prompt",
    anotherMission: state.phase1?.ok || state.realWebgl || (state.phase5?.accepted || 0) > 0
      ? "yes — another tightly bounded visualizer mission, still one objective at a time"
      : "only after another night of small engineering jobs; do not jump to a new subsystem",
  };
  state.lookFirst = [
    join(nightDir(), "MORNING_REPORT.md"),
    join(nightDir(), "diary", "DIARY.md"),
    state.screenshots["02-clean-fallback"] || "(no 02)",
    state.screenshots["03-first-real-webgl"] || "(no real webgl capture)",
    state.best?.png || "(no later candidate)",
  ].join("\n");
  state.diarySummary = (state.screenshotList || []).join("\n") || "see diary/";
  if (!state.best) {
    const keep = state.lastKeep || "creative-01";
    const file = join(nightDir(), "checkpoints", keep, "singularity.ts");
    state.best = {
      name: keep,
      sha: existsSync(file) ? shaFile(file) : CP1_SHA,
      compare: "final is checkpoint 1 or 2 unless later KEEP exists",
    };
  } else {
    state.best.compare = "Compare 00-original-baseline.png, 01-robo-puppy-first-valid.png, 02-clean-fallback.png, and the last KEEP. Do not pretend fallback is WebGL.";
  }
  const report = writeMorningReport(state);
  writeState(state);
  logLine(state, `NIGHT DONE level=${state.successLevel} report=${report}`);
  log(`morning report: ${report}`);
  return state;
}

export async function runSingularityNight({
  log = console.log,
  maxCalls = 100,
  maxMs = 7 * 60 * 60 * 1000,
  stopAfter = null,
  continueNight = false,
} = {}) {
  const t0 = Date.now();
  let state = initState(continueNight ? null : readState());
  if (continueNight) {
    const prev = readState();
    if (prev?.start) {
      state = continueState(prev);
      logLine(state, `CONTINUE round=${state.round} priorCalls=${state.totals.qwenCalls}`);
    }
  }
  const remain = () => ({ calls: maxCalls - state.totals.qwenCalls, ms: maxMs - (Date.now() - t0) });
  const onStop = () => { state.stop = true; logLine(state, "SIGINT — will write morning report"); };
  process.once("SIGINT", onStop);
  try {
    await setup(state, log);
    if (stopAfter === "setup" || state.stop) return finish(state, log);
    if (!state.phase1?.result) await phase1(state, log, remain);
    if (stopAfter === "p1" || state.stop) return finish(state, log);
    if (!state.phase2?.summary) await phase2(state, log);
    if (stopAfter === "p2" || state.stop) return finish(state, log);
    if (!state.phase3?.stage) await phase3(state, log);
    if (stopAfter === "p3" || state.stop) return finish(state, log);
    if (!state.phase4?.done) await phase4(state, log, remain);
    if (stopAfter === "p4" || state.stop) return finish(state, log);
    if (!state.phase5?.done) await phase5(state, log, remain);
    if (stopAfter === "p5" || state.stop) return finish(state, log);
    if (!state.toolingQueueDone) await toolingQueue(state, log);
    return finish(state, log);
  } catch (err) {
    state.fatal = String(err.message || err);
    logLine(state, `FATAL ${state.fatal}`);
    log(`overnight fatal: ${state.fatal}`);
    return finish(state, log);
  } finally {
    process.removeListener("SIGINT", onStop);
  }
}
