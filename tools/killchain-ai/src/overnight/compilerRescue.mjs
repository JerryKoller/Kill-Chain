/**
 * Compiler-mechanic rescue for the real WebGL Singularity scene shader.
 * Not a creative overnight. One diagnostic family per mission.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { dataDir, missionsDataDir, repoRoot } from "../paths.mjs";
import { runMission } from "../mission/runner.mjs";
import { parseMissionFile } from "../mission/schema.mjs";
import {
  captureHarnessFrame,
  ensureHarnessServer,
  restartHarnessServer,
} from "../ui/captureHarness.mjs";
import { stringifyGlSafe, sanitizeGlText } from "./probeShape.mjs";
import {
  compareDiagnostics,
  fingerprintFromProbe,
} from "./diagnosticFingerprint.mjs";
import { glslMicroRepairMission } from "./specs.mjs";
import {
  CP1_SHA,
  SINGULARITY_REL,
  sha256,
  shaFile,
  singularityAbs,
  fingerprintParked,
  parkedUnchanged,
  restoreCheckpoint1,
  saveNamedCheckpoint,
  restoreNamedCheckpoint,
  guardNow,
  quarantineSidecars,
  startingGit,
  audioPlaygroundPorcelain,
  readSingularity,
  writeSingularity,
  nightDir,
} from "./yard.mjs";
import { gitCapture, gitRun } from "../git.mjs";

export const PIPELINE_A_SHA = "01c82ee09184ad2a200946b5da2780beff87420c8b689ec1e4c9974d2c6c0f68";
export const MAX_FAMILIES = 4;
export const MAX_CALLS = 40;
export const CALLS_PER_MISSION = 18;
export const RESCUE_ID = "singularity-glsl-rescue";

export function pipelineAPath() {
  return join(nightDir(), "checkpoints", "pipeline-A", "singularity.ts");
}

export function rescueDir() {
  const dir = join(dataDir, "overnight", RESCUE_ID);
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, "diary"), { recursive: true });
  mkdirSync(join(dir, "checkpoints"), { recursive: true });
  mkdirSync(join(dir, "evidence"), { recursive: true });
  mkdirSync(join(dir, "quarantine"), { recursive: true });
  return dir;
}

function logLine(state, msg) {
  const line = `${new Date().toISOString()}  ${msg}`;
  const p = join(rescueDir(), "RESCUE.log");
  const prev = existsSync(p) ? readFileSync(p, "utf8") : "";
  writeFileSync(p, `${prev}${line}\n`);
  (state.events || (state.events = [])).push(line);
  writeFileSync(join(rescueDir(), "state.json"), `${stringifyGlSafe(state)}`);
  return line;
}

function clipWindow(text, maxLines = 40) {
  const lines = sanitizeGlText(text).split(/\n/);
  if (lines.length <= maxLines) return lines.join("\n");
  return lines.slice(0, maxLines).join("\n");
}

function sourceWindow(fail) {
  if (fail?.srcWindow) return clipWindow(fail.srcWindow, 40);
  return "(no window)";
}

function familyLabel(fp) {
  const undeclared = (fp?.items || [])
    .filter((i) => /undeclared identifier/i.test(i.message || ""))
    .map((i) => i.ident)
    .filter(Boolean);
  const uniq = [...new Set((undeclared.length ? undeclared : (fp?.idents || [])).map((s) => String(s).toLowerCase()))];
  if (uniq.length) return uniq.slice(0, 4).join("/");
  if (fp?.primary?.message) return sanitizeGlText(fp.primary.message).slice(0, 40);
  return fp?.stage || "scene-compile";
}

function missionCheckpointDir() {
  return join(missionsDataDir, RESCUE_ID, "checkpoints", "pipeline-A");
}

export function installPipelineAMissionBase() {
  const src = pipelineAPath();
  if (!existsSync(src)) throw new Error(`pipeline-A missing: ${src}`);
  const buf = readFileSync(src);
  const sha = sha256(buf);
  if (sha !== PIPELINE_A_SHA) {
    throw new Error(`pipeline-A hash mismatch: ${sha} expected ${PIPELINE_A_SHA}`);
  }
  const cp1Still = join(nightDir(), "checkpoints", "creative-01", "singularity.ts");
  if (existsSync(cp1Still) && shaFile(cp1Still) !== CP1_SHA) {
    throw new Error("CREATIVE CHECKPOINT 1 artifact was altered");
  }
  const cdir = missionCheckpointDir();
  const dest = join(cdir, "files", SINGULARITY_REL);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, buf);
  writeFileSync(join(cdir, "files.txt"), `${SINGULARITY_REL}\n`);
  writeFileSync(join(cdir, "meta.json"), stringifyGlSafe({
    role: "PIPELINE-A mission base (Robo Puppy let→float)",
    sha256: sha,
    source: src,
    preservedCreative01: CP1_SHA,
  }));
  const session = join(rescueDir(), "checkpoints", "pipeline-A");
  mkdirSync(session, { recursive: true });
  copyFileSync(src, join(session, "singularity.ts"));
  writeFileSync(join(session, "meta.json"), stringifyGlSafe({ name: "pipeline-A", sha256: sha }));
  writeSingularity(buf);
  return { sha, src, missionCheckpoint: `${RESCUE_ID}/checkpoints/pipeline-A`, live: shaFile(singularityAbs()) };
}

async function captureProbe(state, name, log) {
  await restartHarnessServer({ log });
  const server = await ensureHarnessServer({ log });
  const outPath = join(rescueDir(), "diary", `${name}.png`);
  const cap = await captureHarnessFrame({ origin: server.origin, outPath, log });
  const probe = cap.status?.probe || null;
  const fp = fingerprintFromProbe(probe);
  const rec = {
    at: new Date().toISOString(),
    name,
    ok: cap.ok,
    contextOk: cap.contextOk,
    realPipeline: cap.realPipeline,
    pipelineLabel: cap.pipelineLabel,
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
    firstFail: probe?.firstFail || null,
    fingerprint: fp,
  };
  writeFileSync(join(rescueDir(), "diary", `${name}.json`), stringifyGlSafe(rec));
  state.captures.push(rec);
  logLine(state, `CAPTURE ${name} compileOk=${fp.compileOk} sig=${fp.signature.slice(0, 120)}`);
  return { cap, probe, fp, outPath, rec };
}

async function runOne(state, specPath, log) {
  const parsed = parseMissionFile(specPath);
  if (!parsed.ok) throw new Error(`invalid mission ${specPath}: ${parsed.errors.join("; ")}`);
  logLine(state, `MISSION START ${parsed.spec.id} maxModelCalls=${parsed.spec.maxModelCalls}`);
  const before = shaFile(singularityAbs());
  const status = await runMission({ specPath, log });
  const after = shaFile(singularityAbs());
  const calls = Number(status.modelCalls || 0);
  state.totals.qwenCalls += calls;
  const empty = before === after;
  if (empty) state.totals.emptyEdits += 1;
  else state.totals.editAttempts += 1;
  const q = quarantineSidecars();
  if (q.hits.length) {
    state.totals.sidecars += q.hits.length;
    logLine(state, `SIDECAR quarantined ${q.hits.join(", ")}`);
  }
  const parked = parkedUnchanged(state.start.parked);
  if (!parked.ok) {
    state.stop = true;
    state.fatal = `parked Fire Command UI changed`;
    throw new Error(state.fatal);
  }
  state.missions.push({
    id: status.missionId,
    state: status.state,
    calls,
    empty,
    before,
    after,
    blocked: status.blockedReason || "",
    emptyEdits: status.emptyEdits || 0,
  });
  logLine(state, `MISSION END ${status.missionId} → ${status.state} calls=${calls} empty=${empty}`);
  writeFileSync(join(rescueDir(), "state.json"), stringifyGlSafe(state));
  return { status, empty, before, after, calls };
}

function writeRescueReport(state) {
  const parkedEnd = fingerprintParked();
  const git = gitCapture();
  const porcelain = gitRun(["status", "--porcelain"], { allowFail: true }) || "";
  const last = state.families[state.families.length - 1] || null;
  const items = [
    ["1. NUL sanitization implementation/result", state.tooling.nul],
    ["2. diagnostic fingerprint implementation", state.tooling.fingerprint],
    ["3. test count", state.tooling.testCount],
    ["4. pipeline-A exact hash/path", `${PIPELINE_A_SHA}\n${pipelineAPath()}`],
    ["5. starting compiler diagnostics", state.startFp?.signature],
    ["6. Qwen calls used", state.totals.qwenCalls],
    ["7. actual edit attempts", state.totals.editAttempts],
    ["8. empty edits", state.totals.emptyEdits],
    ["9. sidecar violations", state.totals.sidecars],
    ["10. first repair diff summary", state.firstDiff || "(none)"],
    ["11. before diagnostic fingerprint", JSON.stringify(state.startFp, null, 2)],
    ["12. after diagnostic fingerprint", JSON.stringify(state.endFp, null, 2)],
    ["13. whether ro disappeared", String(state.roGone)],
    ["14. whether dt disappeared", String(state.dtGone)],
    ["15. whether diagnostics advanced", String(state.advanced)],
    ["16. every successive compiler error family", (state.families || []).map((f) => `${f.id} ${f.kind} ${f.family}`).join("\n") || "none"],
    ["17. pipeline checkpoints preserved", (state.checkpoints || []).join(", ") || "none"],
    ["18. whether scene shader compiled", String(Boolean(state.endFlags?.SCENE_SHADER_COMPILE_OK))],
    ["19. whether scene program linked", String(Boolean(state.endFlags?.SCENE_PROGRAM_LINK_OK))],
    ["20. whether full WebGL pipeline executed", String(Boolean(state.realWebgl))],
    ["21. screenshot path if restored", state.realPng || "(none)"],
    ["22. production files changed", SINGULARITY_REL],
    ["23. parked UI hash check", JSON.stringify({ start: state.start.parked, end: parkedEnd }, null, 2)],
    ["24. audio-playground untouched", `start=${state.start.audioPlaygroundPorcelain || ""}\nend=${audioPlaygroundPorcelain()}`],
    ["25. final Git state", `${git.branch} ${git.short}\n${porcelain}`],
    ["26. current Robo Puppy status", last?.missionState || (state.missions.slice(-1)[0]?.state || "idle")],
    ["27. exact next micro-task if pipeline remains broken", state.nextTask || "(none — scene compiled or budget exhausted)"],
  ];
  const md = [
    "# Singularity GLSL compiler rescue",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Live singularity.ts sha256: \`${shaFile(singularityAbs())}\``,
    `Creative Checkpoint 1 still: \`${CP1_SHA}\``,
    "",
    "This was not a creative mission.",
    "",
    ...items.flatMap(([k, v]) => [`## ${k}`, "", sanitizeGlText(String(v ?? "n/a")), ""]),
  ].join("\n");
  const out = join(rescueDir(), "RESCUE_REPORT.md");
  writeFileSync(out, sanitizeGlText(md), "utf8");
  return out;
}

export async function runCompilerRescue({
  log = console.log,
  maxCalls = MAX_CALLS,
  maxFamilies = MAX_FAMILIES,
  testCount = null,
  idPrefix = "singularity-glsl",
} = {}) {
  const state = {
    startedAt: new Date().toISOString(),
    start: { ...startingGit(), parked: fingerprintParked() },
    totals: { qwenCalls: 0, editAttempts: 0, emptyEdits: 0, sidecars: 0 },
    missions: [],
    families: [],
    checkpoints: ["creative-01 (preserved)", "pipeline-A (mission base)"],
    captures: [],
    events: [],
    tooling: {
      nul: "sanitizeGlText + sanitizeGlTree; OpenCode argv; teacher packets; harness probe; reports",
      fingerprint: "tools/killchain-ai/src/overnight/diagnosticFingerprint.mjs — stage+idents+lines; let→ro/dt is PROGRESS",
      testCount,
    },
    realWebgl: false,
    stop: false,
    fatal: null,
  };
  writeFileSync(join(rescueDir(), "state.json"), stringifyGlSafe(state));

  const installed = installPipelineAMissionBase();
  state.pipelineA = installed;
  logLine(state, `INSTALLED pipeline-A ${installed.sha} live=${installed.live} cp1-preserved`);
  log(`pipeline-A installed as live candidate; Checkpoint 1 artifact untouched`);

  const shot0 = await captureProbe(state, "00-pipeline-A-before", log);
  state.startFp = shot0.fp;
  state.startFlags = shot0.rec.flags;
  writeFileSync(join(rescueDir(), "evidence", "START.json"), stringifyGlSafe(shot0.rec));

  let familyIndex = 0;
  const baseMeta = saveNamedCheckpoint("rescue-0", { role: "PIPELINE-A live install; do not overwrite pipeline-A" });
  let lastKeep = "rescue-0";
  state.checkpoints.push(`rescue-0 ${baseMeta.sha256}`);

  while (!state.stop && familyIndex < maxFamilies && state.totals.qwenCalls + 6 <= maxCalls) {
    const current = await captureProbe(state, `family-${familyIndex + 1}-before`, log);
    if (current.fp.compileOk) {
      logLine(state, "SCENE shader compiles — stop compiler chain");
      break;
    }
    familyIndex += 1;
    const fam = familyLabel(current.fp);
    const beforeFp = current.fp;
    const beforeSha = shaFile(singularityAbs());
    const id = `${idPrefix}-f${familyIndex}`;
    const specPath = glslMicroRepairMission({
      id,
      family: fam,
      log: current.probe?.firstFail?.log || "",
      window: sourceWindow(current.probe?.firstFail),
      adoptCheckpoint: familyIndex === 1 ? `${RESCUE_ID}/checkpoints/pipeline-A` : "",
      extra: "Do not introduce new undeclared identifiers. Follow-on mix/assign/field errors are usually symptoms of the undeclared names in this log. Declare each undeclared name with a GLSL ES 3.00 type, or remove the statement that uses it.",
    });
    log(`family ${familyIndex}: ${fam}`);
    let run = await runOne(state, specPath, log);
    if (run.empty) {
      logLine(state, `EMPTY_EDIT ${id}`);
      const retryId = `${id}-empty`;
      const retryPath = glslMicroRepairMission({
        id: retryId,
        family: fam,
        log: current.probe?.firstFail?.log || "",
        window: sourceWindow(current.probe?.firstFail),
        emptyRetry: true,
      });
      run = await runOne(state, retryPath, log);
    }

    const afterShot = await captureProbe(state, `family-${familyIndex}-after`, log);
    const cmp = compareDiagnostics(beforeFp, afterShot.fp);
    const afterSha = shaFile(singularityAbs());
    const guard = guardNow();
    if (!state.firstDiff && afterSha !== beforeSha) {
      try {
        const { execFileSync } = await import("node:child_process");
        state.firstDiff = execFileSync("git", ["diff", "--no-index", "--stat",
          join(rescueDir(), "checkpoints", "pipeline-A", "singularity.ts"),
          singularityAbs(),
        ], { cwd: repoRoot, encoding: "utf8" });
      } catch (e) {
        state.firstDiff = String(e.stdout || e.message || "").slice(0, 800);
      }
    }

    const rec = {
      id: familyIndex,
      family: fam,
      kind: cmp.kind,
      reasons: cmp.reasons,
      missionState: run.status.state,
      calls: run.calls,
      shaBefore: beforeSha,
      shaAfter: afterSha,
      beforeSig: beforeFp.signature,
      afterSig: afterShot.fp.signature,
      compileOk: afterShot.fp.compileOk,
    };
    state.families.push(rec);
    logLine(state, `FAMILY ${familyIndex} ${fam} → ${cmp.kind} (${cmp.reasons.join("; ")})`);

    if (!guard.ok) {
      restoreNamedCheckpoint(lastKeep);
      logLine(state, "guard reject — restored last keep");
      state.nextTask = `guard failed; last keep ${lastKeep}`;
      break;
    }

    if (cmp.regress) {
      restoreNamedCheckpoint(lastKeep);
      logLine(state, `REGRESS — restored ${lastKeep}`);
      rec.restored = lastKeep;
      break;
    }

    if (cmp.progress || cmp.success) {
      const name = `rescue-${familyIndex}`;
      const meta = saveNamedCheckpoint(name, { role: cmp.success ? "scene compile ok" : `progress ${fam}` });
      const nightCp = join(nightDir(), "checkpoints", name, "singularity.ts");
      if (existsSync(nightCp)) {
        const dest = join(rescueDir(), "checkpoints", name);
        mkdirSync(dest, { recursive: true });
        copyFileSync(nightCp, join(dest, "singularity.ts"));
      }
      state.checkpoints.push(`${name} ${meta.sha256}`);
      lastKeep = name;
      rec.checkpoint = name;
      rec.sha = meta.sha256;
      if (cmp.success) break;
      continue;
    }

    // UNCHANGED: one focused retry then block this family
    if (state.totals.qwenCalls + 6 > maxCalls) break;
    const retry2Path = glslMicroRepairMission({
      id: `${id}-retry`,
      family: fam,
      log: afterShot.probe?.firstFail?.log || current.probe?.firstFail?.log || "",
      window: sourceWindow(afterShot.probe?.firstFail || current.probe?.firstFail),
    });
    const retry2 = await runOne(state, retry2Path, log);
    const after2 = await captureProbe(state, `family-${familyIndex}-retry`, log);
    const cmp2 = compareDiagnostics(beforeFp, after2.fp);
    rec.retryKind = cmp2.kind;
    rec.retryState = retry2.status.state;
    if (cmp2.regress) {
      restoreNamedCheckpoint(lastKeep);
      logLine(state, `RETRY REGRESS — restored ${lastKeep}`);
      break;
    }
    if (cmp2.progress || cmp2.success) {
      const name = `rescue-${familyIndex}`;
      saveNamedCheckpoint(name, { role: `progress after retry ${fam}` });
      state.checkpoints.push(name);
      lastKeep = name;
      rec.checkpoint = name;
      rec.kind = cmp2.kind;
      if (cmp2.success) break;
      continue;
    }
    restoreNamedCheckpoint(lastKeep);
    logLine(state, `FAMILY ${familyIndex} BLOCK unchanged after retry — restored ${lastKeep}`);
    rec.blocked = true;
    break;
  }

  const finalShot = await captureProbe(state, "99-final", log);
  state.endFp = finalShot.fp;
  state.endFlags = finalShot.rec.flags;
  const startIdents = new Set((state.startFp?.idents || []).map((s) => s.toLowerCase()));
  const endIdents = new Set((state.endFp?.idents || []).map((s) => s.toLowerCase()));
  state.roGone = startIdents.has("ro") && !endIdents.has("ro");
  state.dtGone = startIdents.has("dt") && !endIdents.has("dt");
  const cmpAll = compareDiagnostics(state.startFp, state.endFp);
  state.advanced = cmpAll.progress || cmpAll.success;

  if (finalShot.fp.compileOk) {
    logLine(state, "SCENE compiled — running pipeline telemetry");
    const tel = finalShot.rec.flags || {};
    state.sceneLinked = Boolean(tel.SCENE_PROGRAM_LINK_OK);
    state.realWebgl = Boolean(
      tel.SCENE_PASS_EXECUTED && tel.BRIGHT_PASS_EXECUTED && tel.BLUR_PASS_EXECUTED && tel.COMPOSITE_PASS_EXECUTED,
    );
    if (state.realWebgl) {
      const png = join(rescueDir(), "diary", "04-first-restored-real-webgl.png");
      const { copyFileSync: cp } = await import("node:fs");
      cp(finalShot.outPath, png);
      state.realPng = png;
      logLine(state, `REAL WEBGL captured ${png}`);
      log("real WebGL pipeline executed — stopping. No visual polish.");
    } else {
      const next = !tel.SCENE_PROGRAM_LINK_OK
        ? "SCENE_PROGRAM_LINK"
        : !tel.FRAMEBUFFER_ALLOC_OK
          ? "FRAMEBUFFER_ALLOC"
          : !tel.SCENE_PASS_EXECUTED
            ? "SCENE_PASS"
            : !tel.BRIGHT_PASS_EXECUTED
              ? "BRIGHT_PASS"
              : !tel.BLUR_PASS_EXECUTED
                ? "BLUR_PASS"
                : "COMPOSITE_PASS";
      state.nextTask = `Scene shader compiled. Next failed stage: ${next}. Do not start creative work.`;
    }
  } else if (!state.nextTask) {
    const fam = familyLabel(state.endFp);
    state.nextTask = `Resolve the current ${fam} compiler failure in the scene fragment shader. Give Puppy the sanitized log + ~20–40 line GLSL window only.`;
  }

  if (!state.advanced && shaFile(singularityAbs()) !== PIPELINE_A_SHA && shaFile(singularityAbs()) !== CP1_SHA) {
    try { restoreNamedCheckpoint(lastKeep); } catch { writeSingularity(readFileSync(pipelineAPath())); }
  }

  state.endedAt = new Date().toISOString();
  state.liveSha = shaFile(singularityAbs());
  state.cp1Live = state.liveSha === CP1_SHA;
  const report = writeRescueReport(state);
  logLine(state, `DONE report=${report}`);
  log(`rescue report: ${report}`);
  return state;
}
