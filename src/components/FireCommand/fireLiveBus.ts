/**
 * One engine-poll loop for every live readout in Fire Command.
 *
 * WHY THIS EXISTS
 * Two patterns were each spawning their own `requestAnimationFrame` per
 * consumer:
 *
 *  - `useToneTelemetry` ran a loop per env module (up to 4) and called
 *    `setState` on every tick whether or not anything had changed.
 *  - Every `Dial` with a modulation route ran an UNCAPPED 60 fps loop that
 *    called `activeFireEngine()` + `getLfoValue()` and then `setState`. With
 *    ~189 knobs and a busy matrix that was 50–80 loops, each re-rendering a
 *    React component and re-reading the engine every single frame.
 *
 * Everything now shares one 30 fps loop that reads the engine ONCE per tick and
 * only notifies subscribers when a value actually moved. The loop doesn't exist
 * while nothing is subscribed, and parks itself while the document is hidden.
 */

import { activeFireEngine, useFireCommandStore } from "@/state/fireCommandStore";
import { idleTelemetry, type ToneVoiceTelemetry } from "@/audio/dsp/toneDifferentiation";

export const IDLE_TELEMETRY: ToneVoiceTelemetry = {
  voiceCount: 0,
  amp: idleTelemetry(),
  mod: idleTelemetry(),
  filt: idleTelemetry(),
  pluck: idleTelemetry(),
};

/** Modulation sources a knob's live indicator can follow. */
export type ModSources = {
  lfo1: number;
  lfo2: number;
  macro1: number;
  macro2: number;
  macro3: number;
  macro4: number;
};

const IDLE_SOURCES: ModSources = { lfo1: 0, lfo2: 0, macro1: 0, macro2: 0, macro3: 0, macro4: 0 };

type Listener<T> = (v: T) => void;

const telSubs = new Set<Listener<ToneVoiceTelemetry>>();
const modSubs = new Set<Listener<ModSources>>();

let raf = 0;
let lastTick = 0;
/** 30 fps is past the point where a modulation dot or env cursor reads smooth. */
const POLL_MS = 33;

let lastTel: ToneVoiceTelemetry = IDLE_TELEMETRY;
let lastSources: ModSources = IDLE_SOURCES;

/** Cheap signature so an idle engine doesn't re-render anything. */
function telChanged(a: ToneVoiceTelemetry, b: ToneVoiceTelemetry): boolean {
  if (a.voiceCount !== b.voiceCount) return true;
  return (
    Math.abs(a.amp.level - b.amp.level) > 0.002 ||
    Math.abs(a.mod.level - b.mod.level) > 0.002 ||
    Math.abs(a.filt.level - b.filt.level) > 0.002 ||
    Math.abs(a.pluck.level - b.pluck.level) > 0.002 ||
    a.amp.stage !== b.amp.stage ||
    a.mod.stage !== b.mod.stage ||
    a.filt.stage !== b.filt.stage ||
    a.pluck.stage !== b.pluck.stage
  );
}

function sourcesChanged(a: ModSources, b: ModSources): boolean {
  return (
    Math.abs(a.lfo1 - b.lfo1) > 0.004 ||
    Math.abs(a.lfo2 - b.lfo2) > 0.004 ||
    a.macro1 !== b.macro1 ||
    a.macro2 !== b.macro2 ||
    a.macro3 !== b.macro3 ||
    a.macro4 !== b.macro4
  );
}

function tick(now: number) {
  raf = 0;
  if (telSubs.size === 0 && modSubs.size === 0) return;
  // Hidden window: park completely (visibility listener below restarts) —
  // scheduling no-op frames still wakes the compositor every vsync.
  if (document.hidden) return;
  raf = requestAnimationFrame(tick);
  if (now - lastTick < POLL_MS) return;
  lastTick = now;

  // One engine handle per tick, shared by every subscriber.
  let eng: ReturnType<typeof activeFireEngine> | null = null;
  try {
    eng = activeFireEngine();
  } catch {
    eng = null;
  }

  if (telSubs.size > 0) {
    let next = IDLE_TELEMETRY;
    try {
      next = eng?.getToneTelemetry?.() ?? IDLE_TELEMETRY;
    } catch {
      next = IDLE_TELEMETRY;
    }
    if (telChanged(next, lastTel)) {
      lastTel = next;
      for (const fn of telSubs) fn(next);
    }
  }

  if (modSubs.size > 0) {
    let next = IDLE_SOURCES;
    try {
      const patch = useFireCommandStore.getState().patch;
      next = {
        lfo1: eng?.getLfoValue?.(1) ?? 0,
        lfo2: eng?.getLfoValue?.(2) ?? 0,
        macro1: patch.macro1,
        macro2: patch.macro2,
        macro3: patch.macro3,
        macro4: patch.macro4,
      };
    } catch {
      next = IDLE_SOURCES;
    }
    if (sourcesChanged(next, lastSources)) {
      lastSources = next;
      for (const fn of modSubs) fn(next);
    }
  }
}

function ensureLoop() {
  if (!raf && !document.hidden) raf = requestAnimationFrame(tick);
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && (telSubs.size > 0 || modSubs.size > 0)) ensureLoop();
  });
}

export function subscribeToneTelemetry(fn: Listener<ToneVoiceTelemetry>): () => void {
  telSubs.add(fn);
  ensureLoop();
  return () => {
    telSubs.delete(fn);
  };
}

export function subscribeModSources(fn: Listener<ModSources>): () => void {
  modSubs.add(fn);
  ensureLoop();
  return () => {
    modSubs.delete(fn);
  };
}

/** Latest polled values, for a first paint before the next tick lands. */
export function currentToneTelemetry(): ToneVoiceTelemetry {
  return lastTel;
}

export function currentModSources(): ModSources {
  return lastSources;
}
