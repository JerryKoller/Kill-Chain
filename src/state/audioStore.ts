import { create } from "zustand";
import type { ParametricBand, SoundParams } from "@/audio/types";
import { NEUTRAL_PARAMS, normalizeParams, paramsAreNeutral } from "@/audio/types";
import { getEngine } from "@/audio/AudioEngine";
import { RESTORE_OFF, restoreActive, type RestoreParams } from "@/audio/dsp/Reconstructor";
// Deferred-use import (functions are only called inside actions) — safe
// despite the module cycle chainSnapshot → audioStore.
import { applyChain, captureChain, type ChainSnapshot } from "@/lib/chainSnapshot";
import type { RoomId } from "@/audio/dsp/HRTFRooms";
import { DEFAULT_CORRECTION_BANDS, DEFAULT_OUTPUT_GAIN_DB } from "@/audio/defaultCorrectionProfile";
import { HEADPHONES, profileForId } from "@/audio/headphoneProfiles";
import { useSettingsStore, type HeadphoneId } from "@/state/settingsStore";

export type EngineStatus = "idle" | "loading" | "ready" | "playing" | "error";

export interface AudioState {
  status: EngineStatus;
  params: SoundParams;
  correctionBands: ParametricBand[];
  correctionEnabled: boolean;
  outputGainDb: number;
  bypass: boolean;
  /** Full-chain A/B: side "A" of the compare (v1.5 — was params-only). */
  abSnapshot: ChainSnapshot | null;
  /** Measured loudness (short-term LUFS) of the stored A side, if known. */
  abLufs: number | null;
  history: SoundParams[];
  future: SoundParams[];

  ensureReady: () => Promise<void>;
  setParam: <K extends keyof SoundParams>(key: K, value: SoundParams[K]) => void;
  setParams: (next: Partial<SoundParams>) => void;
  /** Apply params to the DSP only — does NOT push to undo history. */
  previewParams: (next: Partial<SoundParams>) => void;
  replaceParams: (next: SoundParams) => void;
  setBypass: (bypass: boolean) => void;
  toggleBypass: () => void;
  setCorrectionEnabled: (enabled: boolean) => void;
  toggleCorrection: () => void;
  storeAB: () => void;
  swapAB: () => void;
  clearAB: () => void;
  setOutputGain: (db: number) => void;
  replaceCorrectionBands: (bands: ParametricBand[]) => void;
  /** Switch the entire correction profile to a different headphone model. */
  setHeadphoneProfile: (id: HeadphoneId) => void;

  // Pro tools (engine-only state - not part of SoundParams).
  room: RoomId;
  roomMix: number;
  balanceLDb: number;
  balanceRDb: number;
  balanceDelayMs: number;
  setRoom: (room: RoomId, mix?: number) => void;
  setRoomMix: (mix: number) => void;
  setBalance: (leftDb: number, rightDb: number, delayMs: number) => void;

  /** Restoration Bay (session-only — a per-source repair, not a preset). */
  restore: RestoreParams;
  setRestore: (patch: Partial<RestoreParams>) => void;

  /** Clarity Engine amount 0..1 (session-only). */
  clarity: number;
  setClarity: (amount: number) => void;

  /** v2.1 — repair-stack A/B: true-bypass Restoration → Clarity → Sculptor EQ
   *  (session-only, never captured in snapshots). */
  repairBypass: boolean;
  setRepairBypass: (b: boolean) => void;

  undo: () => void;
  redo: () => void;
  resetToNeutral: () => void;
}

const HISTORY_CAP = 64;

// Coalesce a continuous drag of one knob/slider into a SINGLE undo step.
// Without this, every pointer-move frame pushed a new history entry (dozens
// per drag) — flooding undo and allocating a fresh history array each frame.
const DRAG_COALESCE_MS = 500;
let lastParamKey: keyof SoundParams | null = null;
let lastParamTs = 0;

/**
 * Engage the FX chain (leave clean bypass) only when there's something
 * non-neutral to actually hear. `force` is for intents that are inherently
 * audible (correction layer, room) regardless of the tone params. If the
 * candidate state is fully neutral we STAY in bypass so playback remains
 * bit-identical to the source (WMP parity).
 */
function engageFxChain(
  get: () => AudioState,
  set: (partial: Partial<AudioState>) => void,
  candidate: SoundParams,
  force = false,
): void {
  if (!get().bypass) return;
  if (!force && paramsAreNeutral(candidate)) return;
  set({ bypass: false });
  getEngine().setBypass(false);
}

/** One-shot guard: persisted headphone profile applied on first engine boot. */
let bootProfileApplied = false;

