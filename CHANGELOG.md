# Changelog

All notable changes to Kill Chain are documented here.

## [2.6.7] — 2026-07-26 — Chrome Hover + Song Clarity + Keyboard

### Changed
- **Window controls** — minimize / maximize / close fade in only when you hover the top-right corner (no always-on native overlay)
- **Patterns / Song order** — clearer two-row arrangement: Patterns you edit, Song order you play; Loop pattern vs Play song; chain always visible
- **Keyboard** — 1–4 octaves on screen (default 2); high-contrast key labels; hover travel + fire polish

## [2.6.6] — 2026-07-26 — Path Fit + Lineage + Color Map

### Fixed
- **Natural Selection** — Keep Winner / Extinct stay inside the mutate bay (no bleed into Studio); generation continues after Keep Winner via lineage
- **Signal Path** — nodes stretch full width (no empty bay to the right of Scope)

### Added
- **Keyboard** — toggle 1 or 2 full octaves on screen (default 2); preference remembered

### Changed
- **Fire Command color language** — each band owns a hue (Mix coral · Sources peach · Tone gold · Mod sky · FX violet · Perf amber) so Command Map, Signal Path, and stage chrome agree on where you are

## [2.6.5] — 2026-07-26 — Command Deck

### Added
- **Signal Path Theater** — OSC → Filter → Drive → FX → Mix → Scope with live heat; click jump / FOC focus
- **Command Map** — atlas of all Fire Command stages with jump + focus
- **Focus Mode** — solo one module full-bay; sticky Show-all HUD. Layout only — audio unchanged

## [2.6.4] — 2026-07-26 — Morph Search + Stage Depth

### Changed
- **Morph Pad** — type-to-search corner presets (factory + user); living blend-field wash + filaments
- **Studio bay** — Library button removed (Browse in Patch bay); Undo/Redo with history depth rails
- **Stage depth** — Mod Matrix patchbay cables, phosphor Scope, WaveDisplay scan beam, Meter Bridge bloom, Reverb impulse spikes. Display only

## [2.6.3] — 2026-07-26 — Unique Stage Personalities

### Changed
- **Macros** — four equal command cards (ring meters + destination chips); no radar clipping
- **Stage chrome** — plate / bloom / scope / rails / notch / keys frames so FX and Core stages no longer share one look
- **Personality pass** — Drive forge, Phaser comb valleys, Chorus L/C/R sheets, Delay dual lanes, LFO CRT phosphor, FM Venn, Performance piano keys, Gate shutter rails, Arp bloom rails. Display only — audio unchanged

## [2.6.2] — 2026-07-26 — Visualizer Fidelity + Patch Polish

### Changed
- **Visualizer fidelity** — stage canvases match container width (no floor clipping); Osc WaveDisplay hi-DPI; Morph Pad responsive; abbreviated edge labels under narrow bays
- **Patch bar** — Keep winner padded/two-line; Studio bay equal Undo · Redo · Library cells. Layout only

## [2.6.1] — 2026-07-26 — Armory Deploy + Patch Bar Symmetry

### Changed
- **Armory Deploy** — Randomize twin pod with tumbling dice, category Scope, spin-then-land, last-hit readout
- **Patch bar** — balanced three-bay layout: Patch · Generative (Deploy + Natural Selection) · Studio. Layout only

## [2.6.0] — 2026-07-26 — Natural Selection + Drum Bay

### Changed
- **Natural Selection mutate** — evolution bay UI (helix, Mild→Wild pressure, Gen, rival A/B cards, Keep winner / Extinct). Breeding math unchanged
- **Drum bay** — step grids stretch full width (no dead void); plated Drum Bay / Sample Deck; fixed tools rail. Layout only — sequencing unchanged

## [2.5.9] — 2026-07-26 — Piano Roll Fit + Sequencer Symmetry

### Changed
- **Piano roll fills the bay** — pattern grid fit-to-widths the sequencer (no dead black gap); Fit / ± zoom; velocity + automation stay gutter-aligned
- **Sequencer symmetry** — transport in Play · Bars · Channels zones; editor chrome in a three-column layout; roomier controls and stage plating. Layout only — audio unchanged

## [2.5.8] — 2026-07-26 — Layout Breathing Room

