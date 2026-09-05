/**
 * Deterministic synthetic VisualIntel + RenderFrame driving fields.
 *
 * Built from the real IntelSnapshot / RenderFrame contracts in
 * src/components/Visualizer/visualIntel.ts and renderers.ts.
 * No AudioEngine, no analysers, no random().
 *
 * Singularity's draw() reads: rms, low, beat, dt, now, reduced, intel
 * (kickHit, hat, snare, width, energy, bpm/bpmConf, beatPhase, barPhase,
 * section, engagePulse, colA/B/C). freq/time are filled for contract
 * completeness; the renderer does not sample them.
 */

export const SAMPLE_RATE = 48000;
export const BIN_COUNT = 1024;
export const FRAME_DT = 1 / 60;

export const PHASES = ["idle", "low", "bass", "highfreq", "peak", "cycle"];

export const DEFAULT_CAPTURE = Object.freeze({
  phase: "peak",
  freezeAt: 4,
});

export const PALETTE = Object.freeze({
  cyan: [84, 180, 214],
  plasma: [255, 64, 64],
  violet: [122, 92, 255],
  lime: [95, 211, 138],
  amber: [255, 176, 72],
  ink: [7, 8, 11],
});

const COL_A = [84, 180, 214];
const COL_B = [255, 64, 64];
const COL_C = [122, 92, 255];

const CYCLE_ORDER = ["idle", "low", "bass", "highfreq", "peak"];
const CYCLE_SLICE = 2;

const PRESETS = {
  idle: {
    section: "idle",
    bpm: 0,
    bpmConf: 0,
    energy: 0,
    rms: 0.015,
    low: 0.03,
    mid: 0.02,
    high: 0.015,
    centroid: 0.18,
    kicks: false,
    hats: false,
    snares: false,
    width: 0.04,
    vocal: 0,
    engage: 0,
  },
  low: {
    section: "verse",
    bpm: 96,
    bpmConf: 0.7,
    energy: 0.22,
    rms: 0.18,
    low: 0.22,
    mid: 0.16,
    high: 0.1,
    centroid: 0.32,
    kicks: true,
    hats: false,
    snares: false,
    width: 0.22,
    vocal: 0.12,
    engage: 0,
  },
  bass: {
    section: "verse",
    bpm: 120,
    bpmConf: 0.85,
    energy: 0.48,
    rms: 0.38,
    low: 0.84,
    mid: 0.2,
    high: 0.08,
    centroid: 0.22,
    kicks: true,
    hats: false,
    snares: false,
    width: 0.42,
    vocal: 0.08,
    engage: 0,
  },
  highfreq: {
    section: "buildup",
    bpm: 128,
    bpmConf: 0.8,
    energy: 0.58,
    rms: 0.34,
    low: 0.16,
    mid: 0.42,
    high: 0.86,
    centroid: 0.72,
    kicks: false,
    hats: true,
    snares: true,
    width: 0.52,
    vocal: 0.35,
    engage: 0.12,
  },
  peak: {
    section: "drop",
    bpm: 128,
    bpmConf: 0.92,
    energy: 0.93,
    rms: 0.72,
    low: 0.8,
    mid: 0.66,
    high: 0.72,
    centroid: 0.55,
    kicks: true,
    hats: true,
    snares: true,
    width: 0.74,
    vocal: 0.45,
    engage: 0.65,
  },
};

export function isPhase(name) {
  return PHASES.includes(String(name || ""));
}

export function resolvePhase(phase, elapsedSec) {
  const t = Math.max(0, Number(elapsedSec) || 0);
  const name = isPhase(phase) ? phase : "peak";
  if (name !== "cycle") return { name, localT: t, cycleIndex: -1 };
  const idx = Math.floor(t / CYCLE_SLICE) % CYCLE_ORDER.length;
  return {
    name: CYCLE_ORDER[idx],
    localT: t - Math.floor(t / CYCLE_SLICE) * CYCLE_SLICE,
    cycleIndex: idx,
  };
}

function edge(t, dt, period) {
  if (!(period > 0) || t < 0) return false;
  const prevT = t - dt;
  if (prevT < 0) return true;
  return Math.floor(t / period) > Math.floor(prevT / period);
}

function decayFrom(t, period, tau) {
  if (!(period > 0)) return 0;
  const last = Math.floor(t / period) * period;
  const since = t - last;
  return Math.exp(-since / tau);
}

