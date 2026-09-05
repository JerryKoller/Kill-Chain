/**
 * Tooling-only Singularity harness server + capture.
 * Does not touch production code, port 5173, or Electron.
 */
import { createServer } from "node:net";
import { spawn, execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { dataDir, repoRoot, toolsRoot } from "../paths.mjs";
import { launchHeadlessChrome } from "./cdp.mjs";
import { pngStats } from "./pngStats.mjs";
import { screenImage, screenVerdict } from "./visualCritic.mjs";
import { sanitizeGlTree, truthFromProbe } from "../overnight/probeShape.mjs";
import {
  DEFAULT_CAPTURE,
  harnessUrl,
  isPhase,
} from "../../harness/syntheticIntel.mjs";

export const HARNESS_MARKER = "kc-singularity-harness";
export const APP_PORT = 5173;
export const PREFERRED_PORT = 5174;
export const WATCH_PORT_RESERVED = 5176;
/** Never 5173 (app) or 5176 (puppy watch). */
export const PORT_SCAN = [5174, 5175, 5180, 5182, 5183, 5184];
const CDP_PORT = 9340;

export function diaryDir() {
  const dir = join(dataDir, "missions", "singularity-visual-overhaul", "diary");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function harnessStatePath() {
  const dir = join(dataDir, "harness");
  mkdirSync(dir, { recursive: true });
  return join(dir, "server.json");
}

function viteBin() {
  const p = join(repoRoot, "node_modules", "vite", "bin", "vite.js");
  if (!existsSync(p)) throw new Error(`vite not found at ${p}`);
  return p;
}

function viteConfig() {
  return join(toolsRoot, "harness", "vite.config.ts");
}

export function portFree(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const s = createServer();
    s.unref();
    s.once("error", () => resolve(false));
    s.listen(port, host, () => {
      s.close(() => resolve(true));
    });
  });
}

export async function pickHarnessPort({ preferred = PREFERRED_PORT } = {}) {
  const order = [preferred, ...PORT_SCAN.filter((p) => p !== preferred)];
  for (const port of order) {
    if (port === APP_PORT || port === WATCH_PORT_RESERVED) continue;
    if (await portFree(port)) return { port, reused: false, occupied: false };
    if (await isOurHarness(port)) return { port, reused: true, occupied: true };
  }
  throw new Error(`no free harness port in ${order.join(", ")} (never ${APP_PORT} or ${WATCH_PORT_RESERVED})`);
}

export async function isOurHarness(port) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1500) });
    if (!r.ok) return false;
    const html = await r.text();
    return html.includes(HARNESS_MARKER);
  } catch {
    return false;
  }
}

