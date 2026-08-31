// Fire Command long-run SOAK — IN-PAGE half.
// Driven by scripts/fire-soak-probe.mjs over CDP. Simulates sustained real
// play (fast arp on ladder/SVF presets + chord stabs + preset churn) for N
// minutes and samples output health continuously. The failure mode this
// guards: progressive audio-thread overload (zombie worklet processors) or
// latched NaN — heard as worsening distortion, then total silence.
//
// Status rows land in globalThis.__FIRE_SOAK_STATUS (harness polls);
// the final verdict resolves into globalThis.__FIRE_SOAK_RESULT.
(() => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn, ms, step = 200) => {
    const end = Date.now() + ms;
    for (;;) {
      try { if (await fn()) return true; } catch { /* poll */ }
      if (Date.now() > end) return false;
      await sleep(step);
    }
  };

  const CFG = globalThis.__FIRE_SOAK || {};
  const MINUTES = Math.max(1, CFG.minutes || 8);
  // Ladder/SVF + FX-heavy rotation — worst case for per-voice worklet churn.
  const PRESETS = CFG.presets && CFG.presets.length
    ? CFG.presets
    : ["fc-lead-acid-scream", "fc-arp-trance", "fc-bass-acid", "fc-pad-hyperspace"];

  globalThis.__FIRE_SOAK_RESULT = null;
  globalThis.__FIRE_SOAK_STATUS = null;

  const run = async () => {
    const hooked = await until(() => !!globalThis.__KC_TEST, 15000);
    if (!hooked) throw new Error("__KC_TEST hook missing — dev build required");
    const M = await globalThis.__KC_TEST.load();
    const { useSettingsStore } = M.settingsStore;
    const { useAudioStore } = M.audioStore;
    const { useFireCommandStore } = M.fireCommandStore;

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
    const fc = engine.fireCommand;
    const store = () => useFireCommandStore.getState();

    // Three taps localize a failure: synth (pre engine bus) → fire (post
    // fire limiter, pre Kill-Chain) → out (DAC).
    const mkTap = (node) => {
      const a = engine.ctx.createAnalyser();
      a.fftSize = 8192;
      a.smoothingTimeConstant = 0;
      node.connect(a);
      return { an: a, buf: new Float32Array(a.fftSize) };
    };
    const taps = {
      synth: mkTap(engine.getFirePartTap("a")),
      fire: mkTap(engine.fireTap),
      out: mkTap(engine.destinationTap),
    };
    const sampleTap = (t) => {
      t.an.getFloatTimeDomainData(t.buf);
      let peak = 0;
      let sumSq = 0;
      let clip = 0;
      let nan = false;
      for (let i = 0; i < t.buf.length; i++) {
        const v = t.buf[i];
        if (!Number.isFinite(v)) { nan = true; continue; }
        const a = Math.abs(v);
        if (a > peak) peak = a;
        sumSq += v * v;
        if (a >= 0.985) clip++;
      }
      return { peak, rms: Math.sqrt(sumSq / t.buf.length), clipPct: (clip / t.buf.length) * 100, nan };
    };
    const sampleOut = () => sampleTap(taps.out);

    // Worklet processor death detector — a processor that throws is
    // permanently silenced by the browser (exact-zero output forever).
    const procErrors = [];
    const hookNode = (label, node) => {
      if (node && !node.__soakHooked) {
        node.__soakHooked = true;
        node.onprocessorerror = () => procErrors.push(`${label}@${engine.ctx.currentTime.toFixed(1)}s`);
      }
    };
    const hookWorklets = () => {
      hookNode("fireLimiter", engine.fireLimiterWorklet);
      hookNode("spectralA", fc.spectralNode);
      const b = engine.peekFireCommandB?.();
      if (b) hookNode("spectralB", b.spectralNode);
    };

    // Gain-stage dump — reading .value on every serial bus gain finds WHICH
    // stage latched to zero when the output dies.
    const gainDump = () => {
      const g = (n) => {
        try { return n && n.gain ? +n.gain.value.toFixed(4) : null; } catch { return null; }
      };
      let firePartA = null;
      try { firePartA = g(engine.getFirePartTap("a")); } catch { /* ignore */ }
      return {
        fxSilenced: !!fc.fxSilenced,
        master: g(fc.master),
        voiceBus: g(fc.voiceBus),
        output: g(fc.output),
        punchDry: g(fc.punchDry),
        punchWet: g(fc.punchWet),
        punchMakeup: g(fc.punchMakeup),
        drivePost: g(fc.drivePost),
        delayDry: g(fc.delayDry),
        reverbDry: g(fc.reverbDry),
        chorusDry: g(fc.chorusDry),
        phaserDry: g(fc.phaserDry),
        spectralDry: g(fc.spectralDry),
        tremolo: g(fc.tremolo),
        gateGain: g(fc.gateGain),
        widthOutGain: g(fc.widthOutGain),
        clipPre: g(fc.clipPre),
        firePartA,
        fireBus: g(engine.fireBus),
        limiterGrDb: (() => { try { return +engine.getFireLimiterReduction().toFixed(2); } catch { return null; } })(),
      };
    };

    // Tone-injection bisection: when the bus latches silent, push a test tone
    // into each serial stage (upstream → downstream) and check whether it
    // reaches the fire tap. `false` at stage k with `true` at k+1 = stage k
    // (or its outgoing edge) is the corpse. Gain dumps can't see broken
    // EDGES; this can.
    const bisect = async () => {
      const stages = [
        ["voiceBus", fc.voiceBus],
        ["drivePost", fc.drivePost],
        ["crushOut", fc.crushOut],
        ["vintageOut", fc.vintage && fc.vintage.output],
        ["ringOut", fc.ringOut],
        ["chorusIn", fc.chorusIn],
        ["phaserIn", fc.phaserIn],
        ["tremolo", fc.tremolo],
        ["delayOut", fc.delayOut],
        ["tone", fc.tone],
        ["punchIn", fc.punchIn],
        ["punchMakeup", fc.punchMakeup],
        ["airIn", fc.airIn],
        ["airOut", fc.airOut],
        ["reverbIn", fc.reverbIn],
        ["reverbOut", fc.reverbOut],
        ["autopan", fc.autopan],
        ["gateGain", fc.gateGain],
        ["widthIn", fc.widthIn],
        ["widthOutGain", fc.widthOutGain],
        ["master", fc.master],
        ["softClip", fc.softClip],
        ["output", fc.output],
        ["engineFireBus", engine.fireBus],
      ];
      const res = {};
      for (const [name, node] of stages) {
        if (!node) { res[name] = null; continue; }
        try {
          const osc = engine.ctx.createOscillator();
          const g = engine.ctx.createGain();
          g.gain.value = 0.15;
          osc.frequency.value = 523;
          osc.connect(g).connect(node);
          osc.start();
          await sleep(180);
          const m = sampleTap(taps.fire);
          osc.stop();
          osc.disconnect();
          g.disconnect();
          res[name] = m.rms > 0.0008;
          await sleep(60);
        } catch (e) {
          res[name] = `err:${String(e && e.message).slice(0, 40)}`;
        }
      }
      return res;
    };

    const stats = async () => {
      try { return (await window.playground?.system?.getStats?.()) ?? null; } catch { return null; }
    };

    // ── Play driver ──
    const CHORD = [48, 55, 60, 64, 67];
    let presetIdx = -1;
    const nextPreset = () => {
      presetIdx = (presetIdx + 1) % PRESETS.length;
      // Raw patch mode: soak a literal patch JSON (e.g. a user preset dump)
      // through the same import path the Preset I/O uses.
      if (CFG.rawPatch) {
        store().importPatch(CFG.rawPatch, CFG.rawArp);
        if (!CFG.rawArp) {
          store().setArp({
            enabled: true, hold: true,
            bpm: CFG.bpm || 174, division: CFG.division || "1/16",
            octaves: CFG.octaves || 2, mode: CFG.arpMode || "updown", gate: CFG.gate || 0.7,
          });
        } else {
          store().setArp({ enabled: true, hold: true });
        }
        for (const m of [45, 52, 57]) store().noteOn(m, 0.9);
        return;
      }
      store().loadPreset(PRESETS[presetIdx]);
      // Force per-voice worklet filters + audible FX space on every preset —
      // this is deliberately the heaviest legal configuration.
      store().setParam("filterModel", presetIdx % 2 === 0 ? "ladder" : "svf");
      store().setParam("delayMix", Math.max(0.2, store().patch.delayMix ?? 0));
      store().setParam("reverbMix", Math.max(0.22, store().patch.reverbMix ?? 0));
      store().setArp({
        enabled: true, hold: true,
        bpm: CFG.bpm || 174,
        division: CFG.division || "1/16",
        octaves: CFG.octaves || 2,
        mode: CFG.arpMode || "updown",
        gate: CFG.gate || 0.7,
      });
      for (const m of [45, 52, 57]) store().noteOn(m, 0.9);
    };
    nextPreset();
    const ROTATE_MS = CFG.rotateMs || 40_000;

    const t0 = performance.now();
    const endAt = t0 + MINUTES * 60_000;
    const rows = [];
    let consecutiveDead = 0;
    let worstClip = 0;
    let nanSeen = false;
    let deadEvents = 0;
    let lastRotate = t0;
    let lastChord = t0;
    let firstMinRms = [];
    let lastMinRms = [];

    while (performance.now() < endAt) {
      await sleep(5000);
      const nowMs = performance.now();

      // Chord stabs every ~9 s (exercises poly steal + same-midi choke).
      if (nowMs - lastChord > 9000) {
        lastChord = nowMs;
        for (const m of CHORD) fc.playNote(m, 0.85, engine.ctx.currentTime + 0.02, 1.2);
      }
      // Preset churn (exercises setPatch force-stop + worklet teardown).
      if (nowMs - lastRotate > ROTATE_MS) {
        lastRotate = nowMs;
        nextPreset();
      }

      hookWorklets();
      const s = sampleOut();
      const sSynth = sampleTap(taps.synth);
      const sFire = sampleTap(taps.fire);
      const mins = (nowMs - t0) / 60_000;
      if (s.nan || sSynth.nan || sFire.nan) nanSeen = true;
      worstClip = Math.max(worstClip, s.clipPct);
      if (mins < 1) firstMinRms.push(s.rms);
      if (nowMs > endAt - 60_000) lastMinRms.push(s.rms);

      // Dead output while the arp latch claims notes are held = the bug.
      const held = store().heldNotes.length;
      let dump = null;
      if (s.rms < 1e-5 && held > 0) {
        consecutiveDead++;
        if (consecutiveDead === 3) {
          deadEvents++;
          dump = gainDump();
          // Shared-infrastructure state: LFO banks feed every voice's detune,
          // filter and the bus tremolo — NaN there kills everything at once.
          const bank = (b) => {
            const pv = (x) => { try { return +x.toFixed(3); } catch { return String(x); } };
            try {
              return {
                oscHz: pv(b.osc.frequency.value),
                oscGain: pv(b.oscGain.gain.value),
                sh: pv(b.sh.offset.value),
                filt: pv(b.filterDepth.gain.value),
                pitch: pv(b.pitchDepth.gain.value),
                pan: pv(b.panDepth.gain.value),
                amp: pv(b.ampDepth.gain.value),
              };
            } catch (e) { return String(e); }
          };
          dump.lfo1 = bank(fc.lfo1);
          dump.lfo2 = bank(fc.lfo2);
          const v0 = fc.voices ? [...fc.voices][0] : null;
          if (v0) {
            const pv = (x) => { try { return +x.toFixed(3); } catch { return String(x); } };
            dump.voice = {
              amp: pv(v0.ampEnv.offset.value),
              mix: pv(v0.mix.gain.value),
              vca: pv(v0.vca.gain.value),
              filtHz: pv(v0.filter.frequency.value),
              det0: pv(v0.groupA.osc[0].detune.value),
              oscHz: pv(v0.groupA.osc[0].frequency.value),
              worklet: !!v0.filterWorklet,
              wCut: v0.filterWorklet ? pv(v0.filterWorklet.parameters.get("cutoff").value) : null,
              releasing: !!v0.releasing,
              stopped: !!v0.stopped,
              startedIn: pv(v0.startedAt - engine.ctx.currentTime),
            };
          }
          dump.arpQueue = fc.arpQueue ? fc.arpQueue.length : null;
          try { dump.bisect = await bisect(); } catch (e) { dump.bisect = String(e); }
          // Fresh-worklet probe: does a brand-new kc-filter instance process
          // AT ALL right now? Distinguishes "worklet subsystem wedged" from
          // "voice scheduling wedged".
          try {
            const w = new AudioWorkletNode(engine.ctx, "kc-filter", {
              numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2],
            });
            w.parameters.get("cutoff").value = 8000;
            const osc2 = engine.ctx.createOscillator();
            const g2 = engine.ctx.createGain();
            g2.gain.value = 0.15;
            osc2.connect(g2).connect(w).connect(fc.voiceBus);
            osc2.start();
            await sleep(250);
            dump.freshWorkletAudible = sampleTap(taps.fire).rms > 0.0008;
            osc2.stop();
            osc2.disconnect();
            g2.disconnect();
            w.disconnect();
          } catch (e) {
            dump.freshWorkletAudible = `err:${String(e && e.message).slice(0, 60)}`;
          }
          // Revival experiments — whichever jiggle restores audio names the
          // poisoned subsystem (LFO banks vs filter vs bus params).
          const revive = {};
          const jiggle = async (label, fn) => {
            try { fn(); } catch (e) { revive[label] = `err:${String(e && e.message).slice(0, 60)}`; return; }
            await sleep(700);
            revive[label] = +sampleTap(taps.out).rms.toFixed(4);
          };
          const patch0 = store().patch;
          await jiggle("lfoParams", () => store().setParam("lfo1Rate", (patch0.lfo1Rate ?? 5) * 1.01));
          await jiggle("filterLive", () => store().setParam("filterCutoff", (patch0.filterCutoff ?? 2000) + 1));
          await jiggle("busParams", () => store().setParam("masterGain", Math.min(1, (patch0.masterGain ?? 0.7) + 0.001)));
          await jiggle("retrigger", () => {
            for (const m of [50, 57]) fc.playNote(m, 0.9, engine.ctx.currentTime + 0.02, 0.8);
          });
          // The discriminator: biquad voices bypass kc-filter entirely.
          // Audio returning here = the per-voice worklet subsystem is the corpse.
          await jiggle("biquadModel", () => {
            store().setParam("filterModel", "biquad");
            for (const m of [50, 57, 62]) fc.playNote(m, 0.9, engine.ctx.currentTime + 0.02, 1.0);
          });
          dump.revive = revive;
          // Sticky — survives row overwrites so the harness always sees it.
          globalThis.__FIRE_SOAK_DUMP = JSON.stringify(dump);
        }
      } else {
        consecutiveDead = 0;
      }

      const sys = rows.length % 6 === 0 ? await stats() : null;
      let gr = null;
      try { gr = +engine.getFireLimiterReduction().toFixed(1); } catch { /* ignore */ }
      const row = {
        tMin: +mins.toFixed(2),
        rms: +s.rms.toFixed(4),
        synthRms: +sSynth.rms.toFixed(4),
        fireRms: +sFire.rms.toFixed(4),
        peak: +s.peak.toFixed(3),
        gr,
        clipPct: +s.clipPct.toFixed(3),
        nan: s.nan,
        voices: fc.voices ? fc.voices.size : -1,
        dying: fc.dying ? fc.dying.size : -1,
        held,
        preset: PRESETS[presetIdx],
        ctx: engine.ctx.state,
        procErrors: procErrors.length ? [...procErrors] : undefined,
        dump: dump ?? undefined,
        appCpu: sys?.appCpuPercent != null ? +sys.appCpuPercent.toFixed(1) : null,
        ramMb: sys?.appRamMB != null ? Math.round(sys.appRamMB) : null,
      };
      rows.push(row);
      globalThis.__FIRE_SOAK_STATUS = JSON.stringify(row);
    }

    // Wind down + final silence check (tails should decay, not persist).
    try { store().setArp({ enabled: false, hold: false }); } catch { /* ignore */ }
    try { store().panic(); } catch { /* ignore */ }
    await sleep(1500);
    const after = sampleOut();

    const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
    const rmsStart = avg(firstMinRms);
    const rmsEnd = avg(lastMinRms);
    return {
      minutes: MINUTES,
      rows,
      verdict: {
        nanSeen,
        deadEvents,
        worstClipPct: +worstClip.toFixed(3),
        rmsFirstMinute: +rmsStart.toFixed(4),
        rmsLastMinute: +rmsEnd.toFixed(4),
        // Healthy: level in the final minute within ~4 dB of the first minute
        // (preset rotation moves it some), zero NaN, zero dead events, and
        // silence actually achievable after panic.
        silentAfterPanic: after.rms < 0.002,
        ctxState: engine.ctx.state,
      },
    };
  };

  globalThis.__FIRE_SOAK_DONE = run().then(
    (r) => { globalThis.__FIRE_SOAK_RESULT = { ok: true, ...r }; return true; },
    (e) => { globalThis.__FIRE_SOAK_RESULT = { ok: false, error: String(e && e.message || e) }; return true; },
  );
  return true;
})();
