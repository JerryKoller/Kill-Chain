import { spawn } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "../paths.mjs";
import { normalizeModelId } from "./model.mjs";
import { isKillchainMcpTool, scanUnixTools } from "./unix.mjs";
import { sanitizeGlText } from "../overnight/probeShape.mjs";

const OPENCODE_CANDIDATES = [
  process.env.OPENCODE_BIN,
  join(process.env.APPDATA || "", "npm/node_modules/opencode-ai/bin/opencode.exe"),
  join(process.env.APPDATA || "", "npm/opencode.exe"),
].filter(Boolean);

export function findOpenCodeBin() {
  for (const p of OPENCODE_CANDIDATES) {
    if (p && existsSync(p)) return p;
  }
  return "opencode";
}

export function parseOpenCodeJsonl(raw) {
  const tools = [];
  const texts = [];
  let lastReason = "";
  let firstTool = null;
  const lines = String(raw || "").split(/\n/);
  for (const line of lines) {
    const t = line.trim();
    if (!t.startsWith("{")) continue;
    let e;
    try {
      e = JSON.parse(t);
    } catch {
      continue;
    }
    const p = e.part || e;
    const type = p.type || e.type;
    if (type === "tool" || type === "tool_use" || type === "tool-call") {
      const name = p.tool || p.name || e.tool || "";
      const entry = {
        tool: name,
        input: p.state?.input || p.input || p.args || e.input || {},
      };
      if (!firstTool && name) firstTool = name;
      if (name) tools.push(entry);
    }
    if (type === "text" && (p.text || e.text)) texts.push(p.text || e.text);
    if ((type === "reasoning" || type === "thinking") && (p.text || e.text)) {
      lastReason = p.text || e.text;
    }
  }
  const text = texts.join("\n\n").trim();
  const unixViolations = scanUnixTools(tools);
  return {
    firstTool,
    tools: tools.map((x) => x.tool),
    toolEntries: tools,
    text,
    reasoning: lastReason,
    visibleTextMissing: text.length === 0,
    mcpFirst: isKillchainMcpTool(firstTool),
    unixViolations,
    tokens: parseOpenCodeTokens(raw),
  };
}

/** Last step_finish token snapshot (OpenCode totals are cumulative). */
export function parseOpenCodeTokens(raw) {
  let last = null;
  for (const line of String(raw || "").split(/\n/)) {
    const t = line.trim();
    if (!t.startsWith("{")) continue;
    let e;
    try {
      e = JSON.parse(t);
    } catch {
      continue;
    }
    const p = e.part || e;
    const type = p.type || e.type;
    if (type === "step_finish" || type === "step-finish") {
      const tok = p.tokens || e.tokens;
      if (tok && typeof tok === "object") last = tok;
    }
  }
  if (!last) return null;
  return {
    total: Number(last.total || 0) || null,
    input: Number(last.input || 0) || null,
    output: Number(last.output || 0) || null,
    reasoning: Number(last.reasoning || 0) || 0,
  };
}

const REPORT_PHASES = new Set(["plan", "plan-critic", "proposal", "final"]);

export function visibleReportTooThin(phase, text, parsed = {}) {
  const t = String(text || "").trim();
  if (t.length === 0) return true;
  if (t.length >= 400) return false;
  return REPORT_PHASES.has(String(phase || ""));
}

export function buriedVerdict(reasoning) {
  const raw = String(reasoning || "");
  if (raw.length < 200) return "";
  if (!/VERDICT:\s*\**\s*(PASS|FAIL|BLOCK|READY|NOT_READY)|#{1,3}\s*VERDICT\b/i.test(raw)) return "";
  return raw.length > 12000 ? raw.slice(-12000) : raw;
}

export function extractVisible(parsed) {
  if (parsed.text) return parsed.text;
  if (parsed.reasoning) return parsed.reasoning.slice(-8000);
  return "";
}

export function killTree(child) {
  try {
    child.kill("SIGTERM");
  } catch {
    /* ignore */
  }
  if (process.platform === "win32" && child.pid) {
    spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
  }
}

export function openCodeRunArgs({
  prompt,
  title,
  cwd = repoRoot,
  model,
} = {}) {
  const args = [
    "run",
    "--format", "json",
    "--auto",
    "--thinking",
    "--title", title || "kc-mission",
    "--dir", cwd,
  ];
  if (model) {
    args.push("-m", normalizeModelId(model));
  }
  args.push(sanitizeGlText(prompt));
  return args;
}

export function runOpenCode({
  prompt,
  title,
  outPath,
  timeoutMs = 12 * 60 * 1000,
  cwd = repoRoot,
  bin = findOpenCodeBin(),
  model,
} = {}) {
  return new Promise((resolve, reject) => {
    mkdirSync(join(outPath, ".."), { recursive: true });
    const errPath = outPath.replace(/\.jsonl?$/i, ".err");
    const out = createWriteStream(outPath);
    const err = createWriteStream(errPath);
    const args = openCodeRunArgs({ prompt, title, cwd, model });
    const child = spawn(bin, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let settled = false;
    const started = Date.now();
    child.stdout.pipe(out);
    child.stderr.pipe(err);
    const timer = setTimeout(() => {
      killTree(child);
      finish(new Error(`OpenCode timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    function finish(error, code) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      out.end();
      err.end();
      if (error) {
        error.outPath = outPath;
        error.durationMs = Date.now() - started;
        reject(error);
        return;
      }
      let raw = "";
      try {
        raw = readFileSync(outPath, "utf8");
      } catch {
        raw = "";
      }
      const parsed = parseOpenCodeJsonl(raw);
      resolve({
        exitCode: code ?? 1,
        durationMs: Date.now() - started,
        outPath,
        errPath,
        parsed,
        text: extractVisible(parsed),
      });
    }

    child.on("error", (e) => finish(e));
    child.on("exit", (code) => finish(null, code ?? 1));
  });
}

export async function opencodeVersion(bin = findOpenCodeBin()) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, ["--version"], {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { err += d; });
    const t = setTimeout(() => {
      killTree(child);
      reject(new Error("opencode --version timed out"));
    }, 15000);
    child.on("error", (e) => {
      clearTimeout(t);
      reject(e);
    });
    child.on("exit", (code) => {
      clearTimeout(t);
      if (code !== 0) reject(new Error(`opencode --version exit ${code}: ${err || out}`));
      else resolve((out || err).trim());
    });
  });
}

export async function opencodeMcpList(bin = findOpenCodeBin(), cwd = repoRoot) {
  return new Promise((resolve) => {
    const child = spawn(bin, ["mcp", "list"], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { err += d; });
    const t = setTimeout(() => {
      killTree(child);
      resolve({ ok: false, connected: false, text: "timeout", out, err });
    }, 30000);
    child.on("error", (e) => {
      clearTimeout(t);
      resolve({ ok: false, connected: false, text: String(e), out, err });
    });
    child.on("exit", (code) => {
      clearTimeout(t);
      const text = `${out}\n${err}`;
      const connected = /killchain/i.test(text) && !/disconnected|error|failed/i.test(text.split("\n").find((l) => /killchain/i.test(l)) || "");
      const line = text.split(/\r?\n/).find((l) => /killchain/i.test(l)) || "";
      const failed = /disconnected|not connected|error|failed/i.test(line);
      resolve({
        ok: code === 0,
        connected: /killchain/i.test(text) && !failed,
        text: text.trim().slice(0, 2000),
        line,
      });
    });
  });
}
