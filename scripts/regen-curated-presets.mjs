/**
 * Regenerate Lead–FM curated presets with unique patches + sound-descriptive names.
 * Keeps Bass + hyperspace intact.
 */
import fs from "fs";

const path = new URL("../src/audio/dsp/fireCuratedBank.ts", import.meta.url);
const src = fs.readFileSync(path, "utf8");
const leadIdx = src.indexOf("  // ===== LEAD (20) =====");
if (leadIdx < 0) throw new Error("LEAD marker missing");
const header = src.slice(0, leadIdx);

const hs = src.match(/  preset\("hyperspace"[\s\S]*?\}\),\n/);
if (!hs) throw new Error("hyperspace missing");
const hyperspace = hs[0];

function ser(patch, indent = 4) {
  const sp = " ".repeat(indent);
  const lines = Object.entries(patch).map(([k, v]) => {
    if (typeof v === "string") return `${sp}${k}: "${v}",`;
    if (typeof v === "boolean") return `${sp}${k}: ${v},`;
    if (typeof v === "number") return `${sp}${k}: ${v},`;
    if (Array.isArray(v)) return `${sp}${k}: [${v.join(", ")}],`;
    return `${sp}${k}: ${JSON.stringify(v)},`;
  });
  return `{\n${lines.join("\n")}\n${" ".repeat(indent - 2)}}`;
}

function preset(id, name, desc, cat, patch, arp) {
  const arpStr = arp
    ? `, { enabled: ${arp.enabled}, mode: "${arp.mode}", bpm: ${arp.bpm}, division: "${arp.division}", octaves: ${arp.octaves}, gate: ${arp.gate} }`
    : "";
  return `  preset("${id}", "${name}", "${desc}", "${cat}", ${ser(patch)}${arpStr}),\n`;
}

function emit(label, cat, rows, withHyperspace = false) {
  let out = `\n  // ===== ${label} (20) =====\n`;
  if (withHyperspace) out += hyperspace + "\n";
  for (const row of rows) {
    out += preset(...row) + "\n";
  }
  return out;
}

