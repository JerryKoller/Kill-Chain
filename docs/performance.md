# Kill Chain — Performance Baseline (v2.4)

Measured on the v2.4 release candidate via `npm run smoke` (the suite samples
`window.playground.system.getStats()` — app-process CPU across all Electron
processes and working-set RAM — at two points in the run).

| Phase                              | App CPU | App RAM |
|------------------------------------|---------|---------|
| Idle (booted, engine up, no audio) | ~0.2–0.5 % | ~1.1 GB |
| Playback (file → full chain → out) | ~0.1–0.2 % | ~1.3 GB |

Notes:

- CPU is effectively idle-level even during playback because the DSP chain is
  native Web Audio nodes; the JS cost is meters and the single shared FFT
  pipeline (`visualIntel`), which is ref-counted and only runs while a
  visualizer holds it.
- RAM is dominated by the deliberately raised V8 heap ceiling
  (`--max-old-space-size` = half of installed RAM, clamped 2–8 GB) plus the
  GPU process; it is stable across the run (no growth trend across the
  suite's repeated source changes, engage/3D churn and engine reset).
- Timer/analyzer accumulation: the smoke suite's churn step (10× engage/bypass
  + repeated 3D on/off + 6 source changes + engine reset) ends with the graph
  healthy and output RMS normal. Long-session leak sources found in the v2.4
  audit (Auto-Lock's immortal poll, per-watcher restore timers) were removed —
  MISSION STATE owns the one poll and the one settle timer, and both are
  cleared on `stopMissionState()`.

Re-measure after any change to analyzers, meters or automation:

    npm run smoke
