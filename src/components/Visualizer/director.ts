/**
 * CINEMA LOCK — the v1.8 auto-director. A pseudo-mode that owns a small
 * fleet of real scene renderers (each drawing into its own offscreen canvas
 * so their afterglow/trail state never collides) and chooses which one is on
 * screen from the shared intel's section estimate:
 *
 *   idle / intro  → AURORA FLOW (calm)
 *   verse         → SPECTRUM ARRAY ⇄ PULSE LATTICE (alternating)
 *   buildup       → WARP TUNNEL (accelerating)
 *   drop          → SINGULARITY ⇄ STRIKE FIELD (maximum impact)
 *   breakdown     → RADIAL REACTOR (low motion)
 *
 * Transitions are BPM-aware: they wait for a bar boundary when the tempo
 * clock is confident, then crossfade over two bars (clamped 1.5–6 s; 2.8 s
 * when the tempo is unknown). A minimum dwell keeps it from thrashing.
 */

import type { ModeRenderer, RenderFrame } from "./renderers";
import type { VisualizerMode } from "@/state/visualizerStore";

const MIN_DWELL_S = 14;
const FALLBACK_FADE_S = 2.8;

interface Scene {
  r: ModeRenderer;
  canvas: HTMLCanvasElement;
  g: CanvasRenderingContext2D;
  w: number;
  h: number;
}

export function createDirector(
  makeScene: (mode: VisualizerMode) => ModeRenderer,
): ModeRenderer {
  const scenes = new Map<VisualizerMode, Scene>();
  let W = 0;
  let H = 0;

  let current: VisualizerMode = "aurora";
  let incoming: VisualizerMode | null = null;
  let fadeT = 0; // seconds into the crossfade
  let fadeDur = FALLBACK_FADE_S;
  let dwell = 0;
  let verseFlip = false;
  let dropFlip = false;

  // sub-frame bags (one per layer) — mutated in place every draw
  const sub: RenderFrame[] = [];

  const getScene = (m: VisualizerMode): Scene => {
    let s = scenes.get(m);
    if (!s) {
      const canvas = document.createElement("canvas");
      const g = canvas.getContext("2d", { alpha: false });
      if (!g) throw new Error("2d context unavailable");
      s = { r: makeScene(m), canvas, g, w: -1, h: -1 };
      scenes.set(m, s);
    }
    if (s.w !== W || s.h !== H) {
      s.canvas.width = Math.max(1, W);
      s.canvas.height = Math.max(1, H);
      s.r.resize(W, H);
      s.w = W;
      s.h = H;
    }
    return s;
  };

  const pick = (f: RenderFrame): VisualizerMode => {
    switch (f.intel.section) {
      case "drop":
        return dropFlip ? "strike" : "singularity";
      case "buildup":
        return "tunnel";
      case "breakdown":
        return "radial";
      case "verse":
        return verseFlip ? "lattice" : "spectrum";
      default:
        return "aurora"; // idle / intro
    }
  };

  const renderLayer = (scene: Scene, f: RenderFrame, idx: number): void => {
    let bag = sub[idx];
    if (!bag) {
      bag = { ...f };
      sub[idx] = bag;
    }
    bag.g = scene.g;
    bag.W = W;
    bag.H = H;
    bag.freq = f.freq;
    bag.time = f.time;
    bag.binCount = f.binCount;
    bag.sampleRate = f.sampleRate;
    bag.dt = f.dt;
    bag.now = f.now;
    bag.rms = f.rms;
    bag.low = f.low;
    bag.mid = f.mid;
    bag.high = f.high;
    bag.centroid = f.centroid;
    bag.beatHit = f.beatHit;
    bag.beat = f.beat;
    bag.lufs = f.lufs;
    bag.title = f.title;
    bag.reduced = f.reduced;
    bag.intel = f.intel;
    scene.r.draw(bag);
  };

  return {
    resize(w: number, h: number) {
      W = Math.max(1, Math.round(w));
      H = Math.max(1, Math.round(h));
    },

    draw(f: RenderFrame) {
      const it = f.intel;
      dwell += f.dt;

      // ── decide whether to cut ──
      if (!incoming) {
        const want = pick(f);
        if (want !== current && dwell >= MIN_DWELL_S) {
          // BPM-aware: wait for the bar line when the clock is confident,
          // otherwise go now.
          const clocked = it.bpm > 0 && it.bpmConf > 0.25;
          if (!clocked || it.barTick) {
            incoming = want;
            fadeT = 0;
            fadeDur = clocked
              ? Math.min(6, Math.max(1.5, (60 / it.bpm) * 8)) // two 4-beat bars
              : FALLBACK_FADE_S;
            // advance the alternators so repeat visits vary
            if (want === "lattice" || want === "spectrum") verseFlip = !verseFlip;
            if (want === "singularity" || want === "strike") dropFlip = !dropFlip;
          }
        }
      }

      // ── render layers ──
      const cur = getScene(current);
      renderLayer(cur, f, 0);
      f.g.drawImage(cur.canvas, 0, 0, f.W, f.H);

      if (incoming) {
        fadeT += f.dt;
        const t = Math.min(1, fadeT / fadeDur);
        const inc = getScene(incoming);
        renderLayer(inc, f, 1);
        // smoothstep alpha — no hard cuts
        const a = t * t * (3 - 2 * t);
        f.g.globalAlpha = a;
        f.g.drawImage(inc.canvas, 0, 0, f.W, f.H);
        f.g.globalAlpha = 1;
        if (t >= 1) {
          current = incoming;
          incoming = null;
          dwell = 0;
        }
      }

      // ── director tag ──
      const g = f.g;
      g.font = "9px JetBrains Mono, Consolas, monospace";
      g.textAlign = "left";
      g.fillStyle = "rgba(140,200,230,0.5)";
      const label = incoming
        ? `CINEMA LOCK · ${current.toUpperCase()} → ${incoming.toUpperCase()}`
        : `CINEMA LOCK · ${current.toUpperCase()} · ${it.section.toUpperCase()}`;
      g.fillText(label, 8, f.H - 10);
    },
  };
}
