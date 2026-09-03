import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { missionsDataDir, repoRoot } from "../paths.mjs";
import { gitCapture } from "../git.mjs";
import { buildCorpus } from "../corpus/build.mjs";
import { parseMissionFile } from "./schema.mjs";
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
import { parseOpenCodeJsonl, runOpenCode, visibleReportTooThin, buriedVerdict } from "./opencode.mjs";
import {
  criticPrompt,
  editPrompt,
  emptyTextRetryPrompt,
  finalPrompt,
  investigatePrompt,
  planPrompt,
  proposalPrompt,
  repairPrompt,
} from "./prompts.mjs";
import { evaluateArtifactGate, evaluateCriticGate, checkInventedSymbolsAsync, checkProposalConcrete, proposalScopeCheck, quarantineFitsDest } from "./critic.mjs";
import {
  changesSince,
  fileSizeOk,
  gitDiffCheck,
  gitAppDiffStat,
  gitPorcelain,
  isAppPath,
  isToolingPath,
  restoreGenerated,
  revertUnauthorized,
  snapshotWorktree,
  unauthorizedChanges,
  unexpectedJunk,
  wasPathClean,
} from "./gitops.mjs";
import { runValidation, validationSummary } from "./validate.mjs";

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

function budgetHit(spec, status) {
  if (status.modelCalls >= spec.maxModelCalls) return `maxModelCalls ${spec.maxModelCalls}`;
  if (elapsed(status) >= spec.maxWallClockMs) return `maxWallClockMs ${spec.maxWallClockMs}`;
  if (status.phaseIndex > spec.maxPhases) return `maxPhases ${spec.maxPhases}`;
  return null;
}

