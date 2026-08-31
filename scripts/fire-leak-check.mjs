// Retained-memory check for Fire Command.
//
//   node scripts/fire-leak-check.mjs [rounds]
//
// The distortion hunt showed usedJSHeapSize climbing 58 → 163 MB over five
// minutes of play. That alone proves nothing: usedJSHeapSize rises between
// garbage collections by design. This forces a GC via the DevTools protocol
// before each measurement, so the reported number is RETAINED memory. A
// monotonic rise in post-GC heap is a real leak — and a leak is the shape of
// bug that degrades audio progressively and only clears on relaunch.
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CDP_PORT = Number(process.env.CDP_PORT || 9223);
const VITE_URL = "http://127.0.0.1:5173";
const ROUNDS = Number(process.argv[2] || 8);
const STRESS_MS = Number(process.argv[3] || 20000);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const up = async (u) => { try { await fetch(u); return true; } catch { return false; } };
const children = [];
const spawnTracked = (cmd, args, opts) => {
  const c = spawn(cmd, args, { stdio: "ignore", shell: true, ...opts });
  children.push(c);
  return c;
};
const killAll = () => {
  for (const c of children) {
    try {
      if (process.platform === "win32") spawn("taskkill", ["/pid", String(c.pid), "/T", "/F"], { shell: true });
      else c.kill("SIGTERM");
    } catch { /* dead */ }
  }
};
process.on("SIGINT", () => { killAll(); process.exit(130); });

// Playing workload, kept in one place so the numbers are comparable run to run.
const SETUP = String.raw`
(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const until = async (fn, ms, step = 200) => {
    const end = Date.now() + ms;
    for (;;) { try { if (await fn()) return true; } catch {} if (Date.now() > end) return false; await sleep(step); }
  };
  if (!(await until(() => !!globalThis.__KC_TEST, 20000))) throw new Error("__KC_TEST missing");
  const M = await globalThis.__KC_TEST.load();
  const st = M.settingsStore.useSettingsStore.getState();
  const v = M.legal?.LEGAL_VERSION ?? "1.0-draft";
  if (!st.legalAcceptedAt || st.legalAcceptedVersion !== v) {
    st.set("legalAcceptedVersion", v);
    st.set("legalAcceptedAt", new Date().toISOString());
  }
  await M.audioStore.useAudioStore.getState().ensureReady();
  const engine = M.engine.getEngine();
  await engine.resume();
  globalThis.__LK = {
    M, engine,
    fc: engine.fireCommand,
    store: () => M.fireCommandStore.useFireCommandStore.getState(),
    ids: (M.fireCommandStore.FIRE_PRESETS || []).map(p => p.id),
    tick: 0,
  };
  globalThis.__LK.store().setRouteThroughFx(true);
  return "ready";
})()
`;

// One slice of ordinary play: notes, preset changes, knob moves, arp.
const STRESS = String.raw`
(async () => {
  const L = globalThis.__LK;
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const end = Date.now() + ${STRESS_MS};
  const models = ["ladder", "svf", "biquad"];
  while (Date.now() < end) {
    const i = L.tick++;
    const s = L.store();
    const mod = i % 10;
    if (mod === 0) s.loadPreset(L.ids[(i * 7919) % L.ids.length]);
    else if (mod === 1) s.setParam("filterModel", models[i % 3]);
    else if (mod === 2) s.setParam("unison", 1 + (i % 7));
    else if (mod === 3) s.setParams({ delayMix: 0.4, delayFeedback: 0.78, reverbMix: 0.45, drive: 0.8 });
    else if (mod === 4) { s.setArp({ enabled: true, rateHz: 16, octaves: 3, mode: "updown" }); for (const m of [40,47,52]) s.noteOn(m, 0.95); }
    else if (mod === 5) { const b = 36 + (i % 20); for (let k = 0; k < 8; k++) L.fc.playNote(b + k*3, 0.95, L.engine.ctx.currentTime + k*0.01, 0.3); }
    else if (mod === 6) s.setParams({ filterCutoff: 300 + ((i*997) % 14000), filterResonance: 0.9 });
    else if (mod === 7) s.randomize();
    else if (mod === 8) s.mutate();
    else { s.panic(); s.setArp({ enabled: false }); }
    await sleep(220);
  }
  L.store().panic();
  L.store().setArp({ enabled: false });
  await sleep(1500);
  return L.tick;
})()
`;

const MEASURE = String.raw`
(() => {
  const L = globalThis.__LK;
  const fc = L.fc;
  const eng = L.engine;
  const n = (v) => (typeof v === "number" ? +v.toFixed(1) : null);
  return JSON.stringify({
    heapMB: n(performance.memory.usedJSHeapSize / 1048576),
    totalHeapMB: n(performance.memory.totalJSHeapSize / 1048576),
    voices: fc.voices ? fc.voices.size : null,
    dying: fc.dying ? fc.dying.size : null,
    pool: fc.filterWorkletPool ? fc.filterWorkletPool.length : null,
    poolCount: typeof fc.filterWorkletCount === "number" ? fc.filterWorkletCount : null,
    held: fc.held ? fc.held.size : null,
    arpQueue: fc.arpQueue ? fc.arpQueue.length : null,
    banks: fc.banks ? fc.banks.size : null,
    warpedBanks: fc.warpedBanks ? fc.warpedBanks.size : null,
    userPresets: L.store().userPresets.length,
    historyLen: (() => { try { return L.M.fireHistory.fireHistoryDepth ? L.M.fireHistory.fireHistoryDepth() : null; } catch { return null; } })(),
    ctxState: eng.ctx.state,
  });
})()
`;

