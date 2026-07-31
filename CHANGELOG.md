# Changelog

All notable changes to Kill Chain are documented here.

## [3.3.0] — 2026-07-31 — Fire Command Sound Character Restored

### Fixed
- **Factory presets** — curated bank authored resonance as 0–1; remastered to musical absolute Q so Acid/Lead/Bass actually diverge again
- **Natural Selection** — wild mode no longer stacks every extreme engine into digital hash; coherent species DNA + dedicated NS safety
- **Sequencer / piano-roll clipping** — Fire bus headroom, softer glue limiter, sample-deck clipper, poly + chord expansion gain staging
- **Sterilized timbre** — less aggressive loudness/performance caps, gentler resonance compensation, stronger formant carve mouths

### Changed
- Default Natural Selection pressure raised into Speciation territory
- Genesis character-linked presets restored to the factory library
- Module visualizer + control overhaul from the 3.2.x audit line included in this build

## [3.2.1] — 2026-07-29 — Fire Command Stability Audit

### Fixed
- **Live A/B routing** — QWERTY / MIDI / on-screen keys play the active Edit target; ARP stays A-only
- **Morph & scene scrub** — mid-scrub blends no longer corrupt `patchA`/`patchB`, persist, or undo
- **Silent FX knobs** — drive bias, freeze, chorus/phaser detail, age macro, and related bus params update live again
- **Project open while Edit B** — Synth A + ARP always load from `.kcproj` (no silent redirect to B)
- **Sequencer bridge** — harmony/chord for A and B, per-channel humanize, delay sync follows BPM
- **MIDI Focus vs Learn** — Focus no longer steals CCs during Learn or when a mapping already exists
- **Scale Strict** — out-of-scale presses no longer record into the piano roll
- **Drum hydrate** — missing sample paths clear stale kit overrides

### Changed
- **`.kcproj` v3** — saves/restores edit target, presets, FX route, scenes, octave, and voice count
- Stage meters / telemetry follow the active Edit A/B engine
- Spectral FFT UI shows fixed 2048 (worklet limit)

## [3.2.0] — 2026-07-28 — Fire Command UX Overhaul

### Added
- Studio / Compact / Focus density, breadcrumb + master meter, Cmd+K palette, Patch / Pattern / Scene / Project save tiers
- Unified Pattern | Arrangement | Selection play scopes

### Changed
- Reorderable signal-path display, mutation genealogy, atlas label modes

## [3.1.0] — 2026-07-27 — Fire Command Depth

### Added
- **Editable Synth B** — Edit A|B on the Synth rack; Draw B focuses the rack; full patch persistence for B
- **Pattern sound recall** — each pattern snapshots Synth A+B on switch; arrangement restores section timbre
- **Offline dry bounce** — OfflineAudioContext Fire export with realtime fallback; Save/Export on the transport
- **Drum grooves** — House / Trap / Break / Clear patterns + Synth Kit clear; clearer Sample Deck callout

### Changed
- **Automation** — default-open with Cutoff preview when collapsed; live→restores-on-stop hint
- Arp / QWERTY remain on Synth A only (documented in What’s New)

## [3.0.13] — 2026-07-27 — Fluid Sequencer Editing

### Changed
- **Piano roll** — Draw / Select / Erase tools, paint-drag, brush length, left+right edge resize
- **Arrangement** — pointer-drag clips with ghost, reject overlaps (toast), Shift+click place, Del/arrows, track rename
- **Patterns** — New + place, Duplicate pattern vs Double len, rename pencil, transport mode chip, clickable Editing badge

## [3.0.12] — 2026-07-27 — Multi-Lane Arrangement


### Added
- **10 playlist tracks** — layer patterns on separate lanes; same-time clips on different tracks play together
- Per-track **mute / solo / color**; clip color, duplicate, bar nudge, and edge trim
- Timeline **zoom**, ruler **scrub** (seek while stopped or playing)

### Fixed
- Piano-roll **right-click erase** hit target and context-menu stealing the gesture

## [3.0.11] — 2026-07-27 — Sequencer Arrangement UX

### Changed
- **Add to end** replaces the confusing “Place {pattern name}” button; empty timeline shows a clear drop hint
- Click an empty bar to place the active pattern; denser playlist track with start bar / length on clips
- Editor badge reads **Editing · {pattern}** so it doesn’t look like another tab

## [3.0.10] — 2026-07-27 — Arrangement Playlist

### Added
- **FL-style arrangement** — pattern bank + horizontal timeline of pattern clips (absolute bar positions; gaps = silence). Loop pattern or play the full arrangement
- **Expand all / Collapse all** on each Synth band header for module chips
- **Blank New pattern** (plus separate Duplicate); new patterns no longer auto-place on the timeline

### Removed
- Song Order chain strip (`chain: string[]`) — migrated to arrangement clips on load

## [3.0.9] — 2026-07-27 — Fire Command Cohesion

