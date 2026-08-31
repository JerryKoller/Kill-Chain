// Progressive-distortion hunt — Node driver.
//
//   node scripts/fire-distort-hunt.mjs [minutes] [--stress-ms N] [--ref PRESET]
//
// Companion to scripts/fire-distort-hunt-page.js. See that file for the
// method; in short it measures the synth chain's TRANSFER FUNCTION (gain, THD,
// DC offset, noise floor, per stage) for a fixed reference patch, abuses the
// synth, then re-measures the same patch. Drift = persistent corruption, and
// the first stage that drifted is the culprit.
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CDP_PORT = Number(process.env.CDP_PORT || 9223);
const VITE_URL = "http://127.0.0.1:5173";

const argv = process.argv.slice(2);
const numArg = argv.find((a) => /^\d+(\.\d+)?$/.test(a));
const MINUTES = numArg ? Number(numArg) : 10;
const flag = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const STRESS_MS = Number(flag("--stress-ms", "20000"));
const REF_PRESET = flag("--ref", "fc-bass-acid");
const OUT_JSON = flag("--out", "");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const up = async (url) => { try { await fetch(url); return true; } catch { return false; } };
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
    } catch { /* already dead */ }
  }
};
process.on("SIGINT", () => { killAll(); process.exit(130); });

function fmtWorst(w) {
  if (!w) return "—";
  const sign = w.thdRise >= 0 ? "+" : "";
  return `${w.stage} thd${sign}${w.thdRise}dB`;
}