const leads = [
  ["fc-lead-saw-edge", "Saw Edge Blade", "Bright mono saw with a sharp filter edge", "Lead",
    { oscATable: "saw", oscALevel: 0.78, filterType: "lowpass", filterCutoff: 4200, filterResonance: 0.45, filterEnvAmount: 0.55, ampAttack: 0.01, ampDecay: 0.25, ampSustain: 0.7, ampRelease: 0.2, mono: true, drive: 0.15 }],
  ["fc-lead-soft-silk", "Soft Silk Lead", "Gentle soft lead with slow attack", "Lead",
    { oscATable: "basic", oscALevel: 0.7, filterCutoff: 2200, ampAttack: 0.08, ampDecay: 0.4, ampSustain: 0.8, ampRelease: 0.45, chorusMix: 0.2, mono: true }],
  ["fc-lead-supersaw", "Supersaw Horizon", "Wide unison saw that fills the stereo field", "Lead",
    { oscATable: "saw", oscALevel: 0.65, oscBTable: "saw", oscBLevel: 0.45, oscBDetune: 0.12, unison: 5, unisonDetune: 0.28, unisonWidth: 0.85, filterCutoff: 3600, ampAttack: 0.02, ampDecay: 0.3, ampSustain: 0.75, ampRelease: 0.3, chorusMix: 0.25, mono: true }],
  ["fc-lead-acid-scream", "Acid Scream", "Resonant screaming acid mono lead", "Lead",
    { oscATable: "saw", oscALevel: 0.8, filterCutoff: 900, filterResonance: 0.82, filterEnvAmount: 0.9, filtAttack: 0.001, filtDecay: 0.28, filtSustain: 0.05, ampAttack: 0.001, ampDecay: 0.35, ampSustain: 0.55, ampRelease: 0.12, glide: 0.06, mono: true }],
  ["fc-lead-pulse-talk", "Pulse Talker", "Narrow pulse that chatters like a talkbox", "Lead",
    { oscATable: "pulse", oscAPos: 0.18, oscALevel: 0.75, filterCutoff: 2800, filterResonance: 0.35, ampAttack: 0.005, ampDecay: 0.22, ampSustain: 0.65, ampRelease: 0.18, lfo1Wave: "sine", lfo1Rate: 4.5, lfo1Depth: 0.35, lfo1Dest: "filter", mono: true }],
  ["fc-lead-fm-bell", "FM Bell Pierce", "Metallic FM bell lead with fast decay", "Lead",
    { oscATable: "bell", oscALevel: 0.75, oscBTable: "basic", oscBLevel: 0.5, fmAmount: 0.55, fmRatio: 3.5, filterCutoff: 5200, ampAttack: 0.001, ampDecay: 0.4, ampSustain: 0.35, ampRelease: 0.35, delayMix: 0.2, mono: true }],
  ["fc-lead-portamento", "Portamento Snake", "Gliding mono snake lead", "Lead",
    { oscATable: "saw", oscALevel: 0.72, oscBTable: "pulse", oscBLevel: 0.35, oscBPos: 0.4, filterCutoff: 2600, ampAttack: 0.03, ampDecay: 0.35, ampSustain: 0.8, ampRelease: 0.25, glide: 0.22, mono: true }],
  ["fc-lead-trance-gate", "Trance Gate Lead", "Bright gated trance stab lead", "Lead",
    { oscATable: "saw", oscALevel: 0.7, unison: 3, unisonDetune: 0.18, filterCutoff: 4800, ampAttack: 0.005, ampDecay: 0.2, ampSustain: 0.7, ampRelease: 0.15, delayTime: 0.375, delayMix: 0.22, gateOn: true, gateRate: 8, gateDepth: 0.7, mono: true }],
  ["fc-lead-vintage-nasal", "Vintage Nasal", "Narrow bandpass nasal lead with tape age", "Lead",
    { oscATable: "pulse", oscAPos: 0.35, oscALevel: 0.7, filterType: "bandpass", filterCutoff: 1400, filterResonance: 0.55, ampAttack: 0.02, ampDecay: 0.3, ampSustain: 0.7, ampRelease: 0.25, cassetteGen: 0.4, wowFlutter: 0.15, hiss: 0.12, mono: true }],
  ["fc-lead-chip-square", "Chip Square Zap", "Retro square lead with hard edges", "Lead",
    { oscATable: "pulse", oscAPos: 0.5, oscALevel: 0.8, pulseDuty: 0.5, filterCutoff: 6000, ampAttack: 0.001, ampDecay: 0.18, ampSustain: 0.55, ampRelease: 0.1, mono: true }],
  ["fc-lead-harmony-stack", "Harmony Stack Lead", "Stacked octaves that bloom on hold", "Lead",
    { oscATable: "saw", oscALevel: 0.55, oscBTable: "saw", oscBLevel: 0.5, oscBDetune: 0.08, oscCTable: "saw", oscCLevel: 0.4, oscCOctave: 1, filterCutoff: 3200, ampAttack: 0.04, ampDecay: 0.4, ampSustain: 0.85, ampRelease: 0.5, chorusMix: 0.3, reverbMix: 0.2 }],
  ["fc-lead-drive-grit", "Drive Grit Lead", "Tube-driven gritty mid lead", "Lead",
    { oscATable: "saw", oscALevel: 0.75, filterCutoff: 2400, filterResonance: 0.3, ampAttack: 0.01, ampDecay: 0.28, ampSustain: 0.7, ampRelease: 0.22, drive: 0.55, driveMode: "tube", mono: true }],
  ["fc-lead-air-whistle", "Air Whistle", "High airy whistle lead", "Lead",
    { oscATable: "basic", oscALevel: 0.65, oscAOctave: 1, filterType: "highpass", filterCutoff: 1800, ampAttack: 0.05, ampDecay: 0.35, ampSustain: 0.75, ampRelease: 0.4, airHigh: 0.4, airAmount: 0.5, reverbMix: 0.25, mono: true }],
  ["fc-lead-ring-spark", "Ring Spark Lead", "Ring-mod sparks over a saw body", "Lead",
    { oscATable: "saw", oscALevel: 0.7, ringAmount: 0.35, ringFreq: 660, filterCutoff: 3800, ampAttack: 0.005, ampDecay: 0.25, ampSustain: 0.6, ampRelease: 0.2, mono: true }],
  ["fc-lead-lfo-wobble", "LFO Wobble Lead", "Filter wobble mono lead", "Lead",
    { oscATable: "saw", oscALevel: 0.72, filterCutoff: 1800, filterResonance: 0.5, ampAttack: 0.02, ampDecay: 0.3, ampSustain: 0.75, ampRelease: 0.25, lfo1Wave: "sine", lfo1Rate: 5.5, lfo1Depth: 0.55, lfo1Dest: "filter", mono: true }],
  ["fc-lead-plucky-hook", "Plucky Hook Lead", "Short plucky lead for hooks", "Lead",
    { oscATable: "pulse", oscAPos: 0.4, oscALevel: 0.75, filterCutoff: 3400, filterEnvAmount: 0.6, filtDecay: 0.15, ampAttack: 0.001, ampDecay: 0.22, ampSustain: 0.15, ampRelease: 0.12, delayMix: 0.15, mono: true }],
  ["fc-lead-warm-analog", "Warm Analog Lead", "Detuned warm analog lead", "Lead",
    { oscATable: "saw", oscALevel: 0.68, oscBTable: "saw", oscBLevel: 0.5, oscBDetune: 0.08, filterCutoff: 2100, ampAttack: 0.03, ampDecay: 0.4, ampSustain: 0.8, ampRelease: 0.35, chorusMix: 0.18, cassetteGen: 0.2, mono: true }],
  ["fc-lead-phase-sweep", "Phase Sweep Lead", "Phaser-swept luminous lead", "Lead",
    { oscATable: "saw", oscALevel: 0.7, filterCutoff: 4000, ampAttack: 0.02, ampDecay: 0.3, ampSustain: 0.75, ampRelease: 0.3, phaserRate: 0.4, phaserDepth: 0.7, phaserMix: 0.45, mono: true }],
  ["fc-lead-oct-scream", "Octave Scream", "Dual-octave screaming lead", "Lead",
    { oscATable: "saw", oscALevel: 0.6, oscBTable: "saw", oscBLevel: 0.55, oscBOctave: 1, filterCutoff: 4500, filterResonance: 0.35, ampAttack: 0.005, ampDecay: 0.25, ampSustain: 0.7, ampRelease: 0.2, drive: 0.25, mono: true }],
  ["fc-lead-delay-echo", "Delay Echo Lead", "Sparse lead riding long echoes", "Lead",
    { oscATable: "saw", oscALevel: 0.65, filterCutoff: 3000, ampAttack: 0.02, ampDecay: 0.35, ampSustain: 0.55, ampRelease: 0.4, delayTime: 0.45, delayFeedback: 0.55, delayMix: 0.4, reverbMix: 0.2, mono: true }],
];

