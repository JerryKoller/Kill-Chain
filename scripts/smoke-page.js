// Kill Chain v2.4 critical-path smoke suite — IN-PAGE half.
// Evaluated via CDP by scripts/smoke.mjs against the dev app. The harness
// prepends `globalThis.__SMOKE = { toneA, toneB }` (absolute paths of two
// generated WAV files). Returns { results: [{name, pass, detail}], stats }.
(async () => {
  const results = [];
  const t = (name, pass, detail = "") =>
    results.push({ name, pass: !!pass, detail: String(detail) });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn, ms, step = 250) => {
    const end = Date.now() + ms;
    for (;;) {
      try { if (await fn()) return true; } catch { /* keep polling */ }
      if (Date.now() > end) return false;
      await sleep(step);
    }
  };
  const S = globalThis.__SMOKE || {};
  const stats = { idle: null, playback: null };

  try {
    // ── Modules — via the app's own test hook so we get the LIVE instances
    // (raw /src/… imports would build a second module graph under Vite HMR).
    const hooked = await until(() => !!globalThis.__KC_TEST, 15000);
    if (!hooked) throw new Error("__KC_TEST hook missing — is this a dev build?");
    const M = await globalThis.__KC_TEST.load();
    const eng = M.engine;
    const { usePlayerStore } = M.playerStore;
    const { useAudioStore } = M.audioStore;
    const { useSettingsStore } = M.settingsStore;
    const { useAirspaceStore } = M.airspaceStore;
    const { useDimensionStore } = M.dimensionStore;
    const { useFireSequencerStore } = M.fireSequencerStore;
    const { useUserPresetsStore } = M.userPresetsStore;
    const lib = M.libraryStore;
    const mission = M.missionStateStore;
    const missionLog = M.missionLogStore;
    const lockLib = M.lockLibraryStore;
    const arbiter = M.sourceArbiter;
    const autoLock = M.tractorAutoLock;
    const health = M.appHealth;
    const snap = M.chainSnapshot;
    const fireStudio = M.fireStudio;

    const readStats = async () => {
      try { return await window.playground?.system?.getStats?.(); } catch { return null; }
    };
    stats.idle = await readStats();

    // Known automation baseline: nothing armed, memory restore on.
    const settings0 = {
      autoFlatten: useSettingsStore.getState().autoFlatten,
      armed: autoLock.isAutoLockArmed(),
    };
    useSettingsStore.getState().set("autoFlatten", false);
    autoLock.setAutoLock(false);
    missionLog.useMissionLogStore.getState().setAutoRestore(true);

    // ── 0. Legal gate ──
    // A FRESH dev profile boots into the legal gate, which blocks the whole
    // app chrome (TransportBar never mounts → no <audio> element → every
    // playback test reports "empty"/silent). Accept it programmatically the
    // way the modal's button does, then wait for the transport to attach.
    {
      const legal = M.legal ?? null;
      const version = legal?.LEGAL_VERSION ?? "1.0-draft";
      const st = useSettingsStore.getState();
      if (!st.legalAcceptedAt || st.legalAcceptedVersion !== version) {
        st.set("legalAcceptedVersion", version);
        st.set("legalAcceptedAt", new Date().toISOString());
      }
      const attached = await until(() => !!usePlayerStore.getState().element, 10000);
      t("Boot: transport attached (legal gate cleared)", attached,
        attached ? "element ready" : "no <audio> element after 10s");
    }

    // ── 1. Cold boot → engine ready ──
    await useAudioStore.getState().ensureReady();
    const engine = eng.getEngine();
    await engine.resume();
    t("Cold boot: AudioContext running", engine.ctx.state === "running", engine.ctx.state);

    // ── 2. Local playback ──
    const urlA = lib.audioUrlForPath(S.toneA);
    const urlB = lib.audioUrlForPath(S.toneB);
    const player = usePlayerStore.getState();
    await player.loadDataUrlOrPath(urlA, "smoke-tone-A.wav");
    // The tones are 60 s; loop the element so the suite never runs dry.
    if (usePlayerStore.getState().element) usePlayerStore.getState().element.loop = true;
    await usePlayerStore.getState().play();
    const playing = await until(() => usePlayerStore.getState().status === "playing", 5000);
    await sleep(700);
    const rms1 = engine.getOutputRms();
    t("Local playback: player playing", playing, usePlayerStore.getState().status);
    t("Local playback: audible at output", rms1 > 0.001, `rms=${rms1.toFixed(4)}`);

    // ── 3. Engage / bypass transitions ──
    useAudioStore.getState().setBypass(false);
    await sleep(300);
    const rmsFx = engine.getOutputRms();
    t("Engage: store ↔ engine in sync", engine.isBypassed() === false);
    t("Engage: FX path audible", rmsFx > 0.001, `rms=${rmsFx.toFixed(4)}`);
    useAudioStore.getState().setBypass(true);
    await sleep(300);
    t("Bypass: back to clean path, audible", engine.getOutputRms() > 0.001 && engine.isBypassed());

    // ── 4. Mission State: one pipeline, correct source ──
    const sawSource = await until(() => {
      const s = mission.useMissionStateStore.getState();
      return s.source !== null && s.source.sig === `file:${urlA}`;
    }, 8000);
    const settled = await until(
      () => mission.useMissionStateStore.getState().pendingOp === null,
      10000,
    );
    t("Mission State: source detected", sawSource,
      mission.useMissionStateStore.getState().source?.sig ?? "none");
    t("Mission State: pipeline settled (nothing armed)", settled,
      mission.useMissionStateStore.getState().lastAction ?? "");

    // ── 5. Manual override flags + holds ──
    // On a re-run, Source Memory may have ALREADY restored bass=0.3 from the
    // previous run's log entry — setting the same value is a no-op and the
    // manual watch (rightly) never fires. Always write a genuinely new value.
    const bassNow = useAudioStore.getState().params.bass;
    useAudioStore.getState().setParam("bass", Math.abs(bassNow - 0.3) < 0.01 ? 0.24 : 0.3);
    await sleep(400);
    t("Manual override: hold raised on user edit",
      mission.useMissionStateStore.getState().manualHold === true,
      `appliedBy=${mission.useMissionStateStore.getState().appliedBy}`);

    // ── 6. Source memory: save → switch → return → restore ──
    // Remember exactly what we saved — the restore assertion below must
    // compare against THIS, not a hardcoded constant (the manual-edit value
    // alternates across runs to defeat source-memory no-op collisions).
    const savedBass = useAudioStore.getState().params.bass;
    const savedName = await missionLog.logCurrentSource();
    t("Mission Log: chain logged for source", savedName !== null, savedName ?? "null");

    await usePlayerStore.getState().loadDataUrlOrPath(urlB, "smoke-tone-B.wav");
    await usePlayerStore.getState().play();
    await until(() => mission.useMissionStateStore.getState().source?.sig === `file:${urlB}`, 8000);
    t("Source change: manual hold cleared",
      mission.useMissionStateStore.getState().manualHold === false);
    await until(() => mission.useMissionStateStore.getState().pendingOp === null, 10000);

    // Disturb the chain (manual on tone B), then return to tone A.
    useAudioStore.getState().setParam("bass", 0);
    await usePlayerStore.getState().loadDataUrlOrPath(urlA, "smoke-tone-A.wav");
    await usePlayerStore.getState().play();
    const restored = await until(() => {
      const s = mission.useMissionStateStore.getState();
      return s.appliedBy === "memory" && s.pendingOp === null;
    }, 12000);
    const bassBack = Math.abs(useAudioStore.getState().params.bass - savedBass) < 0.01;
    t("Memory restore: pipeline applied saved chain", restored,
      `appliedBy=${mission.useMissionStateStore.getState().appliedBy}`);
    t("Memory restore: params actually restored", bassBack,
      `bass=${useAudioStore.getState().params.bass} expected=${savedBass}`);

    // ── 7. Priority: memory > Auto-Lock (lock record present but memory wins) ──
    const keyA = `file:${S.toneA}`;
    const fakeMeasurement = {
      sampleRate: 48000, analyzedSec: 9, windowsUsed: 60,
      centers: [100, 300, 1000, 3000, 10000],
      levelsDb: [-20, -22, -24, -30, -40],
      silent: false, stereoCorr: 0.9,
    };
    const fakeRec = lockLib.sanitizeLockRecord({
      key: keyA, kind: "track", name: "Smoke tone A", sub: "",
      measurement: fakeMeasurement,
      curve: [{ freq: 1000, db: 1.5 }],
      strength: 0.8, matchAfterPct: 90, matchBeforePct: 70,
    });
    lockLib.useLockLibraryStore.getState().upsert(fakeRec);
    autoLock.setAutoLock(true);

    await usePlayerStore.getState().loadDataUrlOrPath(urlB, "smoke-tone-B.wav");
    await usePlayerStore.getState().play();
    await until(() => mission.useMissionStateStore.getState().source?.sig === `file:${urlB}`, 8000);
    await usePlayerStore.getState().loadDataUrlOrPath(urlA, "smoke-tone-A.wav");
    await usePlayerStore.getState().play();
    const memWon = await until(() => {
      const s = mission.useMissionStateStore.getState();
      return s.pendingOp === null && s.appliedBy !== null;
    }, 12000);
    t("Priority: saved memory beats Auto-Lock", memWon &&
      mission.useMissionStateStore.getState().appliedBy === "memory",
      `appliedBy=${mission.useMissionStateStore.getState().appliedBy}`);

    // Remove the memory → the lock record should restore instantly (no scan).
    missionLog.useMissionLogStore.getState().removeEntry(keyA);
    await usePlayerStore.getState().loadDataUrlOrPath(urlB, "smoke-tone-B.wav");
    await usePlayerStore.getState().play();
    await until(() => mission.useMissionStateStore.getState().source?.sig === `file:${urlB}`, 8000);
    await until(() => mission.useMissionStateStore.getState().pendingOp === null, 15000);
    await usePlayerStore.getState().loadDataUrlOrPath(urlA, "smoke-tone-A.wav");
    await usePlayerStore.getState().play();
    const lockRestored = await until(() => {
      const s = mission.useMissionStateStore.getState();
      return s.appliedBy === "lock" && s.pendingOp === null;
    }, 12000);
    t("Auto-Lock: existing lock restores instantly (no scan)", lockRestored,
      `appliedBy=${mission.useMissionStateStore.getState().appliedBy}`);

    // ── 8. Airspace routing → Auto-Lock scan (simulated capture) ──
    stats.playback = await readStats();
    const dest = engine.ctx.createMediaStreamDestination();
    const osc = engine.ctx.createOscillator();
    osc.frequency.value = 220;
    const osc2 = engine.ctx.createOscillator();
    osc2.frequency.value = 3200;
    const og = engine.ctx.createGain();
    og.gain.value = 0.18;
    osc.connect(og); osc2.connect(og); og.connect(dest);
    osc.start(); osc2.start();
    engine.attachMicStream(dest.stream);
    usePlayerStore.setState({ loopbackActive: true, loopbackMode: "airspace" });
    useAirspaceStore.getState().setMedia({
      title: "Smoke Test Video", artist: "Smoke", artwork: null,
      duration: 300, currentTime: 12, paused: false, live: false, volume: 1,
      pageUrl: "https://www.youtube.com/watch?v=SMOKETEST01",
    });
    const airScanned = await until(() => {
      const s = mission.useMissionStateStore.getState();
      return s.source?.kind === "airspace" && s.appliedBy === "auto-lock" && s.pendingOp === null;
    }, 30000, 500);
    const airRec = lockLib.useLockLibraryStore.getState().records["air:yt:SMOKETEST01"];
    t("Airspace → Auto-Lock: fresh scan applied", airScanned,
      `appliedBy=${mission.useMissionStateStore.getState().appliedBy} op=${mission.useMissionStateStore.getState().pendingOp}`);
    t("Airspace → Auto-Lock: lock recorded under media id", !!airRec,
      airRec ? airRec.name : "missing");

    // Cleanup the simulated capture.
    autoLock.setAutoLock(false);
    osc.stop(); osc2.stop();
    useAirspaceStore.getState().setMedia(null);
    usePlayerStore.setState({ loopbackActive: false, loopbackMode: null });

    // ── 9. Loopback off: cached element source re-wires (classic regression) ──
    const el = usePlayerStore.getState().element;
    engine.detachSource();
    if (el) engine.attachAudioElement(el);
    await usePlayerStore.getState().play();
    await sleep(800);
    const rmsBack = engine.getOutputRms();
    t("Loopback off: file playback recovers on cached source", rmsBack > 0.001,
      `rms=${rmsBack.toFixed(4)}`);

    // ── 10. Library ↔ Fire Command handoff ──
    useFireSequencerStore.getState().play();
    const filePaused = await until(() => usePlayerStore.getState().status !== "playing", 4000);
    t("Fire handoff: starting Fire pauses the file", filePaused,
      usePlayerStore.getState().status);
    await usePlayerStore.getState().play();
    const fireStopped = await until(() => useFireSequencerStore.getState().playing === false, 4000);
    t("File handoff: playing the file stops Fire", fireStopped);

    // ── 11. No double playback: airspace claim pauses the file ──
    arbiter.claimSource("airspace");
    const pausedByAir = await until(() => usePlayerStore.getState().status !== "playing", 4000);
    t("No double playback: airspace claim pauses file", pausedByAir,
      usePlayerStore.getState().status);
    await usePlayerStore.getState().play();
    await sleep(400);

    // ── 12. 3D + head tracking ──
    useDimensionStore.getState().setActive(true);
    await sleep(600);
    const dimOn = engine.isDimensionActive();
    const rms3d = engine.getOutputRms();
    let poseOk = true;
    try {
      engine.dimension.setListenerPose({ yaw: 0.5, pitch: 0.1, roll: -0.05, x: 0.3, z: -0.2 });
      engine.dimension.setListenerPose({ yaw: 0, pitch: 0, roll: 0, x: 0, z: 0 });
    } catch (e) { poseOk = false; }
    t("3D: engages as master output", dimOn);
    t("3D: binaural return audible", rms3d > 0.0005, `rms=${rms3d.toFixed(4)}`);
    t("3D: 6DOF listener pose accepted", poseOk);
    useDimensionStore.getState().setActive(false);
    await sleep(400);
    t("3D off: normal path returns, audible", !engine.isDimensionActive() && engine.getOutputRms() > 0.001);

    // ── 13. Device change ──
    const sinkOk = await engine.setOutputDevice("");
    t("Device change: setSinkId to default succeeds", sinkOk === true);
    t("Device change: context stays running", engine.ctx.state === "running");
    health.reportDeviceLost(true);
    const issueUp = health.useAppHealthStore.getState().issues.some((i) => i.id === "device-lost");
    health.useAppHealthStore.getState().clear("device-lost");
    t("Device loss: HUD issue raised + clearable", issueUp &&
      !health.useAppHealthStore.getState().issues.some((i) => i.id === "device-lost"));

    // ── 14. Processed export path (capture + WAV encode) ──
    const proc = engine.ctx.createScriptProcessor(4096, 2, 2);
    const sinkG = engine.ctx.createGain();
    sinkG.gain.value = 0;
    const capL = [], capR = [];
    proc.onaudioprocess = (e) => {
      capL.push(new Float32Array(e.inputBuffer.getChannelData(0)));
      capR.push(new Float32Array(e.inputBuffer.getChannelData(1)));
    };
    engine.destinationTap.connect(proc);
    proc.connect(sinkG).connect(engine.ctx.destination);
    await sleep(900);
    engine.destinationTap.disconnect(proc);
    proc.disconnect();
    sinkG.disconnect();
    const total = capL.reduce((n, c) => n + c.length, 0);
    let peak = 0;
    for (const c of capL) for (let i = 0; i < c.length; i++) peak = Math.max(peak, Math.abs(c[i]));
    const flatL = new Float32Array(total);
    let off = 0;
    for (const c of capL) { flatL.set(c, off); off += c.length; }
    const wavBytes = fireStudio.encodeWav(flatL, flatL, engine.ctx.sampleRate);
    const riff = new TextDecoder().decode(wavBytes.slice(0, 4));
    t("Processed export: live capture has signal", total > 0 && peak > 0.001,
      `samples=${total} peak=${peak.toFixed(4)}`);
    t("Processed export: WAV encode valid", riff === "RIFF", riff);

    // ── 15. Session / project load (SourceMemory v1 → v2 migration + apply) ──
    const v1Entry = {
      kind: "track", name: "Migration test", sub: "",
      chain: snap.captureChain(), savedAt: 1, updatedAt: 2, pinned: false,
    };
    const migrated = missionLog.sanitizeSourceMemory("file:X:/fake.mp3", v1Entry);
    t("SourceMemory migration: v1 entry upgrades to v2",
      migrated !== null && migrated.v === 2 && migrated.lockKey === null &&
      migrated.armoryPresetId === null);
    const roundTrip = snap.sanitizeChainSnapshot(JSON.parse(JSON.stringify(snap.captureChain())));
    t("ChainSnapshot: JSON round trip sane", roundTrip !== null && Array.isArray(roundTrip.eqBands));

    // ── 16. Preset save, clear, restore ──
    useAudioStore.getState().setParam("presence", 0.42);
    const presetId = useUserPresetsStore.getState().savePreset(
      "Smoke preset", useAudioStore.getState().params,
    );
    useAudioStore.getState().resetToNeutral();
    const cleared = Math.abs(useAudioStore.getState().params.presence) < 0.001 &&
      useAudioStore.getState().bypass === true;
    const saved = useUserPresetsStore.getState().presets.find((p) => p.id === presetId);
    if (saved) useAudioStore.getState().replaceParams(saved.params);
    const restoredPreset = Math.abs(useAudioStore.getState().params.presence - 0.42) < 0.01;
    useUserPresetsStore.getState().deletePreset(presetId);
    t("Preset: save → clear → restore", cleared && !!saved && restoredPreset,
      `presence=${useAudioStore.getState().params.presence}`);

    // ── 17. Stability: rapid engage/3D churn leaves the graph healthy ──
    for (let i = 0; i < 10; i++) {
      useAudioStore.getState().setBypass(i % 2 === 0);
      if (i % 3 === 0) {
        useDimensionStore.getState().setActive(true);
        useDimensionStore.getState().setActive(false);
      }
    }
    useAudioStore.getState().setBypass(true);
    await sleep(500);
    t("Stability: graph healthy after churn",
      engine.ctx.state === "running" && engine.getOutputRms() > 0.0005,
      `state=${engine.ctx.state} rms=${engine.getOutputRms().toFixed(4)}`);

    // ── 18. Reset Audio Engine ──
    const resetOk = await health.resetAudioEngine();
    await sleep(400);
    t("Reset Audio Engine: succeeds and audio survives",
      resetOk && engine.ctx.state === "running" && engine.getOutputRms() > 0.0005);

    // ── Cleanup ──
    usePlayerStore.getState().pause();
    if (usePlayerStore.getState().element) usePlayerStore.getState().element.loop = false;
    useAudioStore.getState().resetToNeutral();
    missionLog.useMissionLogStore.getState().removeEntry(keyA);
    missionLog.useMissionLogStore.getState().removeEntry(`file:${S.toneB}`);
    lockLib.useLockLibraryStore.getState().remove(keyA);
    lockLib.useLockLibraryStore.getState().remove("air:yt:SMOKETEST01");
    useSettingsStore.getState().set("autoFlatten", settings0.autoFlatten);
    autoLock.setAutoLock(settings0.armed);
  } catch (err) {
    t("SUITE CRASHED", false, (err && (err.stack || err.message)) || String(err));
  }

  return { results, stats };
})();