try {
  if (!(await up(VITE_URL))) {
    console.log("• Starting Vite…");
    spawnTracked("npx", ["vite"], { cwd: ROOT });
    let ok = false;
    for (let i = 0; i < 60 && !ok; i++) { await sleep(1000); ok = await up(VITE_URL); }
    if (!ok) throw new Error("Vite never came up on :5173");
  }
  const cdpList = `http://127.0.0.1:${CDP_PORT}/json/list`;
  if (!(await up(cdpList))) {
    console.log(`• Starting Electron (CDP :${CDP_PORT})…`);
    spawnTracked("npx", ["electron", ".", `--remote-debugging-port=${CDP_PORT}`], {
      cwd: ROOT, env: { ...process.env, NODE_ENV: "development" },
    });
    let ok = false;
    for (let i = 0; i < 60 && !ok; i++) { await sleep(1000); ok = await up(cdpList); }
    if (!ok) throw new Error("Electron never exposed CDP (close any running Kill-Chain)");
    await sleep(4000);
  }

  const list = await (await fetch(cdpList)).json();
  const page = list.find((t) => t.type === "page" && !/devtools/i.test(t.url));
  if (!page) throw new Error("no page target");
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
  await send("Runtime.enable");

  const evalIn = async (expr, opts = {}) => {
    const res = await send("Runtime.evaluate", {
      expression: expr, returnByValue: true, timeout: 60_000, ...opts,
    });
    if (res.exceptionDetails) {
      throw new Error(JSON.stringify(res.exceptionDetails).slice(0, 1200));
    }
    return res.result?.value;
  };

  // Wipe globals from any previous run in this page. Without this, attaching
  // to a running instance reads a stale verdict and "passes" instantly.
  await evalIn(`
    delete globalThis.__FDH_RESULT;
    delete globalThis.__FDH_STATUS;
    delete globalThis.__FDH_DUMP;
    "cleared"
  `);

  const cfg = { minutes: MINUTES, stressMs: STRESS_MS, refPreset: REF_PRESET };
  const preamble = `globalThis.__FDH = ${JSON.stringify(cfg)};\n`;
  const pageScript = readFileSync(resolve(ROOT, "scripts/fire-distort-hunt-page.js"), "utf8");

  console.log(`• Hunting for ${MINUTES} min · ref=${REF_PRESET} · stress=${STRESS_MS}ms/round\n`);
  await evalIn(preamble + pageScript, { awaitPromise: false });

  const stale = await evalIn("globalThis.__FDH_RESULT ? 'stale' : 'clean'");
  if (stale === "stale") throw new Error("stale result present immediately after kickoff");

  const t0 = Date.now();
  const deadline = t0 + MINUTES * 60_000 + 180_000;
  let lastRound = 0;
  let result = null;

  while (Date.now() < deadline) {
    await sleep(10_000);
    const alive = await evalIn("typeof globalThis.__FDH === 'object' ? 1 : 0").catch(() => 0);
    if (!alive) {
      console.log("  ! page reloaded (HMR) — re-injecting, timer restarts");
      await evalIn(`delete globalThis.__FDH_RESULT; delete globalThis.__FDH_STATUS; "x"`);
      await evalIn(preamble + pageScript, { awaitPromise: false });
      continue;
    }
    const raw = await evalIn("globalThis.__FDH_STATUS || null").catch(() => null);
    if (raw) {
      const r = JSON.parse(raw);
      if (r.round !== lastRound) {
        lastRound = r.round;
        const trip = r.trip ? `  ** TRIP ${r.trip.stage} (${r.trip.why}) **` : "";
        console.log(
          `  r${String(r.round).padStart(2)} ${String(r.elapsedMin).padStart(5)}m`
          + ` heap=${r.heapMB ?? "?"}MB pool=${r.poolSize ?? "?"} wk=${r.worklets}`
          + ` gr=${r.limiterGrDb ?? "?"}dB dc=${r.maxDcDelta}`
          + ` | LIVE clip=${r.liveWorstClipPct}% crest=${r.liveMinCrestDb ?? "?"}dB`
          + ` dc=${r.liveWorstDc} hotRun=${r.liveMaxHotRun}`
          + (r.liveSustainedAt != null ? ` ** SUSTAINED @${r.liveSustainedAt}s **` : "")
          + trip,
        );
      }
    }
    result = await evalIn("globalThis.__FDH_RESULT || null").catch(() => null);
    if (result) break;
  }

  if (!result) throw new Error("hunt never produced a result before the deadline");
  if (!result.ok) throw new Error(`in-page failure: ${result.error}`);

  const ranMs = result.minutes * 60_000;
  if (ranMs < MINUTES * 60_000 * 0.7) {
    console.log(`\n! ran only ${result.minutes}m of ${MINUTES}m — treat with suspicion`);
  }

  const table = (rows, title) => {
    console.log(`\n── ${title} ──`);
    console.log("  stage          gainDb   THD dB base→now  rise   DC delta   noise  glitch%");
    for (const c of rows) {
      console.log(
        `  ${c.stage.padEnd(13)} ${String(c.gainDb).padStart(6)}`
        + `   ${String(c.thdBase).padStart(7)}→${String(c.thdNow).padStart(7)}`
        + ` ${String(c.thdRise).padStart(6)}`
        + ` ${String(c.dcDelta).padStart(10)}`
        + ` ${String(c.noiseRise).padStart(6)}`
        + ` ${String(c.glitchNow).padStart(7)}`
        + (c.nan ? "  NaN!" : ""),
      );
    }
  };

  const L = result.live;
  if (L) {
    console.log("\n── LIVE MUSICAL SIGNAL (during stress, fireTap) ──");
    console.log(`  samples:            ${L.samples}`);
    console.log(`  worst clip:         ${L.worstClipPct}%`);
    console.log(`  min crest factor:   ${L.minCrestDb ?? "n/a"} dB  (< 4.5 dB = squared off)`);
    console.log(`  worst DC offset:    ${L.worstDc}`);
    console.log(`  max peak:           ${L.maxPeak}`);
    console.log(`  longest hot run:    ${L.maxConsecutiveHot} samples (${(L.maxConsecutiveHot * 0.25).toFixed(1)}s)`);
    console.log(`  NaN seen:           ${L.nanSeen}`);
    if (L.events.length) {
      console.log(`\n  ** SUSTAINED DISTORTION EVENTS (${L.events.length}) **`);
      for (const e of L.events) {
        console.log(`    at ${e.at}s  preset=${e.preset}  clip=${e.clipPct}% crest=${e.crestDb}dB dc=${e.dc}`);
        console.log(`      peak=${e.peak} rms=${e.rms} voices=${e.voices} dying=${e.dying} gr=${e.limiterGrDb}dB fxSilenced=${e.fxSilenced}`);
        console.log(`      patch: ${JSON.stringify(e.patchSnapshot)}`);
      }
    }
  }

  const nf = result.noiseFloor;
  if (nf) {
    console.log("\n── INSTRUMENT NOISE FLOOR (repeat probes of the same patch) ──");
    console.log(
      `  measured: gain=${nf.maxGainDb}dB thd=${nf.maxThdRise}dB`
      + ` dc=${nf.maxDcDelta} noise=${nf.maxNoiseRise}dB glitch=${nf.maxGlitchPct}%`,
    );
    if (nf.limits) {
      console.log(
        `  trip at:  gain>${nf.limits.gainDb}dB thd>${nf.limits.thdRise}dB`
        + ` dc>${nf.limits.dcDelta} noise>${nf.limits.noiseRise}dB glitch>${nf.limits.glitchPct}%`,
      );
    }
    console.log(
      nf.trip
        ? `  ** SELF-TRIP ${nf.trip.stage}/${nf.trip.why} — instrument unreliable, ignore trips **`
        : "  no self-trip: trips below are real",
    );
  }

  if (result.firstTrip) {
    table(result.firstTrip.compare, `FIRST TRIP — round ${result.firstTrip.round}, ${result.firstTrip.stage} (${result.firstTrip.why})`);
    console.log("\n  engine state at trip:", JSON.stringify(result.firstTrip.engineState));
    console.log("\n  ── RECOVERY LADDER (does any in-app reset undo it?) ──");
    for (const a of result.firstTrip.recovery ?? []) {
      const still = a.stillBad ? `STILL BAD (${a.stillBad.stage}/${a.stillBad.why})` : "RECOVERED";
      console.log(`    ${a.step.padEnd(22)} ${still}  maxThdRise=${a.maxThdRise}dB glitch=${a.maxGlitchPct}%`);
    }
  }

  table(result.finalCompare, "TRANSFER DRIFT (final vs baseline, chain order)");

  const v = result.verdict;
  console.log("\n── CENSUS ──");
  console.log(`  nodes created total: ${result.census.total}  (growth over run: ${result.nodeGrowth})`);
  console.log(`  worklet nodes:       ${result.census.worklets}`);
  console.log(`  disconnect calls:    ${result.census.disconnects}`);
  const byKind = Object.entries(result.census.byKind)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k.replace("create", "")}=${n}`)
    .join(" ");
  console.log(`  by kind:             ${byKind}`);

  console.log("\n── VERDICT ──");
  console.log(`  first trip:     ${result.firstTrip ? `round ${result.firstTrip.round} · ${result.firstTrip.stage} (${result.firstTrip.why})` : "none"}`);
  console.log(`  max THD rise:   ${v.maxThdRise} dB  (fail > 20 dB)`);
  console.log(`  max DC delta:   ${v.maxDcDelta}  (fail > 0.002)`);
  console.log(`  max gain drift: ${v.maxGainDb} dB  (fail > 3 dB)`);
  console.log(`  max glitch:     ${v.maxGlitchPct}%  (fail > 0.05%)`);
  console.log(`  ctx state:      ${v.ctxState}`);

  const liveOk = !L
    || (!L.nanSeen
      && L.events.length === 0
      && L.worstClipPct < 1.0
      && Math.abs(L.worstDc) < 0.05);
  console.log(`  live signal:    ${liveOk ? "clean" : "DISTORTED"}`);

  const pass =
    liveOk
    && v.maxThdRise <= 20
    && Math.abs(v.maxDcDelta) <= 0.002
    && v.maxGlitchPct <= 0.05
    && v.ctxState === "running";
  console.log(`\n${pass ? "DISTORTION HUNT PASS" : "DISTORTION HUNT FAIL — see first trip above"}`);

  if (OUT_JSON) {
    writeFileSync(resolve(ROOT, OUT_JSON), JSON.stringify(result, null, 2));
    console.log(`\n→ full result written to ${OUT_JSON}`);
  }
  ws.close();
  process.exitCode = pass ? 0 : 1;
} catch (err) {
  console.error("DISTORTION HUNT FAILED:", err.message);
  process.exitCode = 1;
} finally {
  killAll();
}