### Changed
- **Full-width open modules** — when multiple modules in a Fire Command band are expanded, they stack vertically at full width instead of crushing into 2–4 columns
- **Sequencer chrome** — arrangement is one compact row (song chain on demand); editor tabs + Draw A/B + File menu replace the stacked toolbars; piano-roll tools denser; long hint footers removed (shortcuts live in tooltips). Layout only — audio unchanged

## [2.5.7] — 2026-07-26 — Category Bands

### Changed
- **Fire Command category bands** — Mix & Output, Sources, Tone, Modulation, FX, Performance Tools
- **Equal-width collapsed chips** — folded modules inside an open band render as a uniform chip grid instead of jagged multi-column headers
- Band and module fold state still persists under `killchain.firecmd.fold.*`. Layout chrome only — audio unchanged

## [2.5.6] — 2026-07-26 — Symmetry + Stage Depth

### Changed
- **Symmetrical controls** — Fire Command knob rows use even Delay/Reverb-style spacing across Oscillators, Unison, Filter, Envelopes, LFOs, FM·Ring, Pitch, Warp, and Performance
- **Fire Mixer meter bridge** — clear five-channel LED meters (A/B/Drums/Samples/Master) matching strip order; confusing flow viz removed
- **Deeper stages** — Morph Pad trails/ripples, Output/OSC depth plates, Harmonic Forge Warp, richer Unison/Filter/Env/LFO/FM/Pitch personalities. Display only

## [2.5.5] — 2026-07-26 — Core Stages + Lit Collapse

### Changed
- **Lit collapse controls** — larger accent-colored fold chevrons across Fire Command sections
- **Fire Mixer console** — signal-flow summing bay (parts → Master → Kill-Chain), taller strips, clearer Master/sidechain racks. Mixing unchanged
- **Morph Pad** — larger pad, glowing corner weights, blend meters
- **Core stage personalities** — OSC A–C, Performance, Spectral Warp, Unison, Filter, Amp/Mod/Filter envelopes, LFO 1–2, FM·Ring, Pitch·Glide each get their own hi-DPI stage. Display only

## [2.5.4] — 2026-07-26 — Collapse + Warp / Output / Mixer

### Changed
- **Collapsible Fire Command** — every section below the piano roll folds (persisted), including Output, Performance, Oscillators, Warp, Filter, Envelopes, LFOs, FX, Macros, Gate, Matrix, Arp, and Fire Mixer
- **Spectral Warp — gold harmonic lattice** — hi-DPI stage showing Stretch / Tilt / Comb reshaping partials live
- **Output · Scope** — collapsible output stage with wavetable stacks and a filled hi-DPI master trace
- **Fire Mixer — bus deck** — collapsible mixer with overview bars mirroring fader levels. Mixing behavior unchanged

## [2.5.3] — 2026-07-26 — FX Stages

### Changed
- **Drive — Magma Forge** — living transfer curve + crushed sine stage
- **Phaser — Sweep Notches** — magenta notch combs crawling the spectrum
- **Chorus — Ensemble Shimmer** — detuned voice ribbons around the dry signal
- **Delay — Ping-Pong Corridor** — L↔R echo pulses decaying with feedback
- **Reverb — Room Bloom** — expanding impulse rings sized by room Size
- **Spectral — Violet FFT Bay** — hi-DPI mode-aware spectrum (freeze / smear / gate / shift). All display-only

## [2.5.2] — 2026-07-26 — Macro / Gate / Matrix Stages

### Changed
- **Macros — amber command cluster** — radar constellation of the four macros with live wiring readout and per-macro destination chips
- **Trance Gate — ice chop field** — hi-DPI amplitude silhouette with playhead crest, tall step pads, preset chip strip, and symmetric control rails
- **Mod Matrix — green signal bay** — animated cable flow of active routes with traveling packets, deeper patch-grid cells, and clearer slot meter. Patching behavior unchanged

## [2.5.1] — 2026-07-26 — Arp Stage

### Changed
- **Arpeggiator visual overhaul** — hi-DPI contour stage with depth field and vignette, pitch-linked color shifting along the note path, targeting-reticle blooms (no particle sparks), gate columns with afterglow, and a symmetrical 3-column control layout. Scheduling and sound are untouched — display only.

## [2.5.0] — 2026-07-26 — Fire Command MK IV