const plucks = [
  ["fc-pluck-nylon-snap", "Nylon Snap", "Soft nylon-like finger pluck", "Pluck",
    { oscATable: "pulse", oscAPos: 0.35, oscALevel: 0.7, filterCutoff: 2200, filterEnvAmount: 0.45, filtDecay: 0.12, ampAttack: 0.001, ampDecay: 0.28, ampSustain: 0.08, ampRelease: 0.18, reverbMix: 0.15 }],
  ["fc-pluck-steel-twang", "Steel Twang", "Bright steel string twang", "Pluck",
    { oscATable: "saw", oscALevel: 0.72, filterCutoff: 4800, filterResonance: 0.25, filterEnvAmount: 0.7, filtDecay: 0.1, ampAttack: 0.001, ampDecay: 0.22, ampSustain: 0.05, ampRelease: 0.15 }],
  ["fc-pluck-kalimba", "Kalimba Tine", "Metallic kalimba tine pluck", "Pluck",
    { oscATable: "bell", oscALevel: 0.7, oscBTable: "basic", oscBLevel: 0.25, fmAmount: 0.25, filterCutoff: 5200, ampAttack: 0.001, ampDecay: 0.45, ampSustain: 0.05, ampRelease: 0.35, reverbMix: 0.25 }],
  ["fc-pluck-harp-gliss", "Harp Gliss", "Airy harp gliss pluck", "Pluck",
    { oscATable: "basic", oscALevel: 0.65, filterCutoff: 3600, ampAttack: 0.002, ampDecay: 0.5, ampSustain: 0.1, ampRelease: 0.6, chorusMix: 0.2, reverbMix: 0.35 }],
  ["fc-pluck-muted-funk", "Muted Funk Pluck", "Muted funk guitar-style pluck", "Pluck",
    { oscATable: "pulse", oscAPos: 0.2, oscALevel: 0.75, filterCutoff: 1800, filterResonance: 0.3, ampAttack: 0.001, ampDecay: 0.12, ampSustain: 0.02, ampRelease: 0.08, punch: 0.3 }],
  ["fc-pluck-glass-tap", "Glass Tap", "Glass-tapping crystalline pluck", "Pluck",
    { oscATable: "bell", oscALevel: 0.68, filterType: "highpass", filterCutoff: 1200, ampAttack: 0.001, ampDecay: 0.35, ampSustain: 0.05, ampRelease: 0.4, delayMix: 0.2, reverbMix: 0.3 }],
  ["fc-pluck-bass-thump", "Bass Pluck Thump", "Low thumpy bass pluck", "Pluck",
    { oscATable: "basic", oscALevel: 0.8, oscAOctave: -1, subLevel: 0.35, filterCutoff: 900, ampAttack: 0.001, ampDecay: 0.25, ampSustain: 0.1, ampRelease: 0.2, mono: true, punch: 0.4 }],
  ["fc-pluck-chip-blip", "Chip Blip", "8-bit chip blip pluck", "Pluck",
    { oscATable: "pulse", oscAPos: 0.5, pulseDuty: 0.25, oscALevel: 0.75, filterCutoff: 5000, ampAttack: 0.001, ampDecay: 0.15, ampSustain: 0.05, ampRelease: 0.08 }],
  ["fc-pluck-bloom-tail", "Bloom Tail Pluck", "Pluck that blooms into a soft pad tail", "Pluck",
    { oscATable: "saw", oscALevel: 0.6, filterCutoff: 2800, ampAttack: 0.001, ampDecay: 0.4, ampSustain: 0.35, ampRelease: 0.9, reverbMix: 0.4, chorusMix: 0.25 }],
  ["fc-pluck-resonant-zap", "Resonant Zap", "Resonant filter zap pluck", "Pluck",
    { oscATable: "saw", oscALevel: 0.7, filterCutoff: 800, filterResonance: 0.75, filterEnvAmount: 0.9, filtDecay: 0.18, ampAttack: 0.001, ampDecay: 0.2, ampSustain: 0.05, ampRelease: 0.12 }],
  ["fc-pluck-marimba", "Marimba Wood", "Wooden marimba bar hit", "Pluck",
    { oscATable: "basic", oscALevel: 0.7, oscBTable: "bell", oscBLevel: 0.3, filterCutoff: 3200, ampAttack: 0.001, ampDecay: 0.35, ampSustain: 0.05, ampRelease: 0.25, reverbMix: 0.18 }],
  ["fc-pluck-delay-dots", "Delay Dot Plucks", "Sparse plucks painting delay dots", "Pluck",
    { oscATable: "pulse", oscAPos: 0.4, oscALevel: 0.65, filterCutoff: 3000, ampAttack: 0.001, ampDecay: 0.2, ampSustain: 0.05, ampRelease: 0.15, delayTime: 0.333, delayFeedback: 0.45, delayMix: 0.4 }],
  ["fc-pluck-harmonic-ping", "Harmonic Ping", "High harmonic ping pluck", "Pluck",
    { oscATable: "harmonic", oscAPos: 0.6, oscALevel: 0.65, filterCutoff: 5500, ampAttack: 0.001, ampDecay: 0.4, ampSustain: 0.08, ampRelease: 0.5, airHigh: 0.35, airAmount: 0.4 }],
  ["fc-pluck-vinyl-scratch", "Vinyl Scratch Pluck", "Lo-fi vinyl-scuffed pluck", "Pluck",
    { oscATable: "pulse", oscAPos: 0.3, oscALevel: 0.7, noiseLevel: 0.15, filterCutoff: 2000, ampAttack: 0.001, ampDecay: 0.18, ampSustain: 0.05, ampRelease: 0.12, cassetteGen: 0.5, hiss: 0.25 }],
  ["fc-pluck-formant", "Formant Pluck", "Vowel-shaped formant pluck", "Pluck",
    { oscATable: "vocal", oscAPos: 0.4, oscALevel: 0.7, filterCutoff: 2400, ampAttack: 0.001, ampDecay: 0.25, ampSustain: 0.08, ampRelease: 0.2 }],
  ["fc-pluck-wide-chorus", "Wide Chorus Pluck", "Stereo-wide chorused pluck", "Pluck",
    { oscATable: "saw", oscALevel: 0.65, unison: 3, unisonDetune: 0.15, unisonWidth: 0.8, filterCutoff: 3400, ampAttack: 0.001, ampDecay: 0.28, ampSustain: 0.1, ampRelease: 0.25, chorusMix: 0.45 }],
  ["fc-pluck-dark-thumb", "Dark Thumb", "Dark thumb-muted pluck", "Pluck",
    { oscATable: "saw", oscALevel: 0.7, filterCutoff: 900, filterResonance: 0.2, ampAttack: 0.001, ampDecay: 0.3, ampSustain: 0.1, ampRelease: 0.2 }],
  ["fc-pluck-sparkle", "Sparkle Pluck", "Air and sparkle on a short pluck", "Pluck",
    { oscATable: "bell", oscALevel: 0.55, oscBTable: "pulse", oscBLevel: 0.4, filterCutoff: 6000, ampAttack: 0.001, ampDecay: 0.22, ampSustain: 0.05, ampRelease: 0.3, airHigh: 0.5, airAmount: 0.55, reverbMix: 0.28 }],
  ["fc-pluck-sync-snap", "Sync Snap", "Hard-sync snap pluck", "Pluck",
    { oscATable: "saw", oscALevel: 0.72, oscBTable: "saw", oscBLevel: 0.4, oscBOctave: 1, filterCutoff: 3800, filterEnvAmount: 0.5, ampAttack: 0.001, ampDecay: 0.18, ampSustain: 0.05, ampRelease: 0.12 }],
  ["fc-pluck-warm-decay", "Warm Decay Pluck", "Warm long-decay finger pluck", "Pluck",
    { oscATable: "basic", oscALevel: 0.7, filterCutoff: 1800, ampAttack: 0.001, ampDecay: 0.55, ampSustain: 0.12, ampRelease: 0.45, chorusMix: 0.15, reverbMix: 0.2 }],
];