### Removed
- **Capability Missions** — packs, showcase presets, and the Missions browser entry are gone from Fire Command (Mission Log / Mission HUD elsewhere in the app are unchanged)

### Changed
- Shared segmented tab chrome for Synth · Sequencer and Home · Src · Tone · Mod · FX · Mix · Perf
- Band tabs no longer double as foldable shells — selecting a band shows that category directly
- Patch bar is a balanced three-bay layout (Patch · Generative · Studio); Characters and Init sit as equal twin actions
- Mini transport and Signal Path headers match the same hint rhythm as the tab strips

## [3.0.8] — 2026-07-27 — Kill the Ghost Hi-Hat

### Fixed
- **Note-onset tick** — Init no longer applies a hidden filter-envelope zap (`filterEnvAmount` defaulted to 0.4) on every note; removed the forced chip-noise “bed” that added a hi-hat click whenever chip noise mode wasn’t white
- Noise / tape hiss now snap to silence immediately when a clean preset loads (no setTarget lag)

## [3.0.7] — 2026-07-27 — Preset Identity · Symmetry

### Fixed
- **Preset sameness** — Init/default patch no longer paints every preset with 3-voice unison, 25% chorus, Osc B, sub, and drive; module bypasses and arp settings no longer stick across loads; fractional detune values in the bank were scaled to real cents
- Bass presets restore explicit sub levels that had been inherited from the old default

### Changed
- Band chip grids use even atlas-width columns; All Modules map stays a 6-column band row earlier in the breakpoint range

## [3.0.6] — 2026-07-27 — Fire Band Tabs · Named Presets

### Added
- **Synth band tabs** — under Synth: **Home** (Signal Path hub) plus **Src · Tone · Mod · FX · Mix · Perf**, each mounting only that category (same idea as Sequencer as its own workspace)
- Signal Path / All Modules jumps open the matching band tab before scrolling

### Changed
- **Every factory preset** now has a unique, sound-descriptive name (no more “Lead 0” / “Pad 3”); patches re-authored so names match the tone
- Mission showcases renamed for sound: Choir Wall Width, Cross-FM Forge, Frozen Lattice, Gate Chop Pulse, Cassette Age Bus

## [3.0.5] — 2026-07-26 — Curated Preset Library

### Changed
- **Factory bank rebuilt** — removed ~1000 near-duplicate generated patches; each category now has **20 hand-authored, sonically distinct** presets (Bass · Lead · Pluck · Pad · Keys · Arp · FX · Atmos · Vintage · Chip · FM)
- **Missions** — deleted genre showcases; **5 capability demos**: Unison Width, Cross-FM Forge, Spectral Freeze, Gate · Matrix Pulse, Vintage Age Bus
- Character-linked duplicates no longer clutter the library (Characters browser unchanged)

## [3.0.4] — 2026-07-26 — Synth · Sequencer Workspaces

### Added
- **Fire Command workspaces** — **Synth** (sound design + keyboard) and **Sequencer** (patterns, song order, piano roll, drums) as separate tabs inside Fire Command
- **Slim transport** on Synth — Open Fire, BPM, A/B/DRM arms while tweaking the patch
- Cross-links: Sequencer → / ← Synth

### Changed
- Sequencer no longer shares one endless scroll page with the synth rack
- Signal Path deck heat is throttled (~140 ms) so knob drags don’t thrash the UI

### Performance
- Idle workspace unmounts (stage viz RAFs off on Sequencer; roll/drum playheads off on Synth)

## [3.0.3] — 2026-07-26 — Visualizers · Chrome · Honesty

### Changed
- **Stage visualizers** — every Fire Command module elevated with its own philosophy (FM Rack cables, grain storms, tectonic sub, iris pluck, M/S Lissajous, VU glue, air shelves, constellation scenes, richer Core/FX stages, Morph Pad field, matrix cable energy, mixer bus theater)
- **Title bar** — grid layout keeps min/max/close always reachable; System Monitor no longer overlays window chrome
- **Scroll** — Fire Command can reach absolute top; Focus HUD + header Top jump

### Fixed
- Module On/Off bypass gaps (matrix global+voice, macros, morph, vector/FM Rack, arp module, pitch env/glide, osc levels under matrix)
- Arp ticks ignored Scale Lock / Humanize; Arp module Off left the scheduler running
- Scenes stripped `moduleEnable` on capture; preset load wiped module switches
- Drive stage viz incorrectly read Glue’s punch

## [3.0.2] — 2026-07-26 — Module Fill

### Added
- **Noise Bed · Sub Osc** (Sources) — first-class noise + sub with octave
- **Pluck Gate** (Tone) — LPG elevated to its own strike module
- **Width · Glue · Air** (Mix) — stereo M/S, bus compress, dual-shelf tone
- **Harmony · Scale Lock · Chord Memory · Humanize · Scenes** (Perf) — playable performance bay with 8 snapshot slots
- **Per-module On/Off** on All Modules — real bypass for every atlas entry
- Unique stage visualizer for each new module

