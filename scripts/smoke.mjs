// Kill Chain v2.4 — critical-path smoke suite (harness half).
//
//   npm run smoke
//
// Boots the dev stack (Vite + Electron with a CDP port), generates two test
// WAVs, evaluates scripts/smoke-page.js inside the live renderer, and prints
// a pass/fail table. Attaches to an already-debuggable instance when one is
// listening on CDP_PORT; otherwise it spawns and later kills its own.
//
// NOTE: the app holds a single-instance lock — close a normally-launched
// Kill-Chain before running this, or the spawned instance will exit.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CDP_PORT = Number(process.env.CDP_PORT || 9223);
const VITE_URL = "http://127.0.0.1:5173";
const SUITE_TIMEOUT_MS = 300_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const up = async (url) => {
  try { await fetch(url); return true; } catch { return false; }
};

// ── Test tones ───────────────────────────────────────────────────────────────
// Two distinguishable, clearly-audible 60 s WAVs (the page loops them).
function synthWav(path, freqs, noiseAmp) {
  if (existsSync(path)) return;
  const sr = 48000;
  const seconds = 60;
  const frames = sr * seconds;
  const data = Buffer.alloc(frames * 4); // stereo PCM16
  let seed = 1234567;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x3fffffff - 1;
  };
  for (let i = 0; i < frames; i++) {
    const t = i / sr;
    let s = 0;
    for (let k = 0; k < freqs.length; k++) {
      s += Math.sin(2 * Math.PI * freqs[k] * t) * (0.28 / (k + 1));
    }
    s += rand() * noiseAmp;
    const v = Math.max(-1, Math.min(1, s));
    const l = Math.round(v * 32760);
    const r = Math.round(v * 0.9 * 32760); // slight L/R skew → sane stereo corr
    data.writeInt16LE(l, i * 4);
    data.writeInt16LE(r, i * 4 + 2);
  }
  const hdr = Buffer.alloc(44);
  hdr.write("RIFF", 0); hdr.writeUInt32LE(36 + data.length, 4);
  hdr.write("WAVE", 8); hdr.write("fmt ", 12);
  hdr.writeUInt32LE(16, 16); hdr.writeUInt16LE(1, 20); hdr.writeUInt16LE(2, 22);
  hdr.writeUInt32LE(sr, 24); hdr.writeUInt32LE(sr * 4, 28);
  hdr.writeUInt16LE(4, 32); hdr.writeUInt16LE(16, 34);
  hdr.write("data", 36); hdr.writeUInt32LE(data.length, 40);
  writeFileSync(path, Buffer.concat([hdr, data]));
}

const toneDir = join(tmpdir(), "kc-smoke");
mkdirSync(toneDir, { recursive: true });
const toneA = join(toneDir, "kc-smoke-tone-A.wav");
const toneB = join(toneDir, "kc-smoke-tone-B.wav");
console.log("• Test tones →", toneDir);
synthWav(toneA, [110, 440, 2500, 7000], 0.05);
synthWav(toneB, [165, 660, 1200], 0.09);

// ── Dev stack ────────────────────────────────────────────────────────────────
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

let spawnedElectron = false;
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
    spawnedElectron = true;
    spawnTracked("npx", ["electron", ".", `--remote-debugging-port=${CDP_PORT}`], {
      cwd: ROOT,
      env: { ...process.env, NODE_ENV: "development" },
    });
    let ok = false;
    for (let i = 0; i < 60 && !ok; i++) { await sleep(1000); ok = await up(cdpList); }
    if (!ok) {
      throw new Error(
        "Electron never exposed CDP — if Kill-Chain is already running " +
        "(single-instance lock), close it and re-run npm run smoke.",
      );
    }
    await sleep(4000); // let the renderer finish booting
  } else {
    console.log("• Attaching to running debuggable instance");
  }

  // ── CDP connection ──
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

  // ── Run the in-page suite ──
  const pageSuite = readFileSync(join(ROOT, "scripts", "smoke-page.js"), "utf8");
  const preamble = `globalThis.__SMOKE = { toneA: ${JSON.stringify(toneA)}, toneB: ${JSON.stringify(toneB)} };\n`;
  console.log("• Running critical-path suite (2–3 minutes of real audio time)…\n");
  const res = await send("Runtime.evaluate", {
    expression: preamble + pageSuite,
    awaitPromise: true,
    returnByValue: true,
    timeout: SUITE_TIMEOUT_MS,
  });
  ws.close();

  if (res.exceptionDetails) {
    console.error("SUITE EXCEPTION:", JSON.stringify(res.exceptionDetails, null, 2).slice(0, 3000));
    process.exitCode = 1;
  } else {
    const { results, stats } = res.result.value;
    let failed = 0;
    for (const r of results) {
      if (!r.pass) failed++;
      console.log(`  ${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.detail ? `  — ${r.detail}` : ""}`);
    }
    console.log(`\n${results.length - failed}/${results.length} passed`);
    const fmt = (s) =>
      s
        ? `app cpu ${s.appCpuPercent?.toFixed?.(1) ?? "?"}%  sys cpu ${s.sysCpuPercent?.toFixed?.(1) ?? "?"}%  ram ${Math.round(s.appRamMB ?? 0)} MB`
        : "unavailable";
    console.log(`  idle:     ${fmt(stats.idle)}`);
    console.log(`  playback: ${fmt(stats.playback)}`);
    process.exitCode = failed > 0 ? 1 : 0;
  }
} catch (err) {
  console.error("SMOKE HARNESS FAILED:", err.message);
  process.exitCode = 1;
} finally {
  // Only processes this harness spawned are tracked; attached instances are untouched.
  killAll();
}
