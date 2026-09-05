/**
 * Headless supervisor invocation.
 *
 * The human should never need an interactive OpenCode window for this, so every
 * supervisor call is a fresh non-interactive `opencode run`.
 *
 * Flags verified against the installed OpenCode 1.18.29 via `opencode run --help`:
 *   --format json   raw JSON event stream on stdout
 *   -m/--model      provider/model
 *   --title         session title
 *   --dir           working directory
 *   --variant       provider-specific reasoning effort
 *   --agent         named agent
 * There is no --timeout flag, so wall-clock limits are enforced by killing the
 * process tree.
 *
 * Two deliberate safety choices:
 *   - `--auto` is NOT passed. Supervisors reason over a supplied evidence pack;
 *     they are never auto-approved to act.
 *   - `--dir` points at an empty sandbox under data/, not the repo. A supervisor
 *     that tries to touch production finds nothing to touch.
 */
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";

import { findOpenCodeBin, killTree } from "../mission/opencode.mjs";
import { sanitizeGlText } from "../overnight/probeShape.mjs";
import { ensureDir, mediatorCallsDir, ensureMediatorDirs } from "./paths.mjs";
import {
  SUPERVISOR_CONTRACT,
  formatRepairPrompt,
  validateSupervisorResult,
} from "./supervisorProtocol.mjs";
import { renderEvidencePack } from "./trust.mjs";

export const ROLES = ["FAST_SUPERVISOR", "DEEP_SUPERVISOR", "VISUAL_REVIEW", "ROBO_PUPPY"];

/**
 * Role-aware wall clocks. Live DEEP successes in run_mto1hfmy_e7aeb7 were
 * 43s and 65s; the previous 900s default let one hung Nemotron abort the night.
 * Configurable via KILLCHAIN_DEEP_TIMEOUT_MS / KILLCHAIN_FAST_TIMEOUT_MS.
 */
export const SUPERVISOR_TIMEOUT_MS = {
  FAST_SUPERVISOR: 90_000,
  DEEP_SUPERVISOR: 180_000,
  VISUAL_REVIEW: 180_000,
};

function envMs(name) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function supervisorTimeoutMs(role, override) {
  if (Number.isFinite(override) && override > 0) return override;
  if (role === "DEEP_SUPERVISOR") return envMs("KILLCHAIN_DEEP_TIMEOUT_MS") || SUPERVISOR_TIMEOUT_MS.DEEP_SUPERVISOR;
  if (role === "FAST_SUPERVISOR") return envMs("KILLCHAIN_FAST_TIMEOUT_MS") || SUPERVISOR_TIMEOUT_MS.FAST_SUPERVISOR;
  if (role === "VISUAL_REVIEW") return envMs("KILLCHAIN_VISUAL_TIMEOUT_MS") || SUPERVISOR_TIMEOUT_MS.VISUAL_REVIEW;
  return SUPERVISOR_TIMEOUT_MS.FAST_SUPERVISOR;
}

/**
 * Isolated cwd for supervisor sessions.
 *
 * This MUST live outside any git repository. OpenCode resolves a project root by
 * walking up for a `.git` directory and takes a stash-style snapshot of that
 * worktree; if the sandbox sat inside the Kill Chain repo, an OpenCode session
 * could restore that snapshot and silently revert uncommitted work. Putting the
 * sandbox in the OS temp directory means the only worktree OpenCode can see is
 * an empty scratch folder.
 */
export function supervisorSandbox() {
  const dir = join(tmpdir(), "kc-mediator-sandbox");
  ensureDir(dir);
  assertNotInGitRepo(dir);
  const readme = join(dir, "README.txt");
  if (!existsSync(readme)) {
    writeFileSync(
      readme,
      "Isolated working directory for Kill Chain Mediator supervisor calls.\n"
        + "Deliberately outside any git repository so OpenCode cannot snapshot or\n"
        + "restore the Kill Chain worktree. Nothing here is meaningful state.\n",
      "utf8",
    );
  }
  return dir;
}

/** Refuse to run supervisors anywhere a git worktree could be snapshotted. */
export function assertNotInGitRepo(dir) {
  let cur = resolve(dir);
  for (;;) {
    if (existsSync(join(cur, ".git"))) {
      throw new Error(
        `refusing to run a supervisor session inside a git repository (${cur}). `
        + "OpenCode snapshots the enclosing worktree and can revert uncommitted work.",
      );
    }
    const up = dirname(cur);
    if (up === cur) return true;
    cur = up;
  }
}

