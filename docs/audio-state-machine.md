# Kill Chain — Audio State Machine (v2.4)

This document is the single reference for how audio flows through the app,
which states the graph can be in, who is allowed to change them, and how the
system recovers when something goes wrong.

## 1. The graph

One `AudioEngine` (singleton, `src/audio/AudioEngine.ts`) owns one
`AudioContext` for the app's lifetime. It is created lazily on the first
user gesture (`getEngine()`); `peekEngine()` reads it without creating it.

```
source ─► inputBus ─► feedbackKiller ─► preTap ─┬─► bypassBus ───────────────┐
                                                ├─► fxInput ─► [correctionEQ]│
                                                │    └► reconstruct ─► clarity ─► friendlyEQ ─► userEQ
                                                │       ─► deEsser ─► harmonic ─► saturator ─► transient
                                                │       ─► multiband ─► glue ─► spatial ─► perBandWidth
                                                │       ─► widener ─► lofi ─► reverb ─► rooms ─► balance
                                                │       ─► limiter ─► postFxGain ─────────────┤
                                                └─► dimTapRaw/dimTapEq ─► Spatializer3D ─► dimReturn
                                                                                              │
                                outputGain ◄──────────────────────────────────────────────────┘
                                    └─► finalLimiter ─► destinationTap ─► ctx.destination
```

Parallel, never-audible taps: `preTap → analyserPre` (fft 1024),
`destinationTap → analyserPost` (fft 2048), `destinationTap → LUFSMeter`
(ref-counted, off unless a consumer holds it).

## 2. Front-of-chain states

`rewireFront()` is the ONLY function that mutates the front routing. It is
driven by three booleans on the engine, each with exactly one setter:

| State           | Setter                          | Audible path                                        |
|-----------------|---------------------------------|-----------------------------------------------------|
| **BYPASS**      | `setBypass(true)`               | `preTap → bypassBus → outputGain` (bit-transparent) |
| **ENGAGED**     | `setBypass(false)`              | `preTap → fxInput → full chain → postFxGain`        |
| **3D**          | `setDimensionActive(true)`      | tap (raw or post-glue) → Spatializer3D → dimReturn; normal tail muted |

Rules enforced by construction:

- All three output gains (`bypassBus`, `postFxGain`, `dimReturn`) are
  crossfaded with `setTargetAtTime` (10–30 ms) — transitions are click-free.
- Exactly one of the three paths carries signal at any time; the other two
  gains are ramped to 0 in the same `rewireFront()` call. **There is no
  reachable double-output state.**
- The store (`audioStore.bypass`) and engine flag are updated in the same
  synchronous action. If they ever desync (e.g. after a crash-restore),
  **Reset Audio Engine** re-imposes store state on the engine.

## 3. Sources and arbitration

The engine accepts one source at a time (`attachAudioElement` /
`attachMicStream` / `detachSource`). The `<audio>` element's
`MediaElementAudioSourceNode` is cached forever (the Web Audio spec forbids
creating a second one), so loopback → file transitions re-wire the cached
node instead of recreating it.

`claimSource()` (`src/lib/sourceArbiter.ts`) is the single authority on
"who is allowed to make noise". Every play-ish action claims first:

| Claim      | Called from                            | Stops                                     |
|------------|----------------------------------------|-------------------------------------------|
| `file`     | `playerStore.play`                     | Fire sequencer + panic; pauses Airspace   |
| `fire`     | fire sequencer / Fire Command note-on  | pauses file; pauses Airspace              |
| `loopback` | `startLoopback`                        | Fire only (Airspace media IS the source)  |
| `airspace` | Airspace media poll on pause→play      | pauses file; stops Fire                   |

**No double playback:** any newly claimed source silences its rivals in the
same tick. The one deliberate exception is `loopback` + Airspace, where the
webview's audio is the captured signal (per-frame capture mutes its local
playback, so there's still only one audible path).

## 4. Automation — MISSION STATE

Before v2.4 four watchers reacted to a source change independently (Mission
Log airspace subscribe, library play subscribe, Auto-Lock 1.5 s poll,
Auto-Flatten hook). v2.4 replaces them with ONE orchestrator
(`src/state/missionStateStore.ts`):

- One 1.5 s poll detects the active source (`air:` wins over `file:`).
- A source change starts one **2.5 s settle window**; changing again resets
  it and aborts any in-flight run.
- After settling, the pipeline runs **in strict priority order**:

