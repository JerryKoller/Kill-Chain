import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { missionsDataDir, repoRoot } from "../paths.mjs";
import { gitCapture } from "../git.mjs";
import { buildCorpus } from "../corpus/build.mjs";
import { DEFAULT_MISSION_MODEL, normalizeModelId } from "./model.mjs";
import { parseMissionFile, pathEditable } from "./schema.mjs";
import { isTerminal } from "./machine.mjs";
import {
  appendJournal,
  clearLock,
  createMissionStore,
  loadMission,
  pidAlive,
  readLock,
  readText,
  saveStatus,
  transition,
  writeLock,
  writeText,
} from "./store.mjs";
import { runPreflight } from "./preflight.mjs";
import { runValidation, validationSummary } from "./validate.mjs";
import { parseOpenCodeJsonl, runOpenCode, visibleReportTooThin, buriedVerdict } from "./opencode.mjs";
import {
  applyRepairPrompt,
  criticPrompt,
  criticFormatRepairPrompt,
  criticNeedsEvidencePrompt,
  criticEvidenceGatherPrompt,
  executePrompt,
  emptyEditRetryPrompt,
  emptyTextRetryPrompt,
  finalPrompt,
  investigatePrompt,
  planPrompt,
  proposalPrompt,
  repairDiagnosePrompt,
} from "./prompts.mjs";
import { classifyEditOutcome, emptyEditPolicy, shouldExpectEdit } from "./editGate.mjs";
import { callBudgetHit, canEnterEditing, refuseEditingReason } from "./callBudget.mjs";
import { checkChangedTsSyntax, formatDiagnostics, formatStructures } from "./syntax.mjs";
import { checkChangedIdentifiers, formatIdentifierPacket } from "./identifierGate.mjs";
import { ACTIONS, classifyFailure, describeFailure, escalate } from "./failureClass.mjs";
import { buildTeacherPacket, writeTeacherPacket } from "./teacherPacket.mjs";
import { evaluateArtifactGate, evaluateCriticGate, checkInventedSymbolsAsync, checkProposalConcrete, proposalScopeCheck, quarantineFitsDest, unionToolNames, mergeCriticRepair } from "./critic.mjs";
import { classifyGateFailure, criticFormatPacket, criticEvidenceGatherPacket, criticNeedsEvidencePacket, planCriticDisposition, PLAN_CRITIC_ACTION, referencePacket, emptyEditPacket, locateSymbols, nearestValidReferences } from "./tutor.mjs";
import {
  fileSizeOk,
  gitDiffCheck,
  gitAllowedAppDiffStat,
  gitPorcelain,
  restoreMissingCheckpointFiles,
  revertUnauthorized,
  snapshotWorktree,
  unexpectedJunk,
} from "./gitops.mjs";
import {
  captureBaseline,
  capturePhaseSnapshot,
  createFsIo,
  enforcePhaseDelta,
  loadAttribution,
  persistTotalMissionDiff,
  resolveAdoption,
  restoreSnapshot,
  saveAttribution,
  writeLosslessCheckpoint,
} from "./attribution.mjs";

function nowMs() {
  return Date.now();
}

function elapsed(status) {
  const t0 = Date.parse(status.startedAt);
  return Number.isFinite(t0) ? nowMs() - t0 : 0;
}

function block(dir, status, reason) {
  status.blockedReason = reason;
  transition(dir, status, "BLOCKED", reason);
  writeText(dir, "FINAL_REPORT.md", composeReport(status, { extra: `BLOCKED: ${reason}` }));
  return status;
}

function fail(dir, status, reason) {
  status.failedReason = reason;
  transition(dir, status, "FAILED", reason);
  writeText(dir, "FINAL_REPORT.md", composeReport(status, { extra: `FAILED: ${reason}` }));
  return status;
}

function budgetHit(spec, status, extra = {}) {
  if (elapsed(status) >= spec.maxWallClockMs) return `maxWallClockMs ${spec.maxWallClockMs}`;
  if (status.phaseIndex > spec.maxPhases) return `maxPhases ${spec.maxPhases}`;
  return callBudgetHit(spec, status, extra);
}

