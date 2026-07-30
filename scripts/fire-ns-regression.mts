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
} from "../src/audio/dsp/FireCommandSynth.ts";
import {
  normalizeSpectrum,
  spectrumRms,
  spectrumPeak,
  WT_TARGET_RMS,
  WT_PEAK_CEIL,
} from "../src/audio/dsp/wavetables.ts";
import { applyLoudnessSafety } from "../src/lib/fireModuleLocks.ts";

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
assert(filterResoCompGain(14) < 0.5, "high Q gets meaningful input trim");
assert(filterResoCompGain(14) > 0.2, "high Q trim does not mute the filter");

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

// ── Loudness safety ───────────────────────────────────────────────────
const hot = cloneFirePatch({
  ...DEFAULT_FIRE_PATCH,
  filterResonance: 16,
  filterDrive: 0.95,
  noiseLevel: 0.9,
  drive: 0.9,
});
applyLoudnessSafety(hot);
assert((hot.filterResonance ?? 0) <= 10, "loudness safety caps Q ≤ 10");
assert((hot.filterDrive ?? 0) <= 0.7, "loudness safety caps filter drive");
assert((hot.noiseLevel ?? 0) <= 0.45, "loudness safety caps noise");

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll Fire NS regression checks passed.");
