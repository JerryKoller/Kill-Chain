/**
 * ARP keep-alive / hot-rate flags for FireCommandSynth (no store import).
 * Set by the Fire Command ARP wall-clock scheduler.
 */

let arpKeepAlive = false;
let arpStepSec = 0.25;
/** octaves × latchNotes × gate — load hint for hot-arp protection. */
let arpLoad = 1;

export function setArpKeepAlive(on: boolean): void {
  arpKeepAlive = on;
  if (!on) {
    arpStepSec = 0.25;
    arpLoad = 1;
  }
}

export function isArpKeepAlive(): boolean {
  return arpKeepAlive;
}

/** Wall-clock length of one arp step (seconds). */
export function setArpStepSec(sec: number): void {
  arpStepSec = Math.max(0.01, sec);
}

export function getArpStepSec(): number {
  return arpStepSec;
}

/**
 * Relative ARP bus load: octaves × held/latched notes × gate.
 * Used so 4-oct chords get hot-arp protection even near the stepSec boundary.
 */
export function setArpLoad(load: number): void {
  arpLoad = Math.max(0.25, load);
}

export function getArpLoad(): number {
  return arpLoad;
}

/**
 * High-rate or high-load arpeggio — short tails, deferred voices, bus pad.
 * stepSec < 0.05 ≈ ≥24 steps/s (300 BPM × 1/32);
 * also hot when load is dense (≥ 5) with stepSec < 0.09, or very dense (≥ 8).
 */
export function isHotArp(): boolean {
  if (!arpKeepAlive) return false;
  if (arpStepSec < 0.05) return true;
  if (arpStepSec < 0.09 && arpLoad >= 5) return true;
  if (arpLoad >= 8) return true;
  return false;
}

/** Lookahead horizon (seconds) — shrinks when hot so fewer futures collide. */
export function arpLookaheadSec(): number {
  if (!arpKeepAlive) return 0.12;
  if (isHotArp()) {
    const h = Math.max(0.035, Math.min(0.07, arpStepSec * 2.2));
    return h;
  }
  return 0.12;
}
