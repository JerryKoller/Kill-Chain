/**
 * In-page engine for the progressive-distortion hunt.
 *
 * The existing soak harness answers "did the output die?" well, but it only
 * detects distortion as `clipPct > 0.5%` plus a loose level ratio. The bug
 * we're chasing is PROGRESSIVE tonal degradation that survives preset changes
 * and needs an app relaunch — that can be present with almost no hard clipping.
 *
 * Method: a CALIBRATED TRANSFER MEASUREMENT.
 *   1. Load a fixed reference patch, silence all voices.
 *   2. Inject a pure sine directly into the synth's FX bus entry (voiceBus).
 *   3. At every stage of the chain, measure gain, THD, noise floor and DC.
 *   4. That's the baseline.
 *   5. Abuse the synth hard for a while (preset churn, poly stabs, arp,
 *      parameter thrash, filter-model switching, spectral churn).
 *   6. Re-load the SAME reference patch and re-probe.
 *
 * If the transfer function of the same patch has drifted, some persistent
 * state is corrupted — and the per-stage numbers say exactly which stage.
 * Additionally a node census tracks live AudioNode counts to catch leaks,
 * because a render thread starved by leaked nodes glitches in a way that
 * sounds exactly like distortion.
 *
 * Globals contract (read by scripts/fire-distort-hunt.mjs):
 *   __FDH        — config injected by the Node side
 *   __FDH_STATUS — JSON string, latest progress row
 *   __FDH_RESULT — final { ok, rounds, baseline, drift, census, verdict }
 *   __FDH_DUMP   — sticky detailed dump on first trip
 */