function composeReport(status, { extra = "" } = {}) {
  const spec = status._spec || {};
  return `# FINAL_REPORT — ${status.missionId}

- state: ${status.state}
- dryRun: ${status.dryRun}
- started: ${status.startedAt}
- ended: ${status.endedAt || "(running)"}
- durationMs: ${elapsed(status)}
- model: ollama/qwen3.5:9b
- modelCalls: ${status.modelCalls}
- planRetries: ${status.planRetries}
- editRetries: ${status.editRetries}
- repairRetries: ${status.repairRetries}
- unixViolations: ${status.unixViolations}
- mcpFirstMisses: ${status.mcpFirstMisses}
- visibleTextMisses: ${status.visibleTextMisses}
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
  const hit = budgetHit(spec, status);
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
    if (status.modelCalls < spec.maxModelCalls || phase === "final" || phase === "plan-critic") {
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
        });
        if (retry.text?.trim()) text = retry.text.trim();
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

function currentPorcelain(ctx) {
  return ctx.deps.gitPorcelain ? ctx.deps.gitPorcelain() : gitPorcelain();
}

function postPhaseGit(ctx, { revertAllApp = false } = {}) {
  const { spec, status, dir } = ctx;
  try {
    const { added } = changesSince(ctx.snapshot, currentPorcelain(ctx));
    const junk = unexpectedJunk(added, spec, { dryRun: status.dryRun });
    const { unauthorized, allowed } = unauthorizedChanges(added, spec, { dryRun: status.dryRun || revertAllApp });
    const toRevert = revertAllApp
      ? added.filter((r) => !isToolingPath(r.path) && (isAppPath(r.path) || r.untracked))
      : unauthorized;
    if (junk.length) {
      appendJournal(dir, `junk files: ${junk.map((j) => j.path).join(", ")}`);
    }
    if (toRevert.length) {
      const q = join(dir, "quarantine");
      const r = revertUnauthorized(toRevert, { quarantineDir: q });
      appendJournal(dir, `reverted unauthorized: ${(r.reverted || []).join(", ")} quarantined=${r.quarantined?.length || 0}`);
      status.lastError = `unauthorized or dry-run edits: ${toRevert.map((x) => x.path).join(", ")}`;
      return { ok: false, unauthorized: toRevert, allowed, junk, reverted: r };
    }
    return { ok: true, unauthorized: [], allowed, junk };
  } catch (err) {
    appendJournal(dir, `postPhaseGit error: ${err.message}`);
    return { ok: false, error: String(err.message || err), unauthorized: [], allowed: [], junk: [] };
  }
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

function reviewDiff(dir, status) {
  const current = readText(dir, "CURRENT.diff");
  if (current.trim()) return current;
  if (status.dryRun) return "(no production diff — dry-run; ignore tooling/worktree noise)";
  const app = gitAppDiffStat();
  return app.patch || "(no application diff)";
}

function writeCheckpoint(ctx, label) {
  if (ctx.spec.checkpointPolicy === "never") return;
  const n = (ctx.status.checkpoints = (ctx.status.checkpoints || 0) + 1);
  const cdir = join(ctx.dir, "checkpoints", String(n).padStart(2, "0"));
  mkdirSync(cdir, { recursive: true });
  const stat = gitAppDiffStat();
  writeFileSync(join(cdir, "label.txt"), `${label}\n`, "utf8");
  writeFileSync(join(cdir, "status.json"), `${JSON.stringify(ctx.status, null, 2)}\n`, "utf8");
  writeFileSync(join(cdir, "diff.patch"), stat.patch || "", "utf8");
  writeFileSync(join(cdir, "files.txt"), (stat.files || []).join("\n"), "utf8");
  appendJournal(ctx.dir, `checkpoint ${n} ${label} files=${stat.files.length}`);
}

export async function runMission({
  specPath,
  resumeId,
  dryRun = false,
  stopAfter = null,
  approveAudioEdit = false,
  retry = false,
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
          const pf = await runPreflight(spec, deps);
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
          }, null, 2));
          if (!pf.ok) return block(dir, status, pf.errors.join("; "));
          await maybeRebuildCorpus(ctx, "start");
          ctx.snapshot = deps.snapshotWorktree ? deps.snapshotWorktree() : snapshotWorktree();
          if (maybeStop(ctx)) return status;
          transition(dir, status, "INVESTIGATING", "preflight ok");
          break;
        }

        case "INVESTIGATING": {
          log("investigating (local Qwen)…");
          const { text } = await invoke(ctx, "investigate", investigatePrompt(spec, status));
          writeText(dir, "INVESTIGATION.md", text);
          const git = postPhaseGit(ctx, { revertAllApp: true });
          if (!git.ok) {
            status.editRetries += 1;
            if (status.editRetries > spec.maxRetriesPerPhase) {
              return block(dir, status, `investigation created unauthorized files: ${status.lastError}`);
            }
          }
          transition(dir, status, "PLANNING");
          if (maybeStop(ctx)) return status;
          break;
        }

        case "PLANNING": {
          log("planning (local Qwen)…");
          const investigation = readText(dir, "INVESTIGATION.md");
          const { text } = await invoke(ctx, "plan", planPrompt(spec, status, investigation));
          writeText(dir, "PLAN.md", text);
          const git = postPhaseGit(ctx, { revertAllApp: true });
          ingestThinDump(dir, text, git, "PLAN.md");
          transition(dir, status, "PLAN_REVIEW");
          if (maybeStop(ctx)) return status;
          break;
        }

        case "PLAN_REVIEW": {
          log("plan critic (local Qwen)…");
          ingestThinDump(dir, readText(dir, "PLAN.md"), {}, "PLAN.md");
          const plan = readText(dir, "PLAN.md");
          let { text, parsed } = await invoke(ctx, "plan-critic", criticPrompt(spec, status, { plan }));
          writeText(dir, "PLAN_CRITIC.md", text);
          postPhaseGit(ctx, { revertAllApp: true });
          let gate = evaluateCriticGate({
            criticText: text,
            planText: plan,
            spec,
            tools: parsed.tools || [],
          });
          if ((!gate.toolsGate.ok || gate.missingVerdict) && (status.criticRetries || 0) < 1) {
            status.criticRetries = (status.criticRetries || 0) + 1;
            appendJournal(dir, "critic format/tools weak; retrying critic once");
            const retry = await invoke(ctx, "plan-critic", criticPrompt(spec, status, {
              plan,
              extra: "Previous critic output was missing a one-line VERDICT: PASS|FAIL|BLOCK or used zero retrieval tools. Inspect real files, then output INSPECTED, RISK, EVIDENCE, and VERDICT: PASS (or FAIL) on its own line.",
            }));
            text = retry.text;
            parsed = retry.parsed;
            writeText(dir, "PLAN_CRITIC.md", text);
            postPhaseGit(ctx, { revertAllApp: true });
            gate = evaluateCriticGate({
              criticText: text,
              planText: plan,
              spec,
              tools: parsed.tools || [],
            });
          }
          writeText(dir, "critic-gate.json", JSON.stringify({
            errors: gate.errors,
            pass: gate.pass,
            modelVerdict: gate.modelVerdict,
            missing: gate.planFiles?.missing,
          }, null, 2));
          if (gate.modelVerdict === "BLOCK") return block(dir, status, `plan critic BLOCK: ${gate.errors.join("; ") || "unspecified"}`);
          if (!gate.pass) {
            status.planRetries += 1;
            if (status.planRetries > spec.maxRetriesPerPhase) {
              return block(dir, status, `plan critic gate failed: ${gate.errors.join("; ") || gate.modelVerdict}`);
            }
            appendJournal(dir, `plan critic gate ${gate.modelVerdict} ${gate.errors.join(",")}; revising plan`);
            transition(dir, status, "PLANNING", `critic ${gate.errors.join(",") || gate.modelVerdict}`);
            break;
          }
          transition(dir, status, "PROPOSING", "plan critic PASS");
          if (maybeStop(ctx)) return status;
          break;
        }

        case "PROPOSING": {
          log(`proposal round ${status.proposalRound + 1} (local Qwen)…`);
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
          status.forceEditAfterProposal = false;
          if (!canEdit) {
            transition(dir, status, "FINAL_REVIEW", "dry-run or read-only — no edits");
          } else {
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
          log("editing (local Qwen)…");
          const proposal = readText(dir, "PROPOSAL.md");
          const plan = readText(dir, "PLAN.md");
          await invoke(ctx, "edit", editPrompt(spec, status, { proposal, plan }));
          transition(dir, status, "DIFF_REVIEW");
          if (maybeStop(ctx)) return status;
          break;
        }

        case "DIFF_REVIEW": {
          const { added } = changesSince(ctx.snapshot, currentPorcelain(ctx));
          const { unauthorized, allowed } = unauthorizedChanges(added, spec, { dryRun: status.dryRun });
          const check = gitDiffCheck();
          writeText(dir, "diff-check.json", JSON.stringify({
            ok: check.ok,
            output: check.output,
            args: check.args,
            unauthorized: unauthorized.map((r) => r.path),
            allowed: allowed.map((r) => r.path),
          }, null, 2));
          if (unauthorized.length) {
            revertUnauthorized(unauthorized, { quarantineDir: join(dir, "quarantine") });
            status.editRetries += 1;
            if (status.editRetries > spec.maxRetriesPerPhase) {
              return block(dir, status, `unauthorized paths: ${unauthorized.map((r) => r.path).join(", ")}`);
            }
            transition(dir, status, "EDITING", "revert unauthorized; retry");
            break;
          }
          const stat = gitAppDiffStat();
          writeText(dir, "diff-stat.json", JSON.stringify(stat, null, 2));
          writeText(dir, "CURRENT.diff", stat.patch || "");
          const size = fileSizeOk(stat, spec);
          if (size.warn) {
            status.warnings.push(`diff size files=${stat.files.length} insertions=${stat.insertions}`);
            if (size.block) return block(dir, status, "diff exceeded hard thresholds");
          }
          if (!check.ok) {
            status.warnings.push(`git diff --check: ${check.output.slice(0, 400)}`);
          }
          status.expectedAppDirty = allowed.map((r) => r.path);
          saveStatus(dir, status);
          transition(dir, status, "VALIDATING", `${allowed.length} allowed files`);
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
          log("repair diagnosis (local Qwen)…");
          const { text } = await invoke(ctx, "repair", repairPrompt(spec, status, {
            plan: readText(dir, "PLAN.md"),
            proposal: readText(dir, "PROPOSAL.md"),
            validation: readText(dir, "validation.json"),
            diff: readText(dir, "CURRENT.diff"),
          }));
          writeText(dir, "REPAIR_PROPOSAL.md", text);
          writeText(dir, "PROPOSAL.md", text);
          postPhaseGit(ctx, { revertAllApp: false });
          status.forceEditAfterProposal = true;
          transition(dir, status, "PROPOSING", "repair proposal");
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
          if (!status.dryRun && spec.levelInfo?.edits && (spec.validation?.required || []).length) {
            const report = await runValidation(spec, { snapshot: ctx.snapshot, log });
            writeText(dir, "validation-final.json", JSON.stringify(report, null, 2));
            if (!report.ok) return block(dir, status, "final validation failed");
          }
          let { text, parsed } = await invoke(ctx, "final", finalPrompt(spec, status, {
            plan: readText(dir, "PLAN.md"),
            proposal: readText(dir, "PROPOSAL.md"),
            critic: readText(dir, "PLAN_CRITIC.md"),
            investigation: readText(dir, "INVESTIGATION.md"),
            diff: reviewDiff(dir, status),
          }));
          writeText(dir, "FINAL_CRITIC.md", text);
          let gate = evaluateCriticGate({
            criticText: text,
            planText: readText(dir, "PLAN.md"),
            proposalText: readText(dir, "PROPOSAL.md"),
            spec,
            tools: parsed.tools || [],
          });
          if (!gate.pass && (status.criticRetries || 0) < 2) {
            status.criticRetries = (status.criticRetries || 0) + 1;
            const retry = await invoke(ctx, "final", finalPrompt(spec, status, {
              plan: readText(dir, "PLAN.md"),
              proposal: readText(dir, "PROPOSAL.md"),
              critic: text,
              investigation: readText(dir, "INVESTIGATION.md"),
              diff: reviewDiff(dir, status),
            }));
            writeText(dir, "FINAL_CRITIC.md", retry.text);
            gate = evaluateCriticGate({
              criticText: retry.text,
              planText: readText(dir, "PLAN.md"),
              proposalText: readText(dir, "PROPOSAL.md"),
              spec,
              tools: retry.parsed?.tools || [],
            });
            text = retry.text;
          }
          writeText(dir, "final-critic-gate.json", JSON.stringify({ errors: gate.errors, pass: gate.pass, verdict: gate.modelVerdict }, null, 2));
          if (!gate.pass) {
            return block(dir, status, `final critic gate: ${gate.errors.join("; ") || gate.modelVerdict}`);
          }
          postPhaseGit(ctx, { revertAllApp: status.dryRun || !spec.levelInfo?.edits });
          const check = gitDiffCheck();
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

export { restoreGenerated, wasPathClean };