const pads = [
  ["fc-pad-cloud-drift", "Cloud Drift", "Slow drifting cloud pad", "Pad",
    { oscATable: "saw", oscALevel: 0.6, oscBTable: "pulse", oscBPos: 0.4, oscBLevel: 0.45, oscBDetune: 0.1, filterCutoff: 2400, ampAttack: 0.8, ampDecay: 0.6, ampSustain: 0.9, ampRelease: 1.5, unison: 3, unisonDetune: 0.15, chorusMix: 0.35, reverbMix: 0.45 }],
  ["fc-pad-glass-choir", "Glass Choir", "Glass-choir shimmer pad", "Pad",
    { oscATable: "harmonic", oscAPos: 0.45, oscALevel: 0.55, oscBTable: "bell", oscBLevel: 0.35, filterCutoff: 4200, ampAttack: 0.7, ampDecay: 0.5, ampSustain: 0.95, ampRelease: 1.8, chorusMix: 0.3, reverbMix: 0.5, airHigh: 0.3, airAmount: 0.35 }],
  ["fc-pad-dark-ocean", "Dark Ocean", "Deep dark ocean pad", "Pad",
    { oscATable: "saw", oscALevel: 0.65, oscBTable: "saw", oscBLevel: 0.4, oscBOctave: -1, filterCutoff: 900, ampAttack: 1.0, ampDecay: 0.8, ampSustain: 0.95, ampRelease: 2.0, reverbSize: 4.5, reverbMix: 0.5 }],
  ["fc-pad-warm-analog", "Warm Analog Wash", "Classic warm analog wash", "Pad",
    { oscATable: "saw", oscALevel: 0.65, oscBTable: "saw", oscBLevel: 0.55, oscBDetune: 0.08, filterCutoff: 2000, ampAttack: 0.6, ampDecay: 0.5, ampSustain: 0.9, ampRelease: 1.2, unison: 4, unisonDetune: 0.2, chorusMix: 0.4, cassetteGen: 0.15 }],
  ["fc-pad-vocal-aah", "Vocal Aah", "Soft vocal aah pad", "Pad",
    { oscATable: "vocal", oscAPos: 0.35, oscALevel: 0.7, oscBTable: "vocal", oscBPos: 0.55, oscBLevel: 0.4, oscBDetune: 0.06, filterCutoff: 2600, ampAttack: 0.5, ampDecay: 0.5, ampSustain: 0.9, ampRelease: 1.3, reverbMix: 0.4 }],
  ["fc-pad-shimmer-ice", "Shimmer Ice", "Icy shimmer pad with air", "Pad",
    { oscATable: "bell", oscALevel: 0.45, oscBTable: "harmonic", oscBLevel: 0.5, filterType: "highpass", filterCutoff: 800, ampAttack: 0.9, ampDecay: 0.6, ampSustain: 0.95, ampRelease: 2.2, reverbMix: 0.55, chorusMix: 0.35, airHigh: 0.55, airAmount: 0.5 }],
  ["fc-pad-pulse-breath", "Pulse Breath", "Breathing pulse-width pad", "Pad",
    { oscATable: "pulse", oscAPos: 0.4, oscALevel: 0.65, filterCutoff: 2800, ampAttack: 0.7, ampDecay: 0.5, ampSustain: 0.9, ampRelease: 1.4, lfo1Wave: "sine", lfo1Rate: 0.2, lfo1Depth: 0.4, lfo1Dest: "filter", chorusMix: 0.25, reverbMix: 0.35 }],
  ["fc-pad-fm-glisten", "FM Glisten", "FM-glistening metallic pad", "Pad",
    { oscATable: "basic", oscALevel: 0.55, oscBTable: "bell", oscBLevel: 0.45, fmAmount: 0.35, fmRatio: 2.0, filterCutoff: 3600, ampAttack: 0.8, ampDecay: 0.6, ampSustain: 0.9, ampRelease: 1.6, reverbMix: 0.45 }],
  ["fc-pad-lofi-tape", "Lo-Fi Tape Pad", "Warbly tape-saturated pad", "Pad",
    { oscATable: "saw", oscALevel: 0.6, filterCutoff: 1800, ampAttack: 0.7, ampDecay: 0.5, ampSustain: 0.9, ampRelease: 1.3, cassetteGen: 0.55, wowFlutter: 0.35, hiss: 0.2, chorusMix: 0.2, reverbMix: 0.3 }],
  ["fc-pad-wide-horizon", "Wide Horizon", "Ultra-wide stereo horizon pad", "Pad",
    { oscATable: "saw", oscALevel: 0.55, oscBTable: "pulse", oscBLevel: 0.45, unison: 5, unisonDetune: 0.25, unisonWidth: 0.95, filterCutoff: 3200, ampAttack: 0.6, ampDecay: 0.5, ampSustain: 0.9, ampRelease: 1.5, stereoWidth: 1.3, chorusMix: 0.35, reverbMix: 0.4 }],
  ["fc-pad-drone-hum", "Drone Hum", "Endless low drone hum", "Pad",
    { oscATable: "basic", oscALevel: 0.7, oscBTable: "saw", oscBLevel: 0.35, oscBOctave: -1, subLevel: 0.3, filterCutoff: 700, ampAttack: 1.2, ampDecay: 0.8, ampSustain: 1, ampRelease: 2.5, reverbMix: 0.35 }],
  ["fc-pad-phase-mist", "Phase Mist", "Phased misty pad", "Pad",
    { oscATable: "saw", oscALevel: 0.6, filterCutoff: 2500, ampAttack: 0.75, ampDecay: 0.5, ampSustain: 0.9, ampRelease: 1.5, phaserRate: 0.15, phaserDepth: 0.65, phaserMix: 0.5, reverbMix: 0.4 }],
  ["fc-pad-night-glow", "Night Glow", "Soft nightglow neon pad", "Pad",
    { oscATable: "saw", oscALevel: 0.6, oscBTable: "harmonic", oscBLevel: 0.35, filterCutoff: 2100, ampAttack: 0.9, ampDecay: 0.6, ampSustain: 0.95, ampRelease: 1.8, delayMix: 0.2, reverbMix: 0.45, chorusMix: 0.3 }],
  ["fc-pad-formant-swarm", "Formant Swarm", "Swarming formant voices", "Pad",
    { oscATable: "vocal", oscALevel: 0.55, oscBTable: "vocal", oscBPos: 0.6, oscBLevel: 0.5, oscBDetune: 0.12, unison: 3, unisonDetune: 0.2, filterCutoff: 2200, ampAttack: 0.65, ampDecay: 0.5, ampSustain: 0.9, ampRelease: 1.4, reverbMix: 0.4 }],
  ["fc-pad-crystal-bed", "Crystal Bed", "Crystal bed under chords", "Pad",
    { oscATable: "bell", oscALevel: 0.5, oscBTable: "harmonic", oscBLevel: 0.45, filterCutoff: 4800, ampAttack: 0.5, ampDecay: 0.6, ampSustain: 0.85, ampRelease: 1.6, reverbMix: 0.5, delayMix: 0.18 }],
  ["fc-pad-muted-cinema", "Muted Cinema", "Muted cinematic underscore pad", "Pad",
    { oscATable: "saw", oscALevel: 0.55, filterCutoff: 1200, ampAttack: 1.0, ampDecay: 0.7, ampSustain: 0.95, ampRelease: 2.0, reverbSize: 5, reverbMix: 0.55, stereoWidth: 1.15 }],
  ["fc-pad-lfo-swell", "LFO Swell Pad", "Slow LFO-swelling pad", "Pad",
    { oscATable: "saw", oscALevel: 0.6, filterCutoff: 2000, ampAttack: 0.4, ampDecay: 0.5, ampSustain: 0.9, ampRelease: 1.4, lfo1Wave: "sine", lfo1Rate: 0.12, lfo1Depth: 0.5, lfo1Dest: "filter", chorusMix: 0.3, reverbMix: 0.4 }],
  ["fc-pad-hollow-pipe", "Hollow Pipe Pad", "Hollow pipe organ pad", "Pad",
    { oscATable: "pulse", oscAPos: 0.5, oscALevel: 0.55, oscBTable: "pulse", oscBPos: 0.25, oscBLevel: 0.4, oscBOctave: 1, filterCutoff: 2800, ampAttack: 0.35, ampDecay: 0.4, ampSustain: 0.9, ampRelease: 0.9, reverbMix: 0.3 }],
  ["fc-pad-spectral-veil", "Spectral Veil", "Spectral freeze veil pad", "Pad",
    { oscATable: "harmonic", oscALevel: 0.55, oscBTable: "metallic", oscBLevel: 0.35, filterCutoff: 2600, ampAttack: 0.8, ampDecay: 0.6, ampSustain: 1, ampRelease: 2.0, spectralMode: "freeze", spectralAmount: 0.55, spectralMix: 0.5, reverbMix: 0.4 }],
];

