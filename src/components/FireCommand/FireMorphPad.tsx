/**
 * FireMorphPad — XY morph between four Fire Command patches (v2.5.5 stage).
 *
 * Pick a preset for each corner, then drag the puck: every numeric patch
 * field is bilinearly interpolated between the corners; discrete fields
 * come from the NEAREST corner. One undo snapshot per gesture.
 */

import { useEffect, useRef, useState } from "react";
import { GlassPanel } from "@/components/shared/GlassPanel";
import { useFireCommandStore, FIRE_PRESETS } from "@/state/fireCommandStore";
import { DEFAULT_FIRE_PATCH, type FirePatch } from "@/audio/dsp/FireCommandSynth";
import { pushFireHistory } from "@/lib/fireHistory";
import { CollapseToggle } from "./CollapseToggle";

const CORNERS = ["a", "b", "c", "d"] as const;
type Corner = (typeof CORNERS)[number];

const CORNER_META: Record<Corner, { x: number; y: number; label: string; color: string }> = {
  a: { x: 0, y: 0, label: "A", color: "#ff6a3d" },
  b: { x: 1, y: 0, label: "B", color: "#62b6ff" },
  c: { x: 0, y: 1, label: "C", color: "#7cf6b0" },
  d: { x: 1, y: 1, label: "D", color: "#c792ea" },
};

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
const FIRE = "#ff6a3d";
const PAD_SIZE = 240;

