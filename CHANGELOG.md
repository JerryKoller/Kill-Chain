# Changelog

All notable changes to Kill Chain are documented here.

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
