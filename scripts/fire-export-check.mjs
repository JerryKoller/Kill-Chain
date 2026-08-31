// Offline bounce parity check.
//
//   node scripts/fire-export-check.mjs
//
// The exporter renders in an OfflineAudioContext, where the engine's 60 Hz
// modulation timer deliberately never ran — so bounces used to come out with
// the trance gate wide open and sample-hold LFOs frozen. fireStudio now drives
// the real mod tick via OfflineAudioContext.suspend().
//
// This renders the SAME pattern twice — gate off, then a hard gate — and
// checks that the gated render actually shows the gate. Pre-fix the two
// renders were identical.
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CDP_PORT = Number(process.env.CDP_PORT || 9223);
const VITE_URL = "http://127.0.0.1:5173";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const up = async (url) => {
  try { await fetch(url); return true; } catch { return false; }
};
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

const PAGE = String.raw`
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn, ms, step = 200) => {
    const end = Date.now() + ms;
    for (;;) { try { if (await fn()) return true; } catch {} if (Date.now() > end) return false; await sleep(step); }
  };
  if (!(await until(() => !!globalThis.__KC_TEST, 15000))) throw new Error("__KC_TEST missing");
  const M = await globalThis.__KC_TEST.load();
  const { useSettingsStore } = M.settingsStore;
  const { useAudioStore } = M.audioStore;
  const { useFireCommandStore } = M.fireCommandStore;
  const { useFireSequencerStore } = M.fireSequencerStore;
  {
    const version = M.legal?.LEGAL_VERSION ?? "1.0-draft";
    const st = useSettingsStore.getState();
    if (!st.legalAcceptedAt || st.legalAcceptedVersion !== version) {
      st.set("legalAcceptedVersion", version);
      st.set("legalAcceptedAt", new Date().toISOString());
    }
  }
  await useAudioStore.getState().ensureReady();
  await M.engine.getEngine().resume();

  // A sustained 2-bar pad so the gate has something continuous to chop.
  const seq = useFireSequencerStore.getState();
  seq.clearNotes?.();
  const fc = useFireCommandStore.getState();
  fc.loadPreset("fc2-pad-strings");
  useFireSequencerStore.setState({ bars: 2, bpm: 120, playMode: "pattern", synthEnabled: true, drumsEnabled: false });
  const add = useFireSequencerStore.getState().addNotes;
  add([
    { midi: 48, step: 0, len: 32, vel: 0.9, ch: 0 },
    { midi: 55, step: 0, len: 32, vel: 0.9, ch: 0 },
  ]);

  // Window RMS spread: a gate that actually closes leaves near-silent windows.
  const analyze = (left, right, sr) => {
    const win = Math.floor(sr * 0.05);
    let peak = 0, sumSq = 0, n = 0;
    const rmsWins = [];
    for (let i = 0; i + win <= left.length; i += win) {
      let s = 0;
      for (let j = i; j < i + win; j++) {
        const v = (left[j] + right[j]) * 0.5;
        const a = Math.abs(v);
        if (a > peak) peak = a;
        s += v * v; sumSq += v * v; n++;
      }
      rmsWins.push(Math.sqrt(s / win));
    }
    const loud = rmsWins.filter((r) => r > 0.0005).sort((a, b) => a - b);
    const q = (f) => loud.length ? loud[Math.min(loud.length - 1, Math.floor(f * loud.length))] : 0;
    return {
      peak: +peak.toFixed(4),
      rms: +Math.sqrt(sumSq / Math.max(1, n)).toFixed(4),
      // Spread of loud windows: flat pad ≈ 1, chopped pad ≫ 1.
      spread: +(q(0.95) / Math.max(1e-6, q(0.15))).toFixed(2),
    };
  };

  const render = async () => {
    const out = await M.fireStudio.bounceFireDryAudio();
    if (!out) throw new Error("bounce returned null");
    return analyze(out.left, out.right, out.sampleRate);
  };

  // 1) Gate off
  // Pin the edit target. setParams writes to whichever slot is being edited,
  // and the app persists that choice — so a session left on Synth B applied
  // the gate to B while this test's notes (channel 0) render through A, and
  // the two renders came out identical for reasons unrelated to the exporter.
  useFireCommandStore.getState().setEditTarget("a");
  useFireCommandStore.getState().setParams({ gateOn: false, delayMix: 0, reverbMix: 0.15 });
  await sleep(120);
  const flat = await render();

  // 2) Hard gate: every other 1/8 fully closed
  useFireCommandStore.getState().setParams({
    gateOn: true, gateRate: 8, gateDepth: 1, gateSteps: 8, gateSmooth: 0.05,
    gatePattern: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0],
    gateDest: "volume",
  });
  await sleep(120);
  const gated = await render();

  return { flat, gated };
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
  let mid = 0;
  const pending = new Map();
  const send = (method, params = {}) =>
    new Promise((res, rej) => { const id = ++mid; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    const p = msg.id && pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    msg.error ? p.rej(new Error(msg.error.message)) : p.res(msg.result);
  };
  await new Promise((r) => (ws.onopen = r));

  console.log("• Rendering offline bounce (gate off, then hard gate)…\n");
  const res = await send("Runtime.evaluate", {
    expression: PAGE, awaitPromise: true, returnByValue: true, timeout: 600_000,
  });
  ws.close();
  if (res.exceptionDetails) throw new Error(JSON.stringify(res.exceptionDetails).slice(0, 1500));

  const { flat, gated } = res.result.value;
  console.log(`  gate off : peak ${flat.peak}  rms ${flat.rms}  window spread ${flat.spread}×`);
  console.log(`  gate hard: peak ${gated.peak}  rms ${gated.rms}  window spread ${gated.spread}×`);

  const audible = flat.peak > 0.01 && gated.peak > 0.01;
  // Half the pattern is gated to silence at depth 1, so the gated render must
  // lose real energy. (Window spread is reported too, but it is dominated by
  // note envelopes and makes a poor pass/fail signal on its own.)
  const drop = gated.rms / Math.max(1e-6, flat.rms);
  const gateWorks = drop < 0.85;
  console.log(`\n  render audible:      ${audible ? "yes" : "NO — FAIL"}`);
  console.log(`  gated rms / flat:    ${drop.toFixed(2)}×  (needs < 0.85)`);
  console.log(`  gate reaches export: ${gateWorks ? "yes" : "NO — FAIL"}`);
  console.log(`\n${audible && gateWorks ? "EXPORT PARITY PASS" : "EXPORT PARITY FAIL"}`);
  process.exitCode = audible && gateWorks ? 0 : 1;
} catch (err) {
  console.error("EXPORT CHECK FAILED:", err.message);
  process.exitCode = 1;
} finally {
  killAll();
}
