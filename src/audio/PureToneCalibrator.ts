/**
 * PureToneCalibrator — pure sine oscillators for the Sound Sculptor's
 * "Pure Tone Calibration" mode.
 *
 * It can play a single band's tone at a time, OR several bands at once
 * ("unison") so the user can hear the relative loudness of each band and
 * balance them by ear. Each tone's level tracks its band gain (in dB), and
 * the whole stack is gently scaled so adding more tones doesn't clip.
 *
 * Routes straight to the destination — untouched by the sculpt or headphone
 * correction — so it stays a clean reference, like the EarTrainer.
 */
import { getEngine } from "./AudioEngine";

export interface ToneSpec {
  freq: number;
  gainDb: number;
}

export class PureToneCalibrator {
  private ctx: AudioContext;
  private master: GainNode;
  private tones = new Map<string, { osc: OscillatorNode; gain: GainNode }>();
  private running = false;
  /** Comfortable per-tone level for a 0 dB band (~-20 dBFS). */
  private baseLevel = 0.1;

  constructor() {
    this.ctx = getEngine().ctx as AudioContext;
    this.master = this.ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(this.ctx.destination);
  }

  /** Bring the master up (call on a user gesture). */
  async engage(): Promise<void> {
    await getEngine().resume();
    if (this.running) return;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setValueAtTime(this.master.gain.value, t);
    this.master.gain.linearRampToValueAtTime(1, t + 0.05);
    this.running = true;
  }

  /**
   * Declaratively set the playing tones. Creates/updates/removes oscillators
   * to match `map`. The stack is scaled by 1/sqrt(n) so unison stays sane.
   */
  setTones(map: Record<string, ToneSpec>): void {
    const keys = Object.keys(map);
    const scale = keys.length > 0 ? 1 / Math.sqrt(keys.length) : 1;
    const t = this.ctx.currentTime;

    // Remove tones no longer requested.
    for (const [k, node] of this.tones) {
      if (!(k in map)) {
        node.gain.gain.setTargetAtTime(0, t, 0.03);
        const osc = node.osc;
        const gain = node.gain;
        window.setTimeout(() => {
          try { osc.stop(); } catch { /* already stopped */ }
          try { osc.disconnect(); } catch { /* ignore */ }
          // The gain stage must go too — it used to stay wired to master
          // forever, leaking one node per removed tone.
          try { gain.disconnect(); } catch { /* ignore */ }
        }, 120);
        this.tones.delete(k);
      }
    }

    // Add / update.
    for (const k of keys) {
      const spec = map[k];
      let node = this.tones.get(k);
      if (!node) {
        const osc = this.ctx.createOscillator();
        osc.type = "sine";
        osc.frequency.value = spec.freq;
        const gain = this.ctx.createGain();
        gain.gain.value = 0;
        osc.connect(gain);
        gain.connect(this.master);
        osc.start();
        node = { osc, gain };
        this.tones.set(k, node);
      }
      const lin = this.baseLevel * scale * Math.pow(10, spec.gainDb / 20);
      node.osc.frequency.setTargetAtTime(spec.freq, t, 0.02);
      node.gain.gain.setTargetAtTime(Math.max(0, Math.min(0.5, lin)), t, 0.04);
    }
  }

  stop(): void {
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setValueAtTime(this.master.gain.value, t);
    this.master.gain.linearRampToValueAtTime(0, t + 0.1);
    // Guard against a stop → engage race: if the user restarts within the
    // fade-out window, don't kill the oscillators that were just re-created.
    window.setTimeout(() => {
      if (!this.running) this.stopAll();
    }, 150);
    this.running = false;
  }

  private stopAll(): void {
    for (const [, node] of this.tones) {
      try { node.osc.stop(); } catch { /* already stopped */ }
      try { node.osc.disconnect(); } catch { /* ignore */ }
      try { node.gain.disconnect(); } catch { /* ignore */ }
    }
    this.tones.clear();
  }

  isRunning(): boolean {
    return this.running;
  }
}

let _cal: PureToneCalibrator | null = null;
export function getPureToneCalibrator(): PureToneCalibrator {
  if (!_cal) _cal = new PureToneCalibrator();
  return _cal;
}
