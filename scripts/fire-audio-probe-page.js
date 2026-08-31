// Fire Command audio-quality probe — IN-PAGE half.
// Driven by scripts/fire-audio-probe.mjs over CDP. Plays deterministic test
// material (single note / chord / fast arp) through a set of presets and
// measures peak, RMS, crest factor and clip fraction at three taps:
//   synth : firePart A post-pan (the synth's own output, pre bus processing)
//   fire  : fireTap (post bus limiter+clipper, pre Kill-Chain FX)
//   out   : destinationTap (what actually reaches the DAC)
// Returns { presets: [...], notes: [...] } for the harness to tabulate.
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

  const CFG = globalThis.__FIRE_PROBE || {};
  const PRESET_IDS = CFG.presets || [];
  const notes = [];

  const hooked = await until(() => !!globalThis.__KC_TEST, 15000);
  if (!hooked) throw new Error("__KC_TEST hook missing — dev build required");
  const M = await globalThis.__KC_TEST.load();
  const { useSettingsStore } = M.settingsStore;
  const { useAudioStore } = M.audioStore;
  const { useFireCommandStore, FIRE_PRESETS } = M.fireCommandStore;

  // Clear the legal gate (fresh profile) so the app chrome mounts.
  {
    const version = M.legal?.LEGAL_VERSION ?? "1.0-draft";
    const st = useSettingsStore.getState();
    if (!st.legalAcceptedAt || st.legalAcceptedVersion !== version) {
      st.set("legalAcceptedVersion", version);
      st.set("legalAcceptedAt", new Date().toISOString());
    }
  }

  await useAudioStore.getState().ensureReady();
  const engine = M.engine.getEngine();
  await engine.resume();

  // Route through the Kill-Chain FX chain exactly as a default install does.
  if (typeof CFG.routeThroughFx === "boolean") {
    useFireCommandStore.getState().setRouteThroughFx(CFG.routeThroughFx);
    await sleep(150);
  }

  // ── Taps ──────────────────────────────────────────────────────────────────
  const mkTap = (node) => {
    const an = engine.ctx.createAnalyser();
    an.fftSize = 32768; // ~683 ms @ 48k — overlapping windows, no missed peaks
    an.smoothingTimeConstant = 0;
    node.connect(an);
    return { an, buf: new Float32Array(an.fftSize) };
  };
  const taps = {
    synth: mkTap(engine.getFirePartTap("a")),
    fire: mkTap(engine.fireTap),
    out: mkTap(engine.destinationTap),
  };

  const zeroStats = () => ({ peak: 0, sumSq: 0, n: 0, clip: 0, sumPeakWin: 0, winN: 0 });
  let stats = { synth: zeroStats(), fire: zeroStats(), out: zeroStats() };
  const resetStats = () => {
    stats = { synth: zeroStats(), fire: zeroStats(), out: zeroStats() };
  };
  let sampling = null;
  const startSampling = () => {
    if (sampling) return;
    sampling = setInterval(() => {
      for (const key of Object.keys(taps)) {
        const { an, buf } = taps[key];
        an.getFloatTimeDomainData(buf);
        const s = stats[key];
        let winPeak = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = buf[i];
          const a = Math.abs(v);
          if (a > winPeak) winPeak = a;
          s.sumSq += v * v;
          s.n++;
          if (a >= 0.985) s.clip++;
        }
        if (winPeak > s.peak) s.peak = winPeak;
        s.sumPeakWin += winPeak;
        s.winN++;
      }
    }, 250);
  };
  const stopSampling = () => {
    if (sampling) clearInterval(sampling);
    sampling = null;
  };
  const snap = () => {
    const out = {};
    for (const key of Object.keys(stats)) {
      const s = stats[key];
      const rms = s.n > 0 ? Math.sqrt(s.sumSq / s.n) : 0;
      out[key] = {
        peak: +s.peak.toFixed(4),
        rms: +rms.toFixed(4),
        crestDb: s.peak > 0 && rms > 0 ? +(20 * Math.log10(s.peak / rms)).toFixed(1) : 0,
        clipPct: s.n > 0 ? +((s.clip / s.n) * 100).toFixed(3) : 0,
      };
    }
    return out;
  };

  const store = () => useFireCommandStore.getState();
  const fc = engine.fireCommand;

  const quietDown = async () => {
    try { store().setArp({ enabled: false, hold: false }); } catch { /* ignore */ }
    try { store().panic(); } catch { /* ignore */ }
    await sleep(450);
  };

  // ── Scenarios ────────────────────────────────────────────────────────────
  const playSingle = async () => {
    resetStats();
    const t = engine.ctx.currentTime + 0.05;
    fc.playNote(60, 0.9, t, 0.7);
    await sleep(1400);
    return snap();
  };

  const playChord = async () => {
    resetStats();
    const t = engine.ctx.currentTime + 0.05;
    for (const m of [48, 52, 55, 60, 64, 67]) fc.playNote(m, 0.9, t, 1.1);
    await sleep(1900);
    return snap();
  };

  const playArp = async () => {
    resetStats();
    // Fast arp: 4 latched notes, 2 octaves, 1/16 @ 170 — the complaint case.
    store().setArp({
      enabled: true, hold: true, bpm: 170, division: "1/16",
      octaves: 2, gate: 0.8, mode: "updown", ratchet: 0.25,
    });
    for (const m of [48, 55, 60, 64]) store().noteOn(m, 0.9);
    await sleep(320);
    for (const m of [48, 55, 60, 64]) store().noteOff(m);
    await sleep(3200);
    const r = snap();
    store().setArp({ enabled: false, hold: false });
    store().panic();
    return r;
  };

  // ── Run ──────────────────────────────────────────────────────────────────
  const byId = new Map((FIRE_PRESETS ?? []).map((p) => [p.id, p]));
  const results = [];
  startSampling();

  for (const id of PRESET_IDS) {
    const preset = byId.get(id);
    const label = preset ? `${id} (${preset.name})` : id;
    try {
      if (id !== "__current__") {
        store().loadPreset(id);
        await sleep(350);
      }
      await quietDown();
      const single = await playSingle();
      await quietDown();
      const chord = await playChord();
      await quietDown();
      const arp = await playArp();
      await quietDown();
      results.push({ id, label, single, chord, arp });
    } catch (err) {
      notes.push(`preset ${id} failed: ${err?.message ?? err}`);
    }
  }

  stopSampling();
  for (const key of Object.keys(taps)) {
    try { taps[key].an.disconnect(); } catch { /* ignore */ }
  }
  return { presets: results, notes };
})();
