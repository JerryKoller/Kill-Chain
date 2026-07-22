/**
 * The ONE place a VisualizerMode id becomes a live ModeRenderer. Used by the
 * in-app overlay, the broadcast window and the Cinema Lock director — adding
 * a mode means touching the store registry and this switch, nothing else.
 */

import {
  createSpectrumArray,
  createWaveformScope,
  createRadialReactor,
  createWaterfallSpectrogram,
  createStrikeField,
  createWarpTunnel,
  createPulseLattice,
  createAuroraFlow,
  type ModeRenderer,
  type ThemePalette,
} from "./renderers";
import { createSingularity } from "./singularity";
import { createDirector } from "./director";
import type { VisualizerMode } from "@/state/visualizerStore";

export function createModeRenderer(
  mode: VisualizerMode,
  pal: ThemePalette,
  binCount: number,
  sampleRate: number,
): ModeRenderer {
  switch (mode) {
    case "spectrum":
      return createSpectrumArray(pal, binCount, sampleRate);
    case "scope":
      return createWaveformScope(pal);
    case "radial":
      return createRadialReactor(pal, binCount, sampleRate);
    case "waterfall":
      return createWaterfallSpectrogram(pal, binCount, sampleRate);
    case "tunnel":
      return createWarpTunnel(pal);
    case "lattice":
      return createPulseLattice(pal, binCount, sampleRate);
    case "aurora":
      return createAuroraFlow(pal);
    case "singularity":
      return createSingularity(pal);
    case "cinema":
      return createDirector((m) => createModeRenderer(m, pal, binCount, sampleRate));
    case "strike":
    default:
      return createStrikeField(pal);
  }
}
