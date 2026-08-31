// Fire Command audio-quality probe — harness half.
//
//   node scripts/fire-audio-probe.mjs [presetId presetId ...]
//
// Boots the dev stack (Vite + Electron with CDP, same pattern as smoke.mjs),
// runs scripts/fire-audio-probe-page.js in the live renderer, and prints a
// per-preset table of peak / RMS / crest / clip% at three taps:
//   synth (raw synth out) → fire (post bus clip) → out (DAC).
// clip% > 0 at `out` = audible hard-clip territory. Low crest at `out` vs
// `synth` = the bus/master chain is squashing dynamics ("washed out").
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CDP_PORT = Number(process.env.CDP_PORT || 9223);
const VITE_URL = "http://127.0.0.1:5173";
const SUITE_TIMEOUT_MS = 600_000;

// Default preset sample: one per category across the curated factory bank.
const DEFAULT_PRESETS = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [
      "__current__", // whatever the app booted with (init on fresh profile)
      "fc-bass-sub-sine",
      "fc-lead-saw-edge",
      "fc-pluck-nylon",
      "fc-pad-hyperspace",
      "fc-keys-ep",
      "fc-arp-classic",
      "fc-fx-riser",
      "fc-atmos-void",
      "fc-vin-tape",
      "fc-chip-square",
      "fc-fm-electric",
    ];

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

  const pageScript = readFileSync(join(ROOT, "scripts", "fire-audio-probe-page.js"), "utf8");
  const preamble = `globalThis.__FIRE_PROBE = ${JSON.stringify({ presets: DEFAULT_PRESETS, routeThroughFx: true })};\n`;
  console.log(`• Probing ${DEFAULT_PRESETS.length} presets (single / chord / fast-arp each)…\n`);
  const res = await send("Runtime.evaluate", {
    expression: preamble + pageScript,
    awaitPromise: true,
    returnByValue: true,
    timeout: SUITE_TIMEOUT_MS,
  });
  ws.close();

  if (res.exceptionDetails) {
    console.error("PROBE EXCEPTION:", JSON.stringify(res.exceptionDetails, null, 2).slice(0, 3000));
    process.exitCode = 1;
  } else {
    const { presets, notes } = res.result.value;
    const fmtTap = (t) =>
      `pk ${t.peak.toFixed(2)} rms ${t.rms.toFixed(3)} cr ${String(t.crestDb).padStart(4)}dB` +
      (t.clipPct > 0 ? ` CLIP ${t.clipPct}%` : "");
    for (const p of presets) {
      console.log(`■ ${p.label}`);
      for (const scen of ["single", "chord", "arp"]) {
        const s = p[scen];
        console.log(
          `   ${scen.padEnd(6)} synth[${fmtTap(s.synth)}]  fire[${fmtTap(s.fire)}]  out[${fmtTap(s.out)}]`,
        );
      }
    }
    for (const n of notes) console.log(`! ${n}`);

    // Aggregate verdicts the fix loop can key on.
    let worstClip = 0;
    let crestLossSum = 0;
    let crestLossN = 0;
    for (const p of presets) {
      for (const scen of ["single", "chord", "arp"]) {
        worstClip = Math.max(worstClip, p[scen].out.clipPct);
        if (p[scen].synth.crestDb > 0 && p[scen].out.crestDb > 0) {
          crestLossSum += p[scen].synth.crestDb - p[scen].out.crestDb;
          crestLossN++;
        }
      }
    }
    console.log(`\nworst out clip%: ${worstClip}`);
    console.log(
      `mean crest loss synth→out: ${(crestLossN ? crestLossSum / crestLossN : 0).toFixed(1)} dB (positive = dynamics squashed)`,
    );
  }
} catch (err) {
  console.error("FIRE PROBE FAILED:", err.message);
  process.exitCode = 1;
} finally {
  killAll();
}
