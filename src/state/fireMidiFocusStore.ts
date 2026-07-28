/**
 * MPK / MIDI Focus controller — knobs drive the active Signal Path module;
 * PROG cycles modules; BANK pages when a module has >8 knobs.
 */

import { create } from "zustand";
import { useFireCommandStore } from "@/state/fireCommandStore";
import { useUIStore } from "@/state/uiStore";
import {
  FIRE_FOCUS_COUNT,
  MPK_FOCUS_CC,
  MPK_KNOB_CC_SETS,
  MPK_PAD_NAV,
  ccToFocusValue,
  clearLearnedKnobCcs,
  focusBandTitle,
  focusColor,
  focusModuleAt,
  focusPageCount,
  focusPageKnobs,
  focusShort,
  focusTitle,
  loadLearnedKnobCcs,
  saveLearnedKnobCcs,
  type FocusKnob,
} from "@/components/FireCommand/fireKnobFocus";
import type { FireModuleId } from "@/components/FireCommand/fireModuleAtlas";

type FocusBridge = {
  enterFocus: (moduleId: string) => void;
  exitFocus: () => void;
};

let bridge: FocusBridge | null = null;

/** Wired from FireLayoutProvider so MIDI can solo the active module. */
export function registerFireFocusBridge(b: FocusBridge | null): void {
  bridge = b;
}

interface FireMidiFocusState {
  /** When true, knobs + PROG/BANK drive Signal Path focus. */
  enabled: boolean;
  index: number;
  /** 0 = Bank A (knobs 1–8), 1 = Bank B (knobs 9–16), … */
  bankPage: number;
  /** Locked K1–K8 CC numbers (learned or matched preset). */
  knobSet: number[] | null;
  /** How many of 8 slots are bound while auto-learning. */
  knobsBound: number;
  lastKnobLabel: string | null;
  lastKnobAt: number;
  /** Last raw CC seen (HUD debug). */
  lastCc: number | null;

  setEnabled: (on: boolean) => void;
  cycleNext: () => void;
  cyclePrev: () => void;
  setBankPage: (page: number) => void;
  toggleBank: () => void;
  jumpToIndex: (index: number) => void;
  /** Forget learned knob CCs and re-bind on next twists. */
  relearnKnobs: () => void;
  /** Handle a CC. Returns true if consumed (skip generic MIDI mappings). */
  handleCc: (cc: number, value01: number, raw: number) => boolean;
  /**
   * Pad / note navigation while Focus is on.
   * Returns true if the note was consumed (do not play synth).
   */
  handleNoteOn: (midi: number, velocity: number) => boolean;
  /** Program Change — advance source. */
  handleProgramChange: (program: number) => void;
}

function clampIndex(i: number): number {
  return ((i % FIRE_FOCUS_COUNT) + FIRE_FOCUS_COUNT) % FIRE_FOCUS_COUNT;
}

function applyFocus(index: number, bankPage = 0, toast = true): void {
  const mod = focusModuleAt(index);
  const pages = focusPageCount(mod);
  const page = Math.max(0, Math.min(pages - 1, bankPage));
  useFireMidiFocusStore.setState({ index, bankPage: page });
  bridge?.enterFocus(mod.id);
  if (toast) {
    useUIStore.getState().toast(
      `${focusShort(mod.id)} · ${focusTitle(mod.id)}${pages > 1 ? ` · Bank ${page === 0 ? "A" : "B"}` : ""}`,
    );
  }
}

/** Live MIDI writes — coalesce history, skip per-tick persist thrash. */
function applyKnob(knob: FocusKnob, rawCc: number): void {
  const v = ccToFocusValue(rawCc, knob);
  const store = useFireCommandStore.getState();
  // setParam already coalesces undo by key; keep engine + UI in sync.
  store.setParam(knob.key, v as never);
  useFireMidiFocusStore.setState({
    lastKnobLabel: knob.label,
    lastKnobAt: Date.now(),
  });
}

function runNav(action: "prev" | "next" | "bank"): void {
  const s = useFireMidiFocusStore.getState();
  if (action === "prev") s.cyclePrev();
  else if (action === "next") s.cycleNext();
  else s.toggleBank();
}

let navArmed = new Set<number>();
let padNavArmed = new Set<number>();

/** Growing auto-learn list until 8 unique CCs are collected. */
let learnOrder: number[] = [];

function resolveKnobIndex(cc: number, locked: number[] | null): number {
  if (locked) return locked.indexOf(cc);

  // Known presets
  for (const setCcs of MPK_KNOB_CC_SETS) {
    const i = setCcs.indexOf(cc);
    if (i >= 0) {
      useFireMidiFocusStore.setState({ knobSet: setCcs, knobsBound: 8 });
      saveLearnedKnobCcs(setCcs);
      useUIStore.getState().toast(`MPK knobs bound (preset CC ${setCcs[0]}–…)`);
      return i;
    }
  }

  // Auto-learn: first 8 unique CCs become K1–K8 in twist order.
  if (cc === MPK_FOCUS_CC.prev || cc === MPK_FOCUS_CC.next || cc === MPK_FOCUS_CC.bankToggle) {
    return -1;
  }
  let idx = learnOrder.indexOf(cc);
  if (idx < 0) {
    if (learnOrder.length >= 8) return -1;
    learnOrder.push(cc);
    idx = learnOrder.length - 1;
    useFireMidiFocusStore.setState({ knobsBound: learnOrder.length, lastCc: cc });
    if (learnOrder.length === 8) {
      const setCcs = [...learnOrder];
      useFireMidiFocusStore.setState({ knobSet: setCcs, knobsBound: 8 });
      saveLearnedKnobCcs(setCcs);
      useUIStore.getState().toast(`MPK knobs learned · K1=CC${setCcs[0]} … K8=CC${setCcs[7]}`);
    } else {
      useUIStore.getState().toast(`Learning knobs… K${idx + 1}=CC${cc} (${learnOrder.length}/8)`);
    }
  }
  return idx;
}

