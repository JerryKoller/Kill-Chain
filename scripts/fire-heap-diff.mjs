// Heap-snapshot diff: names the object classes retained by NS auditions.
//
//   node scripts/_heap_diff.mjs [auditionsPerRound]
//
// Takes two V8 heap snapshots separated by N auditionFirePatch calls (with a
// forced GC before each) and reports which constructors grew. Whatever grows by
// ~N per round is what the audition is leaking.
import { spawn } from "node:child_process";
import { createWriteStream, readFileSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.CDP_PORT || 9223);
const N = Number(process.argv[2] || 30);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const up = async (u) => { try { await fetch(u); return true; } catch { return false; } };
const kids = [];
const kill = () => { for (const c of kids) { try { if (process.platform === "win32") spawn("taskkill", ["/pid", String(c.pid), "/T", "/F"], { shell: true }); else c.kill("SIGTERM"); } catch {} } };

const SETUP = String.raw`
(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const until = async (fn, ms) => { const e = Date.now()+ms; for(;;){ try{ if(await fn()) return true; }catch{} if(Date.now()>e) return false; await sleep(200);} };
  await until(() => !!globalThis.__KC_TEST, 20000);
  const M = await globalThis.__KC_TEST.load();
  const st = M.settingsStore.useSettingsStore.getState();
  const v = M.legal?.LEGAL_VERSION ?? "1.0-draft";
  if (!st.legalAcceptedAt || st.legalAcceptedVersion !== v) { st.set("legalAcceptedVersion", v); st.set("legalAcceptedAt", new Date().toISOString()); }
  await M.audioStore.useAudioStore.getState().ensureReady();
  await M.engine.getEngine().resume();
  globalThis.__HD = { M, patch: M.fireCommandStore.useFireCommandStore.getState().patch };
  return "ready";
})()`;

const AUDITS = (n) => String.raw`
(async () => {
  const A = globalThis.__HD;
  for (let i = 0; i < ${n}; i++) await A.M.fireNsAudition.auditionFirePatch(A.patch);
  return "done";
})()`;

try {
  const listUrl = `http://127.0.0.1:${PORT}/json/list`;
  if (!(await up("http://127.0.0.1:5173"))) {
    kids.push(spawn("npx", ["vite"], { cwd: ROOT, stdio: "ignore", shell: true }));
    for (let i = 0; i < 60; i++) { await sleep(1000); if (await up("http://127.0.0.1:5173")) break; }
  }
  if (!(await up(listUrl))) {
    console.log("• Starting Electron…");
    kids.push(spawn("npx", ["electron", ".", `--remote-debugging-port=${PORT}`], {
      cwd: ROOT, stdio: "ignore", shell: true, env: { ...process.env, NODE_ENV: "development" } }));
    for (let i = 0; i < 60; i++) { await sleep(1000); if (await up(listUrl)) break; }
    await sleep(4000);
  }
  const list = await (await fetch(listUrl)).json();
  const page = list.find((t) => t.type === "page" && !/devtools/i.test(t.url));
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pend = new Map();
  let chunkSink = null;
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method === "HeapProfiler.addHeapSnapshotChunk") {
      if (chunkSink) chunkSink.write(m.params.chunk);
      return;
    }
    if (m.method === "HeapProfiler.reportHeapSnapshotProgress") return;
    const p = m.id && pend.get(m.id);
    if (!p) return;
    pend.delete(m.id);
    m.error ? p.rej(new Error(m.error.message)) : p.res(m.result);
  };
  const send = (method, params = {}) =>
    new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
  await new Promise((r) => (ws.onopen = r));
  await send("Runtime.enable");
  await send("HeapProfiler.enable");
  const ev = async (e, t = 600000) => {
    const r = await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true, timeout: t });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 800));
    return r.result?.value;
  };
  const gc = async () => {
    await send("HeapProfiler.collectGarbage"); await sleep(500);
    await send("HeapProfiler.collectGarbage"); await sleep(900);
  };

  const snapshot = async (label) => {
    const file = resolve(tmpdir(), `kc-heap-${label}.heapsnapshot`);
    chunkSink = createWriteStream(file);
    await send("HeapProfiler.takeHeapSnapshot", { reportProgress: false, treatGlobalObjectsAsRoots: true });
    await new Promise((r) => chunkSink.end(r));
    chunkSink = null;
    return file;
  };

  /** Count nodes by (type, name) from a .heapsnapshot file. */
  const countByName = (file) => {
    const snap = JSON.parse(readFileSync(file, "utf8"));
    const nf = snap.snapshot.meta.node_fields;
    const iType = nf.indexOf("type");
    const iName = nf.indexOf("name");
    const iSelf = nf.indexOf("self_size");
    const stride = nf.length;
    const types = snap.snapshot.meta.node_types[iType];
    const nodes = snap.nodes;
    const strings = snap.strings;
    const counts = new Map();
    const sizes = new Map();
    for (let i = 0; i < nodes.length; i += stride) {
      const type = types[nodes[i + iType]] ?? "?";
      const name = strings[nodes[i + iName]] ?? "";
      const key = `${type}:${name}`;
      counts.set(key, (counts.get(key) || 0) + 1);
      sizes.set(key, (sizes.get(key) || 0) + nodes[i + iSelf]);
    }
    return { counts, sizes, total: nodes.length / stride };
  };

  await ev(SETUP);
  console.log(`• warming up (${N} auditions) then snapshotting\n`);
  await ev(AUDITS(N));
  await gc();
  const fileA = await snapshot("a");
  console.log("  snapshot A taken");

  await ev(AUDITS(N));
  await gc();
  const fileB = await snapshot("b");
  console.log("  snapshot B taken\n");

  const A = countByName(fileA);
  const B = countByName(fileB);
  console.log(`  nodes: A=${A.total}  B=${B.total}  (+${B.total - A.total})`);

  const rows = [];
  for (const [key, bc] of B.counts) {
    const ac = A.counts.get(key) || 0;
    const dCount = bc - ac;
    const dSize = (B.sizes.get(key) || 0) - (A.sizes.get(key) || 0);
    if (dCount > 2 || dSize > 32768) rows.push({ key, ac, bc, dCount, dSize });
  }
  rows.sort((a, b) => b.dSize - a.dSize);

  console.log(`\n── GREW BETWEEN SNAPSHOTS (${N} auditions apart) ──`);
  console.log("     ΔKB    Δcount   A→B        class");
  for (const r of rows.slice(0, 30)) {
    console.log(
      `  ${String((r.dSize / 1024).toFixed(1)).padStart(8)}  ${String(r.dCount).padStart(7)}`
      + `   ${String(r.ac).padStart(5)}→${String(r.bc).padEnd(6)}  ${r.key.slice(0, 70)}`,
    );
  }
  console.log(`\n  (a class growing by ~${N} per round is allocated once per audition)`);
  const perAudition = rows.filter((r) => Math.abs(r.dCount - N) <= Math.max(2, N * 0.15));
  if (perAudition.length) {
    console.log("\n  ── EXACTLY ONE PER AUDITION ──");
    for (const r of perAudition.slice(0, 20)) {
      console.log(`    Δ${String(r.dCount).padStart(4)}  ${(r.dSize / 1024).toFixed(1)} KB  ${r.key}`);
    }
  }
  for (const f of [fileA, fileB]) { try { unlinkSync(f); } catch {} }
  ws.close();
} catch (e) {
  console.error("HEAP DIFF FAILED:", e.message);
  process.exitCode = 1;
} finally { kill(); }
