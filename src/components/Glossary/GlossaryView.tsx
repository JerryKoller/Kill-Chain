import { useEffect, useMemo, useState } from "react";
import { GlassPanel } from "@/components/shared/GlassPanel";
import { ActionBar } from "@/components/shared/ActionBar";
import { FIRST_60_SECONDS_STEPS, FIRE_MISSING_SAMPLES_TERM } from "@/lib/retailHelp";
import { useUIStore } from "@/state/uiStore";

type Category =
  | "Product"
  | "Tone"
  | "Dynamics"
  | "Space"
  | "Color"
  | "Pro Tools"
  | "Lo-Fi"
  | "Calibration"
  | "Tools"
  | "Metering"
  | "Pipeline";

interface Entry {
  term: string;
  category: Category;
  short: string;
  long: string;
}

// Kept in sync with the words the app actually puts on screen — the Sculptor
// tone bands, the Dynamics/Space/Color knobs, the Pro Tools and Lo-Fi panels,
// every feature in the sidebar, and the read-outs in the Scope.
const ENTRIES: Entry[] = [
  // ── Product identity & care ────────────────────────────────────────────────
  {
    term: "Kill-Chain",
    category: "Product",
    short: "A place to play with and reshape your audio.",
    long:
      "Kill-Chain is a desktop playground for loading music, sculpting tone, fixing damaged tracks, and routing sound through a full DSP chain. Everyday work happens in Library → Sculptor → Tractor → Armory. Fire Command, Airspace, and Morph Lab are advanced tools — deep when you want them, never required for a first listen. The Field Manual (this Glossary) is where the in-depth explanations live; the first-run tour stays basic on purpose.",
  },
  {
    term: "Library",
    category: "Product",
    short: "Your local music arsenal — folders, playlists, favorites.",
    long:
      "Add folders from your PC; Kill-Chain indexes supported audio files and plays them into the engine. Empty Library? Use Add folders, Load a file, or drop files onto the window. Library needs the desktop app (Electron) — the web build cannot scan folders. Paths are absolute: if you move or rename a folder on disk, tracks show MISSING. Use Check missing, Prune orphans, Reveal in Explorer, or Rescan after re-adding the new location. A Kill-Chain backup stores folder paths and meta (favorites, playlists, play counts) — not the audio files themselves — so after wipe/reinstall you may need to re-add folders if files moved.",
  },
  {
    term: "First 60 seconds",
    category: "Product",
    short: "Add music → hear through the chain → sculpt.",
    long: [
      "The everyday loop you can repeat on every session:",
      ...FIRST_60_SECONDS_STEPS.map((s, i) => `${i + 1}. ${s.title} — ${s.body}`),
      "Fire Command, Airspace, and Morph Lab wait until you want them. Settings → Appearance has this card; the first-run tour stays short on purpose.",
    ].join(" "),
  },
  {
    term: "Kill-Chain backup",
    category: "Product",
    short: "Portable Settings + Library meta + Mission Log (.kcbackup).",
    long:
      "Settings → Kill-Chain backup exports a .kcbackup with appearance/playback settings, Library folders and track index/meta, and Mission Log source memories. Import with Merge (combine) or Replace (overwrite those areas). Fire Command .kcproj projects are NOT included in v1 backup — save those separately. After restore, if music folders moved on disk, re-add them and Rescan; Mission Log memories still key off paths when possible.",
  },
  {
    term: "Mission Log",
    category: "Product",
    short: "Per-source memory of the DSP chain you liked.",
    long:
      "When you save a chain for a track, album, playlist, or Airspace source, Mission Log stores it. With Restore saved source memory on, playing that source again reapplies the chain (after Manual override priority). Separate from Kill-Chain backup's sibling .kcsession export, which also bundles referenced Tractor locks.",
  },
  {
    term: "Sound pipeline",
    category: "Pipeline",
    short: "How audio flows from source → DSP → output.",
    long:
      "A source (Library file, drop, Exterior Audio loopback, or Airspace capture) feeds the AudioEngine. Correction (headphone/speaker profile) sits early; Sculptor EQ + tone/dynamics/space/color/pro/lo-fi shape the program; Restoration/Clarity can repair; 3rd Dimension can spatialize; output gain and sink device finish the path. Mission State automation (saved memory → Auto-Lock → Auto-Flatten) may rewrite the chain when the source changes — manual knob touches put the source on manual hold until the next source.",
  },
  {
    term: "Playback Correction",
    category: "Pipeline",
    short: "Output-device curves (headphones, speakers, TV…).",
    long:
      "Compatibility profiles counteract typical tonal bumps of a device class or model so the rest of the chain starts from a more neutral place. Pick during onboarding or Settings. Not a brand endorsement. Toggle off anytime for a raw A/B against Windows.",
  },

  // ── Tone (the friendly EQ band stack in the Sculptor) ──────────────────────
  {
    term: "Sub Bass",
    category: "Tone",
    short: "Below ~60 Hz — the felt rumble under kicks and basslines.",
    long:
      "More felt than heard. Boost for weight on electronic and hip-hop; cut to tighten a muddy low end. A little goes a long way before it overwhelms small drivers.",
  },
  {
    term: "Bass",
    category: "Tone",
    short: "~80–160 Hz — the punch and groove of the low end.",
    long:
      "The body of kicks and bass guitars. This is where 'fullness' lives; too much turns boomy, too little sounds thin.",
  },
  {
    term: "Warmth",
    category: "Tone",
    short: "~200–300 Hz — lower-mid weight and richness.",
    long:
      "Adds richness to vocals and acoustic instruments. Push it for an analog, intimate feel; pull it back when the mix sounds congested or 'boxy'.",
  },
  {
    term: "Body",
    category: "Tone",
    short: "~350 Hz — fullness without the mud.",
    long:
      "Fills out thin recordings. The boundary between warmth and mud — small cuts here clean up a cluttered mix fast.",
  },
  {
    term: "Mid",
    category: "Tone",
    short: "~700 Hz — overall midrange fullness.",
    long:
      "The core of most instruments. Boosting brings everything forward; scooping it creates the classic 'smiley-face' hi-fi sound.",
  },
  {
    term: "Vocals",
    category: "Tone",
    short: "Forward presence tuned for voices.",
    long:
      "Lifts lead vocals and dialogue so lyrics and speech sit on top of the mix without having to raise the whole midrange.",
  },
  {
    term: "Presence",
    category: "Tone",
    short: "~3 kHz — articulation and bite.",
    long:
      "Where instruments 'cut through'. Boosting makes things feel close and detailed; too much causes harsh, fatiguing edges.",
  },
  {
    term: "Clarity",
    category: "Tone",
    short: "Upper-mid definition and separation.",
    long:
      "Sharpens the line between instruments so a busy mix feels organised rather than smeared. Pairs well with Air for an open sound.",
  },
  {
    term: "Air",
    category: "Tone",
    short: "~8–12 kHz — openness and breath.",
    long:
      "Lifts the ceiling of a recording — cymbals open up, vocals breathe. Use sparingly; it also exposes hiss and streaming artefacts.",
  },
  {
    term: "Top End",
    category: "Tone",
    short: "The uppermost shelf — high-frequency detail above ~12 kHz.",
    long:
      "The highest band — adds fine detail and polish to a master. Overdone, it gets brittle and fatiguing, so nudge in small amounts.",
  },

  // ── Dynamics ───────────────────────────────────────────────────────────────
  {
    term: "Punch",
    category: "Dynamics",
    short: "Transient attack — the snap of every hit.",
    long:
      "A transient shaper. Positive punch sharpens the leading edge of kicks, snares and plucks; negative punch softens hits for a relaxed feel.",
  },
  {
    term: "Texture",
    category: "Dynamics",
    short: "Sustain shaping — the tail of each note.",
    long:
      "Positive texture extends sustain (rooms feel bigger, plucks ring longer); negative dries notes out for a tight, studio feel.",
  },
  {
    term: "Glue",
    category: "Dynamics",
    short: "Cohesion and loudness consistency (compression).",
    long:
      "A gentle compressor that pulls the mix together and steadies the level so quiet parts come up. Transparent at zero; push it for energy and density.",
  },

  // ── Space ────────────────────────────────────────────────────────────────
  {
    term: "Width",
    category: "Space",
    short: "Stereo spread — mono ↔ stereo ↔ wide.",
    long:
      "Adjusts the side channel. Wider feels more enveloping; narrower focuses the centre. The low end is kept mono-safe internally.",
  },
  {
    term: "Space",
    category: "Space",
    short: "The ambient reverb tail mixed in.",
    long:
      "How much room ambience sits behind the music. Small amounts (5–15%) add warmth without smearing detail. Pairs with Room for the size of that space.",
  },
  {
    term: "Room",
    category: "Space",
    short: "Reverb size — small booth → cathedral.",
    long:
      "Sets the character of the Space tail, from a tight booth to a huge hall. Smaller rooms stay tight and present; larger rooms feel grand but wash out detail.",
  },
  {
    term: "Crossfeed",
    category: "Space",
    short: "Out-of-head, speaker-style imaging.",
    long:
      "Bleeds a little left into right and vice-versa, re-creating the natural ear-to-ear interaction of speakers so headphone audio sounds less 'stuck in your skull'.",
  },
  {
    term: "3rd Dimension",
    category: "Space",
    short: "Place sound anywhere in a virtual 3D room.",
    long:
      "A room where the character at centre is you — their ears are your ears. Drop speakers (soundbar up to 7.2/Atmos) or scatter your active EQ bands around the space and hear each one from exactly where it sits. Room size sets the soundstage; everything is rendered binaurally for headphones.",
  },
  {
    term: "HRTF",
    category: "Space",
    short: "Head-Related Transfer Function — how ears localise sound.",
    long:
      "The subtle timing, level and tonal filtering your head and outer ears apply to a sound depending on its direction. The 3rd Dimension uses HRTF panning so a speaker placed up-left actually sounds up-left over headphones, not just louder on one side.",
  },
  {
    term: "Binaural",
    category: "Space",
    short: "Two-channel audio designed for headphone 3D.",
    long:
      "Audio rendered for the two ears specifically, carrying the directional cues (HRTF) that trick the brain into hearing sound outside the head. The 3rd Dimension's output is binaural — best experienced on headphones.",
  },
  {
    term: "Soundstage",
    category: "Space",
    short: "The perceived size and layout of the sound field.",
    long:
      "How wide, deep and tall the music feels around you. In the 3rd Dimension the Room width/height/depth sliders literally grow or shrink the soundstage — bigger rooms spread the speakers further and add more ambience.",
  },
  {
    term: "LFE / Subwoofer",
    category: "Space",
    short: "Low-Frequency Effects — the dedicated bass channel.",
    long:
      "The '.1' in 5.1 / 7.1. A subwoofer voice is fed a mono signal low-passed around 120 Hz, so it only reproduces the deep bass. Placement matters less than for full-range speakers because low frequencies are hard to localise.",
  },
  {
    term: "Surround / Height (Atmos)",
    category: "Space",
    short: "Speakers beside, behind and above the listener.",
    long:
      "Surround speakers sit to the sides/rear for envelopment; height (Atmos) speakers go up near the ceiling for overhead effects. In the 3rd Dimension you can raise any speaker toward the ceiling (hold Shift while dragging, or use the Height slider) to build a 5.1.2-style dome.",
  },
  {
    term: "Near / Far Field",
    category: "Space",
    short: "How close a source sits to your ears.",
    long:
      "Near-field sources are close and intimate; far-field sources are distant and roomy. Distance in the 3rd Dimension is modelled by the panner's roll-off plus reverb — drag a speaker away and it gets quieter, more diffuse and further back.",
  },

  // ── Color ────────────────────────────────────────────────────────────────
  {
    term: "Harmonics",
    category: "Color",
    short: "Even-order excitation — a tube-like glow.",
    long:
      "Adds 2nd-order harmonics that the ear reads as warm, full and pleasant. Tiny amounts make a big subjective difference.",
  },
  {
    term: "Saturation",
    category: "Color",
    short: "Tape-style soft clipping — subtle drive.",
    long:
      "Rounds peaks instead of letting them poke through, adding grit and density. Great on sparse mixes; too much sounds distorted.",
  },

  // ── Pro Tools ──────────────────────────────────────────────────────────────
  {
    term: "De-ess",
    category: "Pro Tools",
    short: "Tames harsh 'S' sounds (5–9 kHz sibilance).",
    long:
      "A narrow dynamic processor that ducks only the sibilant band when it gets loud. Essential for bright vocals, podcasts and pop masters.",
  },
  {
    term: "Sub Width",
    category: "Pro Tools",
    short: "Stereo width of the lows (<250 Hz).",
    long:
      "Independent width for the bass band. −1 (mono) is recommended — wide bass smears the low end and can cancel on some systems.",
  },
  {
    term: "Mid Width",
    category: "Pro Tools",
    short: "Stereo width of vocals and mids (250 Hz–3 kHz).",
    long:
      "Controls how spread out the midrange is without touching the bass or highs — handy for widening a stage while keeping vocals centred.",
  },
  {
    term: "Air Width",
    category: "Pro Tools",
    short: "Stereo width of the top end (>3 kHz).",
    long:
      "Spreads only the top end for an airy, expansive treble while the rest of the image stays put.",
  },
  {
    term: "MB Comp (Low / Mid / High)",
    category: "Pro Tools",
    short: "Multiband compression per frequency band.",
    long:
      "Compresses the lows, mids and highs separately, so you can tame a boomy bass without ducking vocals, or de-harsh highs without muddying mids.",
  },

  // ── Lo-Fi Deck ─────────────────────────────────────────────────────────────
  {
    term: "Age",
    category: "Lo-Fi",
    short: "Bandwidth reduction and filter degradation.",
    long:
      "Rolls off the extremes and narrows the response to emulate old, worn playback gear. Higher values = more vintage, less hi-fi.",
  },
  {
    term: "Wear",
    category: "Lo-Fi",
    short: "Dust, crackle and dropout artefacts.",
    long:
      "Adds the mechanical noise of aged media — surface crackle and brief dropouts — for a tactile, lived-in character.",
  },
  {
    term: "Wow/Flutter",
    category: "Lo-Fi",
    short: "Pitch instability and tape-style wobble.",
    long:
      "Slow 'wow' and fast 'flutter' pitch drift, like a worn tape deck or warped record. A little adds soul; a lot sounds seasick.",
  },

  // ── Calibration ────────────────────────────────────────────────────────────
  {
    term: "Guided Calibration",
    category: "Calibration",
    short: "A/B questions that build a personal tuning.",
    long:
      "Pick which of two samples sounds better and the engine narrows in on a profile shaped to your ears and headphones. You can also drag the sliders directly.",
  },
  {
    term: "Live Signature",
    category: "Calibration",
    short: "The radar of your profile vs. the live sound.",
    long:
      "The spider chart in Calibration. Solid lobes show boosts, dashed lobes show cuts — your target profile in plasma/gold, the currently audible sound in cyan.",
  },
  {
    term: "Pure Tone Calibration",
    category: "Calibration",
    short: "Audition each band with a clean test tone.",
    long:
      "Plays a pure sine at each band's exact frequency — solo, swept, or all at once (unison) — so you can balance levels by ear and hear precisely what each band does.",
  },
  {
    term: "A/B Compare",
    category: "Calibration",
    short: "Snapshot a tuning, tweak, then swap to compare.",
    long:
      "Save the current sound as A, keep adjusting, then swap to hear A vs B instantly. Your ears normalise quickly, so A/B is the only honest test of a change.",
  },
  {
    term: "Headphone Correction",
    category: "Calibration",
    short: "Counteracts your headphone's tonal signature.",
    long:
      "Every headphone colours sound. The correction layer flattens your model's stock bumps and dips so the rest of the chain starts from an accurate reference. Toggle off for a raw A/B with Windows.",
  },
  {
    term: "Golden Ears",
    category: "Calibration",
    short: "Ear-training drills that sharpen your listening.",
    long:
      "Practice spotting EQ boosts, level differences and distortion against varied sounds (or your own track) to train your hearing over time.",
  },

  // ── Tools (features) ───────────────────────────────────────────────────────
  {
    term: "Sculptor",
    category: "Tools",
    short: "The main workbench — bands, knobs and toggles.",
    long:
      "Where you reshape everyday listening: parametric EQ (1–20 bands), Tone / Dynamics / Space / Color knobs, Pro Tools, Lo-Fi deck, A/B compare, and Bounce/Restore panels. Save the result to the Armory (Presets). You do not need Fire Command to hear sculpted music — load a Library track and work here.",
  },
  {
    term: "Armory (Presets)",
    category: "Tools",
    short: "Saved looks — morph, blend, and stack favourites.",
    long:
      "The Presets view (Armory) stores Sculptor states locally. Morph between two presets with a slider, commit blends, and keep favourites across sessions. Included in Kill-Chain backup via settings persistence of related stores where applicable; treat Armory as part of your local app data.",
  },
  {
    term: "Parametric EQ band",
    category: "Tools",
    short: "A movable filter set by frequency, gain, Q and type.",
    long:
      "The draggable dots in the Sculptor's EQ. Each band lifts or cuts a region; chain 1–20 of them to draw any response curve you like.",
  },
  {
    term: "Q (quality factor)",
    category: "Tools",
    short: "How wide or narrow an EQ band is.",
    long:
      "Low Q = a broad, gentle, musical shape; high Q = a surgical notch for killing a single resonance. Tune it per band in the Sculptor.",
  },
  {
    term: "Morph Lab",
    category: "Tools",
    short: "Blend four presets in 2D — plus Quick Sculpts.",
    long:
      "Advanced morphing: drag the puck (or let autopilot orbit) between four corner presets, then Commit. Quick Sculpts (Make-it moves + morph pad) live here too. Optional depth after you are comfortable in Sculptor + Armory.",
  },
  {
    term: "Quick Sculpts",
    category: "Tools",
    short: "One-tap moves: Warmer, Cleaner, Punchier…",
    long:
      "Fast nudges that layer onto your current sound, plus an XY morph pad for shaping tone and space by feel. Found in Morph Lab; they commit straight to the sculpt.",
  },
  {
    term: "Morphing Blend",
    category: "Tools",
    short: "Crossfade between two presets with a slider.",
    long:
      "In Presets — choose preset A and B and slide to morph between them. Preview is live; Commit blend writes the result into the sculpt.",
  },
  {
    term: "Macro Reactor",
    category: "Tools",
    short: "Stackable one-tap sound moves you can keep or reset.",
    long:
      "Tap pads to layer instant moves (Drop Switch, Focus Beam, Analog Bloom…). Stack as many as you like, then Keep blend to bake them in or Reset to undo. Fully non-destructive.",
  },
  {
    term: "Tractor Beam",
    category: "Tools",
    short: "Auto-EQ that matches a track to your headphones.",
    long:
      "Analyses the loaded track with high-resolution (1/3-octave) measurement and retunes your Sculptor bands toward a balanced target voiced for your output profile — keeping your band count and layout. Smart Lock / Live Lock / Auto-Lock / Full Chain extend Tractor for content-aware and hands-free workflows. Primary 'fix/shape' beat in the basic tour.",
  },
  {
    term: "Spectral Lock",
    category: "Tools",
    short: "Tractor Beam's Bass / Treble EQ read-out.",
    long:
      "Shows the net EQ move Tractor Beam is applying — positive means it lifted that end, negative means it cut it — so the numbers match the curve you see.",
  },
  {
    term: "Library (tool)",
    category: "Tools",
    short: "Sidebar Library view — browse and deploy tracks.",
    long:
      "See Product → Library for the full story: folder scan, missing-file repair, playlists, Mission Log hooks, and desktop-only gating.",
  },
  {
    term: "Smart Lock",
    category: "Tools",
    short: "Tractor Beam's content-aware target — it reads WHAT you're playing.",
    long:
      "Fingerprints the audio (dynamics, stereo field, spectral balance) and reads the title to classify film, music, speech or games, then picks the correction voicing that suits it instead of forcing one curve on everything.",
  },
  {
    term: "Live Lock",
    category: "Tools",
    short: "Measure whatever is playing RIGHT NOW through the engine.",
    long:
      "Listens to the live signal — an Airspace movie, Exterior Audio, a local track — for ~20 seconds and derives the correction from that measurement. No file needed.",
  },
  {
    term: "Auto-Lock",
    category: "Tools",
    short: "Hands-free Tractor Beam — re-locks on every track change.",
    long:
      "When armed, a new video or track triggers a fresh 9-second live measurement and the full chain re-locks itself: EQ curve, dynamics, width and de-ess, tuned per item.",
  },
  {
    term: "Full Chain",
    category: "Tools",
    short: "Tractor moves beyond EQ — dynamics, image, de-ess, space.",
    long:
      "'Engage full chain' applies the correction curve plus master moves across the whole program: multiband glue where dynamics are crushed, width where the image is narrow, de-ess where the top is spiky.",
  },
  {
    term: "3rd Dimension",
    category: "Tools",
    short: "The spatial audio deck — rooms, height, and Motion mode.",
    long:
      "Places virtual sources around your head with distance, height and room ambience. Motion mode splits the signal into frequency bands that physically orbit you — anchored lows, flying highs.",
  },
  {
    term: "Headphone Stage",
    category: "Tools",
    short: "3rd Dimension profile tuned for in-head listening.",
    long:
      "Pulls the virtual sources into a tighter, closer constellation with gentler crossfeed so movement feels coherent on headphones instead of gimmicky. Room Stage keeps the wider speaker-like placement.",
  },
  {
    term: "Restoration Bay",
    category: "Tools",
    short: "Rebuild damaged audio — HF ladder, body, de-crunch, hiss tamer.",
    long:
      "For low-bitrate rips and bad uploads. A two-stage harmonic ladder regenerates the brickwalled top octaves (the 'HD guess'), body rebuild restores the low mids, de-crunch softens codec grit and the hiss tamer ducks noise between the notes.",
  },
  {
    term: "Clarity Engine",
    category: "Tools",
    short: "One knob whose only job is CLEAN.",
    long:
      "Four coordinated moves — a dynamic mud duck that only engages when low mids pile up, a sub-sonic rumble gate, a gentle unveil tilt, and an edge guard that keeps the opened top end smooth.",
  },
  {
    term: "Deadflat",
    category: "Calibration",
    short: "One button that drives the whole chain toward flat.",
    long:
      "Engages headphone correction, zeroes every colour control, listens to what's playing for 12 seconds and retunes the Sculptor so every third-octave band sits dead even against a pink-noise reference. Reports the measured deviation before and after.",
  },
  {
    term: "Fire Command",
    category: "Tools",
    short: "Advanced synth deck — twin synths, drums, sequencer, samples.",
    long:
      "Power-user territory: playable wavetable synth (plus second voice), FL-style drum grid with your samples, scale-aware piano roll, Euclidean tools, WAV export, and .kcproj projects. The basic tour only points here — full depth lives in What's New notes and this Glossary. Not required to sculpt Library music. Save projects separately; not part of Kill-Chain backup v1.",
  },
  {
    term: "Sample Deck",
    category: "Tools",
    short: "Rack your own sounds and paint them on the step grid.",
    long:
      "Up to six operator-loaded samples (risers, chops, FX) become sequencer lanes with their own level and steps — saved with the project, hydrated from disk on load. Missing samples on another machine show on project open.",
  },
  {
    term: FIRE_MISSING_SAMPLES_TERM,
    category: "Tools",
    short: "Project paths that no longer exist on this PC.",
    long:
      "Fire Command .kcproj files store absolute paths to your drum hits and Sample Deck WAVs. After moving machines or folders, lanes may load silent. On project open you'll see a warning — use Retry sample load in the sequencer bar, or Drums tab → click each lane to re-pick the file. Copying the original folders back to the same path also works. Export may skip missing lanes until you re-link.",
  },
  {
    term: "Airspace",
    category: "Tools",
    short: "The in-app browser wired into the DSP chain.",
    long:
      "Advanced routing: stream YouTube or anything else and Route through Kill-Chain. Cinema/Music voicings layer on top; the transport mirrors the video; capture self-heals on navigation. Optional ad/tracker blocking has separate legal considerations — see Settings → About.",
  },
  {
    term: "Exterior Audio",
    category: "Tools",
    short: "Capture system/desktop audio into the chain (loopback).",
    long:
      "Grabs Windows audio — games, another browser, anything — and runs it through the engine. Pair with a virtual cable or a second output device to avoid feedback. Device loss surfaces in the Mission HUD.",
  },
  {
    term: "Visualizer",
    category: "Tools",
    short: "Eight reactive modes over whatever is playing.",
    long:
      "Spectrum Array, Waveform Scope, Radial Reactor (with a matrix intel core), Waterfall, Strike Field (a musical warzone with a hunting crosshair), Warp Tunnel kaleidoscope, Pulse Lattice and Aurora Flow. Click to cycle, arrows to switch.",
  },

  // ── Metering (the Scope) ───────────────────────────────────────────────────
  {
    term: "LUFS (M / S / I)",
    category: "Metering",
    short: "Perceptual loudness — Momentary, Short-term, Integrated.",
    long:
      "ITU-R BS.1770 loudness. M reacts instantly, S averages ~3 s, I is the whole-program average. −14 LUFS is the Spotify / YouTube target marked on the meter.",
  },
  {
    term: "Peak (dBFS)",
    category: "Metering",
    short: "The loudest single sample, in dB full-scale.",
    long:
      "0 dBFS is the digital ceiling. Going over it clips. The Scope flags peaks above −1 dBFS in red so you can leave headroom.",
  },
  {
    term: "RMS",
    category: "Metering",
    short: "Average signal level — perceived 'how loud'.",
    long:
      "A running average of energy. Unlike peak, it tracks how loud something actually feels moment to moment.",
  },
  {
    term: "Crest factor",
    category: "Metering",
    short: "Peak minus RMS — how dynamic the audio is.",
    long:
      "A high crest factor means punchy, dynamic material; a low one means it's been squashed loud. A quick read on how compressed a track is.",
  },
  {
    term: "Spectral centroid",
    category: "Metering",
    short: "The 'centre of gravity' of the spectrum — brightness.",
    long:
      "Where the energy sits on average. A higher centroid sounds brighter; a lower one sounds darker and warmer.",
  },
  {
    term: "Correlation",
    category: "Metering",
    short: "Mono compatibility, from −1 to +1.",
    long:
      "+1 = perfectly mono-compatible, 0 = wide stereo, negative = out-of-phase content that may cancel on mono systems. Watch it stay above 0 on the bass.",
  },
  {
    term: "Goniometer (Stereo Image)",
    category: "Metering",
    short: "A vectorscope of the left/right field.",
    long:
      "Plots left vs right as a glowing cloud: a vertical line is mono, a fat ball is wide, and a horizontal smear warns of phase problems.",
  },
  {
    term: "Spectrogram",
    category: "Metering",
    short: "A scrolling waterfall of frequency over time.",
    long:
      "Time runs left-to-right, low frequencies sit at the bottom, and brighter colour means louder — great for spotting resonances and build-ups.",
  },
  {
    term: "Width %",
    category: "Metering",
    short: "How much of the signal is side (stereo) energy.",
    long:
      "The proportion of side vs mid content. 0% is mono; higher numbers mean a wider, more spread-out image.",
  },
  {
    term: "Balance",
    category: "Metering",
    short: "Left/right energy tilt of the output.",
    long:
      "Shows whether the mix leans left or right. 'C' means centred — useful for catching an accidental pan or channel imbalance.",
  },
  {
    term: "Dynamics (LU range)",
    category: "Metering",
    short: "The loudness range across recent playback.",
    long:
      "The spread between the quietest and loudest recent moments, in loudness units. Bigger range = more dynamic; small = heavily compressed.",
  },
];