async function waitForHarness(port, timeoutMs = 30000) {
  const t0 = Date.now();
  let last = "";
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/`);
      last = `http ${r.status}`;
      if (r.ok) {
        const html = await r.text();
        if (html.includes(HARNESS_MARKER)) return true;
        last = "http ok but not harness marker";
      }
    } catch (e) {
      last = e.message;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`harness on :${port} never became ready (${last})`);
}

function readState() {
  try {
    return JSON.parse(readFileSync(harnessStatePath(), "utf8"));
  } catch {
    return null;
  }
}

function writeState(state) {
  writeFileSync(harnessStatePath(), `${JSON.stringify(state, null, 2)}\n`);
}

/**
 * Start Vite for the harness if needed. Never binds 5173. Never kills others.
 */
export async function ensureHarnessServer({ preferredPort = PREFERRED_PORT, log = () => {} } = {}) {
  const existing = readState();
  if (existing?.port && await isOurHarness(existing.port)) {
    log(`reusing harness on :${existing.port}`);
    return { origin: `http://127.0.0.1:${existing.port}`, port: existing.port, started: false, reused: true };
  }

  const picked = await pickHarnessPort({ preferred: preferredPort });
  if (picked.reused) {
    const state = {
      at: new Date().toISOString(),
      port: picked.port,
      origin: `http://127.0.0.1:${picked.port}`,
      pid: null,
      startedByUs: false,
    };
    writeState(state);
    log(`reusing existing harness on :${picked.port}`);
    return { ...state, started: false, reused: true };
  }

  const port = picked.port;
  const config = viteConfig();
  const logFile = join(dataDir, "harness", "vite.log");
  mkdirSync(join(dataDir, "harness"), { recursive: true });
  const child = spawn(
    process.execPath,
    [viteBin(), "--config", config, "--port", String(port), "--strictPort", "--host", "127.0.0.1"],
    {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      detached: true,
      env: { ...process.env, BROWSER: "none" },
    },
  );
  child.unref();
  const chunks = [];
  child.stdout?.on("data", (d) => chunks.push(d));
  child.stderr?.on("data", (d) => chunks.push(d));
  child.on("exit", (code) => {
    try {
      writeFileSync(logFile, Buffer.concat(chunks).toString("utf8") || `exit ${code}\n`);
    } catch { /* ignore */ }
    const cur = readState();
    if (cur?.pid === child.pid) {
      try { unlinkSync(harnessStatePath()); } catch { /* ignore */ }
    }
  });
  try {
    await waitForHarness(port);
  } catch (e) {
    try { child.kill(); } catch { /* ignore */ }
    writeFileSync(logFile, Buffer.concat(chunks).toString("utf8") + `\n${e.message}\n`);
    throw e;
  }
  const state = {
    at: new Date().toISOString(),
    port,
    origin: `http://127.0.0.1:${port}`,
    pid: child.pid,
    startedByUs: true,
  };
  writeState(state);
  log(`harness listening on :${port}`);
  return { ...state, started: true, reused: false, child };
}

function killPidTree(pid) {
  if (!pid || pid === process.pid) return;
  try {
    if (process.platform === "win32") {
      execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      process.kill(pid, "SIGTERM");
    }
  } catch {
    /* already gone */
  }
}

/**
 * Restart only the tooling harness we recorded. Never 5173. Never puppy watch.
 */
