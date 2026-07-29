/**
 * Mix Clarity helpers — metering labels, limiter copy, mastering-chain order,
 * and shared Mix & Output vocabulary (trust-first, not decorative).
 */

export type MixGroupId = "routing" | "morph" | "mastering" | "analysis" | "stage";

export const MIX_GROUP_LABELS: Record<MixGroupId, string> = {
  routing: "Routing",
  morph: "Morph",
  mastering: "Mastering",
  analysis: "Analysis",
  stage: "Stage",
};

/** Fixed mastering insert order through Phases 1–5 (reconnect in Phase 6). */
export type MasterChainScene = "glueAirWidth" | "glueWidthAir" | "airGlueWidth" | "widthGlueAir";

export const MASTER_CHAIN_SCENES: { id: MasterChainScene; label: string; order: string }[] = [
  { id: "glueAirWidth", label: "G→A→W", order: "Glue → Air → Width" },
  { id: "glueWidthAir", label: "G→W→A", order: "Glue → Width → Air" },
  { id: "airGlueWidth", label: "A→G→W", order: "Air → Glue → Width" },
  { id: "widthGlueAir", label: "W→G→A", order: "Width → Glue → Air" },
];

export type GlueMode = "soft" | "glue" | "bus" | "punch" | "slam";
export type AirArch = "dual" | "tilt";
export type WidthMechanism = "ms" | "microdelay" | "decorrelate";
export type MorphPadMode = "morph" | "crossfade";
export type MorphInterp = "linear" | "equalPower" | "nearest";
export type VoiceStealPolicy = "oldest" | "newest" | "lowest" | "highest";
export type CeaseMode = "notes" | "notesTails" | "total";
export type SoloMode = "exclusive" | "additive" | "dim";
export type ScopeViewMode = "oscilloscope" | "spectrum" | "vectorscope";

export const FIRE_LIMITER_CEILING_DB = -3;

/** Format compressor reduction (negative dB) for UI. */
export function fmtGrDb(reduction: number): string {
  const gr = Math.max(0, -reduction);
  if (gr < 0.05) return "0.0";
  return gr.toFixed(1);
}

/** Peak as dBFS from linear 0..1. */
export function peakToDbfs(peak: number): string {
  if (peak <= 0.0001) return "−∞";
  const db = 20 * Math.log10(Math.min(1.5, peak));
  return `${db >= 0 ? "+" : ""}${db.toFixed(1)}`;
}

/** stereoWidth 0..1.4 → legend percent (0 mono · 100 original · 140 extreme). */
export function widthPct(w: number): number {
  return Math.round(Math.max(0, Math.min(1.4, w)) * 100);
}

export function widthScaleLegend(w: number): string {
  const p = widthPct(w);
  if (p < 5) return "0% mono";
  if (Math.abs(p - 100) < 3) return "100% original";
  if (p > 100) return `${p}% extreme`;
  return `${p}%`;
}

/** Punch macro → structural compressor params (documented mapping). */
export function punchMacroToGlue(punch: number, mode: GlueMode = "glue") {
  const p = Math.max(0, Math.min(1, punch));
  const modeMul: Record<GlueMode, { atk: number; rel: number; knee: number; ratioBoost: number }> = {
    soft: { atk: 0.012, rel: 0.28, knee: 12, ratioBoost: 0.55 },
    glue: { atk: 0.008, rel: 0.18, knee: 6, ratioBoost: 1 },
    bus: { atk: 0.006, rel: 0.14, knee: 4, ratioBoost: 1.15 },
    punch: { atk: 0.018, rel: 0.12, knee: 3, ratioBoost: 1.25 },
    slam: { atk: 0.0015, rel: 0.06, knee: 0, ratioBoost: 1.6 },
  };
  const m = modeMul[mode] ?? modeMul.glue;
  return {
    threshDb: -p * 30,
    ratio: 1 + p * 7 * m.ratioBoost,
    attack: m.atk,
    release: m.rel,
    knee: m.knee,
    makeup: 1 + p * 0.3,
    grEstimate: p * (6 + p * 8) * (mode === "slam" ? 1.2 : 1),
  };
}

export const MIX_CHAIN_COPY =
  "A/B/Drums/Samples → Mixer → Glue → Air → Width → Limiter → Scope · Morph/Live are state, not inserts";