(async () => {
  const CFG = globalThis.__FDH || {};
  const MINUTES = CFG.minutes || 10;
  const ROUND_STRESS_MS = CFG.stressMs || 20000;
  const REF_PRESET = CFG.refPreset || "fc-bass-acid";
  const TONE_HZ = CFG.toneHz || 440;
  const TONE_AMP = CFG.toneAmp || 0.2;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn, ms, step = 200) => {
    const end = Date.now() + ms;
    for (;;) {
      try { if (await fn()) return true; } catch { /* keep waiting */ }
      if (Date.now() > end) return false;
      await sleep(step);
    }
  };

  const status = (o) => { globalThis.__FDH_STATUS = JSON.stringify(o); };

  try {
    if (!(await until(() => !!globalThis.__KC_TEST, 20000))) {
      throw new Error("__KC_TEST hook missing — dev build required");
    }
    const M = await globalThis.__KC_TEST.load();
    const { useSettingsStore } = M.settingsStore;
    const { useAudioStore } = M.audioStore;
    const { useFireCommandStore, FIRE_PRESETS } = M.fireCommandStore;

    // Clear the first-boot legal gate so the audio graph builds.
    {
      const version = M.legal?.LEGAL_VERSION ?? "1.0-draft";
      const st = useSettingsStore.getState();
      if (!st.legalAcceptedAt || st.legalAcceptedVersion !== version) {
        st.set("legalAcceptedVersion", version);
        st.set("legalAcceptedAt", new Date().toISOString());
      }
    }

    await useAudioStore.getState().ensureReady();
    // Mutable: the recovery ladder's last rung rebuilds the whole audio graph,
    // which replaces the engine, the synth and every node we tapped.
    let engine = M.engine.getEngine();
    await engine.resume();
    let fc = engine.fireCommand;
    let ctx = engine.ctx;
    const store = () => useFireCommandStore.getState();

    // ROUTE THROUGH THE KILL-CHAIN FX CHAIN. Off by default in a bare harness,
    // which silently bypassed the shared glue / FX limiter / final limiter —
    // i.e. exactly the nodes the synth's own comments call the
    // "strongest reboot-only contamination candidate". A real user has this on.
    if (CFG.routeThroughFx !== false) {
      try { store().setRouteThroughFx(true); } catch { /* older build */ }
    }

    // ── Node census ────────────────────────────────────────────────────────
    // A leaked node is invisible to level metering but starves the render
    // thread, and render overruns sound like crackle/distortion. Patch the
    // factory methods to count creates, and `disconnect` to count releases.
    const census = { created: {}, disconnected: 0, worklets: 0 };
    if (!ctx.__fdhCensus) {
      ctx.__fdhCensus = true;
      const kinds = [
        "createGain", "createBiquadFilter", "createDelay", "createOscillator",
        "createWaveShaper", "createStereoPanner", "createConvolver",
        "createDynamicsCompressor", "createBufferSource", "createAnalyser",
        "createChannelSplitter", "createChannelMerger", "createConstantSource",
      ];
      for (const k of kinds) {
        const orig = ctx[k];
        if (typeof orig !== "function") continue;
        census.created[k] = 0;
        ctx[k] = function patched(...args) {
          census.created[k]++;
          return orig.apply(this, args);
        };
      }
      const origDisc = AudioNode.prototype.disconnect;
      AudioNode.prototype.disconnect = function patchedDisconnect(...args) {
        census.disconnected++;
        return origDisc.apply(this, args);
      };
      const OrigWorklet = globalThis.AudioWorkletNode;
      if (OrigWorklet) {
        globalThis.AudioWorkletNode = class extends OrigWorklet {
          constructor(...args) { super(...args); census.worklets++; }
        };
      }
    }
    const censusTotal = () =>
      Object.values(census.created).reduce((a, b) => a + b, 0);

    // ── Stage taps ─────────────────────────────────────────────────────────
    // Reach into the synth's FX chain (TS `private` is compile-time only) so a
    // drift can be localized to one stage instead of "somewhere in the synth".
    const FFT = 32768;
    const mkTap = (label, node) => {
      if (!node || typeof node.connect !== "function") return null;
      try {
        const an = ctx.createAnalyser();
        an.fftSize = FFT;
        an.smoothingTimeConstant = 0;
        node.connect(an);
        return { label, an, td: new Float32Array(FFT), fd: new Float32Array(FFT / 2) };
      } catch { return null; }
    };

    const stageSpecs = [
      ["voiceBus", () => fc.voiceBus],
      ["drivePost", () => fc.drivePost],
      ["crushOut", () => fc.crushOut],
      ["ringOut", () => fc.ringOut],
      ["chorusOut", () => fc.chorusOut],
      ["phaserOut", () => fc.phaserOut],
      ["tremolo", () => fc.tremolo],
      ["delayOut", () => fc.delayOut],
      ["tone", () => fc.tone],
      ["punchOut", () => fc.punchOut],
      ["punchMakeup", () => fc.punchMakeup],
      ["airOut", () => fc.airOut],
      ["reverbOut", () => fc.reverbOut],
      ["autopan", () => fc.autopan],
      ["gateGain", () => fc.gateGain],
      ["widthOut", () => fc.widthOutGain],
      ["master", () => fc.master],
      ["synthOut", () => fc.output],
      ["firePartA", () => engine.getFirePartTap("a")],
      ["fireTap", () => engine.fireTap],
      ["destination", () => engine.destinationTap],
    ];
    let taps = [];
    const rebuildTaps = () => {
      for (const t of taps) { try { t.an.disconnect(); } catch { /* gone */ } }
      taps = [];
      for (const [label, get] of stageSpecs) {
        let node = null;
        try { node = get(); } catch { /* stage absent in this build */ }
        const t = mkTap(label, node);
        if (t) taps.push(t);
      }
    };
    rebuildTaps();

    // ── Measurement ────────────────────────────────────────────────────────
    const binHz = ctx.sampleRate / FFT;
    const fundBin = Math.round(TONE_HZ / binHz);

    /** Integrate linear magnitude across a small window of bins. */
    const bandEnergy = (fd, centerBin, halfWidth) => {
      let sum = 0;
      const lo = Math.max(1, centerBin - halfWidth);
      const hi = Math.min(fd.length - 1, centerBin + halfWidth);
      for (let k = lo; k <= hi; k++) {
        // getFloatFrequencyData returns dBFS; convert to linear power.
        const lin = Math.pow(10, fd[k] / 20);
        sum += lin * lin;
      }
      return sum;
    };

    const measure = (t) => {
      t.an.getFloatTimeDomainData(t.td);
      t.an.getFloatFrequencyData(t.fd);

      let peak = 0;
      let sum = 0;
      let sumSq = 0;
      let clip = 0;
      let nan = false;
      for (let i = 0; i < t.td.length; i++) {
        const v = t.td[i];
        if (!Number.isFinite(v)) { nan = true; continue; }
        sum += v;
        sumSq += v * v;
        const a = v < 0 ? -v : v;
        if (a > peak) peak = a;
        if (a >= 0.985) clip++;
      }
      const n = t.td.length;
      const rms = Math.sqrt(sumSq / n);

      // GLITCH DETECTOR. For a pure sine, x[n+1] - 2x[n] + x[n-1] = -w²·x[n]
      // exactly, so the residual of that identity is ~0 everywhere. A render
      // dropout, a buffer discontinuity, or a sample-level artifact breaks it.
      // This is what the user actually hears as "distortion" when the render
      // thread can't keep up, and level/THD metering both miss it entirely.
      const w = (2 * Math.PI * TONE_HZ) / ctx.sampleRate;
      const wSq = w * w;
      let glitches = 0;
      let worstResid = 0;
      if (rms > 1e-5) {
        // Scale the tolerance to signal level; 2% of peak is far above
        // arithmetic noise but far below any real discontinuity.
        const tol = Math.max(1e-4, peak * 0.02);
        for (let i = 1; i < n - 1; i++) {
          const resid = t.td[i + 1] - 2 * t.td[i] + t.td[i - 1] + wSq * t.td[i];
          const a = resid < 0 ? -resid : resid;
          if (a > worstResid) worstResid = a;
          if (a > tol) glitches++;
        }
      }

      // THD in dB relative to the fundamental. Percent was useless here: a
      // clean chain measures 0.0000% and gives no dynamic range to detect
      // degradation against. dB spans the whole -140..0 range.
      const fund = bandEnergy(t.fd, fundBin, 3);
      let harm = 0;
      for (let h = 2; h <= 8; h++) {
        const b = fundBin * h;
        if (b > t.fd.length - 4) break;
        harm += bandEnergy(t.fd, b, 3);
      }
      // Noise floor: everything that is neither the tone nor a harmonic.
      let noise = 0;
      let noiseN = 0;
      for (let k = 4; k < t.fd.length; k++) {
        let nearHarmonic = false;
        for (let h = 1; h <= 8; h++) {
          if (Math.abs(k - fundBin * h) <= 5) { nearHarmonic = true; break; }
        }
        if (nearHarmonic) continue;
        const lin = Math.pow(10, t.fd[k] / 20);
        noise += lin * lin;
        noiseN++;
      }

      return {
        peak: +peak.toFixed(5),
        rms: +rms.toFixed(6),
        // DC offset. Never measured by any previous harness, and a DC drift
        // pushes the signal asymmetrically into every downstream clipper —
        // audible as distortion with no level change at all.
        dc: +(sum / n).toFixed(6),
        clipPct: +((clip / n) * 100).toFixed(4),
        nan,
        glitches,
        glitchPct: +((glitches / n) * 100).toFixed(4),
        worstResid: +worstResid.toFixed(5),
        fundDb: fund > 0 ? +(10 * Math.log10(fund)).toFixed(2) : -200,
        thdDb: fund > 0 && harm > 0 ? +(10 * Math.log10(harm / fund)).toFixed(2) : -200,
        noiseDb: noiseN > 0 && noise > 0 ? +(10 * Math.log10(noise / noiseN)).toFixed(2) : -200,
      };
    };

    // ── Reference-patch transfer probe ─────────────────────────────────────
    let toneOsc = null;
    let toneGain = null;

    const startTone = () => {
      toneOsc = ctx.createOscillator();
      toneGain = ctx.createGain();
      toneOsc.type = "sine";
      toneOsc.frequency.value = TONE_HZ;
      toneGain.gain.value = TONE_AMP;
      toneOsc.connect(toneGain).connect(fc.voiceBus);
      toneOsc.start();
    };
    const stopTone = () => {
      try { toneOsc && toneOsc.stop(); } catch { /* already stopped */ }
      try { toneOsc && toneOsc.disconnect(); } catch { /* gone */ }
      try { toneGain && toneGain.disconnect(); } catch { /* gone */ }
      toneOsc = null;
      toneGain = null;
    };

    /**
     * Load the reference patch, silence everything, inject the tone, and
     * measure every stage. Any drift between two calls of this is a real
     * persistent-state bug, because the patch is byte-identical each time.
     */
    const probeTransfer = async (label) => {
      store().panic();
      await sleep(250);
      store().loadPreset(REF_PRESET);
      // Pin the FX to a fixed, mild configuration so the measurement is about
      // the CHAIN, not about whatever the last preset left in the wet knobs.
      store().setParams({
        delayMix: 0, delayFeedback: 0, delayFreeze: false,
        reverbMix: 0, reverbFreeze: false,
        chorusMix: 0, phaserMix: 0,
        spectralMode: "off", spectralMix: 0,
        drive: 0, crush: 0, ringAmount: 0, punch: 0,
        gateOn: false, airAmount: 0, ageMacro: 0,
        // LFOs off: a running LFO would amplitude-modulate the probe tone and
        // show up as sidebands, i.e. fake THD.
        lfo1Depth: 0, lfo1Dest: "off", lfo2Depth: 0, lfo2Dest: "off",
        fmAmount: 0, fmBtoA: 0,
        masterGain: 0.8, stereoWidth: 1,
        // Force every module awake. loadPreset sleeps modules the preset
        // doesn't use, and setParams auto-wakes them — so the sleep state
        // differed between probes and shifted drivePost gain by ~2 dB, which
        // the trip detector read as corruption.
        moduleEnable: {},
        driveInGain: 1, driveOutGain: 1, driveAutoGain: true,
        driveBias: 0, driveSymmetry: 0, driveMode: "soft",
      });
      store().setArp({ enabled: false });
      store().panic();
      // Long enough for reverb/delay tails and the limiter to release.
      await sleep(1400);

      // ACTIVELY wait for the bus smoothers to settle. applyBusParams uses
      // setTargetAtTime, so a fixed sleep left drivePost still gliding from
      // whatever the stress phase set — which read as a 5 dB "gain drift"
      // trip that was purely an artifact of measuring mid-glide.
      const watched = () => [
        fc.drivePost, fc.drivePre, fc.master, fc.delayWet, fc.reverbWet,
        fc.crushWet, fc.chorusWet, fc.phaserWet, fc.punchWet, fc.gateGain,
      ].filter((n) => n && n.gain);
      let prev = watched().map((n) => n.gain.value);
      for (let i = 0; i < 40; i++) {
        await sleep(150);
        const cur = watched().map((n) => n.gain.value);
        const maxDelta = cur.reduce((m, v, k) => Math.max(m, Math.abs(v - prev[k])), 0);
        prev = cur;
        if (maxDelta < 1e-4) break;
      }

      startTone();
      // Let the analyser fill with pure tone (32768 samples ≈ 0.68 s @ 48k)
      // plus chain settling.
      await sleep(1600);
      const stages = {};
      for (const t of taps) stages[t.label] = measure(t);
      stopTone();
      await sleep(200);

      return {
        label,
        at: +ctx.currentTime.toFixed(1),
        nodes: censusTotal(),
        worklets: census.worklets,
        disconnects: census.disconnected,
        limiterGrDb: (() => {
          try { return +engine.getFireLimiterReduction().toFixed(2); } catch { return null; }
        })(),
        ctxState: ctx.state,
        // Engine-side state that would explain a level or tone change without
        // any DSP corruption at all.
        engineState: {
          fxSilenced: !!fc.fxSilenced,
          voices: (() => { try { return fc.voices?.size ?? null; } catch { return null; } })(),
          dying: (() => { try { return fc.dying?.size ?? null; } catch { return null; } })(),
          voiceBusGain: (() => { try { return +fc.voiceBus.gain.value.toFixed(4); } catch { return null; } })(),
          masterGain: (() => { try { return +fc.master.gain.value.toFixed(4); } catch { return null; } })(),
          outputGain: (() => { try { return +fc.output.gain.value.toFixed(4); } catch { return null; } })(),
          poolSize: (() => { try { return fc.filterWorkletPool?.length ?? null; } catch { return null; } })(),
          heapMB: (() => {
            try { return +(performance.memory.usedJSHeapSize / 1048576).toFixed(1); } catch { return null; }
          })(),
        },
        stages,
      };
    };

    // ── Stress phase ───────────────────────────────────────────────────────
    // Emulates "playing with Fire Command": preset churn, chords, arp, and
    // knob thrashing, including the topology-changing params that force a
    // full setPatch (filterModel / filterSlope / unison).
    const ids = (FIRE_PRESETS || []).map((p) => p.id);
    let rr = 0;
    const pick = () => ids[(rr++ * 7919) % ids.length];

    const FILTER_MODELS = ["ladder", "svf", "biquad"];
    const SPECTRAL_MODES = ["off", "freeze", "smear", "gate", "shift"];
    const DELAY_MODES = ["slap", "echo", "dub", "bounce", "long", "infinite"];

    // ── Continuous monitoring of the REAL musical signal ───────────────────
    // The tone probe measures the chain while silent, which cannot see a fault
    // that only manifests with voices running — and that is exactly when the
    // user hears it. This samples the live output throughout the stress phase.
    const live = {
      samples: 0,
      worstClipPct: 0,
      worstDc: 0,
      minCrestDb: 999,
      maxPeak: 0,
      nanSeen: false,
      // Sustained distortion is the real symptom: a single hot transient is
      // musical, 20 consecutive hot windows is a broken instrument.
      consecutiveHot: 0,
      maxConsecutiveHot: 0,
      firstSustainedAt: null,
      events: [],
    };
    const liveTapFire = taps.find((t) => t.label === "fireTap");
    const liveTapSynth = taps.find((t) => t.label === "synthOut");
    const liveBuf = new Float32Array(4096);

    const sampleLive = () => {
      const t = liveTapFire || liveTapSynth;
      if (!t) return;
      t.an.getFloatTimeDomainData(t.td);
      // Only look at the newest 4096 samples: the 32k analyser window would
      // smear a short burst across ~0.7 s and hide when it started.
      liveBuf.set(t.td.subarray(t.td.length - liveBuf.length));
      let peak = 0;
      let sum = 0;
      let sumSq = 0;
      let clip = 0;
      for (let i = 0; i < liveBuf.length; i++) {
        const v = liveBuf[i];
        if (!Number.isFinite(v)) { live.nanSeen = true; continue; }
        sum += v;
        sumSq += v * v;
        const a = v < 0 ? -v : v;
        if (a > peak) peak = a;
        if (a >= 0.985) clip++;
      }
      const n = liveBuf.length;
      const rms = Math.sqrt(sumSq / n);
      const clipPct = (clip / n) * 100;
      const dc = sum / n;
      const crestDb = peak > 1e-6 && rms > 1e-9 ? 20 * Math.log10(peak / rms) : 99;

      live.samples++;
      if (clipPct > live.worstClipPct) live.worstClipPct = clipPct;
      if (Math.abs(dc) > Math.abs(live.worstDc)) live.worstDc = dc;
      if (peak > live.maxPeak) live.maxPeak = peak;
      // Crest below ~5 dB with real level means the waveform has been squared
      // off — the audible signature of "it broke into distortion".
      if (rms > 0.02 && crestDb < live.minCrestDb) live.minCrestDb = crestDb;

      const hot = clipPct > 0.5 || (rms > 0.05 && crestDb < 4.5) || Math.abs(dc) > 0.05;
      if (hot) {
        live.consecutiveHot++;
        if (live.consecutiveHot > live.maxConsecutiveHot) {
          live.maxConsecutiveHot = live.consecutiveHot;
        }
        // ~4 s of continuous distortion at a 250 ms sample interval.
        if (live.consecutiveHot === 16 && live.firstSustainedAt == null) {
          live.firstSustainedAt = +ctx.currentTime.toFixed(1);
          live.events.push({
            at: live.firstSustainedAt,
            clipPct: +clipPct.toFixed(3),
            crestDb: +crestDb.toFixed(2),
            dc: +dc.toFixed(5),
            peak: +peak.toFixed(3),
            rms: +rms.toFixed(4),
            preset: store().presetId,
            voices: (() => { try { return fc.voices.size; } catch { return null; } })(),
            dying: (() => { try { return fc.dying.size; } catch { return null; } })(),
            limiterGrDb: (() => { try { return +engine.getFireLimiterReduction().toFixed(2); } catch { return null; } })(),
            fxSilenced: !!fc.fxSilenced,
            patchSnapshot: (() => {
              try {
                const p = store().patch;
                return {
                  masterGain: p.masterGain, drive: p.drive, driveMode: p.driveMode,
                  crush: p.crush, punch: p.punch, unison: p.unison,
                  delayMix: p.delayMix, delayFeedback: p.delayFeedback,
                  delayFreeze: p.delayFreeze, delayCascadeMode: p.delayCascadeMode,
                  reverbMix: p.reverbMix, reverbFreeze: p.reverbFreeze,
                  spectralMode: p.spectralMode, spectralMix: p.spectralMix,
                  filterModel: p.filterModel, filterCutoff: p.filterCutoff,
                  filterResonance: p.filterResonance, filterDrive: p.filterDrive,
                  ringAmount: p.ringAmount, fmAmount: p.fmAmount,
                };
              } catch { return null; }
            })(),
          });
        }
      } else {
        live.consecutiveHot = 0;
      }
    };

    let stressEvents = 0;
    const stressTick = async (i) => {
      const s = store();
      const mod = i % 12;
      if (mod === 8) {
        // RANDOMIZED patches. The user generates sounds constantly, and random
        // patches explore parameter combinations no factory preset contains —
        // which is exactly why the user reported these break things fastest.
        s.randomize();
        stressEvents++;
        return sleep(220);
      }
      if (mod === 9) {
        // Natural-selection breed: mutated offspring of the current patch.
        s.mutate();
        stressEvents++;
        return sleep(220);
      }
      if (mod === 10) {
        // SYNTH B. Both layers sum on the same fireBus and share the engine's
        // dynamics; a harness that only drives A tests half the signal.
        try {
          s.setEditTarget("b");
          s.loadPreset(pick());
          s.setParams({ masterGain: 1.1, drive: 0.7, delayMix: 0.4, delayFeedback: 0.7 });
          for (const m of [31, 38, 43, 50]) s.noteOn(m, 0.95);
        } finally {
          s.setEditTarget("a");
        }
        return sleep(220);
      }
      if (mod === 11) {
        // Push the shared master fader hot — a user reaching for more level.
        try {
          const mix = M.fireSequencerStore.useFireSequencerStore.getState();
          mix.setMixerStrip("master", { level: 1 });
          mix.setMixerStrip("a", { level: 1 });
          mix.setMixerStrip("b", { level: 1 });
        } catch { /* mixer shape differs */ }
        return sleep(220);
      }
      if (mod === 0) {
        s.loadPreset(pick());
        stressEvents++;
      } else if (mod === 1) {
        // Topology change → full teardown + rebuild path.
        s.setParam("filterModel", FILTER_MODELS[i % FILTER_MODELS.length]);
        s.setParam("unison", 1 + (i % 7));
      } else if (mod === 2) {
        // Push the FX hot: this is where feedback energy accumulates.
        s.setParams({
          delayMix: 0.45, delayFeedback: 0.82,
          delayCascadeMode: DELAY_MODES[i % DELAY_MODES.length],
          delayFreeze: i % 16 === 2,
          reverbMix: 0.5, reverbSize: 6, reverbFreeze: i % 24 === 2,
          drive: 0.75, crush: 0.35, punch: 0.8,
        });
      } else if (mod === 3) {
        s.setParams({
          spectralMode: SPECTRAL_MODES[i % SPECTRAL_MODES.length],
          spectralMix: 0.6, spectralAmount: 0.8,
        });
      } else if (mod === 4) {
        // Hot ARP — the dying-voice pile-up path.
        s.setArp({ enabled: true, rateHz: 18, octaves: 3, mode: "updown", gate: 0.85 });
        for (const m of [40, 47, 52, 55, 59]) s.noteOn(m, 0.95);
      } else if (mod === 5) {
        // Poly stabs straight at the synth (bypasses held-note bookkeeping,
        // which is the voice-steal / choke path).
        const base = 36 + (i % 24);
        for (let k = 0; k < 8; k++) {
          fc.playNote(base + k * 3, 0.95, ctx.currentTime + k * 0.01, 0.35);
        }
      } else if (mod === 6) {
        s.setParams({
          filterCutoff: 200 + ((i * 997) % 15000),
          filterResonance: 0.95,
          filterDrive: 0.8,
          fmAmount: 0.7, ringAmount: 0.5,
          lfo1Rate: 12, lfo1Depth: 0.9, lfo1Dest: "filter",
        });
      } else {
        s.panic();
        s.setArp({ enabled: false });
      }
      await sleep(220);
    };

    // ── Main loop ──────────────────────────────────────────────────────────
    // Discard the very first probe: the FX smoothers use setTargetAtTime, and
    // the first settle from a cold graph is slower than steady state.
    await probeTransfer("warmup");
    const baseline = await probeTransfer("baseline");
    const rounds = [];
    let firstTrip = null;

    /** Per-stage comparison against baseline. */
    const compare = (probe) => {
      const out = [];
      for (const [stage, cur] of Object.entries(probe.stages)) {
        const base = baseline.stages[stage];
        if (!base) continue;
        out.push({
          stage,
          gainDb: +(cur.fundDb - base.fundDb).toFixed(2),
          thdBase: base.thdDb,
          thdNow: cur.thdDb,
          // Positive = MORE harmonic distortion than baseline.
          thdRise: +(cur.thdDb - base.thdDb).toFixed(2),
          dcBase: base.dc,
          dcNow: cur.dc,
          dcDelta: +(cur.dc - base.dc).toFixed(6),
          noiseRise: +(cur.noiseDb - base.noiseDb).toFixed(2),
          glitchBase: base.glitchPct,
          glitchNow: cur.glitchPct,
          residBase: base.worstResid,
          residNow: cur.worstResid,
          nan: cur.nan,
        });
      }
      return out;
    };

    /**
     * Trip thresholds, widened to sit above the instrument's own repeatability.
     *
     * Set from the self-check below. Two untouched probes of the same patch do
     * NOT agree perfectly: applyBusParams drives its gains with
     * setTargetAtTime, and the drive stage in particular is still gliding when
     * the probe fires, which showed up as a phantom ~5 dB "gain drift" at
     * drivePost. A threshold under the measurement noise is a false alarm
     * generator, so each limit is at least 3× the observed noise.
     */
    let limits = { gainDb: 3, thdRise: 20, dcDelta: 0.002, noiseRise: 12, glitchPct: 0.05 };

    /**
     * First stage IN CHAIN ORDER whose metrics broke — that localizes the
     * source, because everything downstream inherits the damage.
     */
    const firstBadStage = (cmp) => {
      for (const c of cmp) {
        if (c.nan) return { ...c, why: "nan" };
        if (Math.abs(c.dcDelta) > limits.dcDelta) return { ...c, why: "dc" };
        // 20 dB more harmonic energy is 10× the distortion voltage.
        if (c.thdRise > limits.thdRise && c.thdNow > -60) return { ...c, why: "thd" };
        if (Math.abs(c.gainDb) > limits.gainDb) return { ...c, why: "gain" };
        if (c.noiseRise > limits.noiseRise) return { ...c, why: "noise" };
        // Waveform discontinuities: render dropouts / buffer artifacts.
        if (c.glitchNow > limits.glitchPct && c.glitchNow > c.glitchBase * 4 + 0.02) {
          return { ...c, why: "glitch" };
        }
      }
      return null;
    };

    /**
     * Recovery ladder. The user reports the app must be RELAUNCHED once it
     * degrades, so the decisive question is which (if any) in-app reset
     * restores the baseline. Whatever survives all of these lives in state
     * that nothing rebuilds.
     */
    const tryRecovery = async () => {
      const attempts = [];
      const snap = async (label) => {
        const p = await probeTransfer(`recover:${label}`);
        const cmp = compare(p);
        const bad = firstBadStage(cmp);
        attempts.push({
          step: label,
          stillBad: bad ? { stage: bad.stage, why: bad.why } : null,
          maxThdRise: cmp.reduce((m, c) => Math.max(m, c.thdRise), -999),
          maxGlitchPct: cmp.reduce((m, c) => Math.max(m, c.glitchNow), 0),
        });
        return !bad;
      };

      store().panic();
      if (await snap("panic")) return attempts;

      try { fc.flushBusContamination(ctx.currentTime, { rebuildDelay: true }); } catch { /* n/a */ }
      if (await snap("flushBusContamination")) return attempts;

      try { engine.flushSharedDynamics(); } catch { /* n/a */ }
      if (await snap("flushSharedDynamics")) return attempts;

      store().resetToDefaults();
      if (await snap("resetToDefaults")) return attempts;

      // Last resort short of a relaunch: rebuild the whole audio graph. If
      // even this doesn't recover, the corruption is outside the graph.
      try {
        await M.appHealth.resetAudioEngine();
        await sleep(1200);
        engine = M.engine.getEngine();
        fc = engine.fireCommand;
        ctx = engine.ctx;
        await engine.resume();
        rebuildTaps();
        await sleep(400);
      } catch { /* n/a */ }
      await snap("resetAudioEngine");
      return attempts;
    };

    // INSTRUMENT NOISE FLOOR. A second untouched probe must agree with the
    // baseline; whatever it disagrees by is measurement noise, not a bug. Any
    // trip threshold below this number would be a false positive, so this
    // number is reported and must be checked before trusting a trip.
    // Two independent self-checks: the spread between three probes of the same
    // patch is a better noise estimate than a single pair.
    const selfCheck = compare(await probeTransfer("selfcheck1"));
    const selfCheck2 = compare(await probeTransfer("selfcheck2"));
    const worstOf = (pick) => Math.max(
      selfCheck.reduce((m, c) => Math.max(m, Math.abs(pick(c))), 0),
      selfCheck2.reduce((m, c) => Math.max(m, Math.abs(pick(c))), 0),
    );
    const noiseFloor = {
      maxGainDb: +worstOf((c) => c.gainDb).toFixed(2),
      maxThdRise: +worstOf((c) => c.thdRise).toFixed(2),
      maxDcDelta: +worstOf((c) => c.dcDelta).toFixed(6),
      maxNoiseRise: +worstOf((c) => c.noiseRise).toFixed(2),
      maxGlitchPct: +worstOf((c) => c.glitchNow).toFixed(4),
    };
    // Raise every limit to at least 3× the measured noise.
    limits = {
      gainDb: Math.max(limits.gainDb, noiseFloor.maxGainDb * 3),
      thdRise: Math.max(limits.thdRise, noiseFloor.maxThdRise * 3),
      dcDelta: Math.max(limits.dcDelta, noiseFloor.maxDcDelta * 3),
      noiseRise: Math.max(limits.noiseRise, noiseFloor.maxNoiseRise * 3),
      glitchPct: Math.max(limits.glitchPct, noiseFloor.maxGlitchPct * 3),
    };
    noiseFloor.limits = {
      gainDb: +limits.gainDb.toFixed(2),
      thdRise: +limits.thdRise.toFixed(2),
      dcDelta: +limits.dcDelta.toFixed(6),
      noiseRise: +limits.noiseRise.toFixed(2),
      glitchPct: +limits.glitchPct.toFixed(4),
    };
    // Re-run detection with the widened limits so a self-trip is impossible
    // by construction; if one still appears the instrument is unusable.
    noiseFloor.trip = (() => {
      const b = firstBadStage(selfCheck) || firstBadStage(selfCheck2);
      return b ? { stage: b.stage, why: b.why } : null;
    })();

    const t0 = Date.now();
    const endAt = t0 + MINUTES * 60_000;
    let round = 0;
    let tick = 0;

    while (Date.now() < endAt) {
      round++;
      const stressEnd = Date.now() + ROUND_STRESS_MS;
      const liveIv = setInterval(sampleLive, 250);
      try {
        while (Date.now() < stressEnd) {
          await stressTick(tick++);
        }
      } finally {
        clearInterval(liveIv);
      }
      const probe = await probeTransfer(`round${round}`);
      const cmp = compare(probe);
      const bad = firstBadStage(cmp);
      const row = {
        round,
        elapsedMin: +((Date.now() - t0) / 60000).toFixed(2),
        nodes: probe.nodes,
        nodeGrowth: probe.nodes - baseline.nodes,
        worklets: probe.worklets,
        ctxState: probe.ctxState,
        limiterGrDb: probe.limiterGrDb,
        stressEvents,
        heapMB: probe.engineState.heapMB,
        poolSize: probe.engineState.poolSize,
        liveWorstClipPct: +live.worstClipPct.toFixed(3),
        liveMinCrestDb: live.minCrestDb === 999 ? null : +live.minCrestDb.toFixed(2),
        liveWorstDc: +live.worstDc.toFixed(5),
        liveMaxHotRun: live.maxConsecutiveHot,
        liveSustainedAt: live.firstSustainedAt,
        worst: cmp.slice().sort((a, b) => b.thdRise - a.thdRise)[0] ?? null,
        maxDcDelta: cmp.reduce((m, c) => (Math.abs(c.dcDelta) > Math.abs(m) ? c.dcDelta : m), 0),
        maxGlitchPct: cmp.reduce((m, c) => Math.max(m, c.glitchNow), 0),
        maxNoiseRise: cmp.reduce((m, c) => Math.max(m, c.noiseRise), -999),
        trip: bad ? { stage: bad.stage, why: bad.why } : null,
      };
      rounds.push(row);
      status(row);

      if (bad && !firstTrip) {
        firstTrip = { round, bad, compare: cmp, probe };
        // Ask immediately which reset (if any) undoes it — waiting until the
        // end of the run would let more state pile on and blur the answer.
        firstTrip.recovery = await tryRecovery();
        globalThis.__FDH_DUMP = JSON.stringify(firstTrip);
      }
    }

    const lastProbe = await probeTransfer("final");
    const finalCmp = compare(lastProbe);

    globalThis.__FDH_RESULT = {
      ok: true,
      minutes: +((Date.now() - t0) / 60000).toFixed(2),
      baseline,
      noiseFloor,
      rounds,
      finalCompare: finalCmp,
      firstTrip: firstTrip
        ? {
            round: firstTrip.round,
            stage: firstTrip.bad.stage,
            why: firstTrip.bad.why,
            detail: firstTrip.bad,
            compare: firstTrip.compare,
            engineState: firstTrip.probe.engineState,
            recovery: firstTrip.recovery,
          }
        : null,
      census: { total: censusTotal(), byKind: census.created, disconnects: census.disconnected, worklets: census.worklets },
      live: {
        samples: live.samples,
        worstClipPct: +live.worstClipPct.toFixed(3),
        minCrestDb: live.minCrestDb === 999 ? null : +live.minCrestDb.toFixed(2),
        worstDc: +live.worstDc.toFixed(5),
        maxPeak: +live.maxPeak.toFixed(3),
        maxConsecutiveHot: live.maxConsecutiveHot,
        firstSustainedAt: live.firstSustainedAt,
        nanSeen: live.nanSeen,
        events: live.events,
      },
      nodeGrowth: lastProbe.nodes - baseline.nodes,
      verdict: {
        anyTrip: !!firstTrip,
        maxThdRise: finalCmp.reduce((m, c) => Math.max(m, c.thdRise), -999),
        maxDcDelta: finalCmp.reduce((m, c) => (Math.abs(c.dcDelta) > Math.abs(m) ? c.dcDelta : m), 0),
        maxGainDb: finalCmp.reduce((m, c) => (Math.abs(c.gainDb) > Math.abs(m) ? c.gainDb : m), 0),
        maxGlitchPct: finalCmp.reduce((m, c) => Math.max(m, c.glitchNow), 0),
        ctxState: lastProbe.ctxState,
      },
    };
  } catch (err) {
    globalThis.__FDH_RESULT = { ok: false, error: String(err && err.stack ? err.stack : err) };
  }
})();