```
manual override  >  saved source memory  >  Auto-Lock  >  Auto-Flatten
```

1. **Manual override** — any user edit to params / Sculptor bands /
   restoration / clarity flags `manualHold` for the current source and
   aborts pending automation. Cleared when the source changes.
   (Automation's own writes are excluded via `runAsAutomation()`.)
2. **Saved source memory** — a `SourceMemory` record (Mission Log) restores
   the full chain verbatim. No scan runs against a remembered source.
3. **Auto-Lock** (armed only) — an existing Lock Library record restores
   instantly; otherwise one 9 s scan derives a health-guarded manifest,
   applies it, and records it. Scans are serialized by an AbortController —
   **never two parallel scans**.
4. **Auto-Flatten** (preference-gated, files only) — the default automation,
   runs only when nothing above applied.

The Mission HUD (strip under the title bar) shows the tracked source, the
pending op, which system applied, and any health issues.

## 5. Per-source memory

One versioned record type, `SourceMemory` (`missionLogStore.ts`, v2):
full `ChainSnapshot` + `lockKey` (reference into the Lock Library, not a
copy) + `armoryPresetId` (reference into the Armory, not a copy).

- v1 Mission Log entries and the legacy `trackEq.v1` store migrate in place
  on load.
- Sessions export/import as `.kcsession` (records + referenced locks
  bundled).

## 6. Device changes

- Output routing uses `AudioContext.setSinkId` only — the graph never
  rebuilds for a device change.
- `useDeviceWatch` listens for `devicechange`; if the selected sink
  disappears it reverts to system default, toasts, and raises a Mission HUD
  issue with a one-click path to Settings.
- A context that lands in `suspended` mid-session gets one silent
  auto-resume (`appHealth.initAppHealth`); if that fails, a HUD issue with a
  **Resume** action appears.

## 7. Export / record paths

`bounceExport.ts` and `fireStudio.ts` attach a `ScriptProcessorNode` to a
live tap for the duration of the capture and disconnect it in `finally`
blocks — success, abort and failure all clean up. Offline (LUFS-normalized)
passes run in a throwaway `OfflineAudioContext`. Offline restore renders
call `dispose()` on their DSP clones so watchdog timers never leak.

## 8. Analyzer lifecycle

| Consumer                | Node(s)                          | Cleanup                          |
|-------------------------|----------------------------------|----------------------------------|
| Engine pre/post + LUFS  | 2 analysers + LUFS meter         | Engine-lifetime by design; LUFS ref-counted |
| visualIntel             | fft 4096 + 2×1024 on dest tap    | Ref-counted singleton `start()`/`stop()`; overlay, broadcast and 3D tempo sync are the three holders |
| Scope                   | own splitter + hi-res analysers  | Disconnected on unmount          |
| RepairSpectrogram       | fft 4096 on preTap               | Disconnected on unmount          |
| Fire mixer meters       | per-part analysers               | Disconnected on unmount          |
| Transport / MiniPlayer  | read shared `analyserPost` only  | rAF cancelled on unmount; no own nodes |

Invariant: **one high-rate FFT pipeline** (visualIntel) runs at a time;
everything else reads the two engine analysers or tiny fft-32/64 meter taps.
Scope adds its own high-res analysers only while mounted.

## 9. Recovery

**Reset Audio Engine** (Settings → Advanced → Recovery, also surfaced by
HUD issues) — keeps the context, then: aborts automation → re-wires the
cached source → re-applies the output sink → re-syncs every DSP stage from
store state (params, correction, Sculptor bands, restore, clarity, room,
balance, gain, bypass, repair bypass, 3D) → resumes.

Renderer crash: the main process reloads the window (`render-process-gone`
→ `webContents.reload()`); Airspace guest crashes reload the webview and
raise a HUD issue. A second app launch focuses the existing instance
(single-instance lock).

## 10. Invariants (checklist for future changes)

1. Only `rewireFront()` touches the front routing gains.
2. Only `claimSource()` decides playback ownership.
3. Only MISSION STATE reacts to source changes; new automation must be a
   pipeline step with a defined priority, not a new watcher.
4. Any node attached to a live tap must be disconnected in a `finally`.
5. Any interval/rAF started by a component must be cleared on unmount.
6. Store writes and engine calls for the same state must happen in the same
   synchronous action.
7. Persist failures must call `reportStorageFailure` — never a bare catch.
