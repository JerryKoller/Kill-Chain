import { useEffect, useState } from "react";
import { GlassPanel } from "@/components/shared/GlassPanel";
import {
  HOTKEY_ACTIONS,
  DEFAULT_BINDINGS,
  useHotkeyStore,
  type HotkeyActionId,
} from "@/state/hotkeyStore";
import { useUIStore } from "@/state/uiStore";

/**
 * Settings → Hotkeys: remap table for the global single-letter commands.
 * Click a key cap, press the new key. Reserved keys (Space, digits, arrows,
 * ?) are refused; picking a key another action owns swaps the two.
 */
export function HotkeysSection() {
  const bindings = useHotkeyStore((s) => s.bindings);
  const setBinding = useHotkeyStore((s) => s.setBinding);
  const resetBindings = useHotkeyStore((s) => s.resetBindings);
  const toast = useUIStore((s) => s.toast);
  const [capturing, setCapturing] = useState<HotkeyActionId | null>(null);

  // While capturing, the next keydown becomes the binding.
  useEffect(() => {
    if (!capturing) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        setCapturing(null);
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return; // modifiers reserved for the OS
      const ok = useHotkeyStore.getState().setBinding(capturing, e.key);
      if (ok) {
        toast(`Bound "${e.key.toUpperCase()}"`);
        setCapturing(null);
      } else {
        toast("That key is reserved — try a letter");
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [capturing, toast]);

  const isDefault = HOTKEY_ACTIONS.every(
    (a) => bindings[a.id] === DEFAULT_BINDINGS[a.id],
  );

  return (
    <GlassPanel intense className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold uppercase tracking-[0.2em]">Hotkeys</div>
          <div className="text-[11px] text-dim mt-0.5">
            Remap the global command keys. Space, arrows, ? and the 0–9 view keys are fixed.
          </div>
        </div>
        {!isDefault && (
          <button
            onClick={() => {
              resetBindings();
              toast("Hotkeys reset to defaults");
            }}
            className="btn-ghost text-xs text-white/60 hover:text-cyan"
          >
            Reset all
          </button>
        )}
      </div>

      <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1">
        {HOTKEY_ACTIONS.map((a) => {
          const active = capturing === a.id;
          return (
            <div
              key={a.id}
              className="flex items-center justify-between gap-3 py-1.5 border-b border-white/[0.05]"
            >
              <div className="min-w-0">
                <div className="text-[12px] text-white/85 truncate">{a.label}</div>
                {a.shiftLabel && (
                  <div className="text-[10px] text-dim">{a.shiftLabel}</div>
                )}
              </div>
              <button
                onClick={() => setCapturing(active ? null : a.id)}
                className={`shrink-0 min-w-[44px] text-center text-[12px] font-mono px-2.5 py-1 rounded-md border transition ${
                  active
                    ? "border-cyan/70 bg-cyan/15 text-cyan animate-pulse"
                    : "border-white/12 bg-white/[0.05] hover:border-white/30"
                }`}
                title={active ? "Press the new key… (Esc cancels)" : "Click, then press a key to rebind"}
              >
                {active ? "…" : bindings[a.id].toUpperCase()}
              </button>
            </div>
          );
        })}
      </div>
    </GlassPanel>
  );
}
