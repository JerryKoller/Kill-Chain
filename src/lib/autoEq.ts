import type { ParametricBand } from "@/audio/types";

/**
 * AutoEq "ParametricEQ.txt" import/export. The AutoEq project publishes
 * parametric corrections for thousands of headphones in this format:
 *
 *   Preamp: -6.6 dB
 *   Filter 1: ON PK Fc 21 Hz Gain 6.3 dB Q 1.41
 *   Filter 2: ON LSC Fc 105 Hz Gain 1.2 dB Q 0.71
 *   Filter 10: ON HSC Fc 10000 Hz Gain -4.0 dB Q 0.71
 *
 * PK → peaking, LSC/LS → lowshelf, HSC/HS → highshelf. Disabled ("OFF")
 * filters are skipped.
 */

export interface AutoEqResult {
  /** Preamp in dB (negative — headroom for the boosts). */
  preampDb: number;
  bands: ParametricBand[];
}

const FILTER_RE =
  /^\s*Filter\s*\d+\s*:\s*(ON|OFF)\s+(PK|LSC?|HSC?|LOWSHELF|HIGHSHELF|PEAKING)\s+Fc\s+([\d.]+)\s*Hz\s+Gain\s+(-?[\d.]+)\s*dB(?:\s+Q\s+([\d.]+))?/i;
const PREAMP_RE = /^\s*Preamp\s*:\s*(-?[\d.]+)\s*dB/i;

function biquadType(token: string): BiquadFilterType {
  const t = token.toUpperCase();
  if (t === "LSC" || t === "LS" || t === "LOWSHELF") return "lowshelf";
  if (t === "HSC" || t === "HS" || t === "HIGHSHELF") return "highshelf";
  return "peaking";
}

/** Parse AutoEq ParametricEQ text. Returns null when nothing parseable. */
export function parseAutoEq(text: string, idPrefix = "aeq"): AutoEqResult | null {
  let preampDb = 0;
  const bands: ParametricBand[] = [];
  for (const line of text.split(/\r?\n/)) {
    const pre = PREAMP_RE.exec(line);
    if (pre) {
      preampDb = Number(pre[1]);
      continue;
    }
    const m = FILTER_RE.exec(line);
    if (!m) continue;
    if (m[1].toUpperCase() === "OFF") continue;
    const freq = Number(m[3]);
    const gain = Number(m[4]);
    const q = m[5] !== undefined ? Number(m[5]) : 0.71;
    if (!isFinite(freq) || freq < 10 || freq > 24000 || !isFinite(gain)) continue;
    const type = biquadType(m[2]);
    bands.push({
      id: `${idPrefix}-b${bands.length}`,
      freq: Math.round(freq * 10) / 10,
      gain: Math.max(-20, Math.min(20, gain)),
      q: Math.max(0.1, Math.min(18, isFinite(q) ? q : 0.71)),
      type,
      label: `${type === "peaking" ? "PK" : type === "lowshelf" ? "LS" : "HS"} ${freq >= 1000 ? `${(freq / 1000).toFixed(1)}k` : Math.round(freq)}`,
    });
  }
  if (bands.length === 0) return null;
  return { preampDb, bands };
}

/** Serialize bands back to AutoEq ParametricEQ text (for export). */
export function formatAutoEq(preampDb: number, bands: ParametricBand[]): string {
  const lines = [`Preamp: ${preampDb.toFixed(1)} dB`];
  bands.forEach((b, i) => {
    const type =
      b.type === "lowshelf" ? "LSC" : b.type === "highshelf" ? "HSC" : "PK";
    lines.push(
      `Filter ${i + 1}: ON ${type} Fc ${Math.round(b.freq)} Hz Gain ${b.gain.toFixed(1)} dB Q ${b.q.toFixed(2)}`,
    );
  });
  return lines.join("\n") + "\n";
}
