/**
 * FireMorphPad — XY morph between four Fire Command patches.
 *
 * Pick a preset for each corner (type-to-search), then drag the puck: every
 * numeric patch field is bilinearly interpolated between the corners;
 * discrete fields come from the NEAREST corner. One undo snapshot per gesture.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GlassPanel } from "@/components/shared/GlassPanel";
import { useFireCommandStore, FIRE_PRESETS, type SavedPreset } from "@/state/fireCommandStore";
import { DEFAULT_FIRE_PATCH, type FirePatch } from "@/audio/dsp/FireCommandSynth";
import { pushFireHistory } from "@/lib/fireHistory";
import { CollapseToggle } from "./CollapseToggle";
import { useFireCollapsed } from "./useFireCollapsed";
import { useFireBandRegister } from "./FireBand";
import { useFireLayout } from "./FireLayoutContext";
import { ensureExpanded } from "./fireNavigate";

const CORNERS = ["a", "b", "c", "d"] as const;
type Corner = (typeof CORNERS)[number];

const CORNER_META: Record<Corner, { x: number; y: number; label: string; color: string; hue: number }> = {
  a: { x: 0, y: 0, label: "A", color: "#ff6a3d", hue: 18 },
  b: { x: 1, y: 0, label: "B", color: "#62b6ff", hue: 210 },
  c: { x: 0, y: 1, label: "C", color: "#7cf6b0", hue: 145 },
  d: { x: 1, y: 1, label: "D", color: "#c792ea", hue: 275 },
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

type TrailParticle = { x: number; y: number; life: number; hue: number };

interface PersistShape {
  cornerIds: Record<Corner, string>;
  open: boolean;
}

type PresetOption = {
  id: string;
  name: string;
  category: string;
  user: boolean;
  desc: string;
};

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

function buildOptions(userPresets: SavedPreset[]): PresetOption[] {
  const users: PresetOption[] = [...userPresets]
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((p) => ({
      id: p.id,
      name: p.name,
      category: "User",
      user: true,
      desc: "Your saved patch",
    }));
  const factory: PresetOption[] = FIRE_PRESETS.map((p) => ({
    id: p.id,
    name: p.name,
    category: p.category,
    user: false,
    desc: p.desc,
  }));
  return [...users, ...factory];
}

function filterOptions(all: PresetOption[], query: string): PresetOption[] {
  const q = query.trim().toLowerCase();
  if (!q) return all.slice(0, 48);
  const scored: { opt: PresetOption; score: number }[] = [];
  for (const opt of all) {
    const name = opt.name.toLowerCase();
    const cat = opt.category.toLowerCase();
    const desc = opt.desc.toLowerCase();
    let score = -1;
    if (name === q) score = 100;
    else if (name.startsWith(q)) score = 80;
    else if (name.includes(q)) score = 60;
    else if (cat.startsWith(q) || cat.includes(q)) score = 40;
    else if (desc.includes(q)) score = 20;
    else if (opt.id.toLowerCase().includes(q)) score = 15;
    if (score >= 0) scored.push({ opt, score: score + (opt.user ? 5 : 0) });
  }
  scored.sort((a, b) => b.score - a.score || a.opt.name.localeCompare(b.opt.name));
  return scored.slice(0, 48).map((s) => s.opt);
}

/** Type-to-search preset picker — replaces the old dropdown for 500+ banks. */
function MorphPresetSearch({
  value,
  color,
  options,
  onChange,
  cornerLabel,
}: {
  value: string;
  color: string;
  options: PresetOption[];
  onChange: (id: string) => void;
  cornerLabel: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.id === value);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hi, setHi] = useState(0);

  const results = useMemo(() => filterOptions(options, query), [options, query]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  useEffect(() => {
    setHi(0);
  }, [query, open]);

  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(`[data-idx="${hi}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [hi, open]);

  const pick = useCallback((id: string) => {
    onChange(id);
    setOpen(false);
    setQuery("");
    inputRef.current?.blur();
  }, [onChange]);

  const onFocus = () => {
    setOpen(true);
    setQuery("");
    setHi(0);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setHi((h) => Math.min(results.length - 1, h + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHi((h) => Math.max(0, h - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const hit = results[hi];
      if (hit) pick(hit.id);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      setQuery("");
      inputRef.current?.blur();
    }
  };

  return (
    <div ref={wrapRef} className="relative min-w-0 flex-1">
      <div
        className="flex items-center gap-1.5 rounded-lg border bg-black/45 px-2 py-1 transition"
        style={{
          borderColor: open ? `${color}88` : "rgba(255,255,255,0.12)",
          boxShadow: open ? `0 0 16px ${color}22` : undefined,
        }}
      >
        <span className="pointer-events-none text-[10px] text-white/30" aria-hidden>⌕</span>
        <input
          ref={inputRef}
          value={open ? query : (selected?.name ?? "?")}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={onFocus}
          onKeyDown={onKeyDown}
          placeholder={`Search corner ${cornerLabel}…`}
          className="min-w-0 flex-1 bg-transparent text-[11px] text-white/85 outline-none placeholder:text-white/25"
          aria-label={`Search preset for corner ${cornerLabel}`}
          aria-expanded={open}
          aria-autocomplete="list"
          role="combobox"
          autoComplete="off"
          spellCheck={false}
        />
        {!open && selected && (
          <span
            className="shrink-0 rounded px-1 py-0.5 text-[8px] font-bold uppercase tracking-wider"
            style={{ color, background: `${color}18` }}
          >
            {selected.category}
          </span>
        )}
      </div>

      {open && (
        <div
          ref={listRef}
          className="absolute left-0 right-0 top-[calc(100%+4px)] z-40 max-h-56 overflow-y-auto rounded-xl border border-white/12 bg-[#0a0a0e]/97 shadow-[0_16px_40px_rgba(0,0,0,0.65)] backdrop-blur-md"
          role="listbox"
        >
          {results.length === 0 ? (
            <div className="px-3 py-3 text-[11px] text-white/40">No presets match “{query}”</div>
          ) : (
            results.map((opt, idx) => {
              const active = idx === hi;
              const current = opt.id === value;
              return (
                <button
                  key={opt.id}
                  type="button"
                  data-idx={idx}
                  role="option"
                  aria-selected={current}
                  onMouseEnter={() => setHi(idx)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(opt.id)}
                  className={`flex w-full items-start gap-2 px-2.5 py-1.5 text-left transition ${
                    active ? "bg-white/[0.08]" : "hover:bg-white/[0.04]"
                  }`}
                >
                  <span
                    className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ background: current ? color : opt.user ? "#ff9a6b" : "rgba(255,255,255,0.25)" }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11px] font-semibold text-white/90">{opt.name}</span>
                    <span className="block truncate text-[9px] text-white/35">
                      {opt.category}{opt.desc ? ` · ${opt.desc}` : ""}
                    </span>
                  </span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

export function FireMorphPad({ chipHosted = false }: { chipHosted?: boolean } = {}) {
  const [persisted] = useState(loadPersist);
  const [collapsed, toggle] = useFireCollapsed("morph", !persisted.open);
  const { focusActive, focusId, isFocused } = useFireLayout();
  useFireBandRegister("morph", "Morph Pad", FIRE, collapsed, toggle, chipHosted);
  useEffect(() => {
    if (isFocused("morph") && collapsed) ensureExpanded("morph");
  }, [collapsed, isFocused]);
  const open = !collapsed || isFocused("morph");
  const [cornerIds, setCornerIds] = useState(persisted.cornerIds);
  const [pos, setPos] = useState({ x: 0.5, y: 0.5 });
  const [isDragging, setIsDragging] = useState(false);
  const userPresets = useFireCommandStore((s) => s.userPresets);
  const padRef = useRef<HTMLDivElement>(null);
  const trailCanvasRef = useRef<HTMLCanvasElement>(null);
  const fieldCanvasRef = useRef<HTMLCanvasElement>(null);
  const draggingRef = useRef(false);
  const rafRef = useRef(0);
  const trailRafRef = useRef(0);
  const fieldRafRef = useRef(0);
  const posRef = useRef(pos);
  const trailRef = useRef<TrailParticle[]>([]);
  posRef.current = pos;

  const options = useMemo(() => buildOptions(userPresets), [userPresets]);

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
    savePersist({ cornerIds: next, open: !collapsed });
  };

  const toggleOpen = () => {
    toggle();
    savePersist({ cornerIds, open: collapsed });
  };

  const w = bilinear(pos.x, pos.y);

  // Living blend field — soft color wash that follows the puck weights
  useEffect(() => {
    if (!open) return;
    const canvas = fieldCanvasRef.current;
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

    let last = 0;
    const draw = (t: number) => {
      fieldRafRef.current = requestAnimationFrame(draw);
      if (document.hidden || t - last < 40) return;
      last = t;
      const W = pad.clientWidth;
      const H = pad.clientHeight;
      if (W < 2 || H < 2) return;
      ctx.clearRect(0, 0, W, H);

      const { x, y } = posRef.current;
      const weights = bilinear(x, y);
      const breath = 0.92 + 0.08 * Math.sin(t / 1400);

      for (const c of CORNERS) {
        const meta = CORNER_META[c];
        const cx = meta.x * W;
        const cy = meta.y * H;
        const strength = 0.18 + weights[c] * 0.55;
        const R = Math.max(W, H) * (0.42 + weights[c] * 0.28) * breath;
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
        g.addColorStop(0, `hsla(${meta.hue}, 90%, 60%, ${strength})`);
        g.addColorStop(0.45, `hsla(${meta.hue}, 80%, 50%, ${strength * 0.35})`);
        g.addColorStop(1, `hsla(${meta.hue}, 70%, 40%, 0)`);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
      }

      // Dimensional cross-blend filaments — energized connection beams
      const px = x * W;
      const py = y * H;
      for (const c of CORNERS) {
        const meta = CORNER_META[c];
        const alpha = weights[c] * 0.5;
        if (alpha < 0.04) continue;
        
        // Outer glow beam
        ctx.strokeStyle = `hsla(${meta.hue}, 90%, 65%, ${alpha * 0.35})`;
        ctx.lineWidth = 2.5 + weights[c] * 5;
        ctx.beginPath();
        ctx.moveTo(px, py);
        const mx = (px + meta.x * W) / 2 + Math.sin(t / 900 + meta.hue) * 10 * weights[c];
        const my = (py + meta.y * H) / 2 + Math.cos(t / 1100 + meta.hue) * 10 * weights[c];
        ctx.quadraticCurveTo(mx, my, meta.x * W, meta.y * H);
        ctx.stroke();
        
        // Core energy beam
        ctx.strokeStyle = `hsla(${meta.hue}, 95%, 75%, ${alpha * 0.75})`;
        ctx.lineWidth = 1 + weights[c] * 2.8;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.quadraticCurveTo(mx, my, meta.x * W, meta.y * H);
        ctx.stroke();
        
        // Energy pulses along the beam
        if (weights[c] > 0.15) {
          const pulseCount = Math.ceil(weights[c] * 3);
          for (let p = 0; p < pulseCount; p++) {
            const u = ((t / 1200) + p * 0.33 + c.charCodeAt(0) * 0.1) % 1;
            const pu = 1 - u;
            const bx = pu * pu * pu * px + 3 * pu * pu * u * mx + 3 * pu * u * u * mx + u * u * u * (meta.x * W);
            const by = pu * pu * pu * py + 3 * pu * pu * u * my + 3 * pu * u * u * my + u * u * u * (meta.y * H);
            const pg = ctx.createRadialGradient(bx, by, 0, bx, by, 4 + weights[c] * 3);
            pg.addColorStop(0, `hsla(${meta.hue}, 100%, 85%, ${weights[c] * 0.9})`);
            pg.addColorStop(1, `hsla(${meta.hue}, 90%, 70%, 0)`);
            ctx.fillStyle = pg;
            ctx.beginPath();
            ctx.arc(bx, by, 4 + weights[c] * 3, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }

      // Soft vignette so corners stay readable
      const vig = ctx.createRadialGradient(W * 0.5, H * 0.5, Math.min(W, H) * 0.2, W * 0.5, H * 0.5, Math.max(W, H) * 0.7);
      vig.addColorStop(0, "rgba(0,0,0,0)");
      vig.addColorStop(1, "rgba(0,0,0,0.35)");
      ctx.fillStyle = vig;
      ctx.fillRect(0, 0, W, H);
    };

    fieldRafRef.current = requestAnimationFrame(draw);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(fieldRafRef.current);
    };
  }, [open]);

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
          if (wts[c] > domW) { domW = wts[c]; domHue = CORNER_META[c].hue; }
        }
        trailRef.current.push({ x: px, y: py, life: 1, hue: domHue });
        if (trailRef.current.length > 36) trailRef.current.shift();
      }

      // Enhanced ghost trail rendering with depth and energy
      for (let i = trailRef.current.length - 1; i >= 0; i--) {
        const p = trailRef.current[i];
        p.life -= 0.038;
        if (p.life <= 0) { trailRef.current.splice(i, 1); continue; }
        const a = p.life * 0.75;
        const r = 3 + (1 - p.life) * 7;
        
        // Outer glow halo
        const halo = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 3);
        halo.addColorStop(0, `hsla(${p.hue}, 90%, 75%, ${a * 0.5})`);
        halo.addColorStop(0.5, `hsla(${p.hue}, 85%, 65%, ${a * 0.2})`);
        halo.addColorStop(1, `hsla(${p.hue}, 70%, 55%, 0)`);
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r * 3, 0, Math.PI * 2);
        ctx.fill();
        
        // Core bright particle
        const core = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 0.8);
        core.addColorStop(0, `hsla(${p.hue}, 100%, 85%, ${a * 0.9})`);
        core.addColorStop(1, `hsla(${p.hue}, 90%, 72%, ${a * 0.3})`);
        ctx.fillStyle = core;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r * 0.8, 0, Math.PI * 2);
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

  if (focusActive && focusId !== "morph") return null;
  if (chipHosted && collapsed && !isFocused("morph")) return null;

  return (
    <GlassPanel className="p-3" data-fire-module="morph">
      <style>{`
        @keyframes morph-breathe {
          0%, 100% { opacity: 0.55; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.08); }
        }
        @keyframes morph-grid-pulse {
          0%, 100% { opacity: 0.15; }
          50% { opacity: 0.32; }
        }
        @keyframes morph-grid-breathe {
          0%, 100% { opacity: 0.22; transform: scale(1); }
          50% { opacity: 0.35; transform: scale(1.02); }
        }
        @keyframes morph-ripple {
          0% { transform: translate(-50%, -50%) scale(0.85); opacity: 0.65; }
          100% { transform: translate(-50%, -50%) scale(1.85); opacity: 0; }
        }
        @keyframes corner-glow-pulse {
          0%, 100% { filter: brightness(1); }
          50% { filter: brightness(1.4); }
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
          <span className="text-[10px] text-white/35 italic truncate">
            drag between {CORNERS.map((c) => nameFor(cornerIds[c])).join(" · ")}
          </span>
        )}
      </div>

      {open && (
        <div className="mt-2.5 flex flex-wrap gap-4 min-w-0">
          <div
            ref={padRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            className="relative w-full max-w-[min(100%,300px)] aspect-square cursor-crosshair touch-none select-none overflow-hidden rounded-2xl border border-white/15 shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_8px_28px_rgba(0,0,0,0.35)]"
            style={{
              background:
                "linear-gradient(160deg, rgba(8,6,10,0.95), rgba(0,0,0,0.82))",
            }}
            role="slider"
            aria-label="Patch morph pad — drag to blend the four corner presets"
            aria-valuetext={`x ${Math.round(pos.x * 100)}%, y ${Math.round(pos.y * 100)}%`}
            aria-valuenow={Math.round(pos.x * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <canvas
              ref={fieldCanvasRef}
              className="pointer-events-none absolute inset-0 block h-full w-full"
              aria-hidden
            />

            {/* Dimensional breathing grid — dual-layer with phase offset */}
            <div
              className="pointer-events-none absolute inset-0 animate-[morph-grid-pulse_3.6s_ease-in-out_infinite]"
              style={{
                backgroundImage:
                  "linear-gradient(rgba(255,255,255,0.18) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.18) 1px, transparent 1px)",
                backgroundSize: "40px 40px",
              }}
            />
            <div
              className="pointer-events-none absolute inset-0 animate-[morph-grid-breathe_4.8s_ease-in-out_infinite]"
              style={{
                backgroundImage:
                  "linear-gradient(rgba(255,255,255,0.09) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.09) 1px, transparent 1px)",
                backgroundSize: "20px 20px",
              }}
            />

            <canvas
              ref={trailCanvasRef}
              className="pointer-events-none absolute inset-0 block h-full w-full"
              aria-hidden
            />

            {CORNERS.map((c) => (
              <span
                key={c}
                className="absolute flex h-7 w-7 items-center justify-center rounded-full border-2 text-[11px] font-bold pointer-events-none transition-all duration-200"
                style={{
                  color: CORNER_META[c].color,
                  borderColor: `${CORNER_META[c].color}${Math.round(70 + w[c] * 150).toString(16).padStart(2, "0")}`,
                  background: `radial-gradient(circle at 35% 30%, ${CORNER_META[c].color}${Math.round(35 + w[c] * 70).toString(16).padStart(2, "0")}, ${CORNER_META[c].color}${Math.round(12 + w[c] * 35).toString(16).padStart(2, "0")})`,
                  boxShadow: `0 0 ${12 + w[c] * 28}px ${CORNER_META[c].color}88, inset 0 0 ${6 + w[c] * 12}px ${CORNER_META[c].color}44`,
                  animation: w[c] > 0.3 ? "corner-glow-pulse 1.8s ease-in-out infinite" : "none",
                  left: CORNER_META[c].x === 0 ? 8 : undefined,
                  right: CORNER_META[c].x === 1 ? 8 : undefined,
                  top: CORNER_META[c].y === 0 ? 8 : undefined,
                  bottom: CORNER_META[c].y === 1 ? 8 : undefined,
                }}
              >
                {CORNER_META[c].label}
              </span>
            ))}

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

          <div className="flex min-w-0 flex-1 flex-col gap-2.5">
            {CORNERS.map((c) => (
              <div key={c} className="flex items-center gap-2 min-w-0">
                <span
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border text-[11px] font-bold"
                  style={{
                    color: CORNER_META[c].color,
                    borderColor: `${CORNER_META[c].color}77`,
                    background: `${CORNER_META[c].color}22`,
                    boxShadow: `0 0 10px ${CORNER_META[c].color}33`,
                  }}
                >
                  {CORNER_META[c].label}
                </span>
                <MorphPresetSearch
                  value={cornerIds[c]}
                  color={CORNER_META[c].color}
                  options={options}
                  onChange={(id) => setCorner(c, id)}
                  cornerLabel={CORNER_META[c].label}
                />
                <div
                  className="h-1.5 w-11 shrink-0 overflow-hidden rounded-full bg-white/10"
                  title={`${Math.round(w[c] * 100)}% blend weight`}
                >
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
            <div className="mt-0.5 rounded-lg border border-white/8 bg-black/30 px-2.5 py-2 text-[10px] leading-snug text-white/40">
              Type to search any factory or user patch for each corner. Numbers
              blend; wavetables and the matrix jump to the nearest corner. One
              drag = one undo step.
            </div>
          </div>
        </div>
      )}
    </GlassPanel>
  );
}
