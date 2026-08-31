/**
 * Offline fitness audition for Natural Selection offspring.
 *
 * Renders a candidate patch for ~1.2 s in an OfflineAudioContext (one mid
 * note + a small chord) and measures what actually comes out. NS used to
 * ship whatever the parameter dice rolled — the user-facing symptom was
 * "a lot of them are either silent or distorted". Heuristic clamps can't
 * fully prevent that (silence/screech emerges from parameter INTERACTIONS),
 * so the store re-rolls candidates that fail this measurement.
 *
 * Costs ~50–150 ms per candidate on a desktop — imperceptible next to the
 * mutate gesture, and it runs after the sync UI update.
 */

import { FireCommandSynth, type FirePatch } from "@/audio/dsp/FireCommandSynth";

export interface NsAudition {
  rms: number;
  peak: number;
  clipPct: number;
  crestDb: number;
  silent: boolean;
  distorted: boolean;
  ok: boolean;
}

export async function auditionFirePatch(patch: FirePatch): Promise<NsAudition> {
  const sr = 44100;
  // Adaptive window: a 1.5 s attack pad measured over a fixed 1.2 s render
  // looked "silent" purely because it had barely started. Give slow envelopes
  // (and long LFO sweeps) room to actually speak.
  const atk = Math.max(0, patch.ampAttack ?? 0.01);
  const dec = Math.max(0, patch.ampDecay ?? 0.25);
  const seconds = Math.min(4, Math.max(1.2, 0.7 + atk * 1.8 + dec * 0.8));
  // MONO render. The measurement is level / clip / crest, none of which need
  // two channels, and the rendered buffer is the single biggest allocation in
  // an audition — halving it halves the cost of every candidate.
  const ctx = new OfflineAudioContext(1, Math.floor(sr * seconds), sr);
  // `transient` suppresses the filter-worklet preload: addModule() attaches a
  // worklet realm to the context, after which Blink never collects it, and NS
  // creates one context per candidate.
  const synth = new FireCommandSynth(ctx as unknown as AudioContext, ctx.destination, {
    transient: true,
  });
  synth.offlineSafe = true;
  try {
    return await renderAndMeasure(ctx, synth, patch, seconds);
  } finally {
    // This synth is a throwaway: ~150 nodes, a generated reverb impulse
    // response and a freshly rendered wavetable bank set, all for one
    // measurement. Without an explicit teardown each audition retained
    // 0.42 MB forever (measured), and since a single mutate runs several
    // auditions, breeding sounds leaked ~64 MB/min — about a gigabyte in
    // fifteen minutes of sound design, recoverable only by relaunching.
    try { synth.dispose(); } catch { /* best effort — never fail an audition */ }
  }
}

async function renderAndMeasure(
  ctx: OfflineAudioContext,
  synth: FireCommandSynth,
  patch: FirePatch,
  seconds: number,
): Promise<NsAudition> {
  // Both worklet-backed paths are unavailable here, for different reasons, so
  // measure the patch with each swapped for its fallback:
  //
  //   spectral — the STFT worklet loads ASYNCHRONOUSLY and the render can
  //     finish before the module registers, leaving the wet path silent and
  //     making a perfectly good spectral preset look dead.
  //   filter   — the ladder/SVF worklet is deliberately not loaded on audition
  //     contexts (attaching a worklet realm makes Blink retain the context
  //     forever). Without pinning the model here, a ladder patch would render
  //     through the biquad fallback anyway but report `filterModel: "ladder"`,
  //     which is a confusing mismatch for anyone reading the audit output.
  const measured: FirePatch = { ...patch };
  if ((measured.spectralMode ?? "off") !== "off") measured.spectralMode = "off";
  const model = measured.filterModel ?? "biquad";
  if (model === "ladder" || model === "svf") measured.filterModel = "biquad";
  synth.setPatch(measured);
  // A mid note, then a partial chord partway in — exposes pluck transients
  // and sustained-body level. Note lengths scale with the window so a long
  // attack is still open when the render ends.
  const hold = seconds * 0.55;
  synth.playNote(57, 0.9, 0.03, hold);
  synth.playNote(64, 0.85, seconds * 0.35, hold * 0.9);
  synth.playNote(52, 0.85, seconds * 0.35, hold * 0.9);
  const buf = await ctx.startRendering();

  let peak = 0;
  let sumSq = 0;
  let clip = 0;
  let n = 0;
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < d.length; i++) {
      const v = d[i]!;
      if (!Number.isFinite(v)) { clip++; n++; continue; }
      const a = Math.abs(v);
      if (a > peak) peak = a;
      sumSq += v * v;
      if (a >= 0.985) clip++;
      n++;
    }
  }
  const rms = n > 0 ? Math.sqrt(sumSq / n) : 0;
  const clipPct = n > 0 ? (clip / n) * 100 : 0;
  const crestDb = peak > 0 && rms > 0 ? 20 * Math.log10(peak / rms) : 0;
  // "Silent" needs BOTH a dead peak and a dead average: a hi-hat tick or a
  // sparse granular texture has a legitimately tiny RMS over the window but a
  // clearly audible peak, and judging on RMS alone condemned them.
  // "Distorted": sustained hard-clipping, or a loud signal with almost no
  // crest left (square-wall saturation).
  const silent = peak < 0.025 && rms < 0.004;
  const distorted = clipPct > 0.35 || (rms > 0.05 && crestDb < 4.5);
  return { rms, peak, clipPct, crestDb, silent, distorted, ok: !silent && !distorted };
}