export const useFireMidiFocusStore = create<FireMidiFocusState>((set, get) => ({
  enabled: true,
  index: 0,
  bankPage: 0,
  knobSet: typeof window !== "undefined" ? loadLearnedKnobCcs() : null,
  knobsBound: typeof window !== "undefined" ? (loadLearnedKnobCcs()?.length ?? 0) : 0,
  lastKnobLabel: null,
  lastKnobAt: 0,
  lastCc: null,

  setEnabled: (on) => {
    set({ enabled: on });
    if (on) applyFocus(get().index, get().bankPage);
    else bridge?.exitFocus();
  },

  cycleNext: () => {
    const next = clampIndex(get().index + 1);
    applyFocus(next, 0);
  },

  cyclePrev: () => {
    const prev = clampIndex(get().index - 1);
    applyFocus(prev, 0);
  },

  setBankPage: (page) => {
    const mod = focusModuleAt(get().index);
    const pages = focusPageCount(mod);
    const p = Math.max(0, Math.min(pages - 1, page));
    set({ bankPage: p });
    useUIStore.getState().toast(
      `${focusShort(mod.id)} · Bank ${String.fromCharCode(65 + p)}${pages > 1 ? ` (${p + 1}/${pages})` : ""}`,
    );
  },

  toggleBank: () => {
    const mod = focusModuleAt(get().index);
    const pages = focusPageCount(mod);
    if (pages <= 1) {
      useUIStore.getState().toast(`${focusShort(mod.id)} · only one knob bank`);
      return;
    }
    const next = (get().bankPage + 1) % pages;
    get().setBankPage(next);
  },

  jumpToIndex: (index) => applyFocus(clampIndex(index), 0),

  relearnKnobs: () => {
    clearLearnedKnobCcs();
    learnOrder = [];
    set({ knobSet: null, knobsBound: 0, lastCc: null });
    useUIStore.getState().toast("Twist K1→K8 to re-bind MPK knobs");
  },

  handleCc: (cc, value01, raw) => {
    if (!get().enabled) return false;
    set({ lastCc: cc });

    // Navigation (momentary)
    if (cc === MPK_FOCUS_CC.prev || cc === MPK_FOCUS_CC.next || cc === MPK_FOCUS_CC.bankToggle) {
      const down = raw >= 64;
      if (down && !navArmed.has(cc)) {
        navArmed.add(cc);
        if (cc === MPK_FOCUS_CC.prev) get().cyclePrev();
        else if (cc === MPK_FOCUS_CC.next) get().cycleNext();
        else get().toggleBank();
      }
      if (!down) navArmed.delete(cc);
      return true;
    }

    const knobIdx = resolveKnobIndex(cc, get().knobSet);
    if (knobIdx < 0) return false;

    const mod = focusModuleAt(get().index);
    const pageKnobs = focusPageKnobs(mod, get().bankPage);
    const knob = pageKnobs[knobIdx];
    if (!knob) return true;
    applyKnob(knob, raw);
    void value01;
    return true;
  },

  handleNoteOn: (midi, velocity) => {
    if (!get().enabled || velocity <= 0) return false;
    const action = MPK_PAD_NAV[midi];
    if (!action) return false;

    // Debounce note-on spam / note-repeat
    if (padNavArmed.has(midi)) return true;
    padNavArmed.add(midi);
    window.setTimeout(() => padNavArmed.delete(midi), 180);
    runNav(action);
    return true;
  },

  handleProgramChange: (_program) => {
    if (!get().enabled) return;
    void _program;
    get().cycleNext();
  },
}));

export function getFocusHud(): {
  enabled: boolean;
  moduleId: FireModuleId;
  title: string;
  short: string;
  band: string;
  color: string;
  bankPage: number;
  bankPages: number;
  knobs: (FocusKnob | null)[];
  lastKnobLabel: string | null;
  index: number;
  total: number;
} {
  const s = useFireMidiFocusStore.getState();
  const mod = focusModuleAt(s.index);
  return {
    enabled: s.enabled,
    moduleId: mod.id,
    title: focusTitle(mod.id),
    short: focusShort(mod.id),
    band: focusBandTitle(mod.id),
    color: focusColor(mod.id),
    bankPage: s.bankPage,
    bankPages: focusPageCount(mod),
    knobs: focusPageKnobs(mod, s.bankPage),
    lastKnobLabel: s.lastKnobLabel,
    index: s.index,
    total: FIRE_FOCUS_COUNT,
  };
}

/**
 * Restore learned knob CCs when Fire Command mounts. Deliberately does NOT
 * solo the ring module: auto-entering Focus on mount hid every other module
 * behind the MPK ring until the user toggled keyboard Focus — Solo should
 * only engage from an explicit action (PROG/pads/Solo buttons).
 */
export function bootFireMidiFocus(): void {
  const s = useFireMidiFocusStore.getState();
  if (!s.enabled) return;
  const learned = loadLearnedKnobCcs();
  if (learned) {
    learnOrder = [...learned];
    useFireMidiFocusStore.setState({ knobSet: learned, knobsBound: 8 });
  }
}
