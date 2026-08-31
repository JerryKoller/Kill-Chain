// Reproduce and diagnose a project that distorts on playback.
//
//   node scripts/fire-project-repro.mjs "C:/path/to/file.kcproj" [seconds]
//
// Opens a real .kcproj, starts the sequencer, and samples per-stage level,
// clipping, DC and gain-staging state every 250 ms. The reported symptom is
// "distorts on playback, then corrects itself after a while", which points at
// stale state on load rather than a bad patch — so the interesting output is
// the FIRST few seconds compared against the steady state, plus whatever
// internal value changes in between.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.CDP_PORT || 9223);
const FILE = process.argv[2];
const SECONDS = Number(process.argv[3] || 40);
if (!FILE) {
  console.error("usage: node scripts/fire-project-repro.mjs <file.kcproj> [seconds]");
  process.exit(2);
}
const projectText = readFileSync(FILE, "utf8");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const up = async (u) => { try { await fetch(u); return true; } catch { return false; } };
const kids = [];
const kill = () => {
  for (const c of kids) {
    try {
      if (process.platform === "win32") spawn("taskkill", ["/pid", String(c.pid), "/T", "/F"], { shell: true });
      else c.kill("SIGTERM");
    } catch { /* dead */ }
  }
};
process.on("SIGINT", () => { kill(); process.exit(130); });

const PAGE = (text, seconds) => String.raw`
(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const until = async (fn, ms) => { const e = Date.now()+ms; for(;;){ try{ if(await fn()) return true; }catch{} if(Date.now()>e) return false; await sleep(200);} };
  if (!(await until(() => !!globalThis.__KC_TEST, 20000))) throw new Error("__KC_TEST missing");
  const M = await globalThis.__KC_TEST.load();
  const st = M.settingsStore.useSettingsStore.getState();
  const lv = M.legal?.LEGAL_VERSION ?? "1.0-draft";
  if (!st.legalAcceptedAt || st.legalAcceptedVersion !== lv) {
    st.set("legalAcceptedVersion", lv);
    st.set("legalAcceptedAt", new Date().toISOString());
  }
  await M.audioStore.useAudioStore.getState().ensureReady();
  const engine = M.engine.getEngine();
  await engine.resume();
  const fc = engine.fireCommand;
  const fcb = engine.peekFireCommandB ? engine.peekFireCommandB() : null;
  const seq = () => M.fireSequencerStore.useFireSequencerStore.getState();
  const cmd = () => M.fireCommandStore.useFireCommandStore.getState();

  const mk = (n) => {
    if (!n) return null;
    const a = engine.ctx.createAnalyser();
    a.fftSize = 4096; a.smoothingTimeConstant = 0;
    try { n.connect(a); } catch { return null; }
    return a;
  };
  const taps = {
    synthA: mk(fc.output),
    synthB: fcb ? mk(fcb.output) : null,
    partA: mk(engine.getFirePartTap("a")),
    partB: mk(engine.getFirePartTap("b")),
    drums: mk(engine.getFirePartTap("drums")),
    fire: mk(engine.fireTap),
    out: mk(engine.destinationTap),
  };
  const buf = new Float32Array(4096);
  const read = (a) => {
    if (!a) return null;
    a.getFloatTimeDomainData(buf);
    let p = 0, s = 0, q = 0, clip = 0, nan = false;
    for (let i = 0; i < buf.length; i++) {
      const v = buf[i];
      if (!Number.isFinite(v)) { nan = true; continue; }
      s += v; q += v * v;
      const x = v < 0 ? -v : v;
      if (x > p) p = x;
      if (x >= 0.985) clip++;
    }
    const rms = Math.sqrt(q / buf.length);
    return {
      peak: +p.toFixed(3), rms: +rms.toFixed(4),
      clip: +((clip / buf.length) * 100).toFixed(2),
      dc: +(s / buf.length).toFixed(4),
      crest: p > 1e-6 && rms > 1e-9 ? +(20 * Math.log10(p / rms)).toFixed(1) : null,
      nan,
    };
  };

  // ── Load the project, exactly as the Open button does ──
  const loadRes = await M.fireStudio.applyProjectText(${JSON.stringify(text)});

  const gains = () => {
    const g = (n) => { try { return n && n.gain ? +n.gain.value.toFixed(3) : null; } catch { return null; } };
    return {
      aVoiceBus: g(fc.voiceBus), aMaster: g(fc.master), aOut: g(fc.output),
      bVoiceBus: fcb ? g(fcb.voiceBus) : null, bMaster: fcb ? g(fcb.master) : null, bOut: fcb ? g(fcb.output) : null,
      aVoices: fc.voices ? fc.voices.size : null, aDying: fc.dying ? fc.dying.size : null,
      bVoices: fcb && fcb.voices ? fcb.voices.size : null, bDying: fcb && fcb.dying ? fcb.dying.size : null,
      aFxSilenced: !!fc.fxSilenced, bFxSilenced: fcb ? !!fcb.fxSilenced : null,
      limiterGr: (() => { try { return +engine.getFireLimiterReduction().toFixed(2); } catch { return null; } })(),
    };
  };

  const beforePlay = { taps: Object.fromEntries(Object.entries(taps).map(([k,v]) => [k, read(v)])), gains: gains() };

  // ── Start the sequencer ──
  seq().setPlayMode("pattern");
  seq().play ? seq().play() : seq().togglePlay();
  await sleep(200);

  const rows = [];
  const N = Math.floor(${seconds} * 4);
  for (let i = 0; i < N; i++) {
    await sleep(250);
    rows.push({
      t: +(i * 0.25).toFixed(2),
      ...Object.fromEntries(Object.entries(taps).map(([k, v]) => {
        const r = read(v);
        return [k, r ? [r.peak, r.rms, r.clip, r.crest, r.dc] : null];
      })),
      g: gains(),
    });
  }
  try { seq().stop ? seq().stop() : seq().togglePlay(); } catch {}
  cmd().panic();

  return JSON.stringify({ loadRes, beforePlay, rows });
})()
`;