const CATEGORIES = [
  "All",
  ...Array.from(new Set(ENTRIES.map((e) => e.category))),
] as const;

export function GlossaryView() {
  const glossaryFocusTerm = useUIStore((s) => s.glossaryFocusTerm);
  const clearGlossaryFocus = useUIStore((s) => s.clearGlossaryFocus);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<(typeof CATEGORIES)[number]>("All");

  useEffect(() => {
    if (!glossaryFocusTerm) return;
    setQ(glossaryFocusTerm);
    setCat("All");
    clearGlossaryFocus();
  }, [glossaryFocusTerm, clearGlossaryFocus]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return ENTRIES.filter((e) => {
      if (cat !== "All" && e.category !== cat) return false;
      if (!needle) return true;
      return (
        e.term.toLowerCase().includes(needle) ||
        e.short.toLowerCase().includes(needle) ||
        e.long.toLowerCase().includes(needle)
      );
    });
  }, [q, cat]);

  return (
    <div className="flex flex-col gap-3 pb-4">
      <ActionBar
        title="Field Manual"
        code="KC-13"
        subtitle="Plain-English definitions for every term, knob, and tool in Kill-Chain"
      />
      <GlassPanel intense className="p-5">
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search: glue, crossfeed, tractor beam, LUFS..."
            className="flex-1 min-w-[220px] bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-cyan/60"
          />
          <div className="flex gap-1 flex-wrap">
            {CATEGORIES.map((c) => (
              <button
                key={c}
                onClick={() => setCat(c)}
                className={`px-2.5 py-1 rounded-lg text-[11px] uppercase tracking-widest border transition ${
                  cat === c
                    ? "border-cyan/60 bg-cyan/10 text-cyan"
                    : "border-white/10 text-white/65 hover:border-white/25"
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        </div>
      </GlassPanel>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {filtered.map((e) => (
          <GlassPanel key={e.term} className="p-4">
            <div className="flex items-baseline justify-between gap-3">
              <div className="text-lg font-semibold">{e.term}</div>
              <div className="text-[10px] uppercase tracking-[0.3em] text-cyan/80 shrink-0">
                {e.category}
              </div>
            </div>
            <div className="text-[12px] text-white/85 mt-1">{e.short}</div>
            <div className="text-[12px] text-dim mt-2 leading-relaxed">{e.long}</div>
          </GlassPanel>
        ))}
        {filtered.length === 0 && (
          <GlassPanel className="p-6 text-center text-dim col-span-2">
            No entries match "{q}".
          </GlassPanel>
        )}
      </div>
    </div>
  );
}
