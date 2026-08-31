// Fire Command long-run SOAK — harness half.
//
//   node scripts/fire-soak-probe.mjs [minutes] [presetId presetId ...]
//
// Boots the dev stack (Vite + Electron with CDP), injects
// scripts/fire-soak-page.js, then POLLS progress rows while the page hammers
// the synth (fast ladder/SVF arps, chord stabs, preset churn) for N minutes.
// Verdict criteria: no NaN at the DAC, no dead-output events, bounded clip%,
// stable RMS from first to last minute, and real silence after panic.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CDP_PORT = Number(process.env.CDP_PORT || 9223);
const VITE_URL = "http://127.0.0.1:5173";

const argv = process.argv.slice(2);
const MINUTES = argv.length && /^\d+(\.\d+)?$/.test(argv[0]) ? Number(argv[0]) : 8;
const PRESETS = argv.filter((a) => !/^\d+(\.\d+)?$/.test(a));

// SOAK_RAW_PATCH=path/to/dump.json → soak that literal patch (user preset
// dumps: either a bare patch or a SavedPreset-shaped { patch, arp } object).
let RAW_PATCH;
let RAW_ARP;
if (process.env.SOAK_RAW_PATCH) {
  const raw = JSON.parse(readFileSync(process.env.SOAK_RAW_PATCH, "utf8"));
  RAW_PATCH = raw.patch ?? raw;
  RAW_ARP = raw.arp;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const up = async (url) => {
  try { await fetch(url); return true; } catch { return false; }
};

const children = [];
const spawnTracked = (cmd, args, opts) => {
  const child = spawn(cmd, args, { stdio: "ignore", shell: true, ...opts });
  children.push(child);
  return child;
};
const killAll = () => {
  for (const c of children) {
    try {
      if (process.platform === "win32") {
        spawn("taskkill", ["/pid", String(c.pid), "/T", "/F"], { shell: true });
      } else {
        c.kill("SIGTERM");
      }
    } catch { /* already dead */ }
  }
};
process.on("SIGINT", () => { killAll(); process.exit(130); });

try {
  if (!(await up(VITE_URL))) {
    console.log("• Starting Vite…");
    spawnTracked("npx", ["vite"], { cwd: ROOT });
    let ok = false;
    for (let i = 0; i < 60 && !ok; i++) { await sleep(1000); ok = await up(VITE_URL); }
    if (!ok) throw new Error("Vite dev server never came up on :5173");
  } else {
    console.log("• Vite already running");
  }

  const cdpList = `http://127.0.0.1:${CDP_PORT}/json/list`;
  if (!(await up(cdpList))) {
    console.log(`• Starting Electron (CDP :${CDP_PORT})…`);
    spawnTracked("npx", ["electron", ".", `--remote-debugging-port=${CDP_PORT}`], {
      cwd: ROOT,
      env: { ...process.env, NODE_ENV: "development" },
    });
    let ok = false;
    for (let i = 0; i < 60 && !ok; i++) { await sleep(1000); ok = await up(cdpList); }
    if (!ok) throw new Error("Electron never exposed CDP (close any running Kill-Chain)");
    await sleep(4000);
  } else {
    console.log("• Attaching to running debuggable instance");
  }

  const list = await (await fetch(cdpList)).json();
  const page = list.find((t) => t.type === "page" && !/devtools/i.test(t.url));
  if (!page) throw new Error("No page target on the CDP port");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let mid = 0;
  const pending = new Map();
  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const id = ++mid;
      pending.set(id, { res, rej });
      ws.send(JSON.stringify({ id, method, params }));
    });
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    const p = msg.id && pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    msg.error ? p.rej(new Error(msg.error.message)) : p.res(msg.result);
  };
  await new Promise((r) => (ws.onopen = r));

  const evalJson = async (expr) => {
    const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true });
    return r.exceptionDetails ? null : r.result.value;
  };

  // Wipe any globals left by a previous soak in this same page. Without this,
  // attaching to an already-running instance saw a stale __FIRE_SOAK_RESULT on
  // the first poll and reported that OLD verdict as a pass in ~10 s.
  await send("Runtime.evaluate", {
    expression:
      "delete globalThis.__FIRE_SOAK_RESULT;"
      + "delete globalThis.__FIRE_SOAK_DONE;"
      + "delete globalThis.__FIRE_SOAK_STATUS;"
      + "delete globalThis.__FIRE_SOAK_DUMP; true",
    returnByValue: true,
  });

  const pageScript = readFileSync(join(ROOT, "scripts", "fire-soak-page.js"), "utf8");
  const preamble = `globalThis.__FIRE_SOAK = ${JSON.stringify({
    minutes: MINUTES,
    presets: PRESETS,
    bpm: process.env.SOAK_BPM ? Number(process.env.SOAK_BPM) : undefined,
    division: process.env.SOAK_DIV || undefined,
    rotateMs: process.env.SOAK_ROTATE_MS ? Number(process.env.SOAK_ROTATE_MS) : undefined,
    octaves: process.env.SOAK_OCT ? Number(process.env.SOAK_OCT) : undefined,
    arpMode: process.env.SOAK_MODE || undefined,
    gate: process.env.SOAK_GATE ? Number(process.env.SOAK_GATE) : undefined,
    rawPatch: RAW_PATCH,
    rawArp: RAW_ARP,
  })};\n`;
  console.log(`• Soaking Fire Command for ${MINUTES} min (fast arps + chords + preset churn)…\n`);
  const kick = await send("Runtime.evaluate", { expression: preamble + pageScript, returnByValue: true });
  if (kick.exceptionDetails) {
    throw new Error("soak kickoff failed: " + JSON.stringify(kick.exceptionDetails).slice(0, 800));
  }
  // A verdict cannot legitimately exist yet — if one does, the injection did
  // not take and we would be polling a stale run.
  if (await evalJson("globalThis.__FIRE_SOAK_RESULT != null")) {
    throw new Error("stale soak result present after injection — page state not clean");
  }
  const startedAt = Date.now();

  // Stream progress rows while the soak runs. If the page reloads mid-run
  // (Vite HMR full-reload wipes all globals), re-inject and start over.
  let lastRow = "";
  let printedDump = "";
  const deadline = Date.now() + MINUTES * 60_000 + 150_000;
  for (;;) {
    await sleep(10_000);
    if (Date.now() > deadline) throw new Error("soak timed out");
    const alive = await evalJson("typeof globalThis.__FIRE_SOAK_DONE !== 'undefined'");
    if (!alive) {
      console.log("  ! page reloaded — re-injecting soak (timer restarts)");
      const rekick = await send("Runtime.evaluate", { expression: preamble + pageScript, returnByValue: true });
      if (rekick.exceptionDetails) throw new Error("soak re-inject failed");
      lastRow = "";
      continue;
    }
    const done = await evalJson("globalThis.__FIRE_SOAK_RESULT != null");
    const row = await evalJson("globalThis.__FIRE_SOAK_STATUS");
    if (row && row !== lastRow) {
      lastRow = row;
      const r = JSON.parse(row);
      console.log(
        `  t=${String(r.tMin).padStart(5)}m out=${r.rms.toFixed(4)} synth=${(r.synthRms ?? 0).toFixed(4)}`
        + ` fire=${(r.fireRms ?? 0).toFixed(4)} peak=${r.peak.toFixed(2)}`
        + (r.gr != null ? ` gr=${r.gr}dB` : "")
        + ` clip=${r.clipPct}% v=${r.voices}/${r.dying} held=${r.held} [${r.preset ?? "?"}] ctx=${r.ctx}`
        + (r.appCpu != null ? ` cpu=${r.appCpu}%` : "")
        + (r.ramMb != null ? ` ram=${r.ramMb}MB` : "")
        + (r.nan ? "  !! NaN" : ""),
      );
      if (r.procErrors) console.log(`  !! WORKLET PROCESSOR ERRORS: ${r.procErrors.join(", ")}`);
      if (r.dump) console.log(`  !! GAIN DUMP AT SILENCE: ${JSON.stringify(r.dump)}`);
    }
    {
      const dump = await evalJson("globalThis.__FIRE_SOAK_DUMP ?? null");
      if (dump && dump !== printedDump) {
        printedDump = dump;
        console.log(`  !! SILENCE DIAGNOSIS: ${dump}`);
      }
    }
    if (done) break;
  }

  const result = await evalJson("globalThis.__FIRE_SOAK_RESULT");
  ws.close();
  if (!result || !result.ok) {
    throw new Error("soak failed: " + (result ? result.error : "no result"));
  }
  // Guard against a verdict that arrived impossibly fast (stale globals or a
  // page reload mid-run): a real soak cannot finish before its own duration.
  const ranMs = Date.now() - startedAt;
  if (ranMs < MINUTES * 60_000 * 0.8) {
    throw new Error(`soak returned after only ${(ranMs / 1000).toFixed(0)}s of a ${MINUTES}min run — result not trustworthy`);
  }
  const v = result.verdict;
  console.log("\n── SOAK VERDICT ──");
  console.log(`  NaN at DAC:            ${v.nanSeen ? "YES — FAIL" : "no"}`);
  console.log(`  dead-output events:    ${v.deadEvents}`);
  console.log(`  worst clip%:           ${v.worstClipPct}`);
  console.log(`  rms first→last minute: ${v.rmsFirstMinute} → ${v.rmsLastMinute}`);
  console.log(`  silent after panic:    ${v.silentAfterPanic ? "yes" : "NO — FAIL"}`);
  console.log(`  ctx state at end:      ${v.ctxState}`);
  const levelRatio = v.rmsLastMinute / Math.max(1e-6, v.rmsFirstMinute);
  // Level ratio bounds are loose on purpose: the rotation means the first and
  // last minute sample DIFFERENT presets. This is a collapse/runaway detector
  // (pre-fix, zombie worklet pile-up drove the ratio toward 0), not a
  // loudness-consistency assertion.
  const pass =
    !v.nanSeen
    && v.deadEvents === 0
    && v.silentAfterPanic
    && v.ctxState === "running"
    && v.worstClipPct < 0.5
    && levelRatio > 0.3 && levelRatio < 3.5;
  console.log(`\n${pass ? "SOAK PASS" : "SOAK FAIL"} (level ratio ${levelRatio.toFixed(2)})`);
  process.exitCode = pass ? 0 : 1;
} catch (err) {
  console.error("FIRE SOAK FAILED:", err.message);
  process.exitCode = 1;
} finally {
  killAll();
}
