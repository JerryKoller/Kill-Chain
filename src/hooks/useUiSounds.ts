import { useEffect, useRef } from "react";
import { useSettingsStore } from "@/state/settingsStore";
import { useUIStore } from "@/state/uiStore";
import { useAudioStore } from "@/state/audioStore";
import { useFavoritesStore } from "@/state/favoritesStore";
import {
  engageSoundsSuppressed,
  playUi,
  resumeUiAudioIfSuspended,
  setUiSoundsEnabled,
  setUiSoundsSink,
  setUiSoundsVolume,
  uiSoundRecentlyPlayed,
} from "@/audio/uiSounds";
import {
  playDisengageGrowl,
  playEngageGrowl,
  preloadEngageGrowl,
} from "@/audio/uiSoundsGrowl";

/**
 * Wires the synthesized UI feedback into the whole app.
 *
 * Two layers, all gated by Settings → UI sounds:
 *
 *  1. Document delegation for pointer input — generic buttons get a soft
 *     press, `data-ui-sound="toggle"` switches get their on/off voices,
 *     range sliders ratchet as they move. Elements voiced by the store layer
 *     (sidebar nav, DSP engage) opt OUT with `data-ui-sound="none"` so each
 *     interaction has exactly ONE sound. The pointerdown listener doubles as
 *     the resume rescue for a ui AudioContext a browser left suspended.
 *
 *  2. Central store subscriptions — the semantic sounds fire on the state
 *     change itself (works for clicks, hotkeys, MIDI, remote):
 *       · uiStore.view            → tab tick
 *       · uiStore.hotkeyOverlay   → modal open/close servo
 *       · audioStore.bypass       → ENGAGE clunk + metal riff / disengage
 *       · favoritesStore useCount → preset latch clack (fires on every
 *         preset apply — that's the one place applies are recorded)
 *
 * The engage RIFF is user-initiated only: it needs a pointer/key event in the
 * last 400 ms and skips the boot-restore engage (syncEngine re-arming the
 * chain right after the engine first reports ready). Overlap is impossible —
 * the riff module keeps an exclusive playback window.
 */
export function useUiSounds() {
  const enabled = useSettingsStore((s) => s.uiSounds);
  const volume = useSettingsStore((s) => s.uiSoundVolume);
  const outputDeviceId = useSettingsStore((s) => s.audioOutputDeviceId);
  const prevEnabledRef = useRef<boolean | null>(null);

  // Follow the engine's output device so feedback is audible on the same
  // endpoint the user actually listens on (issue: "UI sounds not playing").
  useEffect(() => {
    setUiSoundsSink(outputDeviceId);
  }, [outputDeviceId]);

  useEffect(() => {
    setUiSoundsEnabled(enabled);
    if (enabled) {
      // Warm the offline growl render so the first ENGAGE hits instantly.
      void preloadEngageGrowl();
      // Audible confirmation when the user flips the setting ON (the click
      // itself couldn't play — sounds were still off at pointerdown).
      if (prevEnabledRef.current === false) playUi("toggle-on");
    }
    prevEnabledRef.current = enabled;
  }, [enabled]);

  useEffect(() => {
    setUiSoundsVolume(volume);
  }, [volume]);

  useEffect(() => {
    if (!enabled) return;

    // ── Layer 1: DOM delegation ──────────────────────────────────────────
    const isDisabled = (el: Element | null): boolean =>
      !!el && (el as HTMLButtonElement).disabled === true;

    let lastInputAt = 0;

    const onPointerDown = (e: PointerEvent) => {
      lastInputAt = performance.now();
      resumeUiAudioIfSuspended();
      if (e.button !== undefined && e.button !== 0) return;
      const target = e.target as Element | null;
      if (!target) return;

      // Nearest data-ui-sound marker wins, so a control inside an opted-out
      // region (e.g. a favorite button on a preset card whose click is voiced
      // by the store layer) can still opt back in with data-ui-sound="press".
      //   "none"   → voiced by a store subscription (nav tabs, DSP engage…)
      //   "toggle" → switch voices its *resulting* state via data-ui-on
      //   "press"  → force the generic press
      const marked = target.closest("[data-ui-sound]");
      if (marked) {
        const kind = marked.getAttribute("data-ui-sound");
        if (kind === "none") return;
        if (kind === "toggle") {
          if (isDisabled(marked)) return;
          const wasOn = marked.getAttribute("data-ui-on") === "true";
          playUi(wasOn ? "toggle-off" : "toggle-on");
          return;
        }
        if (kind === "press") {
          if (!isDisabled(marked)) playUi("press");
          return;
        }
      }

      const clickable = target.closest(
        'button, [role="button"], [role="tab"], a[href], select, summary',
      );
      if (clickable && !isDisabled(clickable)) {
        playUi("press");
      }
    };

    const onKeyDown = () => {
      lastInputAt = performance.now();
      resumeUiAudioIfSuspended();
    };

    // Range sliders ratchet as they slide (playUi rate-limits per type).
    const onInput = (e: Event) => {
      const el = e.target as HTMLInputElement | null;
      if (!el || el.type !== "range") return;
      const min = Number(el.min || 0);
      const max = Number(el.max || 100);
      const val = Number(el.value);
      const norm = max > min ? (val - min) / (max - min) : 0.5;
      playUi("knob", norm);
    };

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("input", onInput, true);

    // ── Layer 2: store subscriptions ─────────────────────────────────────
    // View/tab switches (sidebar clicks, number hotkeys, programmatic).
    const unsubUi = useUIStore.subscribe((s, prev) => {
      if (s.view !== prev.view) playUi("tab");
      if (s.hotkeyOverlayOpen !== prev.hotkeyOverlayOpen) {
        playUi(s.hotkeyOverlayOpen ? "modal-open" : "modal-close");
      }
    });

    // DSP chain ENGAGED / BYPASSED — the star of the show.
    // Boot-restore guard: right after the engine first flips to "ready",
    // App.tsx's syncEngine() may re-engage the chain from persisted EQ state.
    // That transition lands within a few ms of "ready" — swallow it.
    let firstReadyAt: number | null = null;
    const unsubAudio = useAudioStore.subscribe((s, prev) => {
      if (s.status === "ready" && prev.status !== "ready" && firstReadyAt === null) {
        firstReadyAt = performance.now();
      }
      if (s.bypass === prev.bypass) return;
      const now = performance.now();
      const bootRestore = firstReadyAt !== null && now - firstReadyAt < 250;
      if (bootRestore) return;
      // Reactor-driven flips (live pad strikes / stand-down) are marked quiet
      // — a growl mid-performance ruins the effect (issue #3).
      if (engageSoundsSuppressed()) return;
      // ONE sound per flip: the bass growl IS the engage/disengage voice.
      if (!s.bypass) {
        playEngageGrowl();
      } else {
        // Purge already lands its own thunk — don't pile the growl on top.
        if (!uiSoundRecentlyPlayed("purge", 600)) playDisengageGrowl();
      }
    });

    // Preset applies — recordPresetUse bumps useCount on every apply.
    const unsubPresets = useFavoritesStore.subscribe((s, prev) => {
      if (s.metadata === prev.metadata) return;
      for (const [id, meta] of Object.entries(s.metadata)) {
        if ((prev.metadata[id]?.useCount ?? 0) < meta.useCount) {
          playUi("preset");
          return;
        }
      }
    });

    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("input", onInput, true);
      unsubUi();
      unsubAudio();
      unsubPresets();
    };
  }, [enabled]);
}
