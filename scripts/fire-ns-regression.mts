/**
 * Smoke / regression checks for Fire Command NS preset isolation + gain staging.
 * Run: npx --yes tsx scripts/fire-ns-regression.mts
 */
import {
  cloneFirePatch,
  DEFAULT_FIRE_PATCH,
  morphFrameGains,
  unisonLevelNorm,
  filterResoCompGain,
  boundCrossFm,
  makeFbDriveCurve,
  CROSS_FM_LOOP_MAX,
} from "../src/audio/dsp/FireCommandSynth.ts";
import {
  normalizeSpectrum,
  spectrumRms,
  spectrumPeak,
  WT_TARGET_RMS,
  WT_PEAK_CEIL,
} from "../src/audio/dsp/wavetables.ts";
import { applyLoudnessSafety, applyNsSafety } from "../src/lib/fireModuleLocks.ts";
import { remasterResonance } from "../src/audio/dsp/firePresetRemaster.ts";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    failed++;
    console.error("FAIL:", msg);
  } else {
    console.log("ok:", msg);
  }
}

// ── Deep clone isolation (NS → load another preset contamination class) ──
const shared = cloneFirePatch({
  ...DEFAULT_FIRE_PATCH,
  oscALevel: 0.8,
  moduleEnable: { noise: false },
  gatePattern: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0],
  chordIntervals: [0, 4, 7],
});
const a = cloneFirePatch(shared);
const b = cloneFirePatch(shared);
assert(a !== b, "cloneFirePatch returns distinct objects");
assert(a.moduleEnable !== b.moduleEnable, "moduleEnable not shared");
assert(a.modMatrix !== b.modMatrix, "modMatrix not shared");
assert(a.gatePattern !== b.gatePattern, "gatePattern not shared");
assert(a.chordIntervals !== b.chordIntervals, "chordIntervals not shared");
assert(a.fmVectorCorners !== b.fmVectorCorners, "fmVectorCorners not shared");
assert(a.fmVectorCorners[0] !== b.fmVectorCorners[0], "fm corner objects not shared");
assert(a.fmVectorCorners[0]!.levels !== b.fmVectorCorners[0]!.levels, "fm corner levels not shared");
assert(a.modEnvPoints !== b.modEnvPoints, "modEnvPoints not shared");
assert(a.scaleFollowers !== b.scaleFollowers, "scaleFollowers not shared");

a.moduleEnable!["filter"] = false;
a.gatePattern[0] = 0;
a.chordIntervals[1] = 99;
a.fmVectorCorners[0]!.levels[0] = 0.11;
assert(b.moduleEnable!["filter"] !== false, "mutating clone A moduleEnable does not affect B");
assert(b.gatePattern[0] === 1, "mutating clone A gatePattern does not affect B");
assert(b.chordIntervals[1] === 4, "mutating clone A chordIntervals does not affect B");
assert(b.fmVectorCorners[0]!.levels[0] === 1, "mutating clone A fm corners does not affect B");
assert(DEFAULT_FIRE_PATCH.chordIntervals[1] === 4, "DEFAULT chordIntervals untouched");
assert(DEFAULT_FIRE_PATCH.fmVectorCorners[0]!.levels[0] === 1, "DEFAULT fm corners untouched");

// Simulate accept-NS-offspring then load another preset
const parent = cloneFirePatch(DEFAULT_FIRE_PATCH);
const offspring = structuredClone(parent) as typeof parent;
offspring.warpMode = "scramble";
offspring.filterModel = "ladder";
offspring.filterResonance = 14;
offspring.fmVectorCorners[0]!.feedback = 0.8;
const presetB = cloneFirePatch({
  ...DEFAULT_FIRE_PATCH,
  oscATable: "saw",
  filterModel: "biquad",
  warpMode: "classic",
});
assert(offspring.fmVectorCorners !== presetB.fmVectorCorners, "NS offspring vs preset B nests differ");
assert(offspring.fmVectorCorners !== parent.fmVectorCorners, "structuredClone offspring nests differ from parent");
offspring.moduleEnable!["noise"] = false;
assert(presetB.moduleEnable?.["noise"] !== false, "preset B immune to NS moduleEnable edits");
assert(parent.moduleEnable?.["noise"] !== false, "parent immune to NS moduleEnable edits");

// ── Morph gains ───────────────────────────────────────────────────────
const mid = morphFrameGains(0.5);
assert(Math.abs(mid.g0 + mid.g1 - 1) < 1e-9, "morph gains sum to 1 at mid");
assert(mid.g0 <= 1 && mid.g1 <= 1, "morph gains individually ≤ 1");
assert(morphFrameGains(0).g0 === 1 && morphFrameGains(0).g1 === 0, "morph gains at frac 0");
assert(morphFrameGains(1).g0 === 0 && morphFrameGains(1).g1 === 1, "morph gains at frac 1");

// ── Unison norm ───────────────────────────────────────────────────────
assert(Math.abs(unisonLevelNorm(4, "locked") - 0.25) < 1e-9, "coherent locked unison uses 1/N");
assert(Math.abs(unisonLevelNorm(4, "random") - 0.5) < 1e-9, "random unison uses 1/√N");
assert(unisonLevelNorm(7, "locked") < unisonLevelNorm(7, "even"), "coherent locked quieter than even at same count");
assert(
  unisonLevelNorm(7, "locked", 20) > unisonLevelNorm(7, "locked", 0),
  "detuned locked stack regains body vs coherent",
);
assert(
  Math.abs(unisonLevelNorm(7, "locked", 20) - 1 / Math.sqrt(7)) < 1e-9,
  "well-detuned locked → 1/√N body",
);