export function supervisorRunArgs({ prompt, model, title = "kc-mediator", cwd, variant = null, agent = null }) {
  const args = ["run", "--format", "json", "--title", title, "--dir", cwd];
  if (model) args.push("-m", model);
  if (variant) args.push("--variant", variant);
  if (agent) args.push("--agent", agent);
  // Evidence is real captured output, and real compiler logs contain NUL bytes.
  // Node's spawn throws synchronously on argv containing NUL, so sanitize the
  // same way the mission path does rather than losing the evidence.
  args.push(sanitizeGlText(prompt));
  return args;
}

/**
 * Parse the `--format json` event stream.
 * Verified shape: `{type:"text",part:{type:"text",text}}` and
 * `{type:"step_finish",part:{tokens,cost}}`.
 */
export function parseSupervisorStream(raw) {
  const lines = String(raw || "").replace(/\r/g, "").split("\n").filter((l) => l.trim());
  let text = "";
  let tokens = null;
  let cost = null;
  let sessionID = null;
  let finishReason = null;
  const errors = [];
  for (const line of lines) {
    let evt;
    try {
      evt = JSON.parse(line);
    } catch {
      continue;
    }
    if (evt.sessionID) sessionID = evt.sessionID;
    const part = evt.part || {};
    if (part.type === "text" && typeof part.text === "string") text += part.text;
    if (part.type === "step-finish") {
      if (part.tokens) tokens = part.tokens;
      if (typeof part.cost === "number") cost = (cost ?? 0) + part.cost;
      if (part.reason) finishReason = part.reason;
    }
    if (evt.type === "error" || part.type === "error") {
      errors.push(typeof evt.error === "string" ? evt.error : JSON.stringify(evt.error ?? part));
    }
  }
  return { text: text.trim(), tokens, cost, sessionID, finishReason, errors, eventCount: lines.length };
}

/**
 * One raw supervisor call. Never throws for model-side failure — the caller
 * needs the failure as data so it can route around it.
 */