export async function restartHarnessServer({ log = () => {} } = {}) {
  const existing = readState();
  if (existing?.port === APP_PORT || existing?.port === WATCH_PORT_RESERVED) {
    throw new Error("refusing to restart a reserved port");
  }
  if (existing?.pid && existing.startedByUs) {
    log(`stopping harness pid ${existing.pid} on :${existing.port}`);
    killPidTree(existing.pid);
    try { unlinkSync(harnessStatePath()); } catch { /* ignore */ }
    await new Promise((r) => setTimeout(r, 400));
  } else if (existing?.port && await isOurHarness(existing.port) && existing.pid) {
    log(`stopping reused harness pid ${existing.pid} on :${existing.port}`);
    killPidTree(existing.pid);
    try { unlinkSync(harnessStatePath()); } catch { /* ignore */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  return ensureHarnessServer({ log });
}

async function waitReady(client, { timeoutMs = 20000 } = {}) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < timeoutMs) {
    const ev = await client.send("Runtime.evaluate", {
      expression: `window.__kcSingularityHarness ? {
        ready: window.__kcSingularityHarness.ready,
        frozen: window.__kcSingularityHarness.frozen,
        pipeline: window.__kcSingularityHarness.pipeline,
        webgl2Requested: window.__kcSingularityHarness.webgl2Requested,
        webgl2Got: window.__kcSingularityHarness.webgl2Got,
        probe: window.__kcSingularityHarness.probe || null,
        phase: window.__kcSingularityHarness.phase,
        frame: window.__kcSingularityHarness.frame,
        marker: window.__kcSingularityHarness.marker
      } : { ready: false }`,
      returnByValue: true,
    });
    last = ev.result?.value || null;
    if (last?.ready && last?.marker === HARNESS_MARKER) {
      if (last.probe) last.probe = sanitizeGlTree(last.probe);
      return last;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`harness page never published ready state: ${JSON.stringify(last)}`);
}

function decodePngDataUrl(dataUrl) {
  const m = String(dataUrl || "").match(/^data:image\/png;base64,(.+)$/);
  if (!m) throw new Error("snapshot was not a png data URL");
  return Buffer.from(m[1], "base64");
}

async function captureOnce({
  url, outPath, width, height, port, gpu, headless, origin, phase, freezeAt, log,
}) {
  const session = await launchHeadlessChrome({
    url,
    width,
    height,
    port,
    gpu,
    headless,
  });
  const diag = { url, origin, phase, freezeAt, width, height, gpu, headless, appPortUntouched: APP_PORT };
  try {
    await session.client.send("Page.enable");
    await session.client.send("Runtime.enable");
    const status = await waitReady(session.client);
    diag.status = status;
    const snap = await session.client.send("Runtime.evaluate", {
      expression: `window.__kcSingularityHarness.snapshotPng()`,
      returnByValue: true,
    });
    const buf = decodePngDataUrl(snap.result?.value);
    mkdirSync(join(outPath, ".."), { recursive: true });
    writeFileSync(outPath, buf);
    diag.bytes = buf.length;
    diag.outPath = outPath;
    try {
      diag.stats = pngStats(buf);
    } catch (e) {
      diag.stats = { ok: false, error: e.message };
    }
    diag.ok = true;
    const truth = truthFromProbe(status.probe, { webgl2Got: status.webgl2Got });
    diag.contextOk = truth.contextOk;
    diag.realPipeline = truth.realPipeline;
    diag.fallbackUsed = truth.fallbackUsed;
    diag.pipelineLabel = truth.label;
    diag.firstFail = truth.firstFail;
    // pipelineValid now means the real scene→bright→blur→composite path ran.
    diag.pipelineValid = truth.realPipeline;
    log(`captured ${outPath} ctx=${truth.contextOk} real=${truth.realPipeline} label=${truth.label} bytes=${buf.length} gpu=${gpu} headless=${headless}`);
    return diag;
  } catch (e) {
    diag.ok = false;
    diag.error = e.message;
    return diag;
  } finally {
    try { await session.close(); } catch { /* chrome gone */ }
  }
}

export async function captureHarnessFrame({
  origin,
  phase = DEFAULT_CAPTURE.phase,
  freezeAt = DEFAULT_CAPTURE.freezeAt,
  outPath,
  width = 1440,
  height = 900,
  port = CDP_PORT,
  gpu = "swiftshader",
  log = () => {},
} = {}) {
  if (!outPath) throw new Error("captureHarnessFrame requires outPath");
  if (!isPhase(phase)) throw new Error(`unknown phase ${phase}`);
  const url = harnessUrl({ origin, phase, freezeAt, hud: 0 });
  let diag = await captureOnce({
    url, outPath, width, height, port, gpu, headless: true, origin, phase, freezeAt, log,
  });
  if (diag.ok && diag.contextOk === false) {
    log("webgl2 context missing in headless SwiftShader; retrying headed Chrome");
    await new Promise((r) => setTimeout(r, 400));
    diag = await captureOnce({
      url, outPath, width, height, port, gpu: true, headless: false, origin, phase, freezeAt, log,
    });
    diag.retriedHeaded = true;
  }
  return diag;
}

function appendDiary(entry) {
  const p = join(diaryDir(), "DIARY.md");
  const prev = existsSync(p) ? readFileSync(p, "utf8") : "# SINGULARITY visual diary\n";
  writeFileSync(p, `${prev.trim()}\n\n${entry.trim()}\n`);
  return p;
}

export async function proveBaseline({ log = console.log } = {}) {
  const server = await ensureHarnessServer({ log });
  const outPath = join(diaryDir(), "00-baseline.png");
  const cap = await captureHarnessFrame({
    origin: server.origin,
    outPath,
    log,
  });
  const metaPath = join(diaryDir(), "00-baseline.json");
  let critic = null;
  let verdict = null;
  if (cap.ok) {
    critic = await screenImage(outPath);
    verdict = screenVerdict(critic, { requireCore: true });
  }
  const report = {
    at: new Date().toISOString(),
    harnessPort: server.port,
    harnessOrigin: server.origin,
    appPort: APP_PORT,
    startedServer: server.started,
    capture: cap,
    critic,
    verdict,
    diary: outPath,
  };
  writeFileSync(metaPath, `${JSON.stringify(report, null, 2)}\n`);
  appendDiary(`## 00 — baseline (harness, unmodified Singularity)

ITERATION:   00
HYPOTHESIS:  Capture the production createSingularity on the tooling harness before any creative edit.
FILES:       none (read-only import of src/components/Visualizer/singularity.ts)
VALIDATION:  harness ${cap.ok ? "PASS" : "FAIL"} · pipeline ${cap.status?.pipeline || "unknown"} · png ${cap.stats?.likelyUsable ? "usable" : "suspect"}
PERFORMANCE: n/a (baseline capture)
LOCAL_VISUAL_CHECK: visible=${critic?.visible} core=${critic?.brightCore} blown=${critic?.blownOut} detail=${critic?.detail} depth=${critic?.depth}
SENIOR_VISUAL_CHECK: pending Grok inspection of 00-baseline.png
DECISION:    ${cap.ok && cap.pipelineValid && cap.stats?.likelyUsable ? "KEEP (baseline)" : "BLOCK"}
NOTE:        ${critic?.note || cap.error || ""}
`);
  const ok = Boolean(cap.ok && cap.pipelineValid && cap.stats?.likelyUsable && !cap.stats?.likelyBlack);
  return { ok, ...report };
}

export async function harnessCli({ pos = [], flags = {}, log = console.log } = {}) {
  const sub = pos[0] || "prove";
  if (sub === "serve" || sub === "start") {
    const r = await ensureHarnessServer({ preferredPort: Number(flags.port || PREFERRED_PORT), log });
    log(JSON.stringify({ ok: true, port: r.port, origin: r.origin, started: r.started, reused: r.reused }, null, 2));
    return r;
  }
  if (sub === "status") {
    const st = readState();
    const live = st?.port ? await isOurHarness(st.port) : false;
    log(JSON.stringify({ state: st, live, appPort: APP_PORT }, null, 2));
    return { state: st, live };
  }
  if (sub === "capture") {
    const server = await ensureHarnessServer({ preferredPort: Number(flags.port || PREFERRED_PORT), log });
    const out = flags.out
      || join(diaryDir(), `${String(flags.name || "capture")}.png`);
    const cap = await captureHarnessFrame({
      origin: server.origin,
      phase: flags.phase || DEFAULT_CAPTURE.phase,
      freezeAt: flags["freeze-at"] != null ? Number(flags["freeze-at"]) : DEFAULT_CAPTURE.freezeAt,
      outPath: out,
      log,
    });
    writeFileSync(join(diaryDir(), "last-capture.json"), `${JSON.stringify(cap, null, 2)}\n`);
    log(JSON.stringify({
      ok: cap.ok,
      out,
      contextOk: cap.contextOk,
      realPipeline: cap.realPipeline,
      pipelineLabel: cap.pipelineLabel,
      firstFail: cap.firstFail,
      stats: cap.stats,
      error: cap.error,
    }, null, 2));
    if (!cap.ok) process.exitCode = 1;
    else if (flags["require-real-pipeline"] && !cap.realPipeline) process.exitCode = 1;
    return cap;
  }
  if (sub === "prove") {
    const r = await proveBaseline({ log });
    log(JSON.stringify({
      ok: r.ok,
      port: r.harnessPort,
      origin: r.harnessOrigin,
      appPort: r.appPort,
      pipeline: r.capture?.status?.pipeline,
      stats: r.capture?.stats,
      critic: r.critic && {
        visible: r.critic.visible,
        brightCore: r.critic.brightCore,
        blownOut: r.critic.blownOut,
        detail: r.critic.detail,
        depth: r.critic.depth,
        note: r.critic.note,
        reason: r.critic.reason,
      },
      verdict: r.verdict,
      png: r.diary,
    }, null, 2));
    if (!r.ok) process.exitCode = 1;
    return r;
  }
  throw new Error("singularity-harness serve | status | capture | prove");
}