try {
  if (!(await up("http://127.0.0.1:5173"))) {
    console.log("• Starting Vite…");
    kids.push(spawn("npx", ["vite"], { cwd: ROOT, stdio: "ignore", shell: true }));
    for (let i = 0; i < 60; i++) { await sleep(1000); if (await up("http://127.0.0.1:5173")) break; }
  }
  const listUrl = `http://127.0.0.1:${PORT}/json/list`;
  if (!(await up(listUrl))) {
    console.log(`• Starting Electron (CDP :${PORT})…`);
    kids.push(spawn("npx", ["electron", ".", `--remote-debugging-port=${PORT}`], {
      cwd: ROOT, stdio: "ignore", shell: true, env: { ...process.env, NODE_ENV: "development" },
    }));
    for (let i = 0; i < 60; i++) { await sleep(1000); if (await up(listUrl)) break; }
    await sleep(4000);
  }
  const list = await (await fetch(listUrl)).json();
  const page = list.find((t) => t.type === "page" && !/devtools/i.test(t.url));
  if (!page) throw new Error("no page target");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pend = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    const p = m.id && pend.get(m.id);
    if (!p) return;
    pend.delete(m.id);
    m.error ? p.rej(new Error(m.error.message)) : p.res(m.result);
  };
  const send = (method, params = {}) =>
    new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
  await new Promise((r) => (ws.onopen = r));
  await send("Runtime.enable");

  console.log(`• Opening ${FILE}\n`);
  const r = await send("Runtime.evaluate", {
    expression: PAGE(projectText, SECONDS),
    awaitPromise: true, returnByValue: true, timeout: (SECONDS + 90) * 1000,
  });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 1500));
  const data = JSON.parse(r.result.value);

  console.log("  load:", JSON.stringify(data.loadRes));
  console.log("  gains right after load:", JSON.stringify(data.beforePlay.gains));

  console.log("\n  t     synthA peak/rms/clip/crest   partA   partB   drums    fire peak/clip/crest    out    | aV/aD bV/bD  aBus bBus  GR");
  for (const row of data.rows) {
    const f = (x) => (x ? `${String(x[0]).padStart(5)}/${String(x[1]).padStart(6)}/${String(x[2]).padStart(5)}/${String(x[3]).padStart(5)}` : "        —");
    const s = (x) => (x ? `${String(x[0]).padStart(5)}` : "  —");
    const g = row.g;
    console.log(
      `  ${String(row.t).padStart(5)} ${f(row.synthA)}  ${s(row.partA)}  ${s(row.partB)}  ${s(row.drums)}  ${f(row.fire)}  ${s(row.out)}`
      + ` | ${g.aVoices}/${g.aDying} ${g.bVoices}/${g.bDying}  ${g.aVoiceBus} ${g.bVoiceBus}  ${g.limiterGr}`,
    );
  }

  // Summarize the first 5 s against the rest — the "corrects itself" window.
  const early = data.rows.filter((r) => r.t < 5);
  const late = data.rows.filter((r) => r.t >= 10);
  const agg = (rows, key, idx) => {
    const v = rows.map((r) => (r[key] ? r[key][idx] : null)).filter((x) => x != null);
    return v.length ? { max: Math.max(...v), avg: +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(3) } : null;
  };
  console.log("\n── EARLY (0–5 s) vs LATE (10 s+) ──");
  for (const stage of ["synthA", "partA", "partB", "fire", "out"]) {
    const eP = agg(early, stage, 0); const lP = agg(late, stage, 0);
    const eC = agg(early, stage, 2); const lC = agg(late, stage, 2);
    const eCr = agg(early, stage, 3); const lCr = agg(late, stage, 3);
    if (!eP || !lP) continue;
    console.log(
      `  ${stage.padEnd(7)} peak ${String(eP.max).padStart(6)} → ${String(lP.max).padStart(6)}`
      + `   clip% ${String(eC?.max ?? 0).padStart(6)} → ${String(lC?.max ?? 0).padStart(6)}`
      + `   crest ${String(eCr?.avg ?? "—").padStart(6)} → ${String(lCr?.avg ?? "—").padStart(6)} dB`,
    );
  }
  ws.close();
} catch (e) {
  console.error("REPRO FAILED:", e.message);
  process.exitCode = 1;
} finally { kill(); }