export async function invokeSupervisor({
  prompt,
  model,
  role = null,
  title = "kc-mediator",
  timeoutMs,
  variant = null,
  agent = null,
  signal = null,
  bin = null,
  log = null,
  args: argsOverride = null,
} = {}) {
  ensureMediatorDirs();
  const callId = `c_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;
  const cwd = supervisorSandbox();
  const outPath = join(ensureDir(mediatorCallsDir), `${callId}.jsonl`);
  const args = argsOverride || supervisorRunArgs({ prompt, model, title, cwd, variant, agent });
  const startedAt = Date.now();
  const limit = supervisorTimeoutMs(role, timeoutMs);

  const base = { callId, role, model, startedAt, outPath, args, timeoutMs: limit };

  if (signal?.aborted) {
    return { ...base, ok: false, cancelled: true, timedOut: false, durationMs: 0, text: "", stderr: "", exitCode: null, error: "cancelled-before-start" };
  }

  let child;
  try {
    child = spawn(bin || findOpenCodeBin(), args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
  } catch (err) {
    return { ...base, ok: false, cancelled: false, timedOut: false, durationMs: Date.now() - startedAt, text: "", stderr: String(err?.message || err), exitCode: null, error: "spawn-failed" };
  }

  let stdout = "";
  let stderr = "";
  let timedOut = false;
  let cancelled = false;

  const onAbort = () => {
    cancelled = true;
    killTree(child);
  };
  if (signal) signal.addEventListener("abort", onAbort, { once: true });

  const timer = setTimeout(() => {
    timedOut = true;
    killTree(child);
  }, limit);

  const exitCode = await new Promise((resolve) => {
    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); });
    child.on("error", (err) => {
      stderr += `\n${String(err?.message || err)}`;
      resolve(null);
    });
    child.on("close", (code) => resolve(code));
  });

  clearTimeout(timer);
  if (signal) signal.removeEventListener("abort", onAbort);

  const durationMs = Date.now() - startedAt;
  try {
    writeFileSync(outPath, stdout, "utf8");
  } catch {
    /* transcript is a convenience, not correctness */
  }

  const parsed = parseSupervisorStream(stdout);
  const ok = exitCode === 0 && !timedOut && !cancelled && Boolean(parsed.text);
  if (log) {
    log(`  ${role || "supervisor"} ${model} → ${ok ? "ok" : timedOut ? "timeout" : cancelled ? "cancelled" : "failed"} in ${(durationMs / 1000).toFixed(1)}s`);
  }

  return {
    ...base,
    ok,
    cancelled,
    timedOut,
    durationMs,
    exitCode,
    text: parsed.text,
    tokens: parsed.tokens,
    observedCost: parsed.cost,
    sessionID: parsed.sessionID,
    finishReason: parsed.finishReason,
    stderr: stderr.trim(),
    streamErrors: parsed.errors,
    error: ok ? null : timedOut ? "timeout" : cancelled ? "cancelled" : parsed.errors[0] || stderr.trim() || "no-visible-text",
  };
}

/** Assemble the full supervisor prompt. Evidence is rendered with stable refs. */
export function buildSupervisorPrompt({ role, humanBrief, operationalObjective, situation, pack, spec, extra = "" }) {
  const scope = spec
    ? [
      `mission: ${spec.id || "(none)"}  level: ${spec.level ?? "?"}`,
      `allowedPaths: ${(spec.allowedPaths || []).join(", ") || "(none)"}`,
      `forbiddenPaths: ${(spec.forbiddenPaths || []).join(", ") || "(none)"}`,
    ].join("\n")
    : "(no mission spec bound)";

  return `You are the ${role.replace(/_/g, " ").toLowerCase()} of the Kill Chain Mediator.

You supervise Robo Puppy, a small local model (ollama/qwen3.5:9b) that does the
actual implementation work. You direct and teach him. You do not take the
keyboard away from him unless the work is genuinely beyond a worker of his size.

TRUST BOUNDARY
Your reasoning is not evidence. Another model's prose is not evidence.
Only the numbered items under TRUSTED EVIDENCE are evidence.
Cite the refs you actually used.

ORIGINAL HUMAN BRIEF
${String(humanBrief || "(none supplied)").slice(0, 8000)}

CURRENT OPERATIONAL OBJECTIVE
${String(operationalObjective || "(none yet — propose the first micro-objective)")}

SITUATION
${String(situation || "(no situation supplied)")}

SCOPE
${scope}

TRUSTED EVIDENCE
${renderEvidencePack(pack)}
${extra ? `\n${extra}\n` : ""}
${SUPERVISOR_CONTRACT}`;
}

/**
 * Full supervisor turn: invoke, validate, and allow exactly one cheap format
 * repair. A malformed reply never becomes a decision.
 */
export async function askSupervisor({
  role,
  model,
  prompt,
  pack = null,
  spec = null,
  timeoutMs,
  variant = null,
  signal = null,
  title = "kc-mediator",
  log = null,
  invoke = invokeSupervisor,
} = {}) {
  const calls = [];
  const first = await invoke({ prompt, model, role, timeoutMs, variant, signal, title, log });
  calls.push(first);

  if (!first.ok) {
    return { ok: false, reason: first.error || "invoke-failed", calls, result: null, validation: null, repaired: false };
  }

  let validation = validateSupervisorResult(first.text, { pack, spec, role });
  if (validation.ok) {
    return { ok: true, reason: null, calls, result: validation.result, validation, repaired: false };
  }

  // Substantive problems (widened scope, invented evidence refs) are not a
  // formatting accident and must not be re-rolled into a decision.
  if (!validation.formatOnly) {
    return { ok: false, reason: `invalid-supervisor-result:${validation.errors.join(",")}`, calls, result: null, validation, repaired: false };
  }

  const repair = await invoke({
    prompt: formatRepairPrompt(first.text, validation.errors),
    model,
    role,
    timeoutMs,
    variant,
    signal,
    title: `${title}-format-repair`,
    log,
  });
  calls.push(repair);

  if (!repair.ok) {
    return { ok: false, reason: repair.error || "repair-invoke-failed", calls, result: null, validation, repaired: true };
  }

  validation = validateSupervisorResult(repair.text, { pack, spec, role });
  if (!validation.ok) {
    return { ok: false, reason: `invalid-after-repair:${validation.errors.join(",")}`, calls, result: null, validation, repaired: true };
  }
  return { ok: true, reason: null, calls, result: validation.result, validation, repaired: true };
}

export function readCallTranscript(callId) {
  const p = join(mediatorCallsDir, `${callId}.jsonl`);
  if (!existsSync(p)) return null;
  try {
    return readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

export { mkdirSync };
