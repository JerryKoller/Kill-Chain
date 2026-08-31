/**
 * Searchable parameter → module index for the command palette.
 *
 * Fire Command has ~300 patch parameters spread across 42 modules in six
 * bands, and only one band is mounted at a time — so finding a knob meant
 * already knowing which band owns it. The palette indexed module names only.
 * This maps the parameters people actually hunt for onto the module that
 * hosts them, with synonyms for the terms users are likely to type.
 *
 * Deliberately curated rather than generated from FirePatch: a raw key dump
 * would bury useful hits under hundreds of internal gain-trim fields.
 */

export interface FireParamEntry {
  /** Human label, as shown on the knob. */
  label: string;
  /** Module id from fireModuleAtlas. */
  moduleId: string;
  /** Extra search terms (aliases, related words). */
  keywords?: string;
}

export const FIRE_PARAM_INDEX: FireParamEntry[] = [
  // ── Filter / tone ──
  { label: "Cutoff", moduleId: "filter", keywords: "filter freq frequency lowpass brightness" },
  { label: "Resonance", moduleId: "filter", keywords: "q peak emphasis squelch acid" },
  { label: "Filter Type", moduleId: "filter", keywords: "lowpass highpass bandpass notch" },
  { label: "Filter Model", moduleId: "filter", keywords: "ladder svf biquad moog" },
  { label: "Filter Drive", moduleId: "filter", keywords: "saturation dirt bite" },
  { label: "Key Track", moduleId: "filter", keywords: "keyboard tracking follow pitch" },
  { label: "Filter Slope", moduleId: "filter", keywords: "poles db oct steepness" },
  { label: "Harmonic Carve", moduleId: "filter", keywords: "formant notch odds evens" },

  // ── Envelopes ──
  { label: "Amp Attack", moduleId: "env.amp", keywords: "adsr fade in onset" },
  { label: "Amp Decay", moduleId: "env.amp", keywords: "adsr" },
  { label: "Amp Sustain", moduleId: "env.amp", keywords: "adsr hold level" },
  { label: "Amp Release", moduleId: "env.amp", keywords: "adsr tail fade out" },
  { label: "Velocity Amount", moduleId: "env.amp", keywords: "vel sensitivity dynamics touch" },
  { label: "Filter Env Amount", moduleId: "env.filt", keywords: "cutoff sweep modulation depth" },
  { label: "Filter Env Decay", moduleId: "env.filt", keywords: "adsr sweep" },
  { label: "Mod Envelope", moduleId: "env.mod", keywords: "mseg morph weaver extra" },

  // ── Oscillators ──
  { label: "Osc A Table", moduleId: "osc.a", keywords: "wavetable waveform shape saw pulse" },
  { label: "Osc A Morph", moduleId: "osc.a", keywords: "position wavetable scan frame" },
  { label: "Osc A Level", moduleId: "osc.a", keywords: "volume gain mix" },
  { label: "Osc A Octave", moduleId: "osc.a", keywords: "pitch transpose range" },
  { label: "Osc A Detune", moduleId: "osc.a", keywords: "cents tuning fine" },
  { label: "Osc B Table", moduleId: "osc.b", keywords: "wavetable second oscillator twin" },
  { label: "Osc B Level", moduleId: "osc.b", keywords: "volume gain mix" },
  { label: "Osc B Detune", moduleId: "osc.b", keywords: "cents beating width" },
  { label: "Osc B Inherit", moduleId: "osc.b", keywords: "morph mirror offset fm relation" },
  { label: "Osc C Level", moduleId: "osc.c", keywords: "third oscillator depth body" },
  { label: "Sub Level", moduleId: "sub", keywords: "bass low end weight octave down" },
  { label: "Sub Wave", moduleId: "sub", keywords: "sine triangle square" },
  { label: "Noise Level", moduleId: "noise", keywords: "hiss air texture grain" },
  { label: "Noise Colour", moduleId: "noise", keywords: "white pink dark bright" },

  // ── Unison / warp / chip ──
  { label: "Unison Voices", moduleId: "mixer.unison", keywords: "stack supersaw voices count" },
  { label: "Unison Detune", moduleId: "mixer.unison", keywords: "spread width supersaw cents" },
  { label: "Unison Width", moduleId: "mixer.unison", keywords: "stereo spread pan" },
  { label: "Warp Stretch", moduleId: "fire.sec.warp", keywords: "spectral formant shift" },
  { label: "Warp Tilt", moduleId: "fire.sec.warp", keywords: "spectral brightness tilt" },
  { label: "Warp Comb", moduleId: "fire.sec.warp", keywords: "spectral comb metallic" },
  { label: "Pulse Duty", moduleId: "chip", keywords: "pwm pulse width square" },
  { label: "Hard Sync", moduleId: "chip", keywords: "sync oscillator reset" },
  { label: "Acid Mix", moduleId: "chip", keywords: "303 slide accent squelch" },

  // ── FM / ring ──
  { label: "FM Amount", moduleId: "fm", keywords: "frequency modulation index depth" },
  { label: "FM Ratio", moduleId: "fm", keywords: "harmonic ratio operator" },
  { label: "Ring Mod", moduleId: "fm", keywords: "ring modulation metallic sidebands" },
  { label: "FM Algorithm", moduleId: "fm.rack", keywords: "ops4 dx operator routing" },
  { label: "FM Feedback", moduleId: "fm.rack", keywords: "operator self modulation" },

  // ── LFOs / matrix / pitch ──
  { label: "LFO 1 Rate", moduleId: "lfo.1", keywords: "speed frequency hz wobble" },
  { label: "LFO 1 Depth", moduleId: "lfo.1", keywords: "amount modulation intensity" },
  { label: "LFO 1 Destination", moduleId: "lfo.1", keywords: "target route filter pitch pan" },
  { label: "LFO 2 Rate", moduleId: "lfo.2", keywords: "speed second lfo" },
  { label: "LFO 2 Depth", moduleId: "lfo.2", keywords: "amount second lfo" },
  { label: "Mod Matrix", moduleId: "matrix", keywords: "routing source destination patch loom assign" },
  { label: "Glide", moduleId: "pitch", keywords: "portamento slide legato time" },
  { label: "Pitch Envelope", moduleId: "pitch", keywords: "bend sweep drop riser" },

  // ── Drive / FX ──
  { label: "Drive", moduleId: "fx.drive", keywords: "distortion saturation overdrive dirt" },
  { label: "Drive Mode", moduleId: "fx.drive", keywords: "soft tube fold hard fuzz" },
  { label: "Crush", moduleId: "fx.drive", keywords: "bitcrush decimate lofi" },
  { label: "Tone", moduleId: "fx.drive", keywords: "lowpass brightness post filter" },
  { label: "Reverb Mix", moduleId: "fx.reverb", keywords: "wet space room hall ambience" },
  { label: "Reverb Size", moduleId: "fx.reverb", keywords: "room decay rt60 hall" },
  { label: "Reverb Damp", moduleId: "fx.reverb", keywords: "darkness absorption tail" },
  { label: "Reverb Predelay", moduleId: "fx.reverb", keywords: "separation early gap" },
  { label: "Delay Time", moduleId: "fx.delay", keywords: "echo ms sync note division" },
  { label: "Delay Feedback", moduleId: "fx.delay", keywords: "repeats regeneration echo tail" },
  { label: "Delay Mix", moduleId: "fx.delay", keywords: "wet echo amount" },
  { label: "Chorus Mix", moduleId: "fx.chorus", keywords: "ensemble width thickness detune" },
  { label: "Chorus Rate", moduleId: "fx.chorus", keywords: "speed lfo shimmer" },
  { label: "Phaser Mix", moduleId: "fx.phaser", keywords: "sweep allpass swoosh" },
  { label: "Phaser Rate", moduleId: "fx.phaser", keywords: "speed sweep" },
  { label: "Spectral Mode", moduleId: "fx.spectral", keywords: "freeze smear gate shift stft fft" },
  { label: "Spectral Mix", moduleId: "fx.spectral", keywords: "wet bin lattice" },
  { label: "Tape / Age", moduleId: "fx.vintage", keywords: "cassette wow flutter vhs hiss dust lofi" },
  { label: "Bit Depth", moduleId: "fx.vintage", keywords: "8bit 12bit lofi quantize" },

  // ── Analog life ──
  { label: "Drift", moduleId: "analog.life", keywords: "analog instability tuning wander" },
  { label: "Voice Instability", moduleId: "analog.life", keywords: "analog random organic" },
  { label: "Tune Variance", moduleId: "analog.life", keywords: "detune spread per voice" },

  // ── Pluck / LPG ──
  { label: "Pluck Decay", moduleId: "pluck", keywords: "lpg vactrol strike percussive" },
  { label: "Pluck Colour", moduleId: "pluck", keywords: "lpg tone brightness" },

  // ── Mix / output ──
  { label: "Patch Out", moduleId: "output", keywords: "master gain level volume output" },
  { label: "Punch / Glue", moduleId: "glue", keywords: "compression compressor bus punch" },
  { label: "Stereo Width", moduleId: "width", keywords: "ms side image spread mono" },
  { label: "Mono Below", moduleId: "width", keywords: "bass mono elliptical low" },
  { label: "Air", moduleId: "air", keywords: "high shelf treble sparkle presence" },

  // ── Performance ──
  { label: "Macro 1", moduleId: "macros", keywords: "helm assign control performance" },
  { label: "Trance Gate", moduleId: "gate", keywords: "chop rhythm shutter stutter" },
  { label: "Gate Rate", moduleId: "gate", keywords: "chop speed division" },
  { label: "Harmony", moduleId: "harmony", keywords: "companion third fifth octave voices" },
  { label: "Chord Memory", moduleId: "chord", keywords: "stack intervals one finger" },
  { label: "Scale Lock", moduleId: "scale", keywords: "key snap quantize pitch" },
  { label: "Humanize", moduleId: "human", keywords: "feel timing velocity jitter groove" },
  { label: "Arpeggiator", moduleId: "arp", keywords: "arp pattern up down updown octaves gate" },
  { label: "Polyphony", moduleId: "performance", keywords: "voices max notes cpu" },
  { label: "Scenes", moduleId: "scenes", keywords: "snapshot recall orbit vault slot" },
  { label: "Morph Pad", moduleId: "morph", keywords: "blend quad xy interpolate" },
];
