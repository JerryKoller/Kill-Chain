// Editing-toolbox runtime check.
//
//   node scripts/fire-edit-check.mjs
//
// Typecheck and build prove the new editing code COMPILES; they don't prove
// that `applyNoteOp` transforms notes correctly, that markers survive a
// persist round-trip, that the clip clipboard produces schedulable clips, or
// that out-of-range values get clamped instead of poisoning scheduler math.
//
// This drives the real stores inside the running app and asserts on results.
// It works on a scratch pattern and restores the previous project afterwards.
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
  const { useFireSequencerStore } = M.fireSequencerStore;
  const NoteOps = M.fireNoteOps;
  const Shelf = M.firePresetShelf;
  const History = M.fireHistory;

  {
    const version = M.legal?.LEGAL_VERSION ?? "1.0-draft";
    const st = useSettingsStore.getState();
    if (!st.legalAcceptedAt || st.legalAcceptedVersion !== version) {
      st.set("legalAcceptedVersion", version);
      st.set("legalAcceptedAt", new Date().toISOString());
    }
  }

  const out = [];
  const ok = (name, pass, detail = "") => out.push({ name, pass, detail: String(detail) });
  const S = () => useFireSequencerStore.getState();
  const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

  // Snapshot the user's project so this check is non-destructive.
  const restore = M.fireSequencerStore.serializePattern
    ? JSON.parse(JSON.stringify(M.fireSequencerStore.serializePattern()))
    : null;

  const mk = (step, midi, len = 1, vel = 0.8) =>
    ({ id: "t" + step + "_" + midi + "_" + Math.random().toString(36).slice(2, 6), step, midi, len, vel, ch: 0 });
  const setNotes = (arr) => useFireSequencerStore.setState({ notes: arr });

  useFireSequencerStore.setState({ bars: 4, playMode: "pattern", activeChannel: 0 });

  // ── Quantize ──
  setNotes([mk(0.3, 60), mk(2.2, 64), mk(4.15, 67), mk(6.4, 72)]);
  const qTouched = S().applyNoteOp({ kind: "quantize", grid: 1, strength: 1 });
  const qSteps = S().notes.map((n) => n.step);
  ok("quantize touches every note", qTouched === 4, "touched=" + qTouched);
  ok("quantize lands on grid", qSteps.every((s) => near(s, Math.round(s))), JSON.stringify(qSteps));

  setNotes([mk(0.4, 60)]);
  S().applyNoteOp({ kind: "quantize", grid: 1, strength: 0.5 });
  ok("partial quantize pulls halfway", near(S().notes[0].step, 0.2), "step=" + S().notes[0].step);

  // ── Chords ──
  setNotes([mk(0, 60)]);
  const chordAdded = S().applyNoteOp({ kind: "chord", intervals: [4, 7] });
  const midis = S().notes.map((n) => n.midi).sort((a, b) => a - b).join(",");
  ok("chord stacks tones", chordAdded === 2 && midis === "60,64,67", midis);
  // Re-applying stacks above EVERY scoped note (so it compounds by design),
  // but must never create a unison duplicate — two notes at the same
  // step+pitch just double the gain and retrigger.
  S().applyNoteOp({ kind: "chord", intervals: [4, 7] });
  const keys = S().notes.map((n) => Math.round(n.step * 4) + ":" + n.midi);
  ok("chord never creates unison duplicates", new Set(keys).size === keys.length,
    keys.length - new Set(keys).size + " dupes");

  // Applying to a single already-stacked note adds nothing new.
  setNotes([mk(0, 60), mk(0, 64), mk(0, 67)]);
  const onlyRoot = S().notes.find((n) => n.midi === 60).id;
  const dupAdded = S().applyNoteOp({ kind: "chord", intervals: [4, 7] }, new Set([onlyRoot]));
  ok("chord skips pitches already present", dupAdded === 0, "added=" + dupAdded);

  // ── Transpose + clamping ──
  setNotes([mk(0, 60), mk(1, 64)]);
  S().applyNoteOp({ kind: "transpose", semitones: 12 });
  ok("transpose +12", S().notes.map((n) => n.midi).sort((a,b)=>a-b).join(",") === "72,76",
    S().notes.map((n) => n.midi).join(","));
  setNotes([mk(0, 120)]);
  S().applyNoteOp({ kind: "transpose", semitones: 24 });
  ok("transpose clamps at 127", S().notes[0].midi === 127, "midi=" + S().notes[0].midi);

  // ── Length ops ──
  setNotes([mk(0, 60, 0.5), mk(4, 60, 0.5)]);
  S().applyNoteOp({ kind: "length", mode: "legato" });
  ok("legato meets next same pitch",
    near(S().notes.find((n) => near(n.step, 0)).len, 4),
    "len=" + S().notes.find((n) => near(n.step, 0)).len);

  // Legato must NOT stretch across a different pitch (that mushes chords).
  setNotes([mk(0, 60, 0.5), mk(2, 67, 0.5)]);
  S().applyNoteOp({ kind: "length", mode: "legato" });
  const lowNote = S().notes.find((n) => n.midi === 60);
  ok("legato ignores other pitch lanes", lowNote.len > 4, "len=" + lowNote.len);

  setNotes([mk(0, 60, 1), mk(1, 60, 1)]);
  const glued = S().applyNoteOp({ kind: "join" });
  ok("glue merges touching notes", glued >= 1 && S().notes.length === 1, "count=" + S().notes.length);
  ok("glue sums length", near(S().notes[0].len, 2), "len=" + S().notes[0].len);

  setNotes([mk(0, 60, 2)]);
  S().applyNoteOp({ kind: "split", pieces: 4 });
  ok("split into 4", S().notes.length === 4, "count=" + S().notes.length);
  ok("split ids stay unique", new Set(S().notes.map((n) => n.id)).size === 4);

  // A note too short to split must be left alone, not shrunk below the floor.
  setNotes([mk(0, 60, 0.25)]);
  const tinySplit = S().applyNoteOp({ kind: "split", pieces: 4 });
  ok("split refuses sub-minimum pieces", tinySplit === 0 && S().notes.length === 1,
    "touched=" + tinySplit + " count=" + S().notes.length);

  // ── Velocity ──
  setNotes([mk(0, 60, 1, 0.5), mk(4, 62, 1, 0.5), mk(8, 64, 1, 0.5)]);
  S().applyNoteOp({ kind: "velRamp", from: 0.2, to: 1 });
  const vels = [...S().notes].sort((a, b) => a.step - b.step).map((n) => n.vel);
  ok("velocity ramps upward", vels[0] < vels[1] && vels[1] < vels[2],
    vels.map((v) => v.toFixed(2)).join(","));

  setNotes([mk(0, 60, 1, 0.9)]);
  S().applyNoteOp({ kind: "velScale", mul: 4 });
  ok("velocity clamps to 1", S().notes[0].vel <= 1, "vel=" + S().notes[0].vel);

  // ── Scope ──
  setNotes([mk(0, 60), mk(4, 64)]);
  const targetId = S().notes[0].id;
  S().applyNoteOp({ kind: "transpose", semitones: 5 }, new Set([targetId]));
  const moved = S().notes.find((n) => n.id === targetId);
  const stayed = S().notes.find((n) => n.id !== targetId);
  ok("scoped op only touches selection", moved.midi === 65 && stayed.midi === 64,
    moved.midi + "/" + stayed.midi);

  // Cross-channel safety: a channel-1 note must be untouched by a ch-0 op.
  setNotes([mk(0, 60), { ...mk(4, 64), ch: 1 }]);
  S().applyNoteOp({ kind: "transpose", semitones: 7 });
  ok("ops never cross channels",
    S().notes.find((n) => (n.ch ?? 0) === 1).midi === 64,
    "chB=" + S().notes.find((n) => (n.ch ?? 0) === 1).midi);

  // ── No-op hygiene ──
  setNotes([mk(0, 60)]);
  const noop = S().applyNoteOp({ kind: "transpose", semitones: 0 });
  ok("no-op reports 0 touched", noop === 0, "touched=" + noop);

  // ── Strum / reverse ──
  setNotes([mk(0, 60), mk(0, 64), mk(0, 67)]);
  S().applyNoteOp({ kind: "strum", spread: 0.25 });
  const strumSteps = [...S().notes].sort((a, b) => a.midi - b.midi).map((n) => n.step);
  ok("strum spreads a stack",
    near(strumSteps[0], 0) && strumSteps[1] > strumSteps[0] && strumSteps[2] > strumSteps[1],
    strumSteps.join(","));

  setNotes([mk(0, 60, 1), mk(8, 64, 1)]);
  S().applyNoteOp({ kind: "reverse" });
  ok("reverse keeps count and stays in range",
    S().notes.length === 2 && S().notes.every((n) => n.step >= 0 && n.step < 64), "");

  // Nothing anywhere may produce a non-finite field — that reaches the
  // scheduler and turns into a NaN AudioContext time.
  const allFinite = S().notes.every((n) =>
    Number.isFinite(n.step) && Number.isFinite(n.len) && Number.isFinite(n.vel) && Number.isFinite(n.midi));
  ok("no non-finite note fields", allFinite);

  // ── Pure-op unit checks (no store) ──
  {
    const scope = { channel: 0, total: 64 };
    const notes = [mk(0, 60, 1, 0.5), mk(1, 60, 1, 0.5)];
    const r1 = NoteOps.humanize(notes, scope, 0.1, 0.1, { seed: 42, protectDownbeats: false });
    const r2 = NoteOps.humanize(notes, scope, 0.1, 0.1, { seed: 42, protectDownbeats: false });
    ok("humanize is deterministic",
      JSON.stringify(r1.notes.map((n) => [n.step, n.vel])) === JSON.stringify(r2.notes.map((n) => [n.step, n.vel])));
    const prot = NoteOps.humanize([mk(0, 60)], scope, 0.5, 0.5, { protectDownbeats: true });
    ok("humanize protects downbeats", prot.touched === 0, "touched=" + prot.touched);
  }

  // ── Undo ──
  setNotes([mk(0, 60)]);
  History.pushFireHistory("edit-check-baseline");
  const preUndo = S().notes.map((n) => n.midi).join(",");
  S().applyNoteOp({ kind: "transpose", semitones: 7 });
  const postOp = S().notes.map((n) => n.midi).join(",");
  const undone = History.undoFire ? History.undoFire() : false;
  const postUndo = S().notes.map((n) => n.midi).join(",");
  ok("note op is undoable", undone && postUndo === preUndo,
    preUndo + " -> " + postOp + " -> " + postUndo);

  // ── Markers ──
  useFireSequencerStore.setState({ markers: [] });
  const mid1 = S().addMarker(64, "Drop");
  ok("marker added", S().markers.length === 1);
  const found = S().markers.find((m) => m.id === mid1);
  ok("marker keeps label + step", found && found.label === "Drop" && found.step === 64,
    JSON.stringify(found));
  S().addMarker(16, "Verse");
  ok("markers stay sorted", S().markers.every((m, i, a) => i === 0 || a[i - 1].step <= m.step),
    S().markers.map((m) => m.step).join(","));
  ok("markerBefore finds prior", S().markerBefore(64) && S().markerBefore(64).step === 16,
    JSON.stringify(S().markerBefore(64)));
  ok("markerAfter finds next", S().markerAfter(16) && S().markerAfter(16).step === 64);
  ok("markerBefore at start is null", S().markerBefore(0) === null);
  S().renameMarker(mid1, "Big Drop");
  ok("marker renamed", S().markers.find((m) => m.id === mid1).label === "Big Drop");
  S().moveMarker(mid1, 8);
  ok("marker move resorts", S().markers[0].id === mid1, S().markers.map((m) => m.step).join(","));
  S().removeMarker(mid1);
  ok("marker removed", !S().markers.some((m) => m.id === mid1));

  // Markers must be in the serialized project payload (round-trip).
  const ser = M.fireSequencerStore.serializePattern();
  ok("markers serialize into project", Array.isArray(ser.markers) && ser.markers.length === 1,
    JSON.stringify(ser.markers));

  // Garbage must be dropped by the sanitizer rather than reaching the ruler.
  S().importPattern({
    ...ser,
    markers: [
      { id: "bad1", step: Number.NaN, label: "nan" },
      { id: "bad2", step: 32, label: "good" },
      { id: "bad3", step: "xx", label: "str" },
    ],
  });
  const sane = S().markers.every((m) => Number.isFinite(m.step));
  ok("marker sanitizer drops non-finite steps", sane,
    JSON.stringify(S().markers.map((m) => [m.label, m.step])));

  // ── Drum lane clipboard / ramp ──
  S().clearLane("kick");
  S().clearLane("snare");
  {
    const cur = S().drums.steps.kick.map((x) => ({ ...x }));
    for (const st of [0, 4, 8, 12]) cur[st] = { vel: 0.9 };
    useFireSequencerStore.setState({ drums: { steps: { ...S().drums.steps, kick: cur } } });
  }
  const kickHits = S().drums.steps.kick.filter((x) => (x && x.vel) > 0).length;
  ok("kick seeded", kickHits === 4, "hits=" + kickHits);

  const copied = S().copyDrumLane("kick");
  ok("lane copy reports step count", copied === S().drums.steps.kick.length, "copied=" + copied);
  ok("clipboard flag set", S().hasDrumLaneClipboard() === true);
  const pasted = S().pasteDrumLane("snare");
  const snareHits = S().drums.steps.snare.filter((x) => (x && x.vel) > 0).length;
  ok("lane paste reproduces hits", pasted > 0 && snareHits === kickHits,
    "pasted=" + pasted + " hits=" + snareHits + "/" + kickHits);

  const rampN = S().rampDrumLane("kick", 0.3, 1);
  const rv = S().drums.steps.kick.filter((x) => (x && x.vel) > 0).map((x) => x.vel);
  ok("lane ramp shapes existing hits", rampN === kickHits && rv[0] < rv[rv.length - 1],
    "n=" + rampN + " " + rv.map((v) => v.toFixed(2)).join(","));

  // Ramp on an empty lane must be a no-op, not a crash or a phantom push.
  S().clearLane("chat");
  ok("ramp on empty lane is a no-op", S().rampDrumLane("chat", 0.3, 1) === 0);

  // ── Lane swing / flam ──
  S().setDrumLaneMix("chat", { swing: 0.15, flam: 0.2, flamVel: 0.4 });
  const chat = S().drumLaneMix.chat;
  ok("lane swing stored", near(chat.swing, 0.15), "swing=" + chat.swing);
  ok("lane flam stored", near(chat.flam, 0.2), "flam=" + chat.flam);
  ok("lane flamVel stored", near(chat.flamVel, 0.4), "flamVel=" + chat.flamVel);

  // Hydrating a hostile lane mix must clamp, since these feed timing math.
  {
    const cur = M.fireSequencerStore.serializePattern();
    S().importPattern({
      ...cur,
      drumLaneMix: { kick: { level: 99, pan: 5, swing: Number.NaN, flam: 9, rate: 0, feel: "nope" } },
    });
    const k = S().drumLaneMix.kick;
    ok("hostile lane mix clamped",
      !!k && Number.isFinite(k.swing) && k.level <= 2 && Math.abs(k.pan) <= 1 && k.flam <= 0.5 && k.feel === "grid",
      JSON.stringify(k));
  }

  // ── Clip clipboard + per-clip pitch / gain ──
  const secId = S().activeSectionId;
  useFireSequencerStore.setState({ arrangement: [] });
  const placed = S().placeClip(secId, 0, 0);
  if (!placed) {
    ok("clip placed for clipboard test", false, "placeClip returned null");
  } else {
    const n = S().copyClips([placed]);
    ok("clip copy reports count", n === 1, "copied=" + n);
    ok("clip clipboard flag", S().hasClipClipboard() === true);
    const beforeCount = S().arrangement.length;
    const newIds = S().pasteClips(64, 1);
    ok("clip paste creates a clip",
      newIds.length === 1 && S().arrangement.length === beforeCount + 1, "new=" + newIds.length);
    const pastedClip = S().arrangement.find((c) => c.id === newIds[0]);
    ok("pasted clip lands on requested track", pastedClip && pastedClip.track === 1,
      "track=" + (pastedClip && pastedClip.track));
    ok("pasted clip has a fresh id", newIds[0] !== placed);

    S().setClipTranspose(placed, 7);
    ok("clip transpose set", S().arrangement.find((c) => c.id === placed).transpose === 7);
    S().setClipTranspose(placed, 0);
    ok("zero transpose clears the field",
      S().arrangement.find((c) => c.id === placed).transpose === undefined);
    S().setClipTranspose(placed, 999);
    ok("clip transpose clamps to 24",
      S().arrangement.find((c) => c.id === placed).transpose === 24,
      "t=" + S().arrangement.find((c) => c.id === placed).transpose);
    S().setClipGain(placed, -6);
    ok("clip gain set", S().arrangement.find((c) => c.id === placed).gainDb === -6);
    S().setClipGain(placed, -999);
    ok("clip gain clamps to -24",
      S().arrangement.find((c) => c.id === placed).gainDb === -24,
      "g=" + S().arrangement.find((c) => c.id === placed).gainDb);

    // Clip pitch/gain must reach the resolved song map the scheduler reads.
    S().setClipTranspose(placed, 5);
    S().setClipGain(placed, -6);
    useFireSequencerStore.setState({ playMode: "arrangement" });
    const map = M.fireSequencerStore.debugSongMap ? M.fireSequencerStore.debugSongMap() : null;
    if (map) {
      const slot = map.find((m) => m.clipId === placed);
      ok("song map carries clip transpose", slot && slot.transpose === 5,
        JSON.stringify(slot && { t: slot.transpose, g: slot.gain }));
      ok("song map carries clip gain (linear)", slot && slot.gain > 0.4 && slot.gain < 0.6,
        "gain=" + (slot && slot.gain.toFixed(3)));
    } else {
      ok("song map carries clip transpose", null, "skipped — no debugSongMap export");
    }
    useFireSequencerStore.setState({ playMode: "pattern" });
  }

  // ── Preset shelves ──
  {
    const before = Shelf.readFavorites();
    const wasFav = before.has("fc-bass-001");
    const now = Shelf.toggleFavorite("fc-bass-001");
    ok("favorite toggles", now !== wasFav, wasFav + " -> " + now);
    ok("favorite reflected in list", Shelf.readFavorites().has("fc-bass-001") === now);
    Shelf.toggleFavorite("fc-bass-001");
    ok("favorite toggles back", Shelf.readFavorites().has("fc-bass-001") === wasFav);

    Shelf.pushRecent("fc-bass-001");
    Shelf.pushRecent("fc-lead-001");
    Shelf.pushRecent("fc-bass-001");
    const recents = Shelf.readRecents();
    ok("recents are most-recent-first", recents[0] === "fc-bass-001", recents.slice(0, 3).join(","));
    ok("recents de-duplicate",
      recents.filter((x) => x === "fc-bass-001").length === 1, recents.slice(0, 3).join(","));

    Shelf.toggleFavorite("ghost-preset-id");
    Shelf.pruneShelves(new Set(["fc-bass-001", "fc-lead-001"]));
    ok("prune drops unknown ids", !Shelf.readFavorites().has("ghost-preset-id"));
    ok("prune keeps valid ids", Shelf.readRecents().includes("fc-bass-001"));
  }

  // Restore the user's project.
  if (restore) {
    try { S().importPattern(restore); } catch { /* leave the scratch state */ }
  }

  return out;
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

  console.log("• Driving note ops / markers / clips / shelves…\n");
  const res = await send("Runtime.evaluate", {
    expression: PAGE, awaitPromise: true, returnByValue: true, timeout: 300_000,
  });
  ws.close();
  if (res.exceptionDetails) throw new Error(JSON.stringify(res.exceptionDetails).slice(0, 2000));

  const results = res.result.value ?? [];
  console.log("── FIRE EDIT CHECK ──");
  let pass = 0; let fail = 0; let skip = 0;
  for (const r of results) {
    if (r.pass === null) { skip++; console.log(`  SKIP  ${r.name}${r.detail ? "  — " + r.detail : ""}`); }
    else if (r.pass) { pass++; console.log(`  PASS  ${r.name}`); }
    else { fail++; console.log(`  FAIL  ${r.name}${r.detail ? "  — " + r.detail : ""}`); }
  }
  console.log(`\n${pass} passed · ${fail} failed · ${skip} skipped`);
  process.exitCode = fail > 0 ? 1 : 0;
} catch (err) {
  console.error("EDIT CHECK FAILED:", err.message);
  process.exitCode = 1;
} finally {
  killAll();
}