// ── Filter reso compensation ──────────────────────────────────────────
assert(filterResoCompGain(0.707) === 1, "no trim at Butterworth Q");
assert(filterResoCompGain(14) < 0.6, "high Q gets meaningful input trim");
assert(filterResoCompGain(14) > 0.35, "high Q trim does not mute the filter");

// ── Spectrum normalization: constant loudness + true-peak ceiling ─────
// Pure sine is not peak-limited → hits the loudness target exactly.
const sine = new Float32Array(65);
sine[1] = 1;
normalizeSpectrum(sine);
assert(Math.abs(spectrumRms(sine) - WT_TARGET_RMS) < 1e-6, `sine RMS hits loudness target (got ${spectrumRms(sine).toFixed(3)})`);

// Bright saw: loudness at/under target, true peak bounded near the ceiling.
const saw = new Float32Array(65);
for (let n = 1; n < saw.length; n++) saw[n] = 1 / n;
normalizeSpectrum(saw);
assert(spectrumRms(saw) <= WT_TARGET_RMS + 1e-6, `saw RMS at/under target (got ${spectrumRms(saw).toFixed(3)})`);
assert(spectrumPeak(saw) <= WT_PEAK_CEIL + 0.12, `saw true peak bounded (got ${spectrumPeak(saw).toFixed(3)})`);

// Very spiky spectrum (all-ones) must be crest-limited: peak bounded, RMS below target.
const spiky = new Float32Array(65);
for (let n = 1; n < spiky.length; n++) spiky[n] = 1;
normalizeSpectrum(spiky);
assert(spectrumPeak(spiky) <= WT_PEAK_CEIL + 0.12, `spiky spectrum peak-limited (got ${spectrumPeak(spiky).toFixed(3)})`);
assert(spectrumRms(spiky) < WT_TARGET_RMS, `spiky spectrum sits below loudness target (got ${spectrumRms(spiky).toFixed(3)})`);

// ── Cross-FM round trip must stay bounded ─────────────────────────────
// Both directions live is a real graph cycle; an unbounded round-trip index
// self-oscillates into broadband hash.
const f0 = 220;
const loopIndex = (pair: [number, number]) => (pair[0] / f0) * (pair[1] / f0);
const oneWay = boundCrossFm(40 * f0, 0, f0);
assert(oneWay[0] === 40 * f0, "single-direction cross FM is untouched");
const mild = boundCrossFm(1.5 * f0, 2 * f0, f0);
assert(loopIndex(mild) === 3, "mild bidirectional cross FM is untouched");
const wild = boundCrossFm(8 * f0, 8 * f0, f0);
assert(loopIndex(wild) <= CROSS_FM_LOOP_MAX + 1e-6, `wild bidirectional cross FM bounded (got ${loopIndex(wild).toFixed(2)})`);
assert(
  Math.abs(wild[0] / wild[1] - 1) < 1e-6,
  "cross FM bound preserves the balance between directions",
);

// ── Delay feedback saturator: unity small-signal slope, never expanding ──
for (const drive of [0.1, 0.5, 1]) {
  const curve = makeFbDriveCurve(drive);
  // Slope across the two samples straddling zero.
  const last = curve.length - 1;
  const i0 = Math.floor(last / 2);
  const xAt = (i: number) => (i / last) * 2 - 1;
  const slope = (curve[i0 + 1]! - curve[i0]!) / (xAt(i0 + 1) - xAt(i0));
  assert(Math.abs(slope - 1) < 0.02, `fb saturator slope ≈ 1 at drive ${drive} (got ${slope.toFixed(3)})`);
  let expanding = false;
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1;
    if (Math.abs(curve[i]!) > Math.abs(x) + 1e-6) expanding = true;
  }
  assert(!expanding, `fb saturator never expands at drive ${drive} (loop stays stable)`);
}

// ── Loudness safety ───────────────────────────────────────────────────
const hot = cloneFirePatch({
  ...DEFAULT_FIRE_PATCH,
  filterResonance: 16,
  filterDrive: 0.95,
  noiseLevel: 0.9,
  drive: 0.9,
});
applyLoudnessSafety(hot);
assert((hot.filterResonance ?? 0) <= 14, "loudness safety caps Q ≤ 14");
assert((hot.filterDrive ?? 0) <= 0.8, "loudness safety caps filter drive");
assert((hot.noiseLevel ?? 0) <= 0.5, "loudness safety caps noise");

// ── NS safety allows more bite than Armory ────────────────────────────
const nsHot = cloneFirePatch({
  ...DEFAULT_FIRE_PATCH,
  filterResonance: 18,
  fmAmount: 0.95,
  drive: 0.95,
});
applyNsSafety(nsHot);
assert((nsHot.filterResonance ?? 0) <= 16, "NS safety caps Q ≤ 16");
assert((nsHot.fmAmount ?? 0) <= 0.88, "NS safety caps FM");
assert((nsHot.filterResonance ?? 0) > 14, "NS safety allows hotter Q than Armory loudness");

// ── Preset remaster maps legacy 0..1 resonance into musical Q ─────────
const h = { n: 123456789 };
const acidQ = remasterResonance(0.75, "Bass", "Acid Squelch", h);
assert(acidQ >= 6, `acid remaster Q is musical (got ${acidQ})`);
const softQ = remasterResonance(0.3, "Pad", "Soft Silk Pad", { n: 42 });
assert(softQ >= 0.7 && softQ <= 6, `pad remaster Q stays gentle (got ${softQ})`);
assert(remasterResonance(8, "Lead", "Already Hot", { n: 7 }) === 8, "absolute Q left alone");

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll Fire NS regression checks passed.");