const keys = [
  ["fc-keys-electric-bell", "Electric Bell Keys", "Electric piano with bell sheen", "Keys",
    { oscATable: "bell", oscALevel: 0.55, oscBTable: "basic", oscBLevel: 0.55, filterCutoff: 3200, ampAttack: 0.002, ampDecay: 0.8, ampSustain: 0.35, ampRelease: 0.6, chorusMix: 0.25, reverbMix: 0.2 }],
  ["fc-keys-soft-rhodes", "Soft Rhodes", "Soft Rhodes-style keys", "Keys",
    { oscATable: "basic", oscALevel: 0.7, oscBTable: "bell", oscBLevel: 0.25, filterCutoff: 2400, ampAttack: 0.005, ampDecay: 1.0, ampSustain: 0.4, ampRelease: 0.7, chorusMix: 0.35, cassetteGen: 0.1 }],
  ["fc-keys-bright-clav", "Bright Clav", "Bright clavinet bite", "Keys",
    { oscATable: "pulse", oscAPos: 0.2, oscALevel: 0.75, filterCutoff: 4500, filterResonance: 0.3, ampAttack: 0.001, ampDecay: 0.25, ampSustain: 0.15, ampRelease: 0.15, drive: 0.2 }],
  ["fc-keys-organ-drawbar", "Organ Drawbar", "Drawbar organ swell", "Keys",
    { oscATable: "pulse", oscAPos: 0.5, oscALevel: 0.5, oscBTable: "pulse", oscBPos: 0.25, oscBLevel: 0.4, oscBOctave: 1, oscCTable: "basic", oscCLevel: 0.3, oscCOctave: 2, filterCutoff: 4000, ampAttack: 0.01, ampDecay: 0.2, ampSustain: 0.9, ampRelease: 0.15, chorusMix: 0.2 }],
  ["fc-keys-mellow-piano", "Mellow Piano", "Mellow soft piano keys", "Keys",
    { oscATable: "basic", oscALevel: 0.7, filterCutoff: 2800, ampAttack: 0.002, ampDecay: 0.9, ampSustain: 0.25, ampRelease: 0.5, reverbMix: 0.25 }],
  ["fc-keys-harpsi", "Harpsi Pluck Keys", "Harpsichord-like keyed pluck", "Keys",
    { oscATable: "pulse", oscAPos: 0.4, oscALevel: 0.7, filterCutoff: 5000, ampAttack: 0.001, ampDecay: 0.35, ampSustain: 0.1, ampRelease: 0.25 }],
  ["fc-keys-wurli-bark", "Wurli Bark", "Barky Wurlitzer keys", "Keys",
    { oscATable: "saw", oscALevel: 0.65, oscBTable: "pulse", oscBPos: 0.3, oscBLevel: 0.4, filterCutoff: 2200, filterResonance: 0.35, ampAttack: 0.002, ampDecay: 0.7, ampSustain: 0.3, ampRelease: 0.4, drive: 0.3, driveMode: "tube" }],
  ["fc-keys-glass-mallet", "Glass Mallet", "Glass mallet keyboard", "Keys",
    { oscATable: "bell", oscALevel: 0.7, filterCutoff: 5600, ampAttack: 0.001, ampDecay: 0.6, ampSustain: 0.15, ampRelease: 0.7, reverbMix: 0.35, delayMix: 0.15 }],
  ["fc-keys-lofi", "Lo-Fi Keys", "Dusty lo-fi keyboard", "Keys",
    { oscATable: "basic", oscALevel: 0.65, filterCutoff: 1800, ampAttack: 0.005, ampDecay: 0.8, ampSustain: 0.3, ampRelease: 0.5, cassetteGen: 0.45, wowFlutter: 0.25, hiss: 0.2, chorusMix: 0.2 }],
  ["fc-keys-bright-ep", "Bright EP Sparkle", "Bright sparkly electric piano", "Keys",
    { oscATable: "bell", oscALevel: 0.45, oscBTable: "basic", oscBLevel: 0.6, filterCutoff: 4200, ampAttack: 0.002, ampDecay: 0.7, ampSustain: 0.3, ampRelease: 0.55, chorusMix: 0.3, airHigh: 0.3, airAmount: 0.35 }],
  ["fc-keys-pad-bloom", "Pad Keys Bloom", "Keys that bloom into a pad", "Keys",
    { oscATable: "saw", oscALevel: 0.55, oscBTable: "basic", oscBLevel: 0.4, filterCutoff: 2600, ampAttack: 0.05, ampDecay: 0.6, ampSustain: 0.7, ampRelease: 1.2, chorusMix: 0.3, reverbMix: 0.4 }],
  ["fc-keys-fm-ep", "FM Electric Piano", "Classic FM electric piano", "Keys",
    { oscATable: "basic", oscALevel: 0.7, oscBTable: "basic", oscBLevel: 0.5, fmAmount: 0.4, fmRatio: 1.0, filterCutoff: 3600, ampAttack: 0.002, ampDecay: 0.9, ampSustain: 0.25, ampRelease: 0.55, chorusMix: 0.25 }],
  ["fc-keys-church-pipe", "Church Pipe", "Church pipe organ keys", "Keys",
    { oscATable: "pulse", oscAPos: 0.5, oscALevel: 0.5, oscBTable: "saw", oscBLevel: 0.35, oscBOctave: 1, filterCutoff: 3000, ampAttack: 0.08, ampDecay: 0.3, ampSustain: 0.95, ampRelease: 0.4, reverbSize: 4, reverbMix: 0.45 }],
  ["fc-keys-toy-piano", "Toy Piano", "Tiny toy piano keys", "Keys",
    { oscATable: "bell", oscALevel: 0.65, oscAOctave: 1, filterCutoff: 4800, ampAttack: 0.001, ampDecay: 0.35, ampSustain: 0.1, ampRelease: 0.3, reverbMix: 0.2 }],
  ["fc-keys-muted-jazz", "Muted Jazz Keys", "Muted jazz-comp keys", "Keys",
    { oscATable: "basic", oscALevel: 0.7, filterCutoff: 1600, ampAttack: 0.003, ampDecay: 0.6, ampSustain: 0.35, ampRelease: 0.4, chorusMix: 0.15 }],
  ["fc-keys-celesta", "Celesta Twinkle", "Celesta twinkle keys", "Keys",
    { oscATable: "bell", oscALevel: 0.7, oscAOctave: 1, filterCutoff: 6000, ampAttack: 0.001, ampDecay: 0.7, ampSustain: 0.1, ampRelease: 0.8, reverbMix: 0.4 }],
  ["fc-keys-house-stab", "House Stab Keys", "Classic house chord stab", "Keys",
    { oscATable: "saw", oscALevel: 0.65, oscBTable: "saw", oscBLevel: 0.45, oscBDetune: 0.05, filterCutoff: 3800, filterEnvAmount: 0.4, filtDecay: 0.25, ampAttack: 0.001, ampDecay: 0.35, ampSustain: 0.4, ampRelease: 0.25, delayMix: 0.15 }],
  ["fc-keys-warm-comp", "Warm Comp Keys", "Warm companion keys for ballads", "Keys",
    { oscATable: "saw", oscALevel: 0.6, oscBTable: "basic", oscBLevel: 0.4, filterCutoff: 2000, ampAttack: 0.01, ampDecay: 0.7, ampSustain: 0.5, ampRelease: 0.6, chorusMix: 0.2, reverbMix: 0.25 }],
  ["fc-keys-percussive", "Percussive Keys", "Percussive short key hits", "Keys",
    { oscATable: "pulse", oscAPos: 0.35, oscALevel: 0.75, filterCutoff: 3400, ampAttack: 0.001, ampDecay: 0.18, ampSustain: 0.05, ampRelease: 0.12, punch: 0.35 }],
  ["fc-keys-dream-ep", "Dream EP", "Dreamy washed electric piano", "Keys",
    { oscATable: "bell", oscALevel: 0.5, oscBTable: "basic", oscBLevel: 0.5, filterCutoff: 2800, ampAttack: 0.01, ampDecay: 1.0, ampSustain: 0.45, ampRelease: 1.0, chorusMix: 0.4, reverbMix: 0.45, delayMix: 0.2 }],
];