function composeReport(status, { extra = "" } = {}) {
  const spec = status._spec || {};
  return `# FINAL_REPORT — ${status.missionId}

- state: ${status.state}
- dryRun: ${status.dryRun}
- started: ${status.startedAt}
- ended: ${status.endedAt || "(running)"}
- durationMs: ${elapsed(status)}
- model: ${status.model || DEFAULT_MISSION_MODEL}
- modelCalls: ${status.modelCalls}
- planRetries: ${status.planRetries}
- editRetries: ${status.editRetries}
- repairRetries: ${status.repairRetries}
- emptyEdits: ${status.emptyEdits || 0}
- emptyEditRetriesSucceeded: ${status.emptyEditRetriesSucceeded || 0}
- describedButDidNotApply: ${status.describedButDidNotApply || 0}
- syntaxFailures: ${status.syntaxFailures || 0}
- syntaxRepairs: ${status.syntaxRepairs || 0}
- transactionalRollbacks: ${status.transactionalRollbacks || 0}
- typecheckCycles: ${status.typecheckCycles || 0}
- buildCycles: ${status.buildCycles || 0}
- unixViolations: ${status.unixViolations}
- mcpFirstMisses: ${status.mcpFirstMisses}
- visibleTextMisses: ${status.visibleTextMisses}
- readOnlyViolations: ${status.readOnlyViolations || 0}
- automaticRestores: ${status.automaticRestores || 0}
- headAtStart: ${status.headAtStart}
- branchAtStart: ${status.branchAtStart}
- blockedReason: ${status.blockedReason || ""}
- failedReason: ${status.failedReason || ""}

## Transitions
${(status.transitions || []).map((t) => `- ${t.from} → ${t.to}  ${t.note || ""}`).join("\n")}

## Invocations
${(status.invocations || []).map((i) => `- #${i.n} ${i.phase} ${i.durationMs}ms tools=${(i.tools || []).join("|")} first=${i.firstTool} textChars=${i.textChars} unix=${i.unix} mcpFirst=${i.mcpFirst} emptyText=${i.visibleTextMissing}`).join("\n")}

${extra ? `## Notes\n${extra}\n` : ""}
`;
}

export function acquireLock(dir) {
  const lock = readLock(dir);
  if (lock?.pid && pidAlive(lock.pid) && lock.pid !== process.pid) {
    throw new Error(`mission already running (pid ${lock.pid})`);
  }
  writeLock(dir);
}

async function invoke(ctx, phase, prompt) {
  const { spec, status, dir, deps } = ctx;
  const hit = budgetHit(spec, status, { phase });
  if (hit) throw Object.assign(new Error(hit), { budget: true });

  status.modelCalls += 1;
  const n = status.modelCalls;
  const title = `kc-mission-${spec.id}-${phase}-${n}`;
  appendJournal(dir, `invoke ${title}`);
  saveStatus(dir, status);

  const outPath = join(dir, "sessions", `${String(n).padStart(3, "0")}-${phase}.jsonl`);
  const invokeFn = deps.runOpenCode || runOpenCode;
  let result;
  try {
    result = await invokeFn({
      prompt,
      title,
      outPath,
      timeoutMs: spec.sessionTimeoutMs,
      cwd: repoRoot,
      model: status.model || spec.model || DEFAULT_MISSION_MODEL,
    });
  } catch (err) {
    const rec = {
      n,
      phase,
      title,
      ok: false,
      error: String(err.message || err),
      durationMs: err.durationMs || 0,
      tools: [],
      firstTool: null,
      textChars: 0,
      unix: 0,
      mcpFirst: false,
      visibleTextMissing: true,
    };
    status.invocations.push(rec);
    saveStatus(dir, status);
    throw err;
  }

  const parsed = result.parsed || {};
  let text = (result.text || "").trim();
  const thin = visibleReportTooThin(phase, text, parsed);
  if (parsed.visibleTextMissing || thin) {
    if (thin && !parsed.visibleTextMissing) {
      appendJournal(dir, `visible TEXT thin (${text.length} chars) on ${title}; retrying once`);
    } else {
      status.visibleTextMisses += 1;
      appendJournal(dir, `visible TEXT missing on ${title}; retrying once`);
    }
    if (!parsed.visibleTextMissing && thin) status.visibleTextMisses += 1;
    if (!budgetHit(spec, status, { phase: `${phase}-empty-retry` }) || phase === "final") {
      status.modelCalls += 1;
      const retryN = status.modelCalls;
      const retryPath = join(dir, "sessions", `${String(retryN).padStart(3, "0")}-${phase}-empty-retry.jsonl`);
      try {
        const retry = await invokeFn({
          prompt: emptyTextRetryPrompt(parsed.reasoning || prompt.slice(0, 2000)),
          title: `${title}-retry-text`,
          outPath: retryPath,
          timeoutMs: spec.sessionTimeoutMs,
          cwd: repoRoot,
          model: status.model || spec.model || DEFAULT_MISSION_MODEL,
        });
        if (retry.text?.trim()) text = retry.text.trim();
        if (retry.parsed?.tools?.length) {
          parsed.tools = unionToolNames(parsed.tools, retry.parsed.tools);
        }
        status.invocations.push({
          n: retryN,
          phase: `${phase}-empty-retry`,
          title: `${title}-retry-text`,
          ok: true,
          durationMs: retry.durationMs,
          tools: retry.parsed?.tools || [],
          firstTool: retry.parsed?.firstTool || null,
          textChars: (retry.text || "").length,
          unix: retry.parsed?.unixViolations?.length || 0,
          mcpFirst: Boolean(retry.parsed?.mcpFirst),
          visibleTextMissing: Boolean(retry.parsed?.visibleTextMissing),
        });
        if (retry.parsed?.unixViolations?.length) status.unixViolations += retry.parsed.unixViolations.length;
        if (retry.parsed && !retry.parsed.mcpFirst) status.mcpFirstMisses += 1;
      } catch (err) {
        appendJournal(dir, `empty-text retry failed: ${err.message}`);
      }
    }
  }

  if (visibleReportTooThin(phase, text, parsed)) {
    const buried = buriedVerdict(parsed.reasoning);
    if (buried) {
      appendJournal(dir, `visible TEXT still thin; using buried reasoning with VERDICT (${buried.length} chars)`);
      text = buried;
    }
  }

  if (parsed.unixViolations?.length) {
    status.unixViolations += parsed.unixViolations.length;
    appendJournal(dir, `unix discipline: ${parsed.unixViolations.map((v) => v.tool).join(", ")}`);
    writeText(dir, `UNIX_VIOLATIONS_${n}.md`, JSON.stringify(parsed.unixViolations, null, 2));
  }
  if (parsed.firstTool && !parsed.mcpFirst) {
    status.mcpFirstMisses += 1;
    appendJournal(dir, `first tool was ${parsed.firstTool}, not Kill Chain MCP`);
  }

  writeText(dir, "LAST_MODEL_OUTPUT.md", text || parsed.reasoning || "(empty)");
  status.invocations.push({
    n,
    phase,
    title,
    ok: result.exitCode === 0,
    durationMs: result.durationMs,
    tools: parsed.tools || [],
    firstTool: parsed.firstTool || null,
    textChars: text.length,
    unix: parsed.unixViolations?.length || 0,
    mcpFirst: Boolean(parsed.mcpFirst),
    visibleTextMissing: Boolean(parsed.visibleTextMissing),
    exitCode: result.exitCode,
  });
  saveStatus(dir, status);
  return { text, parsed, result };
}

function allowedStat(ctx) {
  if (ctx.deps.gitAllowedAppDiffStat) return ctx.deps.gitAllowedAppDiffStat(ctx.spec);
  return gitAllowedAppDiffStat(ctx.spec);
}

function diffCheckNow(ctx) {
  if (ctx.deps.gitDiffCheck) return ctx.deps.gitDiffCheck();
  return gitDiffCheck();
}

function currentPorcelain(ctx) {
  return ctx.deps.gitPorcelain ? ctx.deps.gitPorcelain() : gitPorcelain();
}

function repoIo(ctx) {
  if (ctx.io) return ctx.io;
  if (ctx.deps.createIo) ctx.io = ctx.deps.createIo();
  else ctx.io = createFsIo(ctx.deps.repoRoot || repoRoot);
  return ctx.io;
}

function beginPhase(ctx, label) {
  const key = `${String(ctx.status.modelCalls).padStart(3, "0")}-${label}`;
  ctx.phaseKey = key;
  ctx.preFiles = capturePhaseSnapshot(
    ctx.dir,
    key,
    ctx.spec,
    ctx.attribution || {},
    repoIo(ctx),
    currentPorcelain(ctx),
  );
  return key;
}

function endPhase(ctx, { writesApp = false } = {}) {
  if (!ctx.phaseKey || !ctx.preFiles) {
    return { ok: true, delta: { dirty: [] }, allowed: [], unauthorized: [], restored: false };
  }
  if (!ctx.attribution) {
    ctx.attribution = {
      adopted: [],
      preserved: [],
      missionOwned: [],
      phaseDeltas: [],
      readOnlyViolations: 0,
      automaticRestores: 0,
    };
  }
  const result = enforcePhaseDelta({
    missionDir: ctx.dir,
    key: ctx.phaseKey,
    preFiles: ctx.preFiles,
    spec: ctx.spec,
    io: repoIo(ctx),
    porcelainNow: currentPorcelain(ctx),
    writesApp,
    attribution: ctx.attribution,
    quarantineNewFile: (rel) => {
      const buf = repoIo(ctx).read(rel);
      if (!buf) return;
      mkdirSync(join(ctx.dir, "quarantine"), { recursive: true });
      const dest = join(ctx.dir, "quarantine", `${Date.now()}-${basename(rel)}`);
      writeFileSync(dest, buf);
      appendJournal(ctx.dir, `quarantined new file ${rel} → ${dest}`);
    },
  });
  ctx.attribution.phaseDeltas = [...(ctx.attribution.phaseDeltas || []), result.delta];
  if (result.readOnlyViolation) {
    ctx.status.readOnlyViolations = (ctx.status.readOnlyViolations || 0) + 1;
    ctx.attribution.readOnlyViolations = (ctx.attribution.readOnlyViolations || 0) + 1;
    ctx.attribution.automaticRestores = (ctx.attribution.automaticRestores || 0) + 1;
    ctx.status.editRetries = (ctx.status.editRetries || 0) + 1;
    appendJournal(ctx.dir, `read-only source write restored: ${(result.unauthorized || []).join(", ")}`);
    ctx.status.lastError = `read-only phase wrote application source: ${(result.unauthorized || []).join(", ")}`;
  } else if (result.restored && result.unauthorized?.length) {
    ctx.status.editRetries = (ctx.status.editRetries || 0) + 1;
    ctx.attribution.automaticRestores = (ctx.attribution.automaticRestores || 0) + 1;
    appendJournal(ctx.dir, `unauthorized phase delta restored: ${result.unauthorized.join(", ")}`);
    ctx.status.lastError = `unauthorized paths: ${result.unauthorized.join(", ")}`;
  }
  saveAttribution(ctx.dir, ctx.attribution);
  persistTotalMissionDiff(ctx.dir, ctx.spec, ctx.attribution, repoIo(ctx), currentPorcelain(ctx));
  saveAttribution(ctx.dir, ctx.attribution);
  ctx.lastEnforce = result;
  ctx.status.expectedAppDirty = [...new Set([
    ...(ctx.attribution.missionOwned || []),
    ...(result.allowed || []),
  ])];
  ctx.status.automaticRestores = ctx.attribution.automaticRestores || 0;
  ctx.phaseKey = null;
  ctx.preFiles = null;
  const junk = unexpectedJunk(currentPorcelain(ctx), ctx.spec, { dryRun: ctx.status.dryRun });
  if (junk.length) {
    appendJournal(ctx.dir, `junk files: ${junk.map((j) => j.path).join(", ")}`);
    const r = revertUnauthorized(junk, { quarantineDir: join(ctx.dir, "quarantine") });
    result.junk = junk;
    result.reverted = r;
  }
  return result;
}

/** Read-only phases pass revertAllApp:true → writesApp false. */
function postPhaseGit(ctx, { revertAllApp = false } = {}) {
  return endPhase(ctx, { writesApp: !revertAllApp });
}

function ingestThinDump(dir, text, gitResult, destName) {
  if ((text || "").trim().length >= 800) return text;
  const dumps = [...(gitResult?.reverted?.quarantined || [])];
  const qdir = join(dir, "quarantine");
  if (existsSync(qdir)) {
    for (const name of readdirSync(qdir)) {
      dumps.push({ from: name, to: join(qdir, name) });
    }
  }
  let best = "";
  let from = "";
  for (const q of dumps) {
    if (!existsSync(q.to)) continue;
    if (!/\.md$/i.test(q.from) && !/\.md$/i.test(q.to)) continue;
    if (!quarantineFitsDest(q.from, destName) && !quarantineFitsDest(q.to, destName)) continue;
    const body = readFileSync(q.to, "utf8");
    if (body.length > best.length) {
      best = body;
      from = q.from;
    }
  }
  if (best.length > (text || "").length + 200) {
    writeText(dir, destName, best);
    appendJournal(dir, `ingested quarantined ${from} into ${destName} (${best.length} chars)`);
    return best;
  }
  return text;
}

function maybeStop(ctx) {
  if (!ctx.stopAfter) return false;
  if (ctx.status.state === ctx.stopAfter) {
    appendJournal(ctx.dir, `stop-after ${ctx.stopAfter}`);
    saveStatus(ctx.dir, ctx.status);
    return true;
  }
  return false;
}

async function maybeRebuildCorpus(ctx, reason) {
  if (!ctx.preflight?.needRebuild && reason === "start") return;
  const policy = ctx.spec.corpus;
  if (policy === "never") return;
  if (reason === "start" && (policy === "start" || (policy === "if-stale" && ctx.preflight.needRebuild) || (policy === "after-checkpoint" && ctx.preflight.needRebuild))) {
    appendJournal(ctx.dir, "corpus rebuild at mission start");
    if (ctx.deps.buildCorpus) await ctx.deps.buildCorpus({ log: ctx.log });
    else await buildCorpus({ log: ctx.log, embed: false });
    ctx.preflight.needRebuild = false;
  }
  if (reason === "checkpoint" && policy === "after-checkpoint") {
    appendJournal(ctx.dir, "corpus rebuild after checkpoint (symbols may have changed)");
    if (ctx.deps.buildCorpus) await ctx.deps.buildCorpus({ log: ctx.log });
    else await buildCorpus({ log: ctx.log, embed: false });
  }
}

function reviewDiff(dir, status, ctx = null) {
  const current = readText(dir, "CURRENT.diff");
  if (current.trim()) return current;
  if (status.dryRun) return "(no production diff — dry-run; ignore tooling/worktree noise)";
  const app = ctx ? allowedStat(ctx) : gitAllowedAppDiffStat(status._spec || {});
  return app.patch || "(no application diff)";
}

function writeCheckpoint(ctx, label) {
  if (ctx.spec.checkpointPolicy === "never") return;
  const n = (ctx.status.checkpoints = (ctx.status.checkpoints || 0) + 1);
  const lossless = writeLosslessCheckpoint(ctx.dir, n, {
    spec: ctx.spec,
    status: ctx.status,
    attribution: ctx.attribution || {},
    io: repoIo(ctx),
    porcelain: currentPorcelain(ctx),
    label,
    validation: null,
    head: ctx.status.headAtStart,
    phaseDelta: ctx.lastEnforce?.delta || null,
  });
  try {
    const stat = allowedStat(ctx);
    writeFileSync(join(lossless.dir, "diff.patch"), stat.patch || "", "utf8");
    writeFileSync(join(lossless.dir, "README.txt"), "Recovery is files/ copies + meta.json hashes. diff.patch is human-readable only and must not be the sole restore source.\n", "utf8");
  } catch {
    writeFileSync(join(lossless.dir, "diff.patch"), "", "utf8");
  }
  appendJournal(ctx.dir, `checkpoint ${n} ${label} files=${lossless.changed.length}`);
}

function lastInvocation(status, needle) {
  const inv = status.invocations || [];
  const n = String(needle || "");
  for (let i = inv.length - 1; i >= 0; i--) {
    const p = String(inv[i].phase || "");
    if (!n || p === n || p.startsWith(n) || p.includes(n)) return inv[i];
  }
  return inv[inv.length - 1] || null;
}

function persistEmptyEdit(dir, status, rec) {
  const p = join(dir, "empty-edits.json");
  let list = [];
  if (existsSync(p)) {
    try { list = JSON.parse(readFileSync(p, "utf8")); } catch { list = []; }
  }
  if (!Array.isArray(list)) list = [];
  list.push(rec);
  writeFileSync(p, `${JSON.stringify(list, null, 2)}\n`, "utf8");
  status.emptyEdits = (status.emptyEdits || 0) + 1;
  status.emptyEditStreak = (status.emptyEditStreak || 0) + 1;
  if (rec.kind === "DESCRIBED_BUT_DID_NOT_APPLY") {
    status.describedButDidNotApply = (status.describedButDidNotApply || 0) + 1;
  }
}

function capturePreEdit(ctx) {
  if (ctx.status.preEditCaptured) return;
  capturePhaseSnapshot(
    ctx.dir,
    "pre-edit",
    ctx.spec,
    ctx.attribution || {},
    repoIo(ctx),
    currentPorcelain(ctx),
  );
  ctx.status.preEditCaptured = true;
}

function transactionalRestore(ctx) {
  const io = repoIo(ctx);
  const r = restoreSnapshot(ctx.dir, "pre-edit", io);
  ctx.status.transactionalRollbacks = (ctx.status.transactionalRollbacks || 0) + 1;
  ctx.status.automaticRestores = (ctx.status.automaticRestores || 0) + 1;
  persistTotalMissionDiff(ctx.dir, ctx.spec, ctx.attribution || {}, io, currentPorcelain(ctx));
  saveAttribution(ctx.dir, ctx.attribution);
  writeText(ctx.dir, "transactional-restore.json", JSON.stringify(r, null, 2));
  appendJournal(ctx.dir, `transactional restore pre-edit ok=${r.ok} restored=${(r.restored || []).join(",")}`);
  ctx.status.preEditCaptured = false;
  ctx.lastEnforce = null;
  return r;
}

function tallyValidation(status, report) {
  for (const r of report?.results || []) {
    if (r.name === "typecheck") status.typecheckCycles = (status.typecheckCycles || 0) + 1;
    if (r.name === "build") status.buildCycles = (status.buildCycles || 0) + 1;
  }
}

function repairFiles(ctx, syntax) {
  const fromDiag = (syntax?.diagnostics || []).map((d) => d.file).filter(Boolean);
  const fromDelta = ctx.lastEnforce?.allowed || [];
  const owned = ctx.attribution?.missionOwned || [];
  return [...new Set([...fromDiag, ...fromDelta, ...owned])];
}

export async function runMission({
  specPath,
  resumeId,
  dryRun = false,
  stopAfter = null,
  approveAudioEdit = false,
  retry = false,
  model = null,
  dataRoot = missionsDataDir,
  log = console.log,
  deps = {},
} = {}) {
  let spec;
  let dir;
  let status;
  let resumed = false;

  if (resumeId) {
    const loaded = loadMission(resumeId, dataRoot);
    spec = loaded.spec;
    dir = loaded.dir;
    status = loaded.status;
    resumed = true;
    status.resumeCount = (status.resumeCount || 0) + 1;
    if (dryRun) status.dryRun = true;
  } else {
    const parsed = parseMissionFile(specPath);
    if (!parsed.ok) throw new Error(`invalid mission spec: ${parsed.errors.join("; ")}`);
    spec = parsed.spec;
    if (parsed.warnings.length) log(`spec warnings: ${parsed.warnings.join("; ")}`);
    const git = (deps.gitCapture || gitCapture)();
    const created = createMissionStore(spec, {
      dryRun: dryRun || spec.dryRun,
      head: git.commit,
      branch: git.branch,
      dataRoot,
    });
    dir = created.dir;
    status = created.status;
  }

  spec.dryRun = Boolean(status.dryRun);
  const chosen = model || deps.model || spec.model || status.model || DEFAULT_MISSION_MODEL;
  spec.model = normalizeModelId(chosen);
  status.model = spec.model;
  status._spec = spec;
  acquireLock(dir);

  const ctx = {
    spec,
    status,
    dir,
    deps,
    log,
    stopAfter,
    approveAudioEdit,
    snapshot: null,
    preflight: null,
    io: null,
    attribution: resumed ? loadAttribution(dir) : null,
  };

  try {
    if (resumed) {
      appendJournal(dir, `resume from ${status.state}`);
      const git = (deps.gitCapture || gitCapture)();
      if (status.headAtStart && git.commit !== status.headAtStart) {
        return block(dir, status, `HEAD moved since mission start (${status.headAtStart} → ${git.commit})`);
      }
      if (isTerminal(status.state)) {
        if (!retry) {
          log(`mission ${spec.id} already ${status.state}. Pass --retry to restore the previous state.`);
          return status;
        }
        const last = [...(status.transitions || [])].reverse().find((t) => t.to === status.state);
        let restore = last?.from || "PREFLIGHT";
        const blocked = status.blockedReason || "";
        if (restore === "FINAL_REVIEW" && /NOT_READY|unresolved-design|proposal/.test(blocked)) {
          restore = "PROPOSING";
          status.proposalRound = 0;
          status.editRetries = 0;
          status.criticRetries = 0;
        }
        appendJournal(dir, `retry: ${status.state} → restore ${restore} (bypassing terminal lock)`);
        status.state = restore;
        status.failedReason = null;
        status.blockedReason = null;
        status.endedAt = null;
        status.lastError = null;
        if (restore === "PLAN_REVIEW" || restore === "FINAL_REVIEW") {
          status.planRetries = restore === "PLAN_REVIEW" ? 0 : status.planRetries;
          status.criticRetries = 0;
        }
        saveStatus(dir, status);
      }
      if (!ctx.attribution) {
        const porcelain = currentPorcelain(ctx);
        const resolved = resolveAdoption(spec, porcelain);
        ctx.attribution = captureBaseline(dir, spec, resolved, repoIo(ctx), porcelain);
        appendJournal(dir, "resume captured missing attribution baseline");
      }
    }

    while (!isTerminal(status.state)) {
      const hit = budgetHit(spec, status);
      if (hit && status.state !== "FINAL_REVIEW") {
        return block(dir, status, hit);
      }

      switch (status.state) {
        case "CREATED":
          transition(dir, status, "PREFLIGHT");
          break;

        case "PREFLIGHT": {
          log("preflight…");
          const pf = await runPreflight(spec, { ...deps, model: status.model });
          ctx.preflight = pf;
          ctx.snapshot = pf.snapshot;
          writeText(dir, "preflight.json", JSON.stringify({
            ok: pf.ok,
            errors: pf.errors,
            warnings: pf.warnings,
            git: pf.git,
            mcp: { connected: pf.mcp.connected, line: pf.mcp.line },
            ollama: { ok: pf.ollama.ok },
            corpusStale: pf.corpusStale,
            needRebuild: pf.needRebuild,
            adoption: pf.adoption || null,
          }, null, 2));
          if (!pf.ok) return block(dir, status, pf.errors.join("; "));
          ctx.io = repoIo(ctx);
          if (!ctx.attribution) {
            const resolved = pf.adoption || { adopted: [], preserved: [], unexpected: [], errors: [] };
            ctx.attribution = captureBaseline(dir, spec, resolved, ctx.io, pf.porcelain || currentPorcelain(ctx));
          }
          await maybeRebuildCorpus(ctx, "start");
          ctx.snapshot = deps.snapshotWorktree ? deps.snapshotWorktree() : snapshotWorktree();
          if (maybeStop(ctx)) return status;
          transition(dir, status, "INVESTIGATING", "preflight ok");
          break;
        }

        case "INVESTIGATING": {
          log(`investigating (${status.model})…`);
          beginPhase(ctx, "investigate");
          const { text } = await invoke(ctx, "investigate", investigatePrompt(spec, status));
          writeText(dir, "INVESTIGATION.md", text);
          const git = postPhaseGit(ctx, { revertAllApp: true });
          if (!git.ok && status.editRetries > spec.maxRetriesPerPhase) {
            return block(dir, status, `investigation created unauthorized files: ${status.lastError}`);
          }
          transition(dir, status, "PLANNING");
          if (maybeStop(ctx)) return status;
          break;
        }

        case "PLANNING": {
          log(`planning (${status.model})…`);
          beginPhase(ctx, "plan");
          const investigation = readText(dir, "INVESTIGATION.md");
          // A correction written by the plan-critic gate is consumed once, so a
          // later clean retry is not re-litigating a stale rejection.
          const planCorrection = readText(dir, "PLAN_CORRECTION.md");
          if (planCorrection) writeText(dir, "PLAN_CORRECTION.md", "");
          const { text } = await invoke(ctx, "plan", planPrompt(spec, status, investigation, { correction: planCorrection }));
          writeText(dir, "PLAN.md", text);
          const git = postPhaseGit(ctx, { revertAllApp: true });
          ingestThinDump(dir, text, git, "PLAN.md");
          transition(dir, status, "PLAN_REVIEW");
          if (maybeStop(ctx)) return status;
          break;
        }

        case "PLAN_REVIEW": {
          log(`plan critic (${status.model})…`);
          // Each new critic cycle gets one cheap contract repair. Do not leak
          // criticRetries from a previous plan — that is what blocked the live
          // singularity resume after a successful FAIL → replan.
          status.criticRetries = 0;
          beginPhase(ctx, "plan-critic");
          ingestThinDump(dir, readText(dir, "PLAN.md"), {}, "PLAN.md");
          const plan = readText(dir, "PLAN.md");
          let { text, parsed } = await invoke(ctx, "plan-critic", criticPrompt(spec, status, { plan }));
          writeText(dir, "PLAN_CRITIC.md", text);
          postPhaseGit(ctx, { revertAllApp: true });
          const trustedEvidence = String(spec.brief || "");
          const evalGate = (criticText, tools) => evaluateCriticGate({
            criticText,
            planText: plan,
            spec,
            tools: tools || [],
            suppliedEvidence: trustedEvidence,
          });
          let gate = evalGate(text, parsed.tools || []);

          const applyLocalNormalize = () => {
            const disp = planCriticDisposition(gate, text, { spec });
            if (disp.action !== PLAN_CRITIC_ACTION.LOCAL_NORMALIZE) return disp;
            text = disp.normalizedText;
            writeText(dir, "PLAN_CRITIC.md", text);
            appendJournal(dir, "plan critic: mechanical verdict normalize (token already present; not inferred)");
            gate = evalGate(text, parsed.tools || []);
            return planCriticDisposition(gate, text, { spec });
          };

          let disp = applyLocalNormalize();
          // Cheap contract repairs. Never wrap them in the full critic
          // investigation prompt — that is what burned the live mission.
          // Budget is 2 so a stamp-only `VERDICT: PASS` can be merged and a
          // remaining INSPECTED/RISK gap can still be asked for.
          while (
            (
              disp.action === PLAN_CRITIC_ACTION.FORMAT_REPAIR
              || disp.action === PLAN_CRITIC_ACTION.NEEDS_MORE_EVIDENCE
              // Exactly one tool-enabled evidence pass, budgeted separately so it
              // never competes with (or is starved by) the prose-repair budget.
              || (disp.action === PLAN_CRITIC_ACTION.EVIDENCE_REPAIR && (status.criticEvidenceRepairs || 0) < 1)
            )
            && (disp.action === PLAN_CRITIC_ACTION.EVIDENCE_REPAIR || (status.criticRetries || 0) < 2)
            && !gate.pass
          ) {
            const evidenceRepair = disp.action === PLAN_CRITIC_ACTION.EVIDENCE_REPAIR;
            if (evidenceRepair) status.criticEvidenceRepairs = (status.criticEvidenceRepairs || 0) + 1;
            else status.criticRetries = (status.criticRetries || 0) + 1;
            const cls = classifyGateFailure(gate);
            const packet = evidenceRepair
              ? criticEvidenceGatherPacket({
                gate,
                criticText: text,
                targets: disp.targets || [],
                retriesUsed: status.criticEvidenceRepairs,
                retryBudget: 1,
              })
              : disp.action === PLAN_CRITIC_ACTION.FORMAT_REPAIR
                ? criticFormatPacket({
                  gate,
                  criticText: text,
                  missingFields: cls.missingFields.length ? cls.missingFields : ["VERDICT"],
                  retriesUsed: status.criticRetries,
                  retryBudget: 2,
                  verdictWords: "PASS, FAIL, or BLOCK",
                })
                : criticNeedsEvidencePacket({
                  gate,
                  criticText: text,
                  retriesUsed: status.criticRetries,
                  retryBudget: 2,
                });
            const prompt = evidenceRepair
              ? criticEvidenceGatherPrompt({ packet, plan, targets: disp.targets || [] })
              : disp.action === PLAN_CRITIC_ACTION.FORMAT_REPAIR
                ? criticFormatRepairPrompt(packet)
                : criticNeedsEvidencePrompt({ packet, plan });
            const label = evidenceRepair
              ? "evidence-gather"
              : disp.action === PLAN_CRITIC_ACTION.FORMAT_REPAIR ? "format-repair" : "needs-evidence";
            appendJournal(dir, `critic contract ${disp.action} (${cls.kind}: ${cls.missingFields.join(",") || gate.errors.join(",")}); cheap ${label}`);
            writeText(dir, `CRITIC_CORRECTION_${status.criticRetries}.md`, packet);
            beginPhase(ctx, `plan-critic-${label}`);
            const retry = await invoke(ctx, `plan-critic-${label}`, prompt);
            text = mergeCriticRepair(text, retry.text);
            parsed = { ...(retry.parsed || {}), tools: unionToolNames(parsed.tools, retry.parsed?.tools) };
            writeText(dir, "PLAN_CRITIC.md", text);
            postPhaseGit(ctx, { revertAllApp: true });
            gate = evalGate(text, parsed.tools || []);
            disp = applyLocalNormalize();
          }

          writeText(dir, "critic-gate.json", JSON.stringify({
            errors: gate.errors,
            pass: gate.pass,
            modelVerdict: gate.modelVerdict,
            missing: gate.planFiles?.missing,
            disposition: disp.action,
          }, null, 2));
          if (disp.action === PLAN_CRITIC_ACTION.BLOCK || (gate.modelVerdict === "BLOCK" && !gate.missingVerdict)) {
            return block(dir, status, `plan critic BLOCK: ${gate.errors.join("; ") || "unspecified"}`);
          }
          if (gate.pass) {
            transition(dir, status, "PROPOSING", "plan critic PASS");
            if (maybeStop(ctx)) return status;
            break;
          }

          // Format-only / missing-verdict must not replan. The live singularity
          // mission spent ~24 calls looping PLANNING because this fell through.
          if (
            disp.action === PLAN_CRITIC_ACTION.FORMAT_REPAIR
            || disp.action === PLAN_CRITIC_ACTION.NEEDS_MORE_EVIDENCE
            || disp.action === PLAN_CRITIC_ACTION.LOCAL_NORMALIZE
            || (gate.missingVerdict && classifyGateFailure(gate).formatOnly)
          ) {
            return block(dir, status, `plan critic gate failed: ${gate.errors.join("; ") || gate.modelVerdict}`);
          }

          status.planRetries += 1;
          if (status.planRetries > spec.maxRetriesPerPhase) {
            return block(dir, status, `plan critic gate failed: ${gate.errors.join("; ") || gate.modelVerdict}`);
          }
          const cls = classifyGateFailure(gate);
          const invalid = [
            ...(gate.planFiles?.missing || []),
            ...(gate.artifacts?.innerPanels || []),
          ];
          if (invalid.length) {
            const symbolNames = invalid.map((p) => String(p).split("/").pop().replace(/\.(tsx|ts)$/, ""));
            writeText(dir, "PLAN_CORRECTION.md", referencePacket({
              invalid,
              nearest: invalid.flatMap((p) => nearestValidReferences(p, { candidates: spec.readOnlyPaths || [] })),
              symbols: await locateSymbols(symbolNames),
              allowedPaths: spec.allowedPaths || [],
              retriesUsed: status.planRetries,
              retryBudget: spec.maxRetriesPerPhase,
            }));
          }
          appendJournal(dir, `plan critic gate ${gate.modelVerdict} [${cls.kind}] ${gate.errors.join(",")}; revising plan`);
          transition(dir, status, "PLANNING", `critic ${gate.errors.join(",") || gate.modelVerdict}`);
          if (maybeStop(ctx)) return status;
          break;
        }

        case "PROPOSING": {
          log(`proposal round ${status.proposalRound + 1} (local Qwen)…`);
          beginPhase(ctx, "proposal");
          const plan = readText(dir, "PLAN.md");
          const critic = readText(dir, "PLAN_CRITIC.md");
          const { text } = await invoke(
            ctx,
            "proposal",
            proposalPrompt(spec, status, { plan, critic, round: status.proposalRound + 1 }),
          );
          writeText(dir, "PROPOSAL.md", text);
          const git = postPhaseGit(ctx, { revertAllApp: true });
          ingestThinDump(dir, text, git, "PROPOSAL.md");
          const body = readText(dir, "PROPOSAL.md");
          const art = evaluateArtifactGate(body, spec);
          const symbols = await checkInventedSymbolsAsync(body);
          const concrete = checkProposalConcrete(body);
          writeText(dir, "proposal-scope.json", JSON.stringify({
            ...art,
            symbols,
            concrete,
            legacy: proposalScopeCheck(body, spec, { dryRun: status.dryRun }),
          }, null, 2));
          if (!art.ok || !symbols.ok || !concrete.ok) {
            status.editRetries += 1;
            if (status.editRetries > spec.maxRetriesPerPhase) {
              return block(dir, status, `proposal gate: ${(art.errors || []).join("; ")} inventedSymbols=${(symbols.invented || []).join(",")} ${concrete.errors.join(";")}`);
            }
            appendJournal(dir, `proposal gate fail; retry ${(art.errors || []).concat(concrete.errors).join(",")}`);
            break;
          }
          status.proposalRound += 1;
          writeText(dir, status.proposalRound === 1 ? "PROPOSAL.md" : `PROPOSAL_${status.proposalRound}.md`, body);
          const canEdit = spec.levelInfo?.edits && !status.dryRun;
          const forceEdit = Boolean(status.forceEditAfterProposal);
          if (!forceEdit && status.proposalRound < spec.proposalRounds) {
            appendJournal(dir, `more proposal rounds remaining`);
            break;
          }
          const expect = shouldExpectEdit(body, spec, { dryRun: status.dryRun });
          status.forceEditAfterProposal = false;
          if (!canEdit) {
            transition(dir, status, "FINAL_REVIEW", "dry-run or read-only — no edits");
          } else if (!expect.expected) {
            appendJournal(dir, "proposal is inspect-only (no authorized edit targets); skipping EDITING");
            transition(dir, status, "FINAL_REVIEW", "inspect-only proposal");
          } else if (!canEnterEditing(spec, status)) {
            return block(dir, status, refuseEditingReason(spec, status));
          } else {
            if (!readText(dir, "ORIGINAL_PROPOSAL.md").trim()) {
              writeText(dir, "ORIGINAL_PROPOSAL.md", body);
            }
            transition(dir, status, "EDITING", "proposal passed scope");
          }
          if (maybeStop(ctx)) return status;
          break;
        }

        case "EDITING": {
          if (spec.level === 4 && spec.levelInfo?.humanBeforeEdit && !ctx.approveAudioEdit) {
            return block(dir, status, "level 4 audio edit requires --approve-audio-edit");
          }
          if (!spec.allowAudioEdits && spec.level === 4) {
            return block(dir, status, "level 4 without allowAudioEdits");
          }
          capturePreEdit(ctx);
          const proposal = readText(dir, "PROPOSAL.md");
          const plan = readText(dir, "PLAN.md");
          const expect = shouldExpectEdit(proposal, spec, { dryRun: status.dryRun });
          const applyN = Number(status.forceApplyRetry) || 0;
          status.forceApplyRetry = 0;
          const phaseLabel = applyN >= 2 ? "edit-apply-strong" : (applyN ? "edit-apply" : "edit");
          log(applyN ? `editing apply-retry ${applyN} (local Qwen)…` : "editing (local Qwen)…");
          beginPhase(ctx, phaseLabel);
          const prompt = applyN
            ? emptyEditRetryPrompt(spec, status, {
              proposal,
              expectedFiles: expect.files,
              stronger: applyN >= 2,
            })
            // Stripped execution contract: the approved change and the target
            // files, with no goal/acceptance/plan context to re-litigate.
            : executePrompt(spec, status, { proposal, expectedFiles: expect.files });
          await invoke(ctx, phaseLabel, prompt);
          const editGit = endPhase(ctx, { writesApp: true });
          status.lastWritePhase = "edit";
          if (!editGit.ok && status.editRetries > spec.maxRetriesPerPhase) {
            return block(dir, status, `unauthorized paths: ${(editGit.unauthorized || []).join(", ")}`);
          }
          transition(dir, status, "DIFF_REVIEW");
          if (maybeStop(ctx)) return status;
          break;
        }

        case "DIFF_REVIEW": {
          let enforced = ctx.lastEnforce;
          if (!enforced && ctx.attribution?.phaseDeltas?.length) {
            const d = ctx.attribution.phaseDeltas[ctx.attribution.phaseDeltas.length - 1];
            enforced = {
              ok: true,
              allowed: (d.dirty || []).filter((p) => pathEditable(p, ctx.spec, { dryRun: false })),
              unauthorized: [],
              delta: d,
            };
          }
          enforced = enforced || { ok: true, allowed: [], unauthorized: [], delta: { dirty: [] } };
          const allowed = enforced.allowed || [];
          const unauthorized = enforced.ok ? [] : (enforced.unauthorized || []);
          const check = diffCheckNow(ctx);
          writeText(dir, "phase-delta.json", JSON.stringify(enforced.delta || {}, null, 2));
          writeText(dir, "diff-check.json", JSON.stringify({
            ok: check.ok,
            output: check.output,
            args: check.args,
            unauthorized,
            allowed,
            phaseDelta: enforced.delta || {},
            missionOwned: ctx.attribution?.missionOwned || [],
          }, null, 2));
          if (unauthorized.length) {
            if (status.editRetries > spec.maxRetriesPerPhase) {
              return block(dir, status, `unauthorized paths: ${unauthorized.join(", ")}`);
            }
            transition(dir, status, "EDITING", "revert unauthorized; retry");
            break;
          }
          const stat = allowedStat(ctx);
          writeText(dir, "diff-stat.json", JSON.stringify({ ...stat, phaseDelta: enforced.delta || {}, totalMission: ctx.attribution?.totalMissionDiff || null }, null, 2));
          writeText(dir, "CURRENT.diff", stat.patch || "");
          const size = fileSizeOk(stat, spec);
          if (size.warn) {
            status.warnings.push(`diff size files=${stat.files.length} insertions=${stat.insertions}`);
            if (size.block) return block(dir, status, "diff exceeded hard thresholds");
          }
          if (!check.ok) {
            status.warnings.push(`git diff --check: ${check.output.slice(0, 400)}`);
          }
          status.expectedAppDirty = [...new Set([...(ctx.attribution?.missionOwned || []), ...allowed])];

          const proposal = readText(dir, "PROPOSAL.md");
          const expect = shouldExpectEdit(proposal, spec, { dryRun: status.dryRun });
          const last = lastInvocation(status, status.lastWritePhase === "repair-apply" ? "repair-apply" : "edit");
          const outcome = classifyEditOutcome({
            expected: expect.expected,
            expectedFiles: expect.files,
            allowed,
            deltaDirty: enforced.delta?.dirty || [],
            tools: last?.tools || [],
            invokeOk: last ? last.ok !== false : true,
          });
          writeText(dir, "edit-outcome.json", JSON.stringify({
            ...outcome,
            phase: status.lastWritePhase,
            session: last?.title || last?.n || null,
            tools: last?.tools || [],
            textChars: last?.textChars || 0,
          }, null, 2));

          if (outcome.empty) {
            persistEmptyEdit(dir, status, {
              at: new Date().toISOString(),
              phase: status.lastWritePhase || "edit",
              proposal: (proposal || "").slice(0, 4000),
              expectedFiles: expect.files,
              modelSession: last?.title || last?.n || null,
              tools: last?.tools || [],
              visibleOutputChars: last?.textChars || 0,
              zeroDelta: true,
              kind: outcome.kind,
              mutation: outcome.mutation,
            });
            const policy = emptyEditPolicy(status.emptyEditStreak);
            appendJournal(dir, `${outcome.kind} streak=${status.emptyEditStreak} action=${policy.action}`);
            saveStatus(dir, status);
            if (policy.action === "BLOCK") {
              return block(dir, status, policy.reason);
            }
            if (status.lastWritePhase === "repair-apply") {
              status.forceApplyRepair = true;
              transition(dir, status, "REPAIRING", outcome.kind);
            } else {
              status.forceApplyRetry = policy.stronger ? 2 : 1;
              transition(dir, status, "EDITING", outcome.kind);
            }
            if (maybeStop(ctx)) return status;
            break;
          }

          if ((status.emptyEditStreak || 0) > 0) {
            status.emptyEditRetriesSucceeded = (status.emptyEditRetriesSucceeded || 0) + 1;
          }
          status.emptyEditStreak = 0;

          const syntaxFn = deps.checkChangedTsSyntax || checkChangedTsSyntax;
          const syntax = syntaxFn(allowed, repoIo(ctx));
          writeText(dir, "syntax-gate.json", JSON.stringify(syntax, null, 2));
          if (!syntax.ok) {
            status.syntaxFailures = (status.syntaxFailures || 0) + 1;
            status.syntaxGateFailed = true;
            saveStatus(dir, status);
            if ((status.syntaxRetries || 0) >= spec.maxRetriesPerPhase) {
              const rolled = transactionalRestore(ctx);
              if (!rolled.ok) return block(dir, status, "syntax repair exhausted; pre-edit restore failed");
              if ((status.transactionalRetries || 0) >= 1) {
                return block(dir, status, "syntax repair exhausted; transactional retry exhausted");
              }
              status.transactionalRetries = (status.transactionalRetries || 0) + 1;
              status.syntaxRetries = 0;
              status.syntaxGateFailed = false;
              status.emptyEditStreak = 0;
              const original = readText(dir, "ORIGINAL_PROPOSAL.md");
              if (original.trim()) writeText(dir, "PROPOSAL.md", original);
              status.forceApplyRetry = 1;
              transition(dir, status, "EDITING", "transactional restore; fresh apply");
              if (maybeStop(ctx)) return status;
              break;
            }
            status.syntaxRetries = (status.syntaxRetries || 0) + 1;
            transition(dir, status, "REPAIRING", "syntax gate");
            if (maybeStop(ctx)) return status;
            break;
          }
          if (status.syntaxGateFailed) {
            status.syntaxRepairs = (status.syntaxRepairs || 0) + 1;
            status.syntaxGateFailed = false;
          }

          // Scope gate. The syntax gate cannot see missing names (a single
          // buffer cannot resolve imports), so invented identifiers used to
          // survive until the project typecheck. Catching them here turns a
          // ~15s validation failure into an immediate, precise repair packet.
          // Deliberately never blocks: if it cannot be satisfied we fall
          // through and let the real typecheck be the authority.
          const identFn = deps.checkChangedIdentifiers || checkChangedIdentifiers;
          const idents = identFn(allowed, repoIo(ctx));
          writeText(dir, "ident-gate.json", JSON.stringify(idents, null, 2));
          if (!idents.ok && (status.identRetries || 0) < spec.maxRetriesPerPhase) {
            status.identRetries = (status.identRetries || 0) + 1;
            status.identFailures = (status.identFailures || 0) + 1;
            const names = idents.results.flatMap((r) => r.unresolved.map((u) => u.name));
            saveStatus(dir, status);
            transition(dir, status, "REPAIRING", `scope gate: unresolved ${[...new Set(names)].join(", ")}`);
            if (maybeStop(ctx)) return status;
            break;
          }

          saveStatus(dir, status);
          transition(dir, status, "VALIDATING", `${allowed.length} phase-delta files owned=${(ctx.attribution?.missionOwned || []).length}`);
          if (maybeStop(ctx)) return status;
          break;
        }

        case "VALIDATING": {
          if (status.dryRun || !(spec.validation?.required || []).length) {
            writeText(dir, "validation.json", JSON.stringify({ ok: true, skipped: true }, null, 2));
            transition(dir, status, spec.levelInfo?.edits && !status.dryRun ? "CHECKPOINT" : "FINAL_REVIEW", "validation skipped");
            break;
          }
          log("validation…");
          const report = await (deps.runValidation
            ? deps.runValidation(spec, { snapshot: ctx.snapshot, log })
            : runValidation(spec, { snapshot: ctx.snapshot, log }));
          tallyValidation(status, report);
          writeText(dir, "validation.json", JSON.stringify({
            ...report,
            summary: validationSummary(report),
          }, null, 2));
          if (!report.ok) {
            status.repairRetries += 1;
            if (status.repairRetries > spec.maxRetriesPerPhase) {
              return block(dir, status, `validation retries exhausted`);
            }
            transition(dir, status, "REPAIRING", "validation failed");
            break;
          }
          const morePhases = status.phaseIndex + 1 < spec.maxPhases && spec.level >= 2;
          transition(dir, status, morePhases ? "CHECKPOINT" : "FINAL_REVIEW", "validation ok");
          if (maybeStop(ctx)) return status;
          break;
        }

        case "REPAIRING": {
          let syntax = {};
          try { syntax = JSON.parse(readText(dir, "syntax-gate.json") || "{}"); } catch { syntax = {}; }
          let identGate = {};
          try { identGate = JSON.parse(readText(dir, "ident-gate.json") || "{}"); } catch { identGate = {}; }
          const files = repairFiles(ctx, syntax);
          const validationText = readText(dir, "validation.json");
          const diagnostics = (!syntax.ok && (syntax.diagnostics || []).length)
            ? formatDiagnostics(syntax.diagnostics)
            : validationText;
          const windows = (syntax.diagnostics || [])
            .map((d) => `--- ${d.file}:${d.line}:${d.column} ${d.code} ---\n${d.excerpt || ""}`)
            .join("\n\n");
          const proposalSummary = readText(dir, "ORIGINAL_PROPOSAL.md") || readText(dir, "PROPOSAL.md");

          // Classify the failure deterministically, then choose the response by
          // failure TYPE rather than by retry count alone. Repeated mechanical
          // failures restore the pre-edit bytes instead of mutating a file that
          // previous repair attempts already damaged.
          const classification = classifyFailure({
            syntax: syntax.ok === false ? syntax : undefined,
            validation: syntax.ok === false ? "" : validationText,
            proposalText: proposalSummary,
          });
          status.failureClassCounts = status.failureClassCounts || {};
          const seen = status.failureClassCounts[classification.failureClass] || 0;
          const decision = escalate(classification, {
            attemptsForClass: seen,
            teacherAvailable: Boolean(spec.teacher?.enabled),
            level: spec.level,
          });
          status.failureClassCounts[classification.failureClass] = seen + 1;
          status.lastFailureClass = classification.failureClass;
          status.lastEscalation = decision.action;
          writeText(dir, "failure-class.json", JSON.stringify({ classification, decision, at: new Date().toISOString() }, null, 2));
          appendJournal(dir, describeFailure(classification, decision));
          saveStatus(dir, status);

          if (decision.action === ACTIONS.BLOCK) {
            return block(dir, status, `${classification.failureClass}: ${decision.reason}`);
          }

          // Teacher escalation. The foreman assembles the evidence packet and
          // stops; a senior model (Cursor/Opus today, a remote teacher later)
          // answers using the contract, and its answer is validated against the
          // repository before it can influence an execution phase.
          if (decision.action === ACTIONS.TEACHER) {
            const packet = buildTeacherPacket({ missionDir: dir, spec, status, classification, files });
            const dest = join(dir, "teacher", `${String(status.phaseIndex).padStart(3, "0")}-${classification.failureClass}`);
            writeTeacherPacket(dest, packet);
            appendJournal(dir, `teacher packet written: ${dest} (${packet.totalChars} chars, withinBudget=${packet.withinBudget})`);
            status.teacherEscalations = (status.teacherEscalations || 0) + 1;
            saveStatus(dir, status);
            return block(dir, status, `${classification.failureClass}: escalated to teacher — packet at ${dest}`);
          }

          // Structural and scope facts computed by the analyzers, not inferred
          // by the model. This is the difference between "unexpected token" and
          // "line 372 closes nothing; the stack expects </EditorToolbarGroup>".
          const structure = [
            formatStructures(syntax.structures),
            formatIdentifierPacket(identGate.results),
          ].filter((s) => s && s.trim()).join("\n\n---\n\n");

          if (decision.action === ACTIONS.RESTORE_AND_REAPPLY) {
            const rolled = transactionalRestore(ctx);
            if (rolled.ok) {
              status.transactionalRetries = (status.transactionalRetries || 0) + 1;
              status.syntaxRetries = 0;
              status.identRetries = 0;
              status.syntaxGateFailed = false;
              status.emptyEditStreak = 0;
              const original = readText(dir, "ORIGINAL_PROPOSAL.md");
              if (original.trim()) writeText(dir, "PROPOSAL.md", original);
              status.forceApplyRetry = 1;
              saveStatus(dir, status);
              transition(dir, status, "EDITING", `${classification.failureClass}: restored pre-edit bytes, re-applying approved patch`);
              if (maybeStop(ctx)) return status;
              break;
            }
            appendJournal(dir, "pre-edit restore unavailable; continuing with focused repair");
          }

          const skipDiagnose = Boolean(status.forceApplyRepair);
          status.forceApplyRepair = false;
          if (!skipDiagnose) {
            log("repair diagnosis (local Qwen)…");
            beginPhase(ctx, "repair-diagnose");
            const { text } = await invoke(ctx, "repair-diagnose", repairDiagnosePrompt(spec, status, {
              proposalSummary,
              diagnostics,
              windows,
              structure,
              failureClass: classification.failureClass,
              delta: readText(dir, "CURRENT.diff"),
              invariants: (spec.acceptance || []).join("\n"),
              files,
            }));
            writeText(dir, "REPAIR_DIAGNOSIS.md", text);
            writeText(dir, "REPAIR_PROPOSAL.md", text);
            postPhaseGit(ctx, { revertAllApp: true });
          }
          log("apply repair (local Qwen)…");
          beginPhase(ctx, "repair-apply");
          await invoke(ctx, "repair-apply", applyRepairPrompt(spec, status, {
            diagnosis: readText(dir, "REPAIR_DIAGNOSIS.md") || readText(dir, "REPAIR_PROPOSAL.md"),
            files,
            diagnostics,
            structure,
          }));
          const repairGit = endPhase(ctx, { writesApp: true });
          status.lastWritePhase = "repair-apply";
          if (!repairGit.ok && status.editRetries > spec.maxRetriesPerPhase) {
            return block(dir, status, `unauthorized paths: ${(repairGit.unauthorized || []).join(", ")}`);
          }
          transition(dir, status, "DIFF_REVIEW", "repair applied");
          if (maybeStop(ctx)) return status;
          break;
        }

        case "CHECKPOINT": {
          writeCheckpoint(ctx, `phase ${status.phaseIndex}`);
          await maybeRebuildCorpus(ctx, "checkpoint");
          status.phaseIndex += 1;
          saveStatus(dir, status);
          if (status.phaseIndex >= spec.maxPhases) {
            transition(dir, status, "FINAL_REVIEW", "max phases");
          } else {
            status.forceEditAfterProposal = true;
            transition(dir, status, "PROPOSING", `next phase ${status.phaseIndex}`);
          }
          if (maybeStop(ctx)) return status;
          break;
        }

        case "FINAL_REVIEW": {
          log("final review (local Qwen)…");
          if (!ctx.snapshot) ctx.snapshot = { porcelain: [] };
          const restored = restoreMissingCheckpointFiles(dir, allowedStat(ctx).files, repoIo(ctx));
          if (restored.restored?.length) {
            appendJournal(dir, `restored checkpoint files: ${restored.restored.join(", ")}`);
          } else if (!restored.ok) {
            appendJournal(dir, `checkpoint restore failed: ${String(restored.output || "").slice(0, 400)}`);
          }
          const reviewStat = allowedStat(ctx);
          status.expectedAppDirty = reviewStat.files;
          writeText(dir, "CURRENT.diff", reviewStat.patch || "");
          writeText(dir, "diff-stat.json", JSON.stringify(reviewStat, null, 2));
          saveStatus(dir, status);
          if (!status.dryRun && spec.levelInfo?.edits && (spec.validation?.required || []).length) {
            const report = await (deps.runValidation
              ? deps.runValidation(spec, { snapshot: ctx.snapshot, log })
              : runValidation(spec, { snapshot: ctx.snapshot, log }));
            writeText(dir, "validation-final.json", JSON.stringify(report, null, 2));
            if (!report.ok) return block(dir, status, "final validation failed");
          }
          const priorFinalTools = unionToolNames(
            ...(status.invocations || []).filter((i) => String(i.phase || "").startsWith("final")).map((i) => i.tools),
          );
          const existingCritic = readText(dir, "FINAL_CRITIC.md");
          let text = existingCritic;
          let parsed = { tools: priorFinalTools };
          let gate = existingCritic.trim()
            ? evaluateCriticGate({
              criticText: existingCritic,
              planText: readText(dir, "PLAN.md"),
              proposalText: readText(dir, "PROPOSAL.md"),
              spec,
              tools: priorFinalTools,
              phase: "final",
            })
            : { pass: false, errors: ["missing-verdict"], modelVerdict: null };
          if (!gate.pass) {
            beginPhase(ctx, "final");
            const invoked = await invoke(ctx, "final", finalPrompt(spec, status, {
              plan: readText(dir, "PLAN.md"),
              proposal: readText(dir, "PROPOSAL.md"),
              critic: readText(dir, "PLAN_CRITIC.md"),
              investigation: readText(dir, "INVESTIGATION.md"),
              diff: reviewDiff(dir, status, ctx),
            }));
            text = invoked.text;
            parsed = invoked.parsed;
            writeText(dir, "FINAL_CRITIC.md", text);
            postPhaseGit(ctx, { revertAllApp: true });
            gate = evaluateCriticGate({
              criticText: text,
              planText: readText(dir, "PLAN.md"),
              proposalText: readText(dir, "PROPOSAL.md"),
              spec,
              tools: unionToolNames(parsed.tools, priorFinalTools),
              phase: "final",
            });
          }
          if (!gate.pass && (status.criticRetries || 0) < 2) {
            status.criticRetries = (status.criticRetries || 0) + 1;
            beginPhase(ctx, "final-retry");
            const retry = await invoke(ctx, "final", finalPrompt(spec, status, {
              plan: readText(dir, "PLAN.md"),
              proposal: readText(dir, "PROPOSAL.md"),
              critic: text,
              investigation: readText(dir, "INVESTIGATION.md"),
              diff: reviewDiff(dir, status, ctx),
            }));
            writeText(dir, "FINAL_CRITIC.md", retry.text);
            postPhaseGit(ctx, { revertAllApp: true });
            gate = evaluateCriticGate({
              criticText: retry.text,
              planText: readText(dir, "PLAN.md"),
              proposalText: readText(dir, "PROPOSAL.md"),
              spec,
              tools: unionToolNames(parsed.tools, retry.parsed?.tools, priorFinalTools),
              phase: "final",
            });
            text = retry.text;
          }
          writeText(dir, "final-critic-gate.json", JSON.stringify({ errors: gate.errors, pass: gate.pass, verdict: gate.modelVerdict }, null, 2));
          if (!gate.pass) {
            return block(dir, status, `final critic gate: ${gate.errors.join("; ") || gate.modelVerdict}`);
          }
          postPhaseGit(ctx, { revertAllApp: true });
          const check = diffCheckNow(ctx);
          appendJournal(dir, `final diff --check ok=${check.ok}`);
          transition(dir, status, "COMPLETE", "stop for human review");
          const facts = composeReport(status, { extra: "" });
          writeText(dir, "FINAL_REPORT.md", `${facts}\n## Model narrative\n\n${text}\n`);
          break;
        }

        default:
          return fail(dir, status, `stuck in unknown state ${status.state}`);
      }
    }
    return status;
  } catch (err) {
    if (err.budget) return block(dir, status, err.message);
    status.lastError = String(err.message || err);
    appendJournal(dir, `error: ${status.lastError}`);
    if (!isTerminal(status.state)) {
      try {
        return fail(dir, status, status.lastError);
      } catch {
        status.state = "FAILED";
        saveStatus(dir, status);
      }
    }
    return status;
  } finally {
    delete status._spec;
    saveStatus(dir, status);
    clearLock(dir);
  }
}

export { restoreGenerated, wasPathClean } from "./gitops.mjs";