**The synth release.** Fire Command graduates to MK IV: a deeper, more playable, more visual wavetable weapons platform.

### Added
- **Natural Selection mutate** — Mutate now breeds **two candidate patches** from the current sound; audition A / B, keep the winner, and evolve in that direction. A strength slider under the button sets the mutation from subtle drift to full rework
- **1000 factory presets** — 27 hand-tuned flagships (including the new **Acid Reactor** 303-style bass) plus 973 archetype-generated patches with unique forged names; every existing preset is preserved byte-for-byte
- **Precision knobs** — shift-drag fine tuning, **click-to-type** exact values, double-click reset to the true default, and a hover reset pip on every knob
- **Next / Prev patch cycling** — step through the whole bank from the header without opening the preset browser
- **Rebuilt onscreen keyboard** — two full octaves, an octave scroll slider, and click-position velocity (strike lower on a key for harder hits)
- **Per-module eye candy** — live visualizations across the panel: envelope and lowpass-gate curves, an animated LFO scope, filter frequency response, spectral-warp harmonic display, drive transfer curve, arp pattern preview, and a spectral FX readout
- **Robust arpeggiator** — new **down-up, converge, diverge, pedal, and walk** modes plus **swing**, **velocity accents** (every N steps), and **probabilistic ratchets**
- **Trance gate v2** — pattern preset menu, **shift / invert / randomize** controls, a **smooth** knob for click-free gating, and a live playhead on the step display
- **12-slot mod matrix** — up from 8, with crosshair hover highlighting, source-family color coding, and a slot-usage meter
- **Four new mission packs** — Neuro Assault, Acid Offensive, Trance Protocol, and Dubstep Sortie join the roster (10 total); existing packs re-tuned to sound more like their claimed genre
- **Sequencer flow guide** — a numbered ① Pattern → ② Sections → ③ Chain strip with a dismissible explainer and an "editing section" chip, making track building far more intuitive

### Changed
- **MK IV banner** — the Fire Command header is redesigned around a reticle emblem with a proper weapons-platform aesthetic (the fire emoji is gone)

### Fixed
- **Talking Bass clipping** — the filter drive stage now uses a soft-knee curve and resonant presets were re-trimmed, ending harsh clipping on high-resonance patches
- **Spectral FX wonkiness** — Freeze no longer captures silence (energy-gated capture), Smear no longer blows up into a noise wash at low levels, and mono-into-stereo routing is handled correctly

## [2.4.1] — 2026-07-22

**Legal and Universal Output Repositioning** — commercial hygiene pass, not a feature release.

### Changed
- Product positioning: universal Windows audio engine for headphones, speakers, and home theater (not a single-headphone product)
- Fresh installs default to **Neutral** playback correction instead of a Sony XM6 curve
- Settings device section renamed **Playback Correction**; onboarding asks what you listen on (headphones, speakers, soundbar/TV, home theater, or neutral)
- Sidebar shows the active profile dynamically; ActionBar and hotkeys use generic “playback correction” wording

### Added
- **About / Legal** (Settings › Advanced): trademark notice, content responsibility, draft EULA and Privacy Policy links
- `LICENSE` (proprietary), `LEGAL/`, and `THIRD_PARTY_NOTICES.md` for commercial distribution checklist
- Profile picker disclaimer: compatibility aids, not brand endorsements

## [2.4.0] — 2026-07-22

**Stability and Cohesion** — a glue-and-trust release. First public build since 1.4.0; also rolls up the internal 1.5–2.3 releases below.

### Added
- **MISSION STATE** — one orchestrator for every smart system. A source change triggers ONE ordered pipeline: manual override › saved source memory › Auto-Lock › Auto-Flatten. Your hand always wins
- **Unified source memory** — Tractor locks, repair layers and chain snapshots in one versioned per-source record; Armory loadouts referenced, not copied; old memories migrate automatically; sessions export/import as `.kcsession`
- **Mission HUD** — always-visible strip: tracked source, pending/applied automation, health issues with one-click fixes
- **Actionable errors** — device loss, suspended audio engine, storage failures, webview crashes and failed exports now surface as alerts instead of failing silently
- **Reset Audio Engine** — one-click recovery (Settings › Advanced) that re-wires the source, output device and every DSP stage without an app restart
- **Critical-path smoke suite** (`npm run smoke`) — drives the real app end to end: playback, routing, Auto-Lock, 3D, device change, export, presets, loopback, double-playback prevention

