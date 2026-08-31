// Natural Selection batch audit — harness half.
//
//   node scripts/fire-ns-audit.mjs [rounds]
//
// Boots the dev stack, then runs `randomize()` and `mutate()` rounds and
// measures EVERY resulting patch with the offline audition (the same gate NS
// itself uses, but run on the FINAL state after the async repair pass).
// Reports silent / distorted / ok counts plus species + loudness spread —
// the regression metric for "a lot of them are either silent or distorted".
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CDP_PORT = Number(process.env.CDP_PORT || 9223);
const VITE_URL = "http://127.0.0.1:5173";
const ROUNDS = Number(process.argv[2] || 16);

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
  const hooked = await until(() => !!globalThis.__KC_TEST, 15000);
  if (!hooked) throw new Error("__KC_TEST hook missing");
  const M = await globalThis.__KC_TEST.load();
  const { useSettingsStore } = M.settingsStore;
  const { useAudioStore } = M.audioStore;
  const { useFireCommandStore } = M.fireCommandStore;
  const { auditionFirePatch } = M.fireNsAudition;
  const { FIRE_MODULE_PRIORITY, FIRE_CORE_MODULES } = M.fireModuleUsage;
  const awakeCount = (p) =>
    FIRE_CORE_MODULES.length
    + FIRE_MODULE_PRIORITY.filter((m) => p.moduleEnable?.[m] !== false).length;
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
  const store = () => useFireCommandStore.getState();
  store().setMutateAmount(0.6);

  const rows = [];
  const ROUNDS = __ROUNDS__;
  for (let i = 0; i < ROUNDS; i++) {
    // Alternate: fresh roll, then a breed from it.
    store().randomize();
    await sleep(2200); // let the async fitness repair land
    {
      const p = store().patch;
      const r = await auditionFirePatch(p);
      rows.push({ kind: "randomize", awake: awakeCount(p), rms: +r.rms.toFixed(4), crest: +r.crestDb.toFixed(1), clip: +r.clipPct.toFixed(2), silent: r.silent, distorted: r.distorted, table: p.oscATable, filt: p.filterType + "/" + (p.filterModel ?? "biquad"), mono: !!p.mono, lpg: !!p.lpgOn });
    }
    store().mutate();
    // Wait out the async fitness gate (up to 3 rerolls + a convergence pass,
    // each an offline render) so we measure the FINAL children, not the
    // pre-repair ones.
    await sleep(3200);
    for (const which of ["a", "b"]) {
      const m = store().mutation;
      if (!m) continue;
      const p = which === "a" ? m.a : m.b;
      const r = await auditionFirePatch(p);
      rows.push({ kind: "child" + which.toUpperCase(), awake: awakeCount(p), rms: +r.rms.toFixed(4), crest: +r.crestDb.toFixed(1), clip: +r.clipPct.toFixed(2), silent: r.silent, distorted: r.distorted, table: p.oscATable, filt: p.filterType + "/" + (p.filterModel ?? "biquad"), mono: !!p.mono, lpg: !!p.lpgOn });
    }
    store().discardMutation();
  }
  try { store().panic(); } catch { /* ignore */ }
  return { rows };
})()
`;

try {
  if (!(await up(VITE_URL))) {
    console.log("• Starting Vite…");
    spawnTracked("npx", ["vite"], { cwd: ROOT });
    let ok = false;
    for (let i = 0; i < 60 && !ok; i++) { await sleep(1000); ok = await up(VITE_URL); }
    if (!ok) throw new Error("Vite dev server never came up on :5173");
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

  console.log(`• Auditing ${ROUNDS} NS rounds (1 randomize + 2 children each)…\n`);
  const res = await send("Runtime.evaluate", {
    expression: PAGE.replace("__ROUNDS__", String(ROUNDS)),
    awaitPromise: true,
    returnByValue: true,
    timeout: 900_000,
  });
  ws.close();
  if (res.exceptionDetails) {
    throw new Error(JSON.stringify(res.exceptionDetails).slice(0, 1200));
  }
  const { rows } = res.result.value;
  let silent = 0;
  let distorted = 0;
  const tables = new Map();
  const filts = new Map();
  const rmsAll = [];
  for (const r of rows) {
    if (r.silent) silent++;
    else if (r.distorted) distorted++;
    rmsAll.push(r.rms);
    tables.set(r.table, (tables.get(r.table) ?? 0) + 1);
    filts.set(r.filt, (filts.get(r.filt) ?? 0) + 1);
    const flag = r.silent ? " SILENT" : r.distorted ? " DISTORTED" : "";
    console.log(
      `  ${r.kind.padEnd(9)} mods=${String(r.awake).padStart(2)} rms=${r.rms.toFixed(4)} crest=${String(r.crest).padStart(5)}dB clip=${r.clip}%`
      + ` ${String(r.table).padEnd(9)} ${r.filt}${r.mono ? " mono" : ""}${r.lpg ? " lpg" : ""}${flag}`,
    );
  }
  const overBudget = rows.filter((r) => (r.awake ?? 0) > 14);
  const awakeMax = rows.reduce((m, r) => Math.max(m, r.awake ?? 0), 0);
  rmsAll.sort((a, b) => a - b);
  const q = (f) => rmsAll[Math.min(rmsAll.length - 1, Math.floor(f * rmsAll.length))];
  console.log(`\n── NS AUDIT (${rows.length} patches) ──`);
  console.log(`  silent:    ${silent}  (${((silent / rows.length) * 100).toFixed(0)}%)`);
  console.log(`  distorted: ${distorted}  (${((distorted / rows.length) * 100).toFixed(0)}%)`);
  console.log(`  rms p10/p50/p90: ${q(0.1).toFixed(3)} / ${q(0.5).toFixed(3)} / ${q(0.9).toFixed(3)}`);
  console.log(`  osc tables: ${[...tables.entries()].map(([k, v]) => `${k}:${v}`).join(" ")}`);
  console.log(`  filters:    ${[...filts.entries()].map(([k, v]) => `${k}:${v}`).join(" ")}`);
  console.log(`  module budget: max awake ${awakeMax}/14 · over budget: ${overBudget.length}`);
  process.exitCode = (silent + distorted > rows.length * 0.1) || overBudget.length > 0 ? 1 : 0;
} catch (err) {
  console.error("NS AUDIT FAILED:", err.message);
  process.exitCode = 1;
} finally {
  killAll();
}