export const useAudioStore = create<AudioState>((set, get) => ({
  status: "idle",
  params: { ...NEUTRAL_PARAMS },
  correctionBands: [...DEFAULT_CORRECTION_BANDS],
  correctionEnabled: false,
  outputGainDb: DEFAULT_OUTPUT_GAIN_DB,
  bypass: true,
  abSnapshot: null,
  abLufs: null,
  history: [],
  future: [],

  room: "off",
  roomMix: 0,
  balanceLDb: 0,
  balanceRDb: 0,
  balanceDelayMs: 0,
  restore: { ...RESTORE_OFF },
  clarity: 0,
  repairBypass: false,

  ensureReady: async () => {
    const engine = getEngine();
    set({ status: "loading" });
    await engine.resume();
    // v1.5: restore the persisted correction profile (built-in OR imported
    // custom — the wizard injects those into HEADPHONES before this runs).
    // Previously the store always booted on XM6 bands regardless of the
    // saved pick. Only do this once, before any session tweaks exist.
    if (!bootProfileApplied) {
      bootProfileApplied = true;
      const hpId = useSettingsStore.getState().headphone;
      const hp = profileForId(hpId);
      set({ correctionBands: hp.bands, outputGainDb: hp.outputGainDb });
    }
    engine.applyParams(get().params);
    engine.replaceCorrectionBands(get().correctionBands);
    engine.setOutputGainDb(get().outputGainDb);
    engine.setCorrectionEnabled(get().correctionEnabled);
    engine.setBypass(get().bypass);
    // Apply the persisted output sink (different device for Exterior Audio).
    try {
      const id = useSettingsStore.getState().audioOutputDeviceId;
      if (id) await engine.setOutputDevice(id);
    } catch { /* ignore */ }
    set({ status: "ready" });
  },

  setParam: (key, value) => {
    const prev = get().params;
    if (prev[key] === value) return;
    const next = { ...prev, [key]: value };
    engageFxChain(get, set, next);
    // While the same control is being dragged, keep the original snapshot and
    // skip pushing per-frame entries; a new gesture (different key or a pause)
    // starts a fresh undo step.
    const now = performance.now();
    const coalesce = key === lastParamKey && now - lastParamTs < DRAG_COALESCE_MS;
    lastParamKey = key;
    lastParamTs = now;
    const history = coalesce
      ? get().history
      : [...get().history, prev].slice(-HISTORY_CAP);
    set({ params: next, history, future: [] });
    getEngine().applyParams({ [key]: value } as Partial<SoundParams>);
  },

  setParams: (next) => {
    const prev = get().params;
    const merged: SoundParams = { ...prev, ...next };
    engageFxChain(get, set, merged);
    const history = [...get().history, prev].slice(-HISTORY_CAP);
    set({ params: merged, history, future: [] });
    getEngine().applyParams(next);
  },

  previewParams: (next) => {
    const merged: SoundParams = { ...get().params, ...next };
    engageFxChain(get, set, merged);
    set({ params: merged });
    getEngine().applyParams(next);
  },

  replaceParams: (next) => {
    const prev = get().params;
    const safe = normalizeParams(next);
    engageFxChain(get, set, safe);
    const history = [...get().history, prev].slice(-HISTORY_CAP);
    set({ params: { ...safe }, history, future: [] });
    getEngine().applyParams(safe);
  },

  setBypass: (bypass) => {
    set({ bypass });
    getEngine().setBypass(bypass);
  },

  toggleBypass: () => {
    const next = !get().bypass;
    set({ bypass: next });
    getEngine().setBypass(next);
  },

  setCorrectionEnabled: (enabled) => {
    if (enabled) engageFxChain(get, set, get().params, true);
    set({ correctionEnabled: enabled });
    getEngine().setCorrectionEnabled(enabled);
  },

  toggleCorrection: () => {
    const next = !get().correctionEnabled;
    set({ correctionEnabled: next });
    getEngine().setCorrectionEnabled(next);
  },

  storeAB: () => {
    // Full-chain snapshot + start the loudness meter so the NEXT swap can be
    // level-matched (short-term LUFS needs a few seconds of history).
    const engine = getEngine();
    if (!get().abSnapshot) engine.ensureLufsMeter();
    const lufs = engine.lufs.shortTermLufs;
    set({
      abSnapshot: captureChain(),
      abLufs: lufs > -70 ? lufs : null,
    });
  },

  swapAB: () => {
    const snap = get().abSnapshot;
    if (!snap) return;
    const engine = getEngine();
    // Loudness of the OUTGOING side, measured live right now.
    const curLufs = engine.lufs.shortTermLufs;
    const outgoing = captureChain();
    const incomingLufs = get().abLufs;
    applyChain(snap);
    // Level match: trim the output gain so the incoming side plays at the
    // outgoing side's loudness — comparisons stay fair ("louder ≠ better").
    if (curLufs > -70 && incomingLufs !== null) {
      const trim = Math.max(-6, Math.min(6, curLufs - incomingLufs));
      if (Math.abs(trim) > 0.25) {
        get().setOutputGain(snap.outputGainDb + trim);
      }
    }
    set({
      abSnapshot: outgoing,
      abLufs: curLufs > -70 ? curLufs : null,
    });
  },

  clearAB: () => {
    if (get().abSnapshot) getEngine().releaseLufsMeter();
    set({ abSnapshot: null, abLufs: null });
  },

  setOutputGain: (db) => {
    set({ outputGainDb: db });
    getEngine().setOutputGainDb(db);
  },

  replaceCorrectionBands: (bands) => {
    set({ correctionBands: bands });
    getEngine().replaceCorrectionBands(bands);
  },

  setHeadphoneProfile: (id) => {
    const profile = profileForId(id);
    set({
      correctionBands: profile.bands,
      outputGainDb: profile.outputGainDb,
    });
    const engine = getEngine();
    engine.replaceCorrectionBands(profile.bands);
    engine.setOutputGainDb(profile.outputGainDb);
  },

  setRoom: (room, mix) => {
    const m = mix !== undefined ? mix : get().roomMix;
    if (room !== "off" && m > 0) engageFxChain(get, set, get().params, true);
    set({ room, roomMix: m });
    getEngine().setRoom(room, m);
  },
  setRoomMix: (mix) => {
    if (mix > 0 && get().room !== "off") engageFxChain(get, set, get().params, true);
    set({ roomMix: mix });
    getEngine().setRoom(get().room, mix);
  },
  setBalance: (l, r, d) => {
    set({ balanceLDb: l, balanceRDb: r, balanceDelayMs: d });
    getEngine().setBalance(l, r, d);
  },

  setRestore: (patch) => {
    const restore: RestoreParams = { ...get().restore, ...patch };
    if (restoreActive(restore)) engageFxChain(get, set, get().params, true);
    set({ restore });
    getEngine().setRestore(patch);
  },

  setClarity: (amount) => {
    const clarity = Math.max(0, Math.min(1, amount));
    if (clarity > 0) engageFxChain(get, set, get().params, true);
    set({ clarity });
    getEngine().setClarity(clarity);
  },

  setRepairBypass: (b) => {
    if (get().repairBypass === b) return;
    set({ repairBypass: b });
    getEngine().setRepairBypass(b);
  },

  undo: () => {
    const { history, params, future } = get();
    if (history.length === 0) return;
    const prev = history[history.length - 1];
    set({
      params: prev,
      history: history.slice(0, -1),
      future: [params, ...future].slice(0, HISTORY_CAP),
    });
    getEngine().applyParams(prev);
  },

  redo: () => {
    const { future, params, history } = get();
    if (future.length === 0) return;
    const next = future[0];
    set({
      params: next,
      future: future.slice(1),
      history: [...history, params].slice(-HISTORY_CAP),
    });
    getEngine().applyParams(next);
  },

  resetToNeutral: () => {
    const prev = get().params;
    const history = [...get().history, prev].slice(-HISTORY_CAP);
    // Restore the active headphone's default output level too, so a Clear All
    // wipes any gain offset left behind by Pro Tools / LUFS normalize.
    const headphoneId = useSettingsStore.getState().headphone;
    const profile = profileForId(headphoneId);
    const defaultGainDb = profile.outputGainDb ?? DEFAULT_OUTPUT_GAIN_DB;
    set({
      params: { ...NEUTRAL_PARAMS },
      history,
      future: [],
      bypass: true,
      correctionEnabled: false,
      outputGainDb: defaultGainDb,
      room: "off",
      roomMix: 0,
      balanceLDb: 0,
      balanceRDb: 0,
      balanceDelayMs: 0,
      restore: { ...RESTORE_OFF },
      clarity: 0,
      repairBypass: false,
    });
    const engine = getEngine();
    engine.setRepairBypass(false);
    engine.setBypass(true);
    engine.setCorrectionEnabled(false);
    engine.applyParams(NEUTRAL_PARAMS);
    engine.setOutputGainDb(defaultGainDb);
    engine.setRoom("off", 0);
    engine.setBalance(0, 0, 0);
    engine.setRestore({ ...RESTORE_OFF });
    engine.setClarity(0);
  },
}));
