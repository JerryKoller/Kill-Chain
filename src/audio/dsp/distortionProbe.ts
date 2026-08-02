/**
 * DistortionProbe — temporary stage peak sampler for the sudden-distortion hunt.
 *
 * Taps nodes in parallel (AnalyserNode only) and logs the FIRST stage whose
 * peak crosses the hot threshold within a short window. Enable via:
 *   localStorage.setItem("killchain.distortProbe", "1")
 * or automatically in DEV builds.
 *
 * Disable: localStorage.removeItem("killchain.distortProbe")
 */

export type ProbePeak = {
  stage: string;
  peak: number;
  at: number;
};

const HOT = 0.92;
const LOG_COOLDOWN_MS = 1200;

function probeEnabled(): boolean {
  try {
    if (typeof window === "undefined") return false;
    if (window.localStorage?.getItem("killchain.distortProbe") === "1") return true;
  } catch { /* ignore */ }
  try {
    // Vite / Electron renderer
    return !!(import.meta as { env?: { DEV?: boolean } }).env?.DEV;
  } catch {
    return false;
  }
}

export class DistortionProbe {
  private readonly ctx: BaseAudioContext;
  private readonly taps = new Map<string, { an: AnalyserNode; buf: Float32Array<ArrayBuffer> }>();
  private rafId = 0;
  private lastLogAt = 0;
  private lastHotStage: string | null = null;
  private enabled = false;

  /** Most recent hot event (for UI / tests). */
  lastEvent: ProbePeak | null = null;
  /** Rolling max peaks by stage (last ~1s). */
  readonly peaks = new Map<string, number>();

  constructor(ctx: BaseAudioContext) {
    this.ctx = ctx;
  }

  /** Parallel tap — never inserts into the audible graph. */
  tap(stage: string, node: AudioNode): void {
    if (this.taps.has(stage)) return;
    const an = this.ctx.createAnalyser();
    an.fftSize = 1024;
    an.smoothingTimeConstant = 0;
    try {
      node.connect(an);
    } catch {
      return;
    }
    this.taps.set(stage, { an, buf: new Float32Array(an.fftSize) as Float32Array<ArrayBuffer> });
  }

  start(): void {
    this.enabled = probeEnabled();
    if (!this.enabled || this.rafId) return;
    this.rafId = requestAnimationFrame(this.tick);
  }

  stop(): void {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
  }

  /** Force-enable even outside DEV (tests / manual hunt). */
  forceEnable(): void {
    this.enabled = true;
    if (!this.rafId) this.rafId = requestAnimationFrame(this.tick);
  }

  private tick = (): void => {
    if (!this.enabled) {
      this.rafId = 0;
      return;
    }
    const now = performance.now();
    let hottest: ProbePeak | null = null;

    for (const [stage, { an, buf }] of this.taps) {
      // getFloatTimeDomainData is available on AnalyserNode in modern Chromium.
      try {
        an.getFloatTimeDomainData(buf);
      } catch {
        continue;
      }
      let peak = 0;
      for (let i = 0; i < buf.length; i++) {
        const a = Math.abs(buf[i]!);
        if (a > peak) peak = a;
      }
      this.peaks.set(stage, peak);
      if (peak >= HOT && (!hottest || peak > hottest.peak)) {
        hottest = { stage, peak, at: now };
      }
    }

    if (hottest && now - this.lastLogAt > LOG_COOLDOWN_MS) {
      this.lastLogAt = now;
      this.lastEvent = hottest;
      this.lastHotStage = hottest.stage;
      // Rank all stages for the log line.
      const ranked = [...this.peaks.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([s, p]) => `${s}=${p.toFixed(3)}`)
        .join(" ");
      console.warn(
        `[distortProbe] HOT ${hottest.stage} peak=${hottest.peak.toFixed(3)} | ${ranked}`,
      );
    }

    this.rafId = requestAnimationFrame(this.tick);
  };

  getLastHotStage(): string | null {
    return this.lastHotStage;
  }

  dispose(): void {
    this.stop();
    for (const { an } of this.taps.values()) {
      try { an.disconnect(); } catch { /* ignore */ }
    }
    this.taps.clear();
  }
}

/** Shared singleton — created lazily by AudioEngine. */
let _probe: DistortionProbe | null = null;

export function getDistortionProbe(ctx?: BaseAudioContext): DistortionProbe | null {
  if (_probe) return _probe;
  if (!ctx) return null;
  _probe = new DistortionProbe(ctx);
  return _probe;
}

export function peekDistortionProbe(): DistortionProbe | null {
  return _probe;
}
