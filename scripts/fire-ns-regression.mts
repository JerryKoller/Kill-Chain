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
import { mutatePatch } from "../src/state/fireCommandStore.ts";

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

// ── NS safety: musical bite without ear-hash ──────────────────────────
const nsHot = cloneFirePatch({
  ...DEFAULT_FIRE_PATCH,
  filterResonance: 18,
  filterModel: "ladder",
  filterEnvAmount: 0.95,
  fmAmount: 0.95,
  drive: 0.95,
  ampAttack: 0.001,
  gateOn: true,
  gateSmooth: 0,
  delayFreeze: true,
  spectralMode: "smear",
});
applyNsSafety(nsHot);
assert((nsHot.filterResonance ?? 0) <= 6.5, "NS safety caps ladder Q ≤ 6.5");
assert((nsHot.fmAmount ?? 0) <= 0.68, "NS safety caps FM");
assert((nsHot.drive ?? 0) <= 0.62, "NS safety caps drive");
assert((nsHot.ampAttack ?? 0) >= 0.005, "NS safety floors amp attack");
assert((nsHot.gateSmooth ?? 0) >= 0.28, "NS safety floors gate smooth when gated");
assert(nsHot.delayFreeze === false, "NS safety clears delay freeze");
assert(nsHot.spectralMode === "off", "NS safety forces spectral off");
assert(Math.abs(nsHot.filterEnvAmount ?? 0) <= 0.7, "NS safety trims scream env at high Q");

const nsInfinite = cloneFirePatch({
  ...DEFAULT_FIRE_PATCH,
  delayCascadeMode: "infinite",
  delayFeedback: 0.95,
  delayFreeze: true,
});
applyNsSafety(nsInfinite);
assert(nsInfinite.delayCascadeMode === "long", "NS safety demotes infinite delay to long");
assert(nsInfinite.delayFreeze === false, "NS safety clears freeze on infinite demotion");
assert((nsInfinite.delayFeedback ?? 0) <= 0.62, "NS safety caps delay feedback");

const nsBiquad = cloneFirePatch({
  ...DEFAULT_FIRE_PATCH,
  filterModel: "biquad",
  filterResonance: 18,
});
applyNsSafety(nsBiquad);
assert((nsBiquad.filterResonance ?? 0) <= 9, "NS safety caps biquad Q ≤ 9");
assert((nsBiquad.filterResonance ?? 0) > 6.5, "biquad may keep more Q than ladder");

// ── NS mutate: offspring diverge + stay ear-safe ─────────────────────
const nsParent = cloneFirePatch({
  ...DEFAULT_FIRE_PATCH,
  oscATable: "saw",
  filterCutoff: 2000,
  filterResonance: 4,
});
const childA = mutatePatch(nsParent, 0.62, { forceSpecies: true });
const childB = mutatePatch(nsParent, 0.62, { forceSpecies: true });
applyNsSafety(childA);
applyNsSafety(childB);
assert((childA.filterResonance ?? 0) <= 9, "mutated A Q stays within NS cap");
assert((childB.filterResonance ?? 0) <= 9, "mutated B Q stays within NS cap");
assert((childA.ampAttack ?? 0) >= 0.005, "mutated A attack floored");
assert((childB.ampAttack ?? 0) >= 0.005, "mutated B attack floored");
const sig = (p: typeof childA) =>
  [p.oscATable, p.filterType, p.filterModel, p.driveMode, p.fmEngine, p.warpMode, p.hardSync, p.lpgOn].join("|");
assert(sig(childA) !== sig(childB) || Math.abs((childA.filterCutoff ?? 0) - (childB.filterCutoff ?? 0)) > 200,
  "forced-species siblings usually diverge in architecture or cutoff");

// ── NS body bias: long / clear / present / bass-forward distribution ──
let longBody = 0;
let present = 0;
let bassWeight = 0;
let clearFx = 0;
const N = 40;
for (let i = 0; i < N; i++) {
  const c = mutatePatch(nsParent, 0.7, { forceSpecies: true });
  applyNsSafety(c);
  // Re-apply store-order bias (mutatePatch already biases; safety then bias in store).
  // Presence + duration should dominate even after safety.
  const release = c.ampRelease ?? 0;
  const sustain = c.ampSustain ?? 0;
  if (release >= 1.5 || (sustain >= 0.5 && release >= 1.0)) longBody++;
  if ((c.oscALevel ?? 0) >= 0.55 && (c.masterGain ?? 0) >= 0.55) present++;
  if ((c.subLevel ?? 0) >= 0.25 || (c.oscAOctave ?? 0) <= -1) bassWeight++;
  if ((c.crush ?? 0) <= 0.15 && (c.bitDepth ?? "off") === "off") clearFx++;
}
assert(longBody >= N * 0.65, `NS body bias: most offspring sustain ≥~1.5s body (${longBody}/${N})`);
assert(present >= N * 0.8, `NS body bias: oscillators stay audible (${present}/${N})`);
assert(bassWeight >= N * 0.55, `NS body bias: sub/low octave common (${bassWeight}/${N})`);
assert(clearFx >= N * 0.7, `NS body bias: crush/bitDepth usually clean (${clearFx}/${N})`);

// Majority should NOT be the wet hollow cave (tube tables + big hall).
let dryish = 0;
let notTubeQ = 0;
for (let i = 0; i < N; i++) {
  const c = mutatePatch(nsParent, 0.7, { forceSpecies: true });
  applyNsSafety(c);
  const wet = (c.reverbMix ?? 0) > 0.3 && (c.reverbSize ?? 0) > 3.2;
  if (!wet) dryish++;
  if ((c.filterResonance ?? 0) <= 3.5 || c.filterType === "lowpass") notTubeQ++;
}
assert(dryish >= N * 0.7, `NS body bias: most offspring avoid huge wet halls (${dryish}/${N})`);
assert(notTubeQ >= N * 0.75, `NS body bias: resonance stays musical / LP-led (${notTubeQ}/${N})`);

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