/**
 * @param {{ phase?: string, frame?: number, dt?: number, elapsed?: number }} opts
 */
export function syntheticFrame(opts = {}) {
  const dt = opts.dt == null ? FRAME_DT : Number(opts.dt);
  const frame = opts.frame == null ? 0 : Math.max(0, Math.floor(opts.frame));
  const elapsed = opts.elapsed == null ? frame * dt : Number(opts.elapsed);
  const resolved = resolvePhase(opts.phase || "peak", elapsed);
  const p = PRESETS[resolved.name] || PRESETS.peak;
  const t = elapsed;

  const beatPeriod = p.bpm > 0 ? 60 / p.bpm : 0;
  const hatPeriod = p.bpm > 0 ? 60 / (p.bpm * 2) : 0;
  const snarePeriod = p.bpm > 0 ? 120 / p.bpm : 0;

  const kickHit = p.kicks && edge(t, dt, beatPeriod);
  const hatHit = p.hats && edge(t, dt, hatPeriod);
  const snareHit = p.snares && edge(t, dt, snarePeriod);
  const barPeriod = beatPeriod * 4;

  const beatPhase = beatPeriod > 0 ? (t / beatPeriod) % 1 : (t * 0.9) % 1;
  const barPhase = barPeriod > 0 ? (t / barPeriod) % 1 : (t * 0.11) % 1;
  const beat = p.kicks ? decayFrom(t, beatPeriod, 1 / 6) : 0;
  const kick = p.kicks ? decayFrom(t, beatPeriod, 1 / 5) : 0;
  const hat = p.hats ? decayFrom(t, hatPeriod, 1 / 8) : 0;
  const snare = p.snares ? decayFrom(t, snarePeriod, 1 / 6) : 0;

  return {
    phase: resolved.name,
    requestedPhase: opts.phase || "peak",
    frame,
    dt,
    elapsed,
    now: elapsed * 1000,
    rms: p.rms,
    low: p.low,
    mid: p.mid,
    high: p.high,
    centroid: p.centroid,
    beatHit: kickHit,
    beat,
    lufs: p.rms > 0.05 ? -14 - (1 - p.rms) * 20 : -70,
    title: "SINGULARITY HARNESS",
    reduced: false,
    intel: {
      rms: p.rms,
      low: p.low,
      mid: p.mid,
      high: p.high,
      centroid: p.centroid,
      beatHit: kickHit,
      beat,
      bpm: p.bpm,
      bpmConf: p.bpmConf,
      beatPhase,
      barPhase,
      beatTick: kickHit,
      barTick: p.kicks && edge(t, dt, barPeriod),
      kick,
      snare,
      hat,
      vocal: p.vocal,
      kickHit,
      snareHit,
      hatHit,
      width: p.width,
      phaseCorr: 0.65,
      section: p.section,
      sectionAge: resolved.localT,
      energy: p.energy,
      engagePulse: p.engage * Math.exp(-resolved.localT * 0.35),
      colA: COL_A.slice(),
      colB: COL_B.slice(),
      colC: COL_C.slice(),
    },
  };
}

export function fillSpectrum(freq, time, syn) {
  const n = freq.length;
  for (let i = 0; i < n; i++) {
    const u = n === 1 ? 0 : i / (n - 1);
    let v;
    if (u < 0.12) v = syn.low;
    else if (u < 0.55) v = syn.mid;
    else v = syn.high;
    freq[i] = Math.max(0, Math.min(255, Math.round(v * 255)));
  }
  const tn = time.length;
  const rms = syn.rms || 0;
  const frame = syn.frame || 0;
  for (let i = 0; i < tn; i++) {
    const s = Math.sin((i / Math.max(1, tn)) * Math.PI * 8 + frame * 0.13) * rms;
    time[i] = Math.max(0, Math.min(255, Math.round(128 + s * 120)));
  }
}

export function harnessUrl({ origin, phase, freezeAt, hud } = {}) {
  const u = new URL(origin || "http://127.0.0.1:5174/");
  if (phase) u.searchParams.set("phase", phase);
  if (freezeAt != null && freezeAt !== false) u.searchParams.set("freezeAt", String(freezeAt));
  if (hud === 0 || hud === "0" || hud === false) u.searchParams.set("hud", "0");
  return u.toString();
}
