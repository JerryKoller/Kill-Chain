import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { GlassPanel } from "@/components/shared/GlassPanel";
import { NeonButton } from "@/components/shared/NeonButton";
import { useAudioStore } from "@/state/audioStore";
import { useUIStore } from "@/state/uiStore";
import { useMidiStore } from "@/state/midiStore";
import { SOUND_PARAM_META, type SoundParams } from "@/audio/types";
import {
  SCENE_SLOT_COUNT,
  flushPadsPersist,
  useReactorStore,
  type ReactorPad,
} from "@/state/reactorStore";
import { PadEditor } from "./PadEditor";

/**
 * Macro Reactor — a performance strike surface.
 *
 * Every pad is a set of param deltas layered non-destructively over the sound
 * you walked in with. LATCH pads toggle; MOMENTARY pads engage only while
 * held. Where you strike a pad vertically sets its intensity, and dragging
 * up/down while held rides the depth live. Number keys 1–8 fire pads while
 * the surface is armed (focused). KEEP BLEND bakes the stack onto the sculpt;
 * RESET, Escape, or leaving with an unapplied stack restores the walk-in
 * sound. Opening the tab is silent until a pad is struck.
 */
export function MacroReactorView() {
  const pads = useReactorStore((s) => s.pads);
  const engaged = useReactorStore((s) => s.engaged);
  const baseline = useReactorStore((s) => s.baseline);
  const scenes = useReactorStore((s) => s.scenes);
  const lastKept = useReactorStore((s) => s.lastKept);
  const params = useAudioStore((s) => s.params);
  const toast = useUIStore((s) => s.toast);
  const midiAvailable = useMidiStore((s) => s.available);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [keysArmed, setKeysArmed] = useState(false);
  const [confirmPurge, setConfirmPurge] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const keyHeldRef = useRef<Set<string>>(new Set());
  const purgeTimer = useRef<number | null>(null);
  const pressRef = useRef<{
    id: string;
    wasEngaged: boolean;
    moved: boolean;
    y0: number;
    t0: number;
  } | null>(null);

  // Session lifecycle: mounting arms the reactor, unmounting stands it down
  // (releases every pad and restores the pre-reactor sound).
  useEffect(() => {
    useReactorStore.getState().setSessionActive(true);
    containerRef.current?.focus({ preventScroll: true });
    return () => {
      const st = useReactorStore.getState();
      const hadStack =
        st.baseline != null &&
        Object.values(st.engaged).some((eng) => eng.phase !== "out");
      st.setSessionActive(false);
      flushPadsPersist();
      if (hadStack) {
        useUIStore.getState().toast("Left Reactor — unapplied stack was restored");
      }
    };
  }, []);

  // Alt-Tab safety: keyup never arrives if the window loses focus while a
  // momentary key is held — release everything key-held on window blur.
  useEffect(() => {
    const onWinBlur = () => {
      const st = useReactorStore.getState();
      for (const id of keyHeldRef.current) st.releasePad(id);
      keyHeldRef.current.clear();
    };
    window.addEventListener("blur", onWinBlur);
    return () => window.removeEventListener("blur", onWinBlur);
  }, []);

  useEffect(
    () => () => {
      if (purgeTimer.current != null) window.clearTimeout(purgeTimer.current);
    },
    [],
  );

  // Escape: cancel MIDI learn, close Tune, then stand down the live stack.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.tagName === "SELECT" ||
          t.isContentEditable)
      ) {
        return;
      }
      const midi = useMidiStore.getState();
      if (midi.learning?.kind === "reactorPad") {
        e.preventDefault();
        midi.setLearning(null);
        toast("MIDI learn cancelled");
        return;
      }
      if (confirmPurge) {
        e.preventDefault();
        setConfirmPurge(false);
        return;
      }
      if (editingId) {
        e.preventDefault();
        setEditingId(null);
        return;
      }
      const st = useReactorStore.getState();
      const live = Object.values(st.engaged).some((eng) => eng.phase !== "out");
      if (live) {
        e.preventDefault();
        st.resetAll();
        toast("Reactor stood down — original sound restored");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editingId, confirmPurge, toast]);

  const activeEntries = useMemo(
    () => Object.entries(engaged).filter(([, e]) => e.phase !== "out"),
    [engaged],
  );
  const activeCount = activeEntries.length;
  const hasActive = activeCount > 0;

  // ── Keyboard triggering (1–8) while the surface is focused ──
  const isEditable = (t: EventTarget | null): boolean => {
    const el = t as HTMLElement | null;
    if (!el) return false;
    return (
      el.tagName === "INPUT" ||
      el.tagName === "TEXTAREA" ||
      el.tagName === "SELECT" ||
      el.isContentEditable
    );
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (isEditable(e.target)) return;
    const idx = "12345678".indexOf(e.key);
    if (idx < 0 || idx >= pads.length) return;
    // Own the number row here — stop it reaching the global view-switcher.
    e.preventDefault();
    e.stopPropagation();
    if (e.repeat) return;
    const pad = pads[idx];
    const st = useReactorStore.getState();
    if (pad.mode === "momentary") {
      keyHeldRef.current.add(pad.id);
      st.engagePad(pad.id, 1);
    } else {
      st.togglePad(pad.id, 1);
    }
  };

  const onKeyUp = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (isEditable(e.target)) return;
    const idx = "12345678".indexOf(e.key);
    if (idx < 0 || idx >= pads.length) return;
    e.preventDefault();
    e.stopPropagation();
    const pad = pads[idx];
    if (keyHeldRef.current.delete(pad.id)) {
      useReactorStore.getState().releasePad(pad.id);
    }
  };

  const onSurfaceBlur = (e: React.FocusEvent<HTMLDivElement>) => {
    if (containerRef.current?.contains(e.relatedTarget as Node)) return;
    setKeysArmed(false);
    // Never leave momentary pads stuck if focus walks away mid-hold.
    const st = useReactorStore.getState();
    for (const id of keyHeldRef.current) st.releasePad(id);
    keyHeldRef.current.clear();
  };

  // ── Pointer interaction: strike height = intensity, drag = ride it ──
  const intensityFromEvent = (
    e: React.PointerEvent,
    el: HTMLElement,
  ): number => {
    const r = el.getBoundingClientRect();
    const raw = 1 - (e.clientY - r.top) / Math.max(1, r.height);
    return Math.max(0.12, Math.min(1, raw));
  };

  const onPadPointerDown =
    (pad: ReactorPad) => (e: React.PointerEvent<HTMLButtonElement>) => {
      if ((e.target as HTMLElement).closest("[data-krx-stop]")) return;
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      const st = useReactorStore.getState();
      const eng = st.engaged[pad.id];
      const isOn = !!eng && eng.phase !== "out";
      const intensity = intensityFromEvent(e, e.currentTarget);
      pressRef.current = {
        id: pad.id,
        wasEngaged: isOn,
        moved: false,
        y0: e.clientY,
        t0: performance.now(),
      };
      if (pad.mode === "momentary") st.engagePad(pad.id, intensity);
      else if (!isOn) st.engagePad(pad.id, intensity);
      // Engaged latch pad: hold & drag rides intensity; a quick tap releases.
    };

  const onPadPointerMove =
    (pad: ReactorPad) => (e: React.PointerEvent<HTMLButtonElement>) => {
      const press = pressRef.current;
      if (!press || press.id !== pad.id) return;
      if (!press.moved && Math.abs(e.clientY - press.y0) > 6) press.moved = true;
      if (press.moved) {
        useReactorStore
          .getState()
          .setPadIntensity(pad.id, intensityFromEvent(e, e.currentTarget));
      }
    };

  const onPadPointerUp =
    (pad: ReactorPad) => (e: React.PointerEvent<HTMLButtonElement>) => {
      try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      const press = pressRef.current;
      if (!press || press.id !== pad.id) return;
      pressRef.current = null;
      const st = useReactorStore.getState();
      if (pad.mode === "momentary") {
        st.releasePad(pad.id);
        return;
      }
      const quickTap = !press.moved && performance.now() - press.t0 < 350;
      if (press.wasEngaged && quickTap) st.releasePad(pad.id);
    };

  const onPadPointerCancel = (pad: ReactorPad) => (e: React.PointerEvent<HTMLButtonElement>) => {
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    const press = pressRef.current;
    const mine = press?.id === pad.id;
    if (mine) pressRef.current = null;
    if (pad.mode === "momentary") {
      useReactorStore.getState().releasePad(pad.id);
      return;
    }
    // OS abort on a *new* latch strike must not leave the pad on. Riding an
    // already-latched pad + cancel keeps it. Ignore cancels for other pads.
    if (mine && press && !press.wasEngaged) {
      useReactorStore.getState().releasePad(pad.id);
    }
  };

  // Space / Enter on a focused pad: hold for momentary, toggle for latch.
  // preventDefault so Space doesn't also hit global play/pause, and so the
  // synthesized click doesn't latch a momentary pad on.
  const onPadKeyDown =
    (pad: ReactorPad) => (e: React.KeyboardEvent<HTMLButtonElement>) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      if ((e.target as HTMLElement).closest("[data-krx-stop]")) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.repeat) return;
      const st = useReactorStore.getState();
      if (pad.mode === "momentary") {
        keyHeldRef.current.add(pad.id);
        st.engagePad(pad.id, 1);
      } else {
        st.togglePad(pad.id, 1);
      }
    };

  const onPadKeyUp =
    (pad: ReactorPad) => (e: React.KeyboardEvent<HTMLButtonElement>) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      e.stopPropagation();
      if (keyHeldRef.current.delete(pad.id)) {
        useReactorStore.getState().releasePad(pad.id);
      }
    };

  // Keyboard activation fallback (screen readers / leftover click). Latch
  // toggles; momentary must not latch via this path — Space/Enter own hold.
  const lastKeyToggleRef = useRef(0);
  const onPadClick =
    (pad: ReactorPad) => (e: React.MouseEvent<HTMLButtonElement>) => {
      if (e.detail !== 0) return;
      if (pad.mode === "momentary") return;
      if ((e.target as HTMLElement).closest("[data-krx-stop]")) return;
      const now = performance.now();
      if (now - lastKeyToggleRef.current < 250) return;
      lastKeyToggleRef.current = now;
      useReactorStore.getState().togglePad(pad.id, 1);
    };

  // ── Header actions ──
  const doKeep = () => {
    const label = useReactorStore.getState().keep();
    if (label) toast(`Kept ${label} (tone knobs — EQ unchanged)`);
  };

  const doReset = () => {
    useReactorStore.getState().resetAll();
    toast("Reactor stood down — original sound restored");
  };

  const doSaveScene = (slot: number) => {
    if (useReactorStore.getState().saveScene(slot)) {
      toast(`Scene S${slot + 1} stored`);
    } else {
      toast("Engage pads first — a scene stores the live stack");
    }
  };

  const doRecallScene = (slot: number) => {
    if (useReactorStore.getState().recallScene(slot)) {
      toast(`Scene S${slot + 1} deployed`);
    } else {
      toast(`Scene S${slot + 1} has no valid pads`);
    }
  };

  const editingPad = editingId ? pads.find((p) => p.id === editingId) : null;
  const editingIndex = editingPad ? pads.indexOf(editingPad) : -1;

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      onFocus={() => setKeysArmed(true)}
      onBlur={onSurfaceBlur}
      className="krx-surface flex flex-col gap-3 pb-4 outline-none"
    >
      <div className="sticky top-0 z-20 -mx-4 px-4 pt-3 pb-2 bg-ink/85 backdrop-blur-md border-b border-white/[0.05]">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.3em] text-dim">
              <span className="module-tag">KC-06</span>
              <span>Macro Reactor</span>
              <span
                className={`text-[9px] px-2 py-0.5 rounded-full border tracking-[0.2em] ${
                  hasActive
                    ? "border-lime/50 text-lime bg-lime/10"
                    : "border-white/15 text-white/45"
                }`}
              >
                {hasActive ? `● ENGAGED ×${activeCount}` : "○ STANDBY"}
              </span>
              <span
                className={`hidden sm:inline text-[9px] px-2 py-0.5 rounded-full border tracking-[0.2em] ${
                  keysArmed
                    ? "border-cyan/50 text-cyan bg-cyan/10"
                    : "border-white/15 text-white/40"
                }`}
                title="Number keys fire pads while the surface is focused"
              >
                {keysArmed ? "KEYS 1–8 HOT" : "CLICK TO ARM KEYS"}
              </span>
            </div>
            <div className="text-sm text-white/70 truncate">
              Performance strike surface — hold, latch, stack and ride. Keep writes knobs, not EQ.
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span title={!hasActive ? "Nothing engaged" : "Restore the sound you walked in with"}>
              <NeonButton variant="ghost" disabled={!hasActive} onClick={doReset}>
                Reset
              </NeonButton>
            </span>
            <span
              title={
                !hasActive
                  ? "Engage a pad first"
                  : "Bake the stack into the sculpt (tone knobs — parametric EQ unchanged)"
              }
            >
              <NeonButton disabled={!hasActive} onClick={doKeep}>
                Keep blend
              </NeonButton>
            </span>
          </div>
        </div>
      </div>

      {/* How-to strip so the interaction is never a mystery. */}
      <GlassPanel className="px-4 py-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-[11px]">
          <Step
            n="1"
            title="Strike a pad"
            body="LATCH pads toggle; MOMENTARY pads run only while held (pointer, number key, or MIDI note). Strike height sets intensity — drag up/down while held to ride it."
          />
          <Step
            n="2"
            title="Stack & perform"
            body="Number keys 1–8 fire pads at full depth while this surface is focused. Stack moves, then store the combo in a scene slot for instant recall."
          />
          <Step
            n="3"
            title="Keep or stand down"
            body="KEEP BLEND writes the stack into the sculpt (tone knobs — parametric EQ unchanged). RESET, Escape, or leaving without Keep restores the sound you walked in with."
          />
        </div>
      </GlassPanel>

      <div className="grid grid-cols-12 gap-3">
        <GlassPanel intense className="col-span-12 xl:col-span-8 p-5">
          <div className="flex items-baseline justify-between mb-4 gap-3 flex-wrap">
            <div>
              <div className="text-[10px] uppercase tracking-[0.3em] text-dim">
                Reactor Pads
              </div>
              <div className="text-xl font-semibold">
                {hasActive ? `${activeCount} engaged` : "Strike to engage"}
              </div>
            </div>
            {lastKept && (
              <div className="text-[10px] uppercase tracking-widest text-cyan/80 truncate max-w-[50%]">
                Last kept: {lastKept}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
            {pads.map((pad, index) => (
              <ReactorPadButton
                key={pad.id}
                pad={pad}
                index={index}
                engagement={engaged[pad.id]}
                editing={editingId === pad.id}
                onPointerDown={onPadPointerDown(pad)}
                onPointerMove={onPadPointerMove(pad)}
                onPointerUp={onPadPointerUp(pad)}
                onPointerCancel={onPadPointerCancel(pad)}
                onKeyDown={onPadKeyDown(pad)}
                onKeyUp={onPadKeyUp(pad)}
                onClick={onPadClick(pad)}
                onEdit={() =>
                  setEditingId((cur) => (cur === pad.id ? null : pad.id))
                }
                onFlipMode={() =>
                  useReactorStore.getState().updatePad(pad.id, {
                    mode: pad.mode === "latch" ? "momentary" : "latch",
                  })
                }
              />
            ))}
          </div>

          {editingPad && editingIndex >= 0 && (
            <PadEditor
              key={editingPad.id}
              pad={editingPad}
              index={editingIndex}
              onClose={() => setEditingId(null)}
            />
          )}

          <div className="mt-4 flex items-center justify-between gap-3 flex-wrap">
            <div className="text-[10px] text-dim">
              {midiAvailable
                ? "MIDI: Tune a pad to map a trigger. Latch toggles on press; Momentary holds while the note is down."
                : ""}
            </div>
            <button
              onClick={() => {
                if (confirmPurge) {
                  if (purgeTimer.current != null) {
                    window.clearTimeout(purgeTimer.current);
                    purgeTimer.current = null;
                  }
                  setConfirmPurge(false);
                  useReactorStore.getState().restoreAllPads();
                  toast("All pads restored to factory spec");
                } else {
                  setConfirmPurge(true);
                  if (purgeTimer.current != null) window.clearTimeout(purgeTimer.current);
                  purgeTimer.current = window.setTimeout(() => setConfirmPurge(false), 2400);
                }
              }}
              title="Restore all eight pads to factory names, modes, and targets. Does not undo a Keep."
              className={`rounded-lg border px-3 py-1.5 text-[10px] uppercase tracking-[0.2em] font-semibold transition ${
                confirmPurge
                  ? "border-rose-400/70 bg-rose-500/20 text-rose-200"
                  : "border-white/10 text-white/40 hover:text-rose-200/80 hover:border-rose-400/30"
              }`}
            >
              {confirmPurge ? "CONFIRM PURGE" : "✕ Factory reset pads"}
            </button>
          </div>
        </GlassPanel>

        <GlassPanel className="col-span-12 xl:col-span-4 p-5 flex flex-col gap-4">
          {/* Scenes */}
          <div>
            <div className="text-[10px] uppercase tracking-[0.3em] text-dim">
              Scenes
            </div>
            <div className="text-xl font-semibold">Stored strike packages</div>
          </div>
          <div className="space-y-2">
            {Array.from({ length: SCENE_SLOT_COUNT }).map((_, i) => (
              <SceneSlot
                key={i}
                slot={i}
                scene={scenes[i]}
                canSave={hasActive}
                onSave={() => doSaveScene(i)}
                onRecall={() => doRecallScene(i)}
                onClear={() => {
                  useReactorStore.getState().clearScene(i);
                  toast(`Scene S${i + 1} purged`);
                }}
              />
            ))}
          </div>

          {/* Live stack */}
          <div>
            <div className="text-[10px] uppercase tracking-[0.25em] text-dim mb-2">
              Live stack
            </div>
            {activeEntries.length === 0 ? (
              <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-4 text-center text-[12px] text-white/50 leading-relaxed">
                Nothing engaged. Strike a pad — nothing is saved until you press
                Keep blend.
              </div>
            ) : (
              <div className="space-y-2">
                {activeEntries.map(([id, eng]) => {
                  const pad = pads.find((p) => p.id === id);
                  if (!pad) return null;
                  return (
                    <div
                      key={id}
                      className="rounded-xl border border-white/10 bg-white/[0.03] p-2.5 flex items-center gap-2"
                    >
                      <div className="text-lg shrink-0" style={{ color: pad.accent }}>
                        {pad.icon}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div
                          className="text-xs font-semibold truncate"
                          style={{ color: pad.accent }}
                        >
                          {pad.name}
                        </div>
                        <div className="mt-1 h-1 rounded-full bg-white/10 overflow-hidden">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${Math.round(eng.intensity * 100)}%`,
                              background: pad.accent,
                            }}
                          />
                        </div>
                      </div>
                      <div className="text-[10px] font-mono text-dim w-8 text-right shrink-0">
                        {Math.round(eng.intensity * 100)}%
                      </div>
                      <button
                        onClick={() => useReactorStore.getState().releasePad(id)}
                        data-ui-sound="none"
                        className="shrink-0 text-[9px] uppercase tracking-widest px-2 py-1 rounded-lg border border-white/12 text-white/55 hover:text-white/90 hover:border-white/30 transition"
                      >
                        Release
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Parameter drift vs baseline */}
          <div className="rounded-2xl border border-white/8 bg-black/30 p-4">
            <div className="text-[10px] uppercase tracking-[0.25em] text-dim mb-3">
              Parameter drift
            </div>
            <ParamDrift base={baseline} current={params} />
          </div>

          <div className="text-[11px] text-dim leading-relaxed">
            Previews are non-destructive.{" "}
            <span className="text-cyan">Keep blend</span> writes the engaged
            stack into your sculpt (tone knobs — parametric EQ unchanged);{" "}
            <span className="text-white/70">Reset</span> or leaving without Keep
            restores the sound you walked in with.
          </div>
        </GlassPanel>
      </div>
    </div>
  );
}

function Step({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <div className="flex gap-3">
      <div className="shrink-0 w-6 h-6 rounded-full border border-cyan/40 bg-cyan/10 text-cyan text-xs font-semibold flex items-center justify-center">
        {n}
      </div>
      <div>
        <div className="text-white/85 font-semibold">{title}</div>
        <div className="text-dim leading-relaxed mt-0.5">{body}</div>
      </div>
    </div>
  );
}

function ReactorPadButton({
  pad,
  index,
  engagement,
  editing,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onKeyDown,
  onKeyUp,
  onClick,
  onEdit,
  onFlipMode,
}: {
  pad: ReactorPad;
  index: number;
  engagement?: { intensity: number; ramp: number; phase: string };
  editing: boolean;
  onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => void;
  onPointerMove: (e: React.PointerEvent<HTMLButtonElement>) => void;
  onPointerUp: (e: React.PointerEvent<HTMLButtonElement>) => void;
  onPointerCancel: (e: React.PointerEvent<HTMLButtonElement>) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLButtonElement>) => void;
  onKeyUp: (e: React.KeyboardEvent<HTMLButtonElement>) => void;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  onEdit: () => void;
  onFlipMode: () => void;
}) {
  const isOn = !!engagement && engagement.phase !== "out";
  const level = isOn ? engagement.intensity : 0;
  const glow = isOn ? 0.35 + 0.65 * engagement.ramp : 0;

  return (
    <motion.button
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      onClick={onClick}
      data-ui-sound="none" // live strike surface — no UI click stings (issue #3)
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.03, type: "spring", stiffness: 420, damping: 30 }}
      whileTap={{ scale: 0.985 }}
      aria-pressed={isOn}
      aria-label={`${pad.name}, ${pad.mode === "momentary" ? "momentary" : "latch"}`}
      className={`group relative overflow-hidden rounded-2xl border p-4 pr-6 text-left min-h-[168px] select-none touch-none transition ${
        isOn
          ? "border-white/25 bg-white/[0.08] krx-pad-live"
          : "border-white/10 bg-white/[0.03] hover:bg-white/[0.055] hover:border-white/20"
      }`}
      style={{
        boxShadow: isOn
          ? `0 0 ${Math.round(30 * glow)}px ${pad.accent}44, inset 0 0 0 1px ${pad.accent}55`
          : undefined,
      }}
      title={
        pad.mode === "momentary"
          ? "Hold to engage — release to revert. Strike height = intensity."
          : "Tap to latch, tap again to release. Strike height = intensity."
      }
    >
      {/* Intensity meter — right edge */}
      <div className="absolute right-1.5 top-2 bottom-2 w-1.5 rounded-full bg-white/8 overflow-hidden pointer-events-none">
        <div
          className="krx-meter-fill absolute inset-x-0 bottom-0 rounded-full"
          style={{
            height: `${Math.round(level * 100)}%`,
            background: pad.accent,
            boxShadow: `0 0 8px ${pad.accent}`,
          }}
        />
      </div>

      <div className="relative flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <kbd
            className={`w-5 h-5 rounded border text-[10px] font-mono flex items-center justify-center ${
              isOn
                ? "border-white/40 text-white"
                : "border-white/15 text-white/40"
            }`}
            title={`Number key ${index + 1}`}
          >
            {index + 1}
          </kbd>
          <div
            className="w-9 h-9 rounded-xl border border-white/15 flex items-center justify-center text-xl"
            style={{
              color: pad.accent,
              boxShadow: isOn ? `0 0 16px ${pad.accent}66` : undefined,
            }}
          >
            {pad.icon}
          </div>
        </div>
        <span
          data-krx-stop
          role="button"
          tabIndex={-1}
          onClick={onFlipMode}
          className={`cursor-pointer text-[9px] uppercase tracking-widest px-2 py-1 rounded-full border transition ${
            pad.mode === "momentary"
              ? "text-amber border-amber/50 bg-amber/10"
              : "text-cyan border-cyan/40 bg-cyan/10"
          }`}
          title={
            pad.mode === "momentary"
              ? "MOMENTARY — hold to engage. Click to switch to LATCH."
              : "LATCH — tap to toggle. Click to switch to MOMENTARY."
          }
        >
          {pad.mode === "momentary" ? "Mom" : "Latch"}
        </span>
      </div>

      <div className="relative mt-3 text-sm font-bold tracking-wide">
        {pad.name}
      </div>
      <div className="relative mt-1 text-[11px] text-white/55 leading-relaxed line-clamp-2">
        {pad.description}
      </div>

      <div className="relative mt-3 flex items-end justify-between gap-2">
        <div className="flex flex-wrap gap-1 min-w-0">
          {Object.keys(pad.deltas)
            .slice(0, 3)
            .map((k) => (
              <span
                key={k}
                className="text-[8px] uppercase tracking-wider rounded-full border border-white/10 px-1.5 py-0.5 text-white/40"
              >
                {SOUND_PARAM_META.find((m) => m.key === k)?.label ?? k}
              </span>
            ))}
          {Object.keys(pad.deltas).length > 3 && (
            <span className="text-[8px] uppercase tracking-wider rounded-full border border-white/10 px-1.5 py-0.5 text-white/40">
              +{Object.keys(pad.deltas).length - 3}
            </span>
          )}
        </div>
        <span
          data-krx-stop
          role="button"
          tabIndex={-1}
          onClick={onEdit}
          className={`cursor-pointer shrink-0 text-[9px] uppercase tracking-widest px-2 py-1 rounded-lg border transition ${
            editing
              ? "border-cyan/60 bg-cyan/15 text-cyan"
              : "border-white/12 text-white/45 hover:text-white/85 hover:border-white/30"
          }`}
          title="Edit this pad's targets, mode and MIDI mapping"
        >
          Tune
        </span>
      </div>

      {isOn && (
        <span
          className="absolute inset-x-0 bottom-0 h-0.5"
          style={{ background: pad.accent, opacity: glow }}
        />
      )}
    </motion.button>
  );
}

function SceneSlot({
  slot,
  scene,
  canSave,
  onSave,
  onRecall,
  onClear,
}: {
  slot: number;
  scene: { name: string; pads: { id: string }[] } | null;
  canSave: boolean;
  onSave: () => void;
  onRecall: () => void;
  onClear: () => void;
}) {
  const [confirmClear, setConfirmClear] = useState(false);
  const confirmTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (confirmTimer.current != null) window.clearTimeout(confirmTimer.current);
    },
    [],
  );

  if (!scene) {
    return (
      <div className="rounded-xl border border-dashed border-white/10 p-2.5 flex items-center gap-2">
        <span className="text-[10px] font-mono text-white/30 w-7">S{slot + 1}</span>
        <span className="flex-1 text-[11px] text-white/30">— empty slot —</span>
        <button
          onClick={onSave}
          disabled={!canSave}
          className={`text-[9px] uppercase tracking-widest px-2 py-1 rounded-lg border transition ${
            canSave
              ? "border-cyan/40 text-cyan hover:bg-cyan/10"
              : "border-white/10 text-white/25 cursor-not-allowed"
          }`}
          title="Store the currently engaged stack"
        >
          ⊕ Store
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-white/12 bg-white/[0.03] p-2.5 flex items-center gap-2">
      <span className="text-[10px] font-mono text-cyan/80 w-7">S{slot + 1}</span>
      <button
        onClick={onRecall}
        data-ui-sound="none" // scene deploys mid-performance — keep it silent
        className="flex-1 min-w-0 text-left text-[11px] font-semibold text-white/80 hover:text-cyan transition truncate"
        title={`Recall: ${scene.name}`}
      >
        {scene.name}
        <span className="ml-1.5 text-[9px] font-mono text-white/35">
          ×{scene.pads.length}
        </span>
      </button>
      <button
        onClick={onSave}
        disabled={!canSave}
        className={`shrink-0 text-[9px] uppercase tracking-widest px-2 py-1 rounded-lg border transition ${
          canSave
            ? "border-white/12 text-white/50 hover:text-cyan hover:border-cyan/40"
            : "border-white/8 text-white/20 cursor-not-allowed"
        }`}
        title="Overwrite with the currently engaged stack"
      >
        ⊕
      </button>
      <button
        onClick={() => {
          if (confirmClear) {
            if (confirmTimer.current != null) {
              window.clearTimeout(confirmTimer.current);
              confirmTimer.current = null;
            }
            setConfirmClear(false);
            onClear();
          } else {
            setConfirmClear(true);
            if (confirmTimer.current != null) window.clearTimeout(confirmTimer.current);
            confirmTimer.current = window.setTimeout(() => setConfirmClear(false), 2400);
          }
        }}
        className={`shrink-0 text-[9px] uppercase tracking-widest px-2 py-1 rounded-lg border transition ${
          confirmClear
            ? "border-rose-400/70 bg-rose-500/20 text-rose-200"
            : "border-white/12 text-white/40 hover:text-rose-200/80 hover:border-rose-400/30"
        }`}
        title="Clear this scene slot"
      >
        {confirmClear ? "SURE?" : "✕"}
      </button>
    </div>
  );
}

function ParamDrift({
  base,
  current,
}: {
  base: SoundParams | null;
  current: SoundParams;
}) {
  const rows = SOUND_PARAM_META.map((meta) => {
    const start = base?.[meta.key] ?? current[meta.key];
    return { key: meta.key, label: meta.label, delta: current[meta.key] - start };
  })
    .filter((r) => Math.abs(r.delta) > 0.015)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 8);

  if (rows.length === 0) {
    return <div className="text-[12px] text-dim">No parameter drift yet.</div>;
  }

  return (
    <div className="space-y-2">
      {rows.map(({ key, label, delta }) => (
        <div key={key} className="flex items-center gap-2">
          <div className="text-[10px] text-white/60 w-20 truncate">{label}</div>
          <div className="flex-1 h-2 rounded-full bg-white/8 overflow-hidden">
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.min(100, Math.abs(delta) * 140)}%`,
                marginLeft: delta < 0 ? "auto" : 0,
                background: delta > 0 ? "#22e8ff" : "#ffb648",
              }}
            />
          </div>
          <div className="text-[10px] font-mono text-dim w-10 text-right">
            {delta > 0 ? "+" : ""}
            {delta.toFixed(2)}
          </div>
        </div>
      ))}
    </div>
  );
}
