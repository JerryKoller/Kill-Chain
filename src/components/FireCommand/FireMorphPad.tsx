/**
 * FireMorphPad — XY morph between four Fire Command patches (v1.6).
 *
 * Pick a preset for each corner, then drag the puck: every numeric patch
 * field is bilinearly interpolated between the corners; discrete fields
 * (wavetable choice, filter type, mod matrix, gate pattern…) come from the
 * NEAREST corner so the sound never lands on a nonsense in-between. The pad
 * takes ONE undo snapshot per gesture, so Ctrl+Z steps back a whole drag.
 */

import { useRef, useState } from "react";
import { GlassPanel } from "@/components/shared/GlassPanel";
import { useFireCommandStore, FIRE_PRESETS } from "@/state/fireCommandStore";
import { DEFAULT_FIRE_PATCH, type FirePatch } from "@/audio/dsp/FireCommandSynth";
import { pushFireHistory } from "@/lib/fireHistory";

const CORNERS = ["a", "b", "c", "d"] as const;
type Corner = (typeof CORNERS)[number];

/** Corner geometry: a/b along the top, c/d along the bottom. */
const CORNER_META: Record<Corner, { x: number; y: number; label: string; color: string }> = {
  a: { x: 0, y: 0, label: "A", color: "#ff6a3d" },
  b: { x: 1, y: 0, label: "B", color: "#62b6ff" },
  c: { x: 0, y: 1, label: "C", color: "#7cf6b0" },
  d: { x: 1, y: 1, label: "D", color: "#c792ea" },
};

/** Numeric fields that must stay whole numbers after interpolation. */
const INT_FIELDS = new Set<keyof FirePatch>([
  "unison", "oscAOctave", "oscBOctave", "oscCOctave", "gateSteps",
]);

const DEFAULT_CORNER_IDS: Record<Corner, string> = {
  a: FIRE_PRESETS[1]?.id ?? "init",
  b: FIRE_PRESETS[2]?.id ?? "init",
  c: FIRE_PRESETS[3]?.id ?? "init",
  d: FIRE_PRESETS[4]?.id ?? "init",
};

const STORAGE_KEY = "killchain.firemorph.v1";

interface PersistShape {
  cornerIds: Record<Corner, string>;
  open: boolean;
}

function loadPersist(): PersistShape {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<PersistShape>;
      return {
        cornerIds: { ...DEFAULT_CORNER_IDS, ...(p.cornerIds ?? {}) },
        open: p.open === true,
      };
    }
  } catch { /* fall through to defaults */ }
  return { cornerIds: { ...DEFAULT_CORNER_IDS }, open: false };
}

function savePersist(p: PersistShape): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(p)); } catch { /* quota — non-fatal */ }
}

function bilinear(x: number, y: number): Record<Corner, number> {
  return { a: (1 - x) * (1 - y), b: x * (1 - y), c: (1 - x) * y, d: x * y };
}

function morphPatches(
  corners: Record<Corner, FirePatch>,
  x: number,
  y: number,
): FirePatch {
  const w = bilinear(x, y);
  let nearest: Corner = "a";
  for (const c of CORNERS) if (w[c] > w[nearest]) nearest = c;
  // Discrete fields (strings, booleans, arrays) ride along from the nearest
  // corner; numeric fields get overwritten with the weighted blend below.
  const out = structuredClone(corners[nearest]);
  for (const key of Object.keys(DEFAULT_FIRE_PATCH) as (keyof FirePatch)[]) {
    if (typeof DEFAULT_FIRE_PATCH[key] !== "number") continue;
    let sum = 0;
    for (const c of CORNERS) {
      const v = corners[c][key];
      sum += (typeof v === "number" && Number.isFinite(v) ? v : (DEFAULT_FIRE_PATCH[key] as number)) * w[c];
    }
    (out as unknown as Record<string, unknown>)[key] = INT_FIELDS.has(key) ? Math.round(sum) : sum;
  }
  return out;
}