### Changed
- All module columns equalized at 7 (Src / Tone / Mod / FX / Mix / Perf)
- Unison slimmed (sub/noise/stereo moved to their own homes)
- Harmony moved out of Live Controls into Perf

## [3.0.1] — 2026-07-26 — Genesis Polish

### Changed
- **Character names** — fully ambiguous (Horizon Stack, Acid Line, Pocket Chip, Algorithm Keys, …); no trademarked inspiration labels in the UI
- **Patch Library** — emoji-free chrome, denser organization, clearer Mission deploy flow
- **Signal Path** — On/Off bypass per stage (OSC · FILTER · DRIVE · AGE · FX · MIX · SCOPE)
- **Reverb** — Damp, Predelay, Diffusion knobs + richer IR / stage viz
- **Chip & Analog Life** — stronger PWM / sync / noise bed / drift / instability / accent / slide feel
- **Visualizers** — Vintage Age, Chip, Analog Life stages; Sidechain duck curve is hi-DPI

### Fixed
- Sidechain rack canvas stretched at low resolution
- Chip noise character barely audible when Noise knob was at zero
- Analog Life knobs too subtle to hear without cranking Drift

## [3.0.0] — 2026-07-26 — Fire Command Genesis

### Added
- **Characters** — 23 inspired cards (Vintage / Chip / FM) with original names (Horizon Stack, Soft Dual, Acid Line, Pocket Chip, Algorithm Keys, Color Morph, and more)
- **Vintage Age** bus — cassette generations, variable tape speed, wow/flutter, VHS color, 8/12-bit + downsample, BBD chorus, analog compress, dust / hiss / hum / print-through (transparent when off)
- **Analog Life** — drift rate, voice instability, per-note tune variance, envelope inconsistency
- **Chip & Acid** — pulse duty, hard sync feel, Hold/Soft/periodic noise, chip voice limit, accent + slide
- **FM Rack & Vector** — 4-op FM engine mode (algorithms / ops / feedback), vector morph rate/depth
- **Library categories** — Vintage, Chip, FM + Genesis presets

### Changed
- Fire Command patch bay: Characters button; rack sections for Vintage Age, Analog Life, Chip, FM Rack
- Signal Path: AGE node heat; module atlas entries for Genesis stages

## [2.7.1] — 2026-07-26 — Splash Sync · Missions Punch · Fire Perf/UX

### Fixed
- **Boot splash sync** — reveal and drop visuals gated on actual audio start (preload + sink during black lead-in); hit pulses for contact / radar / arming / drop
- **Dubstep Sortie** — dry aggressive wobble (was resonance+fuzz+reverb mush); neuro growl dried out too

### Performance
- **Mod timer** — clears when idle ~5s; restarts on note/patch
- **Morph pad** — live scrub updates engine only (no Zustand/structuredClone until release)
- **Sequencer** — notes-by-step index (WeakMap) instead of scanning all notes every step
- **Drum kit** — disconnect synth-hit nodes on end (less GC)
- **Dev boot** — no longer eager-loads the ~1000-preset Fire Command bank

### Changed
- **Fire Command UX** — bands follow signal flow (Sources→…→Mix); slim header; Missions button; Patch Library; Solo labeling; Command Map collapsed by default; Esc exits solo; mixer strips + sidechain row; stripped decorative captions

## [2.6.10] — 2026-07-26 — Missions That Hit + Splash Bite

### Fixed
- **Sidechain** — ducks Synth A only; Synth B (bass / 808 / wobble) bypasses the pump
- **Mission Synth B** — showcase presets apply synchronously so the first note isn’t a default patch
- **Drums** — fatter kick/snare, milder hats, higher kit trim

### Changed
- **Mission demos** — hard rebuild: A = color (pads/leads), B = solid bass; leaner grids, louder patches
- **Boot splash** — same centered layout with HUD brackets, scanline, crosshair ticks, bloom, drop punch

## [2.6.9] — 2026-07-26 — Mission Showcase Presets + Clean Splash

### Added
- **20 mission showcase presets** (`Mission · …`) — purpose-built Fire Command patches for demos (trap 808, floor reese, neon chord, neuro growl, acid 303, uplift saw, halftime wobble, etc.)

### Changed
- **Mission demos** — rebuilt around the showcase presets with leaner arrangements so each genre actually reads
- **Boot splash** — single centered column (emblem → wordmark → bar); even spacing, no cluttered HUD/EQ/radar pile-up

## [2.6.8] — 2026-07-26 — Mission Auth + Boot Splash

### Changed
- **Mission demos** — rewritten so each pack matches its genre (trap pocket, UK drill slides, warehouse techno 4/4, synthwave chords, beatless ambient, two-step neuro, acid 303, trance offbeat bass, halftime dubstep)
- **Boot splash** — fire reticle + chain-link core, radar sweep, HUD readouts; same arming timing as the boot sting

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
