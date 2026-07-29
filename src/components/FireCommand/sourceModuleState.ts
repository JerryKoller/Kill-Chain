/**
 * Standardized Source-module DSP states + thematic display labels.
 * Technical state is authoritative; flavor is optional personality.
 */

export type SourceTechState = "active" | "bypassed" | "muted" | "disabled" | "armed";

export const SOURCE_STATE_FLAVOR: Record<SourceTechState, string> = {
  active: "Awake",
  bypassed: "Passing through",
  muted: "Silent",
  disabled: "Dormant",
  armed: "Ready",
};

export type SourceStateInfo = {
  tech: SourceTechState;
  /** Short pill label — technical when editing, flavor optional. */
  pill: string;
  /** Longer tooltip / canvas hint. */
  detail: string;
};

/** Level-gated voice (Osc A/B/C, Noise, Sub). */
export function levelVoiceState(
  level: number,
  opts?: { wakeHint?: string; role?: "prime" | "twin" | "depth" | "storm" | "tectonic" },
): SourceStateInfo {
  const silent = level < 0.02;
  if (silent) {
    const tech: SourceTechState = opts?.role === "depth" || opts?.role === "tectonic" ? "disabled" : "muted";
    const wake = opts?.wakeHint ?? "raise Level";
    return {
      tech,
      pill: `${SOURCE_STATE_FLAVOR[tech].toUpperCase()}`,
      detail: `${SOURCE_STATE_FLAVOR[tech]} — DSP ${tech === "disabled" ? "disabled" : "muted"}; ${wake}`,
    };
  }
  return {
    tech: "active",
    pill: SOURCE_STATE_FLAVOR.active.toUpperCase(),
    detail: `${SOURCE_STATE_FLAVOR.active} — output live`,
  };
}

/** Warp forge: processing vs neutral pass-through. */
export function forgeState(forging: boolean): SourceStateInfo {
  if (forging) {
    return {
      tech: "active",
      pill: "ACTIVE",
      detail: "Active — Harmonic Forge reshaping A · B · C",
    };
  }
  return {
    tech: "bypassed",
    pill: "BYPASSED",
    detail: "Bypassed — Passing through (Stretch / Tilt / Comb near zero)",
  };
}

/** Chip / Acid circuit engagement. */
export function circuitState(live: boolean): SourceStateInfo {
  if (live) {
    return {
      tech: "active",
      pill: "ACTIVE",
      detail: "Active — Acid Circuit engaged",
    };
  }
  return {
    tech: "armed",
    pill: "ARMED",
    detail: "Armed — Ready; raise Pulse / Voices / Accent or engage Sync",
  };
}

/** Count of significant modulation routes into a voice. */
export function modActivityCount(env: number, lfo: number, detune = 0): number {
  let n = 0;
  if (Math.abs(env) > 0.04) n++;
  if (Math.abs(lfo) > 0.04) n++;
  if (Math.abs(detune) > 0.5) n++;
  return n;
}