type TrailParticle = { x: number; y: number; life: number; hue: number };

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
  const [isDragging, setIsDragging] = useState(false);
  const userPresets = useFireCommandStore((s) => s.userPresets);
  const padRef = useRef<HTMLDivElement>(null);
  const trailCanvasRef = useRef<HTMLCanvasElement>(null);
  const draggingRef = useRef(false);
  const rafRef = useRef(0);
  const trailRafRef = useRef(0);
  const posRef = useRef(pos);
  const trailRef = useRef<TrailParticle[]>([]);
  posRef.current = pos;

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
    setIsDragging(true);
    pushFireHistory();
    const p = posFromEvent(e);
    setPos(p);
    applyAt(p.x, p.y, false);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    const p = posFromEvent(e);
    setPos(p);
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      if (draggingRef.current) applyAt(p.x, p.y, false);
    });
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    setIsDragging(false);
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

  useEffect(() => {
    if (!open) return;
    const canvas = trailCanvasRef.current;
    const pad = padRef.current;
    if (!canvas || !pad) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const sync = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const cssW = pad.clientWidth;
      const cssH = pad.clientHeight;
      canvas.width = Math.floor(cssW * dpr);
      canvas.height = Math.floor(cssH * dpr);
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(pad);

    const drawTrail = () => {
      trailRafRef.current = requestAnimationFrame(drawTrail);
      const W = pad.clientWidth;
      const H = pad.clientHeight;
      ctx.clearRect(0, 0, W, H);

      if (draggingRef.current) {
        const { x, y } = posRef.current;
        const px = x * W;
        const py = y * H;
        const wts = bilinear(x, y);
        let domHue = 30;
        let domW = 0;
        for (const c of CORNERS) {
          if (wts[c] > domW) { domW = wts[c]; domHue = c === "a" ? 18 : c === "b" ? 210 : c === "c" ? 145 : 275; }
        }
        trailRef.current.push({ x: px, y: py, life: 1, hue: domHue });
        if (trailRef.current.length > 28) trailRef.current.shift();
      }

      for (let i = trailRef.current.length - 1; i >= 0; i--) {
        const p = trailRef.current[i];
        p.life -= 0.045;
        if (p.life <= 0) { trailRef.current.splice(i, 1); continue; }
        const a = p.life * 0.55;
        const r = 2 + (1 - p.life) * 4;
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 2.2);
        g.addColorStop(0, `hsla(${p.hue}, 80%, 72%, ${a})`);
        g.addColorStop(1, `hsla(${p.hue}, 70%, 55%, 0)`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r * 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    trailRafRef.current = requestAnimationFrame(drawTrail);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(trailRafRef.current);
      trailRef.current = [];
    };
  }, [open]);

  return (
    <GlassPanel className="p-3">
      <style>{`
        @keyframes morph-breathe {
          0%, 100% { opacity: 0.55; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.08); }
        }
        @keyframes morph-grid-pulse {
          0%, 100% { opacity: 0.12; }
          50% { opacity: 0.24; }
        }
        @keyframes morph-ripple {
          0% { transform: translate(-50%, -50%) scale(0.85); opacity: 0.5; }
          100% { transform: translate(-50%, -50%) scale(1.65); opacity: 0; }
        }
      `}</style>
      <div className="flex items-center gap-2">
        <button
          onClick={toggleOpen}
          className="flex items-center gap-2 text-left rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
          title="Morph pad: blend four patches by dragging a puck — every knob in between exists"
          aria-expanded={open}
        >
          <CollapseToggle collapsed={!open} color={FIRE} />
          <span className="text-[11px] font-semibold uppercase tracking-[0.22em]" style={{ color: FIRE }}>
            Morph Pad
          </span>
        </button>
        {!open && (
          <span className="text-[10px] text-white/35 italic">
            drag between {CORNERS.map((c) => nameFor(cornerIds[c])).join(" · ")}
          </span>
        )}
      </div>

      {open && (
        <div className="mt-2.5 flex flex-wrap gap-4">
          <div
            ref={padRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            className="relative shrink-0 cursor-crosshair touch-none select-none overflow-hidden rounded-2xl border border-white/15 shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_8px_28px_rgba(0,0,0,0.35)]"
            style={{
              width: PAD_SIZE,
              height: PAD_SIZE,
              background:
                "linear-gradient(160deg, rgba(8,6,10,0.92), rgba(0,0,0,0.75))",
            }}
            role="slider"
            aria-label="Patch morph pad — drag to blend the four corner presets"
            aria-valuetext={`x ${Math.round(pos.x * 100)}%, y ${Math.round(pos.y * 100)}%`}
            aria-valuenow={Math.round(pos.x * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            {/* Breathing corner glows */}
            {CORNERS.map((c) => (
              <div
                key={`glow-${c}`}
                className="pointer-events-none absolute animate-[morph-breathe_4.2s_ease-in-out_infinite]"
                style={{
                  animationDelay: `${CORNERS.indexOf(c) * 0.65}s`,
                  width: "62%",
                  height: "62%",
                  left: CORNER_META[c].x === 0 ? "-8%" : undefined,
                  right: CORNER_META[c].x === 1 ? "-8%" : undefined,
                  top: CORNER_META[c].y === 0 ? "-8%" : undefined,
                  bottom: CORNER_META[c].y === 1 ? "-8%" : undefined,
                  background: `radial-gradient(circle, ${CORNER_META[c].color}${Math.round(28 + w[c] * 40).toString(16).padStart(2, "0")}, transparent 68%)`,
                  filter: "blur(2px)",
                }}
              />
            ))}

            {/* Pulsing grid */}
            <div
              className="pointer-events-none absolute inset-0 animate-[morph-grid-pulse_3.6s_ease-in-out_infinite] opacity-[0.18]"
              style={{
                backgroundImage:
                  "linear-gradient(rgba(255,255,255,0.14) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.14) 1px, transparent 1px)",
                backgroundSize: "40px 40px",
              }}
            />
            <div className="pointer-events-none absolute inset-0 opacity-25"
              style={{
                backgroundImage:
                  "linear-gradient(rgba(255,255,255,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.06) 1px, transparent 1px)",
                backgroundSize: "20px 20px",
              }}
            />

            {/* Particle trail overlay (display only) */}
            <canvas
              ref={trailCanvasRef}
              className="pointer-events-none absolute inset-0 block h-full w-full"
              aria-hidden
            />

            {CORNERS.map((c) => (
              <span
                key={c}
                className="absolute flex h-7 w-7 items-center justify-center rounded-full border text-[11px] font-bold pointer-events-none"
                style={{
                  color: CORNER_META[c].color,
                  borderColor: `${CORNER_META[c].color}${Math.round(60 + w[c] * 140).toString(16).padStart(2, "0")}`,
                  background: `${CORNER_META[c].color}${Math.round(18 + w[c] * 50).toString(16).padStart(2, "0")}`,
                  boxShadow: `0 0 ${10 + w[c] * 20}px ${CORNER_META[c].color}77`,
                  left: CORNER_META[c].x === 0 ? 8 : undefined,
                  right: CORNER_META[c].x === 1 ? 8 : undefined,
                  top: CORNER_META[c].y === 0 ? 8 : undefined,
                  bottom: CORNER_META[c].y === 1 ? 8 : undefined,
                }}
              >
                {CORNER_META[c].label}
              </span>
            ))}

            {/* Puck ripple rings */}
            {[0, 1, 2].map((ring) => (
              <div
                key={`ring-${ring}`}
                className="pointer-events-none absolute rounded-full border border-white/25 animate-[morph-ripple_2.4s_ease-out_infinite]"
                style={{
                  left: `${pos.x * 100}%`,
                  top: `${pos.y * 100}%`,
                  width: 20 + ring * 14,
                  height: 20 + ring * 14,
                  animationDelay: `${ring * 0.55}s`,
                  opacity: isDragging ? 0.55 - ring * 0.12 : 0.22 - ring * 0.05,
                }}
              />
            ))}

            <div
              className="pointer-events-none absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white"
              style={{
                left: `${pos.x * 100}%`,
                top: `${pos.y * 100}%`,
                background: "radial-gradient(circle at 35% 30%, rgba(255,255,255,0.55), rgba(255,255,255,0.22))",
                boxShadow: "0 0 18px rgba(255,255,255,0.75), 0 0 36px rgba(255,106,61,0.4), inset 0 0 6px rgba(255,255,255,0.3)",
              }}
            />
          </div>

          <div className="flex min-w-[220px] flex-1 flex-col gap-2">
            {CORNERS.map((c) => (
              <div key={c} className="flex items-center gap-2">
                <span
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border text-[11px] font-bold"
                  style={{
                    color: CORNER_META[c].color,
                    borderColor: `${CORNER_META[c].color}77`,
                    background: `${CORNER_META[c].color}22`,
                    boxShadow: `0 0 10px ${CORNER_META[c].color}33`,
                  }}
                >
                  {CORNER_META[c].label}
                </span>
                <select
                  value={cornerIds[c]}
                  onChange={(e) => setCorner(c, e.target.value)}
                  className="flex-1 rounded-lg border border-white/12 bg-black/40 px-2 py-1.5 text-[11px] text-white/80 outline-none focus:border-white/30"
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
                <div className="h-1.5 w-12 overflow-hidden rounded-full bg-white/10" title={`${Math.round(w[c] * 100)}% blend weight`}>
                  <div
                    className="h-full rounded-full transition-[width] duration-75"
                    style={{
                      width: `${Math.round(w[c] * 100)}%`,
                      background: CORNER_META[c].color,
                      boxShadow: `0 0 8px ${CORNER_META[c].color}`,
                    }}
                  />
                </div>
              </div>
            ))}
            <div className="mt-1 rounded-lg border border-white/8 bg-black/30 px-2.5 py-2 text-[10px] leading-snug text-white/40">
              Numbers blend across corners; wavetables, filter type and the mod
              matrix jump to the nearest corner. One drag = one undo step.
            </div>
          </div>
        </div>
      )}
    </GlassPanel>
  );
}