export function FireMorphPad() {
  const [persisted] = useState(loadPersist);
  const [open, setOpen] = useState(persisted.open);
  const [cornerIds, setCornerIds] = useState(persisted.cornerIds);
  const [pos, setPos] = useState({ x: 0.5, y: 0.5 });
  const userPresets = useFireCommandStore((s) => s.userPresets);
  const padRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const rafRef = useRef(0);

  const patchFor = (id: string): FirePatch => {
    const factory = FIRE_PRESETS.find((p) => p.id === id);
    const user = factory ? null : userPresets.find((p) => p.id === id);
    return { ...DEFAULT_FIRE_PATCH, ...(factory?.patch ?? user?.patch ?? {}) };
  };

  const nameFor = (id: string): string =>
    FIRE_PRESETS.find((p) => p.id === id)?.name
    ?? userPresets.find((p) => p.id === id)?.name
    ?? "?";

  const applyAt = (x: number, y: number, commit: boolean) => {
    const corners = {
      a: patchFor(cornerIds.a), b: patchFor(cornerIds.b),
      c: patchFor(cornerIds.c), d: patchFor(cornerIds.d),
    };
    useFireCommandStore.getState().applyMorphPatch(morphPatches(corners, x, y), commit);
  };

  const posFromEvent = (e: React.PointerEvent): { x: number; y: number } => {
    const r = padRef.current!.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
      y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)),
    };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    draggingRef.current = true;
    // ONE snapshot per gesture, taken before the first blend lands.
    pushFireHistory();
    const p = posFromEvent(e);
    setPos(p);
    applyAt(p.x, p.y, false);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    const p = posFromEvent(e);
    setPos(p);
    // rAF-throttle: setPatch rebuilds the whole voice config, once per frame is plenty.
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      if (draggingRef.current) applyAt(p.x, p.y, false);
    });
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    const p = posFromEvent(e);
    setPos(p);
    applyAt(p.x, p.y, true);
  };

  const setCorner = (c: Corner, id: string) => {
    const next = { ...cornerIds, [c]: id };
    setCornerIds(next);
    savePersist({ cornerIds: next, open });
  };

  const toggleOpen = () => {
    setOpen(!open);
    savePersist({ cornerIds, open: !open });
  };

  const w = bilinear(pos.x, pos.y);

  return (
    <GlassPanel className="p-2.5">
      <div className="flex items-center gap-2">
        <button
          onClick={toggleOpen}
          className="flex items-center gap-2 text-left"
          title="Morph pad: blend four patches by dragging a puck — every knob in between exists"
        >
          <span className="text-[10px] uppercase tracking-[0.25em] text-dim">Morph Pad</span>
          <span className="text-[10px] text-white/30">{open ? "▾" : "▸"}</span>
        </button>
        {!open && (
          <span className="text-[10px] text-white/30 italic">
            drag between {CORNERS.map((c) => nameFor(cornerIds[c])).join(" · ")}
          </span>
        )}
      </div>

      {open && (
        <div className="mt-2 flex flex-wrap gap-3">
          {/* the pad */}
          <div
            ref={padRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            className="relative w-[210px] h-[210px] rounded-xl border border-white/12 cursor-crosshair touch-none select-none shrink-0"
            style={{
              background:
                `radial-gradient(circle at 0% 0%, ${CORNER_META.a.color}30, transparent 60%),` +
                `radial-gradient(circle at 100% 0%, ${CORNER_META.b.color}30, transparent 60%),` +
                `radial-gradient(circle at 0% 100%, ${CORNER_META.c.color}30, transparent 60%),` +
                `radial-gradient(circle at 100% 100%, ${CORNER_META.d.color}30, transparent 60%),` +
                "rgba(0,0,0,0.45)",
            }}
            role="slider"
            aria-label="Patch morph pad — drag to blend the four corner presets"
            aria-valuetext={`x ${Math.round(pos.x * 100)}%, y ${Math.round(pos.y * 100)}%`}
            aria-valuenow={Math.round(pos.x * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            {CORNERS.map((c) => (
              <span
                key={c}
                className="absolute text-[10px] font-bold pointer-events-none"
                style={{
                  color: CORNER_META[c].color,
                  left: CORNER_META[c].x === 0 ? 6 : undefined,
                  right: CORNER_META[c].x === 1 ? 6 : undefined,
                  top: CORNER_META[c].y === 0 ? 4 : undefined,
                  bottom: CORNER_META[c].y === 1 ? 4 : undefined,
                  opacity: 0.4 + w[c] * 0.6,
                }}
              >
                {CORNER_META[c].label}
              </span>
            ))}
            {/* puck */}
            <div
              className="absolute w-4 h-4 rounded-full border-2 border-white/90 pointer-events-none -translate-x-1/2 -translate-y-1/2"
              style={{
                left: `${pos.x * 100}%`,
                top: `${pos.y * 100}%`,
                background: "rgba(255,255,255,0.25)",
                boxShadow: "0 0 12px rgba(255,255,255,0.55)",
              }}
            />
          </div>

          {/* corner pickers */}
          <div className="flex flex-col gap-1.5 min-w-[180px] flex-1">
            {CORNERS.map((c) => (
              <label key={c} className="flex items-center gap-1.5">
                <span
                  className="w-4 text-[11px] font-bold text-center"
                  style={{ color: CORNER_META[c].color }}
                >
                  {CORNER_META[c].label}
                </span>
                <select
                  value={cornerIds[c]}
                  onChange={(e) => setCorner(c, e.target.value)}
                  className="flex-1 rounded-lg border border-white/12 bg-black/40 px-1.5 py-1 text-[11px] text-white/75 outline-none focus:border-white/30"
                  title={`Corner ${CORNER_META[c].label} preset`}
                >
                  {userPresets.length > 0 && (
                    <optgroup label="Your patches">
                      {userPresets.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </optgroup>
                  )}
                  <optgroup label="Factory">
                    {FIRE_PRESETS.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </optgroup>
                </select>
              </label>
            ))}
            <div className="text-[9px] text-white/30 leading-snug">
              Numbers blend across corners; wavetables, filter type and the mod
              matrix jump to the nearest corner. One drag = one undo step.
            </div>
          </div>
        </div>
      )}
    </GlassPanel>
  );
}