const arpCfg = (mode, bpm, division, octaves, gate) => ({ enabled: true, mode, bpm, division, octaves, gate });

const arps = [
  ["fc-arp-crystal-up", "Crystal Up Arp", "Bright crystal ascending arp", "Arp",
    { oscATable: "bell", oscALevel: 0.65, filterCutoff: 5200, ampAttack: 0.001, ampDecay: 0.2, ampSustain: 0.15, ampRelease: 0.15, delayMix: 0.25, reverbMix: 0.2 }, arpCfg("up", 128, "1/16", 2, 0.65)],
  ["fc-arp-saw-cascade", "Saw Cascade", "Cascading saw arp waterfall", "Arp",
    { oscATable: "saw", oscALevel: 0.7, filterCutoff: 3600, filterEnvAmount: 0.4, ampAttack: 0.001, ampDecay: 0.18, ampSustain: 0.2, ampRelease: 0.12, delayMix: 0.2 }, arpCfg("updown", 120, "1/16", 3, 0.55)],
  ["fc-arp-pluck-rain", "Pluck Rain", "Raindrop pluck arp", "Arp",
    { oscATable: "pulse", oscAPos: 0.4, oscALevel: 0.65, filterCutoff: 3000, ampAttack: 0.001, ampDecay: 0.22, ampSustain: 0.08, ampRelease: 0.18, reverbMix: 0.3 }, arpCfg("random", 110, "1/16", 2, 0.5)],
  ["fc-arp-trance-drive", "Trance Drive Arp", "Driving trance arp", "Arp",
    { oscATable: "saw", oscALevel: 0.7, unison: 3, unisonDetune: 0.15, filterCutoff: 4200, ampAttack: 0.001, ampDecay: 0.15, ampSustain: 0.25, ampRelease: 0.1, delayTime: 0.375, delayMix: 0.28 }, arpCfg("up", 138, "1/16", 2, 0.7)],
  ["fc-arp-chip-run", "Chip Run", "Fast chip-tune run", "Arp",
    { oscATable: "pulse", oscAPos: 0.5, pulseDuty: 0.5, oscALevel: 0.75, filterCutoff: 5500, ampAttack: 0.001, ampDecay: 0.12, ampSustain: 0.15, ampRelease: 0.08 }, arpCfg("up", 150, "1/32", 3, 0.8)],
  ["fc-arp-soft-lullaby", "Soft Lullaby Arp", "Soft lullaby rolling arp", "Arp",
    { oscATable: "basic", oscALevel: 0.6, filterCutoff: 2200, ampAttack: 0.01, ampDecay: 0.3, ampSustain: 0.3, ampRelease: 0.35, chorusMix: 0.25, reverbMix: 0.35 }, arpCfg("updown", 90, "1/8", 2, 0.7)],
  ["fc-arp-acid-steps", "Acid Steps", "Acid filter-step arp", "Arp",
    { oscATable: "saw", oscALevel: 0.75, filterCutoff: 700, filterResonance: 0.78, filterEnvAmount: 0.85, filtDecay: 0.2, ampAttack: 0.001, ampDecay: 0.2, ampSustain: 0.4, ampRelease: 0.1, mono: true }, arpCfg("up", 125, "1/16", 1, 0.6)],
  ["fc-arp-glass-ladder", "Glass Ladder", "Glass ladder ascending arp", "Arp",
    { oscATable: "bell", oscALevel: 0.6, oscBTable: "harmonic", oscBLevel: 0.35, filterCutoff: 4800, ampAttack: 0.001, ampDecay: 0.25, ampSustain: 0.15, ampRelease: 0.3, reverbMix: 0.35 }, arpCfg("up", 100, "1/8", 3, 0.55)],
  ["fc-arp-pulse-machine", "Pulse Machine", "Mechanical pulse arp", "Arp",
    { oscATable: "pulse", oscAPos: 0.25, oscALevel: 0.7, filterCutoff: 2800, ampAttack: 0.001, ampDecay: 0.15, ampSustain: 0.2, ampRelease: 0.1, punch: 0.25 }, arpCfg("down", 130, "1/16", 2, 0.75)],
  ["fc-arp-echo-garden", "Echo Garden", "Garden of delayed arp echoes", "Arp",
    { oscATable: "saw", oscALevel: 0.55, filterCutoff: 3200, ampAttack: 0.005, ampDecay: 0.25, ampSustain: 0.2, ampRelease: 0.4, delayTime: 0.5, delayFeedback: 0.55, delayMix: 0.45, reverbMix: 0.3 }, arpCfg("updown", 105, "1/8", 2, 0.5)],
  ["fc-arp-bass-gallop", "Bass Gallop Arp", "Galloping bass arp", "Arp",
    { oscATable: "saw", oscALevel: 0.75, oscAOctave: -1, subLevel: 0.3, filterCutoff: 1200, ampAttack: 0.001, ampDecay: 0.18, ampSustain: 0.25, ampRelease: 0.1, mono: true }, arpCfg("up", 128, "1/16", 1, 0.55)],
  ["fc-arp-vocal-chatter", "Vocal Chatter Arp", "Chattering vocal formant arp", "Arp",
    { oscATable: "vocal", oscAPos: 0.4, oscALevel: 0.65, filterCutoff: 2400, ampAttack: 0.001, ampDecay: 0.2, ampSustain: 0.2, ampRelease: 0.15 }, arpCfg("random", 115, "1/16", 2, 0.6)],
  ["fc-arp-wide-sparkle", "Wide Sparkle Arp", "Wide sparkling unison arp", "Arp",
    { oscATable: "saw", oscALevel: 0.55, unison: 4, unisonDetune: 0.2, unisonWidth: 0.85, filterCutoff: 4000, ampAttack: 0.001, ampDecay: 0.2, ampSustain: 0.2, ampRelease: 0.15, chorusMix: 0.3, reverbMix: 0.25 }, arpCfg("up", 120, "1/16", 2, 0.65)],
  ["fc-arp-lofi-steps", "Lo-Fi Steps", "Wobbly lo-fi arp steps", "Arp",
    { oscATable: "pulse", oscAPos: 0.35, oscALevel: 0.65, filterCutoff: 2000, ampAttack: 0.002, ampDecay: 0.22, ampSustain: 0.2, ampRelease: 0.18, cassetteGen: 0.4, wowFlutter: 0.3, hiss: 0.15 }, arpCfg("updown", 95, "1/8", 2, 0.6)],
  ["fc-arp-fm-bells", "FM Bell Arp", "FM bell cascading arp", "Arp",
    { oscATable: "bell", oscALevel: 0.6, oscBTable: "basic", oscBLevel: 0.45, fmAmount: 0.45, fmRatio: 3, filterCutoff: 5000, ampAttack: 0.001, ampDecay: 0.3, ampSustain: 0.15, ampRelease: 0.25, reverbMix: 0.3 }, arpCfg("up", 110, "1/16", 2, 0.55)],
  ["fc-arp-dark-crawl", "Dark Crawl Arp", "Dark crawling low arp", "Arp",
    { oscATable: "saw", oscALevel: 0.7, filterCutoff: 800, filterResonance: 0.4, ampAttack: 0.005, ampDecay: 0.25, ampSustain: 0.3, ampRelease: 0.2 }, arpCfg("down", 100, "1/8", 2, 0.7)],
  ["fc-arp-staccato-laser", "Staccato Laser", "Staccato laser zap arp", "Arp",
    { oscATable: "saw", oscALevel: 0.7, filterCutoff: 4500, filterEnvAmount: 0.6, filtDecay: 0.08, ampAttack: 0.001, ampDecay: 0.1, ampSustain: 0.05, ampRelease: 0.08 }, arpCfg("up", 140, "1/16", 2, 0.4)],
  ["fc-arp-warm-circle", "Warm Circle Arp", "Warm circling arp", "Arp",
    { oscATable: "basic", oscALevel: 0.65, oscBTable: "saw", oscBLevel: 0.35, oscBDetune: 0.05, filterCutoff: 2400, ampAttack: 0.01, ampDecay: 0.3, ampSustain: 0.35, ampRelease: 0.3, chorusMix: 0.2, reverbMix: 0.25 }, arpCfg("updown", 108, "1/8", 2, 0.7)],
  ["fc-arp-noise-sparkle", "Noise Sparkle Arp", "Noise-kissed sparkle arp", "Arp",
    { oscATable: "bell", oscALevel: 0.5, noiseLevel: 0.2, filterType: "highpass", filterCutoff: 2000, ampAttack: 0.001, ampDecay: 0.2, ampSustain: 0.1, ampRelease: 0.2, reverbMix: 0.3 }, arpCfg("random", 120, "1/16", 2, 0.5)],
  ["fc-arp-octave-bounce", "Octave Bounce", "Octave-bouncing playful arp", "Arp",
    { oscATable: "pulse", oscAPos: 0.5, oscALevel: 0.7, filterCutoff: 3400, ampAttack: 0.001, ampDecay: 0.18, ampSustain: 0.2, ampRelease: 0.12 }, arpCfg("updown", 125, "1/16", 3, 0.65)],
];

// Remaining categories loaded from sibling data to keep this file smaller — inline compact
import { fxs, atmos, vintage, chips, fms } from "./_preset_rest_data.mjs";

let body = "";
body += emit("LEAD", "Lead", leads);
body += emit("PLUCK", "Pluck", plucks);
body += emit("PAD", "Pad", pads, true);
body += emit("KEYS", "Keys", keys);
body += emit("ARP", "Arp", arps);
body += emit("FX", "FX", fxs);
body += emit("ATMOS", "Atmos", atmos);
body += emit("VINTAGE", "Vintage", vintage);
body += emit("CHIP", "Chip", chips);
body += emit("FM", "FM", fms);

const out = header + body + "];\n";
fs.writeFileSync(path, out);
const n = (out.match(/preset\(/g) || []).length;
console.log("Wrote presets:", n, "lines:", out.split("\n").length);