try {
  if (!(await up(VITE_URL))) {
    console.log("• Starting Vite…");
    spawnTracked("npx", ["vite"], { cwd: ROOT });
    let ok = false;
    for (let i = 0; i < 60 && !ok; i++) { await sleep(1000); ok = await up(VITE_URL); }
    if (!ok) throw new Error("Vite never came up");
  }
  const cdpList = `http://127.0.0.1:${CDP_PORT}/json/list`;
  if (!(await up(cdpList))) {
    console.log(`• Starting Electron (CDP :${CDP_PORT})…`);
    spawnTracked("npx", ["electron", ".", `--remote-debugging-port=${CDP_PORT}`], {
      cwd: ROOT, env: { ...process.env, NODE_ENV: "development" },
    });
    let ok = false;
    for (let i = 0; i < 60 && !ok; i++) { await sleep(1000); ok = await up(cdpList); }
    if (!ok) throw new Error("Electron never exposed CDP");
    await sleep(4000);
  }
  const list = await (await fetch(cdpList)).json();
  const page = list.find((t) => t.type === "page" && !/devtools/i.test(t.url));
  if (!page) throw new Error("no page target");

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    const p = m.id && pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    m.error ? p.rej(new Error(m.error.message)) : p.res(m.result);
  };
  const send = (method, params = {}) =>
    new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
  await new Promise((r) => (ws.onopen = r));
  await send("Runtime.enable");
  await send("HeapProfiler.enable");

  const evalIn = async (expr, timeout = 120000) => {
    const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true, timeout });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 900));
    return r.result?.value;
  };

  /** Force GC twice (one pass can leave freshly-unreachable objects). */
  const gcThenMeasure = async () => {
    await send("HeapProfiler.collectGarbage");
    await sleep(600);
    await send("HeapProfiler.collectGarbage");
    await sleep(900);
    return JSON.parse(await evalIn(MEASURE));
  };

  console.log(await evalIn(SETUP) === "ready" ? "• app ready\n" : "• setup returned unexpected\n");

  const base = await gcThenMeasure();
  console.log("  baseline (post-GC):", JSON.stringify(base));
  console.log("\n  rnd  postGC heap   delta   voices dying pool/created held arpQ banks warped  presets");

  const rows = [base];
  for (let r = 1; r <= ROUNDS; r++) {
    await evalIn(STRESS, STRESS_MS + 60000);
    const m = await gcThenMeasure();
    rows.push(m);
    console.log(
      `  ${String(r).padStart(3)}  ${String(m.heapMB).padStart(8)} MB`
      + ` ${String((m.heapMB - base.heapMB).toFixed(1)).padStart(7)}`
      + `   ${String(m.voices).padStart(6)} ${String(m.dying).padStart(5)}`
      + ` ${String(m.pool + "/" + m.poolCount).padStart(9)}`
      + ` ${String(m.held).padStart(4)} ${String(m.arpQueue).padStart(4)}`
      + ` ${String(m.banks).padStart(5)} ${String(m.warpedBanks).padStart(6)}`
      + `  ${String(m.userPresets).padStart(7)}`,
    );
  }

  const first = rows[1] ?? base;
  const last = rows[rows.length - 1];
  const growth = last.heapMB - first.heapMB;
  const perRound = growth / Math.max(1, rows.length - 2);
  console.log("\n── RETAINED MEMORY ──");
  console.log(`  after round 1: ${first.heapMB} MB`);
  console.log(`  after round ${ROUNDS}: ${last.heapMB} MB`);
  console.log(`  growth:        ${growth.toFixed(1)} MB over ${rows.length - 2} further rounds`);
  console.log(`  per round:     ${perRound.toFixed(2)} MB  (~${(perRound * (60000 / STRESS_MS)).toFixed(1)} MB/min of play)`);
  console.log(`  ctx state:     ${last.ctxState}`);

  // Retained growth under ~1 MB/round after the first round is normal caching
  // (wavetable banks, preset objects). Sustained multi-MB growth is a leak.
  const leaking = perRound > 1.5;
  console.log(`\n${leaking ? "LEAK SUSPECTED — retained heap keeps growing" : "NO LEAK — retained heap is stable"}`);
  ws.close();
  process.exitCode = leaking ? 1 : 0;
} catch (e) {
  console.error("LEAK CHECK FAILED:", e.message);
  process.exitCode = 1;
} finally {
  killAll();
}