### Improved
- Single-instance lock — a second launch focuses the running app
- Automatic renderer crash recovery and Airspace webview auto-reload
- Settings reorganized into Audio / Automation / Appearance / Advanced
- Audio-graph lifecycle documented; zombie timers and competing watchers removed

## [2.3.0] — Tractor Beam

- **Full Chain Lock** — one LOCK prepares Sculptor EQ, master moves, restoration, clarity and loudness trim as a reviewable manifest with plain-language reasons
- **Lock Library** — every engaged lock filed per source with search, favorites, one-click restore and `.klock` export/import
- **Tractor Intelligence v2** — source-health reading: already-mastered guard, damage detection, split confidence
- **Reference targets** — lock toward a clean reference track; match % before and predicted after
- **Tractor Command console** — hand-editable correction curve, veto bands, section-aware scanning

## [2.2.0] — Design System

- **KCDS** — unified design system across every view: shell redesign, standardized interaction language, appearance settings
- Visualizer polish pass

## [2.1.0] — Sculptor and Restoration

- **Target Lock** — reference matching inside Sculptor
- **Restoration Bay v2** — declick, dehum, declip, stereo repair, voice rescue
- **Read & Repair** — one-click analyze-and-fix
- **Bounce** — processed export with optional −14 LUFS normalized copy; batch offline restore
- Repair memory and repair loadouts in the Armory

## [2.0.0] — 3rd Dimension

- **6DOF head tracking** and Walk Mode
- Mission profiles, spatial memory and Acoustic Engine v2
- Depth-aware room rendering

## [1.8.0] — Visualizer Intelligence

- Shared analysis service (one FFT pipeline for all consumers)
- **SINGULARITY** WebGL mode and **Cinema Lock** automatic visual director
- Broadcast-friendly output window

## [1.7.0] — Synth Expansion

- Wavetable oscillators, mod matrix, morph pad, expanded patch library

## [1.6.0] — Fire Command Studio

- Song arrangement, MIDI record, undo/redo, mixer strips, automation lanes
- Sidechain ducking, chain-aware stem export, performance mode

## [1.5.0] — Memory and Matching

- Per-track memory, reference matching, headphone profiles, session snapshots
- Library intelligence and 3rd Dimension presets

## [1.4.0] — 2026-07-20

### Added
- **Clarity Engine** — one-knob Sculptor tool for cleaner, more transparent audio
- **Deadflat** — Calibration tool that flattens frequency response across the full chain
- **Fire Command studio** — piano roll zoom/resize, right-click eraser, WAV export, `.kcproj` projects, custom drum samples, Sample Deck lanes
- **Tractor Auto-Lock** — hands-free re-lock when playback source changes
- **Settings** — density scaling fix, ambient backdrop toggle, reduced motion, boot sting toggle

### Improved
- Engage/disengage sound redesigned (short breach-charge slam)
- Boot sequence — cinematic SYSTEM ARM splash with synced visuals
- Restoration Bay — two-stage harmonic ladder for severely bandlimited audio
- All 8 library visualizers upgraded (Strike warzone, Reactor matrix intel, Tunnel kaleidoscope, etc.)
- Scope — 8192-point float FFT for higher-fidelity analysis
- Glossary and Kill-Chain terminology sweep (Armory, etc.)

## [1.3.0]

### Added
- Restoration Bay with auto-read damage detection
- 3rd Dimension motion mode overhaul
- Music/Cinema voicing modes for Airspace and Tractor Beam

## [1.2.0]

### Added
- Tractor Beam content fingerprinting and Smart Lock
- Live Lock for real-time measurement
- Airspace Cinema/Music modes and media routing improvements

## [1.1.0]

### Fixed
- System monitor popup stacking
- Fire Command synth polyphony and voice budgeting
- UI sounds and splash audio routing
- Airspace capture stability on navigation

### Added
- Source exclusivity arbiter
- Head tracking integration (opentrack)
- Ad blocking in Airspace

## [1.0.0]

- Initial public release

[1.4.0]: https://github.com/JerryKoller/Kill-Chain/compare/v1.3.0...v1.4.0
