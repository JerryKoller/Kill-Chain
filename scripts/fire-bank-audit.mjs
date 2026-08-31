// Factory bank audit — renders EVERY preset offline and reports the ones that
// come out silent or distorted, plus how many modules each one keeps awake
// after load-time pruning.
//
//   node scripts/fire-bank-audit.mjs [categoryFilter]
//
// Exit code 1 when any preset fails, so this doubles as a bank regression gate.
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CDP_PORT = Number(process.env.CDP_PORT || 9223);
const VITE_URL = "http://127.0.0.1:5173";
const FILTER = process.argv[2] || "";

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

const PAGE = String.raw`
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn, ms, step = 200) => {
    const end = Date.now() + ms;
    for (;;) {
      try { if (await fn()) return true; } catch { /* poll */ }
      if (Date.now() > end) return false;
      await sleep(step);
    }
  };
  if (!(await until(() => !!globalThis.__KC_TEST, 15000))) throw new Error("__KC_TEST missing");
  const M = await globalThis.__KC_TEST.load();
  const { useSettingsStore } = M.settingsStore;
  const { useAudioStore } = M.audioStore;
  const { FIRE_PRESETS } = M.fireCommandStore;
  const { auditionFirePatch } = M.fireNsAudition;
  const { pruneUnusedModules, FIRE_MODULE_PRIORITY, FIRE_CORE_MODULES } = M.fireModuleUsage;
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

  const filter = "__FILTER__";
  const rows = [];
  for (const preset of FIRE_PRESETS) {
    if (preset.id === "init") continue;
    if (filter && preset.category !== filter) continue;
    // Clone + prune exactly like loadPreset does, then measure.
    const patch = JSON.parse(JSON.stringify(preset.patch));
    const awakeManaged = pruneUnusedModules(patch);
    let r;
    try {
      r = await auditionFirePatch(patch);
    } catch (e) {
      rows.push({ id: preset.id, cat: preset.category, error: String(e && e.message || e) });
      continue;
    }
    // Spectral-dominant presets deliberately keep the DRY path quiet and let
    // the STFT carry the sound. auditionFirePatch measures dry only (the
    // worklet can't be trusted in an offline render), so a "silent" verdict
    // here says nothing about the real patch — mark it unmeasurable.
    const spectralLed =
      (preset.patch.spectralMode ?? "off") !== "off" && (preset.patch.spectralMix ?? 0) > 0.2;
    rows.push({
      id: preset.id,
      name: preset.name,
      cat: preset.category,
      spectralLed,
      rms: +r.rms.toFixed(4),
      peak: +r.peak.toFixed(4),
      crest: +r.crestDb.toFixed(1),
      clip: +r.clipPct.toFixed(2),
      asleep: FIRE_MODULE_PRIORITY.filter((m) => patch.moduleEnable?.[m] === false).join(","),
      silent: r.silent,
      distorted: r.distorted,
      // Awake modules = always-on core + managed modules still enabled.
      awake: awakeManaged + FIRE_CORE_MODULES.length,
      managedTotal: FIRE_MODULE_PRIORITY.length + FIRE_CORE_MODULES.length,
    });
  }
  return { rows };
})()
`;

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
      cwd: ROOT,
      env: { ...process.env, NODE_ENV: "development" },
    });
    let ok = false;
    for (let i = 0; i < 60 && !ok; i++) { await sleep(1000); ok = await up(cdpList); }
    if (!ok) throw new Error("Electron never exposed CDP");
    await sleep(4000);
  }
  const list = await (await fetch(cdpList)).json();
  const page = list.find((t) => t.type === "page" && !/devtools/i.test(t.url));
  if (!page) throw new Error("No page target");
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

  console.log(`• Auditing factory bank${FILTER ? ` (${FILTER})` : ""}…\n`);
  const res = await send("Runtime.evaluate", {
    expression: PAGE.replace("__FILTER__", FILTER),
    awaitPromise: true,
    returnByValue: true,
    timeout: 900_000,
  });
  ws.close();
  if (res.exceptionDetails) throw new Error(JSON.stringify(res.exceptionDetails).slice(0, 1200));

  const { rows } = res.result.value;
  // A silent verdict on a spectral-led preset is not evidence of a fault.
  const unmeasurable = rows.filter((r) => r.spectralLed && r.silent && !r.distorted);
  const bad = rows.filter(
    (r) => r.error || r.distorted || (r.silent && !r.spectralLed),
  );
  const badIds = new Set(bad.map((r) => r.id));
  const byCat = new Map();
  let awakeSum = 0;
  for (const r of rows) {
    if (!byCat.has(r.cat)) byCat.set(r.cat, { n: 0, bad: 0, awake: 0 });
    const c = byCat.get(r.cat);
    c.n++;
    c.awake += r.awake ?? 0;
    awakeSum += r.awake ?? 0;
    if (badIds.has(r.id)) c.bad++;
  }
  for (const r of bad) {
    console.log(
      `  FAIL ${r.id.padEnd(26)} ${(r.name ?? "").padEnd(18)}`
      + (r.error ? ` error=${r.error}` : ` pk=${r.peak} rms=${r.rms} crest=${r.crest}dB clip=${r.clip}%`
        + (r.silent ? " SILENT" : "") + (r.distorted ? " DISTORTED" : "")),
    );
    if (r.asleep) console.log(`       asleep: ${r.asleep}`);
  }
  console.log(`\n── BANK AUDIT (${rows.length} presets) ──`);
  for (const [cat, c] of byCat) {
    console.log(`  ${cat.padEnd(9)} n=${String(c.n).padStart(3)}  bad=${c.bad}  avg awake modules=${(c.awake / c.n).toFixed(1)}`);
  }
  const total = rows[0]?.managedTotal ?? 0;
  if (unmeasurable.length) {
    console.log(`  unmeasurable (spectral-led, dry path quiet by design): ${unmeasurable.map((r) => r.id).join(", ")}`);
  }
  console.log(`  overall: ${bad.length} bad · avg ${(awakeSum / Math.max(1, rows.length)).toFixed(1)} of ${total} manageable modules awake`);
  process.exitCode = bad.length > 0 ? 1 : 0;
} catch (err) {
  console.error("BANK AUDIT FAILED:", err.message);
  process.exitCode = 1;
} finally {
  killAll();
}
