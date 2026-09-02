/**
 * FireMorphPad — Quad Loom (Signal Path Mix · FC.morph).
 * XY morph between four Fire Command patches. Numbers bilinear-blend;
 * discrete fields snap to the nearest corner.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GlassPanel } from "@/components/shared/GlassPanel";
import { ModuleBackdrop } from "./ModuleBackdrop";
import { useFireCommandStore, FIRE_PRESETS, type SavedPreset } from "@/state/fireCommandStore";
import { cloneFirePatch, DEFAULT_FIRE_PATCH, type FirePatch } from "@/audio/dsp/FireCommandSynth";
import { pushFireHistory } from "@/lib/fireHistory";
import { CollapseToggle } from "./CollapseToggle";
import { useFireCollapsed } from "./useFireCollapsed";
import { useFireBandRegister } from "./FireBand";
import { useFireLayout } from "./FireLayoutContext";
import { ensureExpanded } from "./fireNavigate";
import { FC, FC_BAND, bandShade } from "./fireColors";

const CORNERS = ["a", "b", "c", "d"] as const;
type Corner = (typeof CORNERS)[number];

const C = FC.morph;
const C_GLOW = bandShade(FC_BAND.mix, 0.92);
const C_HOT = bandShade(FC_BAND.mix, 0.62);

/** Corner colors stay inside the Mix tangerine family (deep → light). */
const CORNER_META: Record<Corner, { x: number; y: number; label: string; color: string; hue: number }> = {
  a: { x: 0, y: 0, label: "A", color: bandShade(FC_BAND.mix, 0.36), hue: 22 },
  b: { x: 1, y: 0, label: "B", color: bandShade(FC_BAND.mix, 0.52), hue: 28 },
  c: { x: 0, y: 1, label: "C", color: bandShade(FC_BAND.mix, 0.68), hue: 32 },
  d: { x: 1, y: 1, label: "D", color: bandShade(FC_BAND.mix, 0.84), hue: 36 },
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

const SNAP_POS: { id: string; label: string; x: number; y: number }[] = [
  { id: "center", label: "Center", x: 0.5, y: 0.5 },
  { id: "a", label: "A", x: 0, y: 0 },
  { id: "b", label: "B", x: 1, y: 0 },
  { id: "c", label: "C", x: 0, y: 1 },
  { id: "d", label: "D", x: 1, y: 1 },
  { id: "ab", label: "A↔B", x: 0.5, y: 0 },
  { id: "cd", label: "C↔D", x: 0.5, y: 1 },
  { id: "ac", label: "A↕C", x: 0, y: 0.5 },
  { id: "bd", label: "B↕D", x: 1, y: 0.5 },
];

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
  } catch { /* fall through */ }
  return { cornerIds: { ...DEFAULT_CORNER_IDS }, open: false };
}

function savePersist(p: PersistShape): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(p)); } catch { /* */ }
}

function bilinear(x: number, y: number): Record<Corner, number> {
  return { a: (1 - x) * (1 - y), b: x * (1 - y), c: (1 - x) * y, d: x * y };
}

/** Numeric patch keys, computed once — the scrub path runs at pointer rate. */
const NUMERIC_KEYS = (Object.keys(DEFAULT_FIRE_PATCH) as (keyof FirePatch)[])
  .filter((k) => typeof DEFAULT_FIRE_PATCH[k] === "number");

const MORPH_LOCK_KEYS = new Set<keyof FirePatch>([
  "pitchEnvAmount", "pitchEnvTime", "masterGain",
  "pathOsc", "pathFilter", "pathDrive", "pathAge", "pathFx", "pathMix", "pathScope",
  "delayMix", "reverbMix", "chorusMix", "phaserMix", "spectralMix", "drive",
]);

type MorphInterp = "linear" | "equalPower" | "nearest";
type MorphPadMode = "morph" | "crossfade";

function equalPowerWeights(w: Record<Corner, number>): Record<Corner, number> {
  const out = { ...w };
  let sum = 0;
  for (const c of CORNERS) {
    const s = Math.sqrt(Math.max(0, w[c]));
    out[c] = s;
    sum += s;
  }
  if (sum > 1e-9) for (const c of CORNERS) out[c] /= sum;
  return out;
}

function morphPatches(
  corners: Record<Corner, FirePatch>,
  x: number,
  y: number,
  opts?: { interp?: MorphInterp; skipKeys?: Set<keyof FirePatch>; base?: FirePatch },
): FirePatch {
  let w = bilinear(x, y);
  const interp = opts?.interp ?? "linear";
  if (interp === "equalPower") w = equalPowerWeights(w);
  let nearest: Corner = "a";
  for (const c of CORNERS) if (w[c] > w[nearest]) nearest = c;
  if (interp === "nearest") {
    const out = { ...corners[nearest] };
    const skip = opts?.skipKeys;
    const base = opts?.base;
    if (skip && base) {
      for (const k of skip) {
        if (k in base) (out as unknown as Record<string, unknown>)[k as string] = (base as unknown as Record<string, unknown>)[k as string];
      }
    }
    return out;
  }
  const out = { ...corners[nearest] };
  const skip = opts?.skipKeys;
  for (const key of NUMERIC_KEYS) {
    if (skip?.has(key)) {
      if (opts?.base) (out as unknown as Record<string, unknown>)[key as string] = (opts.base as unknown as Record<string, unknown>)[key as string];
      continue;
    }
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

  useEffect(() => { setHi(0); }, [query, open]);

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
          onFocus={() => { setOpen(true); setQuery(""); setHi(0); }}
          onKeyDown={(e) => {
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
              e.stopPropagation();
              setOpen(false);
              setQuery("");
              inputRef.current?.blur();
            }
          }}
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
          className="absolute left-0 right-0 top-[calc(100%+4px)] z-40 max-h-56 overflow-y-auto rounded-xl border border-white/18 bg-[#12121a] shadow-[0_16px_40px_rgba(0,0,0,0.65)]"
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
                    style={{ background: current ? color : opt.user ? C_HOT : "rgba(255,255,255,0.25)" }}
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

function MorphWeightMeter({ label, value, color }: { label: string; value: number; color: string }) {
  const t = Math.min(1, value);
  return (
    <div className="flex flex-col items-center gap-0.5 min-w-[2.2rem]" title={`${label} ${Math.round(t * 100)}%`}>
      <div className="fc-text-floor font-black uppercase tracking-[0.06em]" style={{ color: `${color}aa` }}>{label}</div>
      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-black/50 border border-white/10">
        <div
          className="absolute left-0 top-0 h-full rounded-full transition-[width] duration-75"
          style={{
            width: `${t * 100}%`,
            background: `linear-gradient(90deg, ${color}55, ${color})`,
            boxShadow: t > 0.06 ? `0 0 8px ${color}88` : undefined,
          }}
        />
      </div>
      <div className="font-mono text-[8px] tabular-nums" style={{ color: t > 0.04 ? color : "rgba(255,255,255,0.3)" }}>
        {Math.round(t * 100)}
      </div>
    </div>
  );
}

export function FireMorphPad({ chipHosted = false }: { chipHosted?: boolean } = {}) {
  const [persisted] = useState(loadPersist);
  const [collapsed, toggle] = useFireCollapsed("morph", !persisted.open);
  const { focusActive, focusId, isFocused } = useFireLayout();
  useFireBandRegister("morph", "Morph Pad", C, collapsed, toggle, chipHosted);
  useEffect(() => {
    if (isFocused("morph") && collapsed) ensureExpanded("morph");
  }, [collapsed, isFocused]);
  const open = !collapsed || isFocused("morph");
  const [cornerIds, setCornerIds] = useState(persisted.cornerIds);
  const [pos, setPos] = useState({ x: 0.5, y: 0.5 });
  const [isDragging, setIsDragging] = useState(false);
  const pendingPosRef = useRef<{ x: number; y: number } | null>(null);
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
  const flashRef = useRef(0);
  posRef.current = pos;

  // Cancel any coalesced pointer-move frame still pending at unmount.
  useEffect(() => () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
  }, []);

  const options = useMemo(() => buildOptions(userPresets), [userPresets]);

  // Corner patches resolve ONCE per corner/preset change — rebuilding four
  // full patches on every pointer tick was the main scrub cost (user presets
  // are full ~150-key snapshots, so every numeric field churned per tick).
  const cornerPatches = useMemo<Record<Corner, FirePatch>>(() => {
    const patchFor = (id: string): FirePatch => {
      const factory = FIRE_PRESETS.find((p) => p.id === id);
      const user = factory ? null : userPresets.find((p) => p.id === id);
      // Deep clone so morph scrub never aliases factory / user nested fields.
      return cloneFirePatch(factory?.patch ?? user?.patch ?? {});
    };
    return {
      a: patchFor(cornerIds.a),
      b: patchFor(cornerIds.b),
      c: patchFor(cornerIds.c),
      d: patchFor(cornerIds.d),
    };
  }, [cornerIds, userPresets]);
  const cornerPatchesRef = useRef(cornerPatches);
  cornerPatchesRef.current = cornerPatches;

  const nameFor = (id: string): string =>
    FIRE_PRESETS.find((p) => p.id === id)?.name
    ?? userPresets.find((p) => p.id === id)?.name
    ?? "?";

  const [padMode, setPadMode] = useState<MorphPadMode>("morph");
  const [interp, setInterp] = useState<MorphInterp>("linear");
  const [lockSafe, setLockSafe] = useState(true);
  const [captureCorner, setCaptureCorner] = useState<Corner>("a");

  const applyAt = (x: number, y: number, commit: boolean) => {
    const base = useFireCommandStore.getState().patch;
    const skip = lockSafe ? MORPH_LOCK_KEYS : undefined;
    if (padMode === "crossfade") {
      // CROSSFADE: blend levels of A/B via corner weights when possible; else morph with clear copy.
      const wts = bilinear(x, y);
      const blended = morphPatches(cornerPatchesRef.current, x, y, { interp, skipKeys: skip, base });
      // Prefer level-ish fields for crossfade feel
      for (const key of ["oscALevel", "oscBLevel", "oscCLevel", "masterGain"] as (keyof FirePatch)[]) {
        if (skip?.has(key)) continue;
        let sum = 0;
        for (const c of CORNERS) {
          const v = cornerPatchesRef.current[c][key];
          sum += (typeof v === "number" ? v : 0) * wts[c];
        }
        (blended as unknown as Record<string, unknown>)[key as string] = sum;
      }
      useFireCommandStore.getState().applyMorphPatch(blended, commit);
      return;
    }
    useFireCommandStore.getState().applyMorphPatch(
      morphPatches(cornerPatchesRef.current, x, y, { interp, skipKeys: skip, base }),
      commit,
    );
  };

  const captureCurrent = () => {
    const id = useFireCommandStore.getState().savePreset(`Capture ${captureCorner.toUpperCase()}`);
    const next = { ...cornerIds, [captureCorner]: id };
    setCornerIds(next);
    savePersist({ cornerIds: next, open: !collapsed });
    bumpFlash();
    applyAt(pos.x, pos.y, true);
  };

  // Flash drives the canvas glow only (flashRef, read by RAF) — no setState,
  // or every pointer move re-rendered the whole panel.
  const bumpFlash = () => {
    flashRef.current = 1;
  };

  const posFromEvent = (e: React.PointerEvent): { x: number; y: number } => {
    if (!padRef.current) return posRef.current ?? { x: 0.5, y: 0.5 };
    const r = padRef.current.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
      y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)),
    };
  };

  const goTo = (x: number, y: number, commit = true) => {
    setPos({ x, y });
    bumpFlash();
    if (commit) pushFireHistory();
    applyAt(x, y, commit);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    draggingRef.current = true;
    setIsDragging(true);
    pushFireHistory();
    bumpFlash();
    const p = posFromEvent(e);
    setPos(p);
    applyAt(p.x, p.y, false);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    // Gaming mice deliver pointermove at 125–1000 Hz — coalesce BOTH the
    // React position state and the engine apply to one per frame.
    pendingPosRef.current = posFromEvent(e);
    bumpFlash();
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      const p = pendingPosRef.current;
      if (!p || !draggingRef.current) return;
      setPos(p);
      applyAt(p.x, p.y, false);
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

  const onDoubleClick = (e: React.MouseEvent) => {
    const r = padRef.current!.getBoundingClientRect();
    const p = {
      x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
      y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)),
    };
    let nearest = SNAP_POS[1]!; // A
    let best = Infinity;
    for (const s of SNAP_POS) {
      if (s.id === "center" || s.id.length > 1) continue; // only true corners A–D
      const d = (s.x - p.x) ** 2 + (s.y - p.y) ** 2;
      if (d < best) { best = d; nearest = s; }
    }
    goTo(nearest.x, nearest.y, true);
  };

  const setCorner = (c: Corner, id: string) => {
    const next = { ...cornerIds, [c]: id };
    setCornerIds(next);
    savePersist({ cornerIds: next, open: !collapsed });
    bumpFlash();
    applyAt(pos.x, pos.y, true);
  };

  const toggleOpen = () => {
    toggle();
    savePersist({ cornerIds, open: collapsed });
  };

  const swapDiagonals = () => {
    const next = { a: cornerIds.d, b: cornerIds.c, c: cornerIds.b, d: cornerIds.a };
    setCornerIds(next);
    savePersist({ cornerIds: next, open: !collapsed });
    bumpFlash();
    applyAt(pos.x, pos.y, true);
  };

  const resetCorners = () => {
    setCornerIds({ ...DEFAULT_CORNER_IDS });
    savePersist({ cornerIds: { ...DEFAULT_CORNER_IDS }, open: !collapsed });
    goTo(0.5, 0.5, true);
  };

  const w = bilinear(pos.x, pos.y);
  const dominant = (CORNERS.reduce((best, c) => (w[c] > w[best] ? c : best), "a" as Corner));

  // Living blend field
  useEffect(() => {
    if (!open) return;
    const canvas = fieldCanvasRef.current;
    const pad = padRef.current;
    if (!canvas || !pad) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let cssW = pad.clientWidth;
    let cssH = pad.clientHeight;
    const sync = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      cssW = pad.clientWidth;
      cssH = pad.clientHeight;
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
      if (document.hidden || t - last < 36) return;
      last = t;
      flashRef.current *= 0.9;
      const W = cssW;
      const H = cssH;
      if (W < 2 || H < 2) return;
      ctx.clearRect(0, 0, W, H);

      const { x, y } = posRef.current;
      const weights = bilinear(x, y);
      const breath = 0.92 + 0.08 * Math.sin(t / 1400);
      const flashA = flashRef.current;

      // Base tangerine chamber
      const plate = ctx.createRadialGradient(W * 0.5, H * 0.5, 4, W * 0.5, H * 0.5, Math.max(W, H) * 0.7);
      plate.addColorStop(0, `rgba(255,138,46,${0.06 + flashA * 0.12})`);
      plate.addColorStop(1, "rgba(8,4,2,0.92)");
      ctx.fillStyle = plate;
      ctx.fillRect(0, 0, W, H);

      for (const c of CORNERS) {
        const meta = CORNER_META[c];
        const cx = meta.x * W;
        const cy = meta.y * H;
        const strength = 0.16 + weights[c] * 0.58 + flashA * 0.1;
        const R = Math.max(W, H) * (0.4 + weights[c] * 0.3) * breath;
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
        g.addColorStop(0, `hsla(${meta.hue}, 92%, 58%, ${strength})`);
        g.addColorStop(0.45, `hsla(${meta.hue}, 85%, 48%, ${strength * 0.35})`);
        g.addColorStop(1, `hsla(${meta.hue}, 75%, 40%, 0)`);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
      }

      const px = x * W;
      const py = y * H;
      for (const c of CORNERS) {
        const meta = CORNER_META[c];
        const alpha = weights[c] * 0.55;
        if (alpha < 0.04) continue;
        const mx = (px + meta.x * W) / 2 + Math.sin(t / 900 + meta.hue) * 10 * weights[c];
        const my = (py + meta.y * H) / 2 + Math.cos(t / 1100 + meta.hue) * 10 * weights[c];
        ctx.strokeStyle = `hsla(${meta.hue}, 90%, 62%, ${alpha * 0.4})`;
        ctx.lineWidth = 2.2 + weights[c] * 5;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.quadraticCurveTo(mx, my, meta.x * W, meta.y * H);
        ctx.stroke();
        ctx.strokeStyle = `hsla(${meta.hue}, 95%, 72%, ${alpha * 0.8})`;
        ctx.lineWidth = 1 + weights[c] * 2.5;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.quadraticCurveTo(mx, my, meta.x * W, meta.y * H);
        ctx.stroke();

        if (weights[c] > 0.15) {
          const pulseCount = Math.ceil(weights[c] * 3);
          for (let pi = 0; pi < pulseCount; pi++) {
            const u = ((t / 1200) + pi * 0.33 + c.charCodeAt(0) * 0.1) % 1;
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

      const vig = ctx.createRadialGradient(W * 0.5, H * 0.5, Math.min(W, H) * 0.2, W * 0.5, H * 0.5, Math.max(W, H) * 0.7);
      vig.addColorStop(0, "rgba(0,0,0,0)");
      vig.addColorStop(1, "rgba(0,0,0,0.38)");
      ctx.fillStyle = vig;
      ctx.fillRect(0, 0, W, H);

      // Identity watermark
      ctx.font = "700 9px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = `rgba(255,180,100,${0.35 + flashA * 0.3})`;
      ctx.textAlign = "left";
      ctx.fillText("QUAD LOOM", 10, H - 8);
      ctx.textAlign = "right";
      ctx.fillText(`${Math.round(x * 100)},${Math.round(y * 100)}`, W - 10, H - 8);
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
        let domHue = 28;
        let domW = 0;
        for (const c of CORNERS) {
          if (wts[c] > domW) { domW = wts[c]; domHue = CORNER_META[c].hue; }
        }
        trailRef.current.push({ x: px, y: py, life: 1, hue: domHue });
        if (trailRef.current.length > 40) trailRef.current.shift();
      }

      for (let i = trailRef.current.length - 1; i >= 0; i--) {
        const p = trailRef.current[i]!;
        p.life -= 0.036;
        if (p.life <= 0) { trailRef.current.splice(i, 1); continue; }
        const a = p.life * 0.75;
        const r = 3 + (1 - p.life) * 7;
        const halo = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 3);
        halo.addColorStop(0, `hsla(${p.hue}, 90%, 72%, ${a * 0.5})`);
        halo.addColorStop(1, `hsla(${p.hue}, 80%, 55%, 0)`);
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r * 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = `hsla(${p.hue}, 100%, 82%, ${a * 0.85})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r * 0.7, 0, Math.PI * 2);
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

  const live = isDragging || Math.abs(pos.x - 0.5) > 0.02 || Math.abs(pos.y - 0.5) > 0.02;

  return (
    <GlassPanel className="p-3" data-fire-module="morph">
      <ModuleBackdrop moduleId="morph" color={C} awake />
      <div className="fc-mod-content-well">
      <style>{`
        @keyframes morph-grid-pulse {
          0%, 100% { opacity: 0.12; }
          50% { opacity: 0.28; }
        }
        @keyframes morph-grid-breathe {
          0%, 100% { opacity: 0.18; transform: scale(1); }
          50% { opacity: 0.3; transform: scale(1.015); }
        }
        @keyframes morph-ripple {
          0% { transform: translate(-50%, -50%) scale(0.85); opacity: 0.65; }
          100% { transform: translate(-50%, -50%) scale(1.85); opacity: 0; }
        }
        @keyframes corner-glow-pulse {
          0%, 100% { filter: brightness(1); }
          50% { filter: brightness(1.35); }
        }
      `}</style>

      <div className="flex items-center justify-between gap-2">
        <button
          onClick={toggleOpen}
          className="flex items-center gap-2 text-left rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
          title="Quad Loom: blend four patches by dragging the puck"
          aria-expanded={open}
        >
          <CollapseToggle collapsed={!open} color={C} />
          <span className="text-[11px] font-semibold uppercase tracking-[0.22em]" style={{ color: C }}>
            Morph Pad
          </span>
          <span className="text-[9px] normal-case tracking-normal text-white/35">· Patch morph · not FM Vector Lattice</span>
        </button>
        {!open && (
          <span className="text-[10px] text-white/35 italic truncate">
            {CORNERS.map((c) => nameFor(cornerIds[c])).join(" · ")}
          </span>
        )}
      </div>

      {open && (
        <>
          <div
            className="mt-2.5 mb-2 flex items-center justify-between gap-2 rounded-lg border px-2 py-1.5"
            style={{
              borderColor: live ? `${C}48` : `${C}28`,
              background: live
                ? `linear-gradient(105deg, ${C}28 0%, ${C}0c 38%, transparent 72%)`
                : `linear-gradient(180deg, rgba(0,0,0,0.4), ${C}0c)`,
              boxShadow: live ? `inset 0 1px 0 ${C}28` : undefined,
            }}
          >
            <div className="min-w-0">
              <div className="text-[8px] font-black uppercase tracking-[0.28em]" style={{ color: `${C}99` }}>
                Signal Path · Mix
              </div>
              <div className="truncate text-[13px] font-semibold" style={{ color: C_GLOW }}>
                Quad Loom
                <span className="ml-2 font-mono text-[10px] font-normal text-white/40">
                  {Math.round(pos.x * 100)},{Math.round(pos.y * 100)} · →{dominant.toUpperCase()} {Math.round(w[dominant] * 100)}%
                </span>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1 flex-wrap justify-end">
              <button
                type="button"
                onClick={() => goTo(0.5, 0.5, true)}
                className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition"
                style={{ borderColor: `${C}66`, color: C_GLOW, background: `${C}22` }}
                title="Snap to center blend"
              >
                Center
              </button>
              <button
                type="button"
                onClick={swapDiagonals}
                className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
                style={{ borderColor: `${C}55`, color: C_GLOW, background: `${C}1c` }}
                title="Swap diagonal corners A↔D · B↔C"
              >
                Swap✕
              </button>
              <button
                type="button"
                onClick={resetCorners}
                className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition hover:brightness-125"
                style={{ borderColor: `${C}44`, color: `${C}bb`, background: `${C}14` }}
                title="Reset corners + center"
              >
                Reset
              </button>
              <div
                className="rounded-full px-2.5 py-0.5 text-[9px] font-black uppercase tracking-wider"
                style={{
                  color: live ? C_GLOW : "rgba(255,255,255,0.35)",
                  background: live ? `${C}38` : "rgba(0,0,0,0.45)",
                  border: `1px solid ${live ? `${C}70` : "rgba(255,255,255,0.12)"}`,
                  boxShadow: live ? `0 0 14px ${C}50` : undefined,
                }}
              >
                {isDragging ? "Weave" : dominant.toUpperCase()}
              </div>
            </div>
          </div>

          <div className="mb-2 flex flex-wrap items-center justify-center gap-1">
            <span className="mr-1 text-[8px] font-black uppercase tracking-[0.28em]" style={{ color: `${C}66` }}>
              Snap
            </span>
            {SNAP_POS.map((s) => {
              const on = Math.abs(pos.x - s.x) < 0.04 && Math.abs(pos.y - s.y) < 0.04;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => goTo(s.x, s.y, true)}
                  className="rounded-md border px-2 py-0.5 text-[9px] font-black transition"
                  style={
                    on
                      ? {
                          borderColor: `${C}99`,
                          background: `${C}33`,
                          color: C_GLOW,
                          boxShadow: `0 0 10px ${C}44`,
                        }
                      : { borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.45)", background: "rgba(0,0,0,0.3)" }
                  }
                  title={`Snap to ${s.label}`}
                >
                  {s.label}
                </button>
              );
            })}
          </div>

          <div className="mb-2 flex flex-wrap items-center justify-center gap-1">
            <span className="mr-1 text-[8px] font-black uppercase tracking-[0.28em]" style={{ color: `${C}66` }}>Mode</span>
            {([
              { id: "morph" as MorphPadMode, label: "MORPH" },
              { id: "crossfade" as MorphPadMode, label: "CROSSFADE" },
            ]).map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => setPadMode(o.id)}
                className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase"
                style={
                  padMode === o.id
                    ? { borderColor: `${C}99`, background: `${C}33`, color: C_GLOW }
                    : { borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.45)" }
                }
                title={o.id === "crossfade" ? "Blend mixer levels from corner weights" : "Interpolate FirePatch"}
              >
                {o.label}
              </button>
            ))}
            <span className="mx-1 text-white/20">·</span>
            <span className="mr-1 text-[8px] font-black uppercase tracking-[0.28em]" style={{ color: `${C}66` }}>Interp</span>
            {([
              { id: "linear" as MorphInterp, label: "Linear" },
              { id: "equalPower" as MorphInterp, label: "EqPow" },
              { id: "nearest" as MorphInterp, label: "Nearest" },
            ]).map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => setInterp(o.id)}
                className="rounded-md border px-2 py-0.5 text-[9px] font-black"
                style={
                  interp === o.id
                    ? { borderColor: `${C}99`, background: `${C}33`, color: C_GLOW }
                    : { borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.45)" }
                }
              >
                {o.label}
              </button>
            ))}
            <label className="ml-2 flex items-center gap-1 text-[9px] text-white/50">
              <input type="checkbox" checked={lockSafe} onChange={(e) => setLockSafe(e.target.checked)} />
              Lock pitch/master/path/FX
            </label>
          </div>

          <div className="mb-2 flex items-end justify-center gap-3 flex-wrap">
            {CORNERS.map((c) => (
              <div key={c} className="flex flex-col items-center gap-0.5 min-w-[3.2rem]">
                <span className="text-[18px] font-black tabular-nums leading-none" style={{ color: CORNER_META[c].color }}>
                  {Math.round(w[c] * 100)}
                  <span className="text-[10px] font-bold opacity-70">%</span>
                </span>
                <span className="text-[9px] font-black uppercase tracking-wider" style={{ color: `${CORNER_META[c].color}aa` }}>
                  {c.toUpperCase()}
                </span>
              </div>
            ))}
          </div>

          <div className="mb-2 flex flex-wrap items-center justify-center gap-1">
            <span className="mr-1 text-[8px] font-black uppercase tracking-[0.28em]" style={{ color: `${C}66` }}>Capture</span>
            {CORNERS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCaptureCorner(c)}
                className="rounded-md border px-2 py-0.5 text-[9px] font-black"
                style={
                  captureCorner === c
                    ? { borderColor: `${CORNER_META[c].color}99`, background: `${CORNER_META[c].color}33`, color: C_GLOW }
                    : { borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.45)" }
                }
              >
                {c.toUpperCase()}
              </button>
            ))}
            <button
              type="button"
              onClick={captureCurrent}
              className="rounded-md border px-2 py-0.5 text-[9px] font-black uppercase"
              style={{ borderColor: `${C}88`, color: C_GLOW, background: `${C}28` }}
              title="Capture current patch into selected corner"
            >
              Capture current patch
            </button>
          </div>

          <div className="mb-2 flex items-center justify-center gap-2.5 flex-wrap">
            {CORNERS.map((c) => (
              <MorphWeightMeter key={c} label={c.toUpperCase()} value={w[c]} color={CORNER_META[c].color} />
            ))}
          </div>


          <div className="flex flex-wrap gap-4 min-w-0">
            <div
              ref={padRef}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onDoubleClick={onDoubleClick}
              className="relative w-full max-w-[min(100%,300px)] aspect-square cursor-crosshair touch-none select-none overflow-hidden rounded-2xl border-2"
              style={{
                borderColor: `${C}${isDragging ? "88" : "44"}`,
                background: "linear-gradient(160deg, rgba(12,6,2,0.95), rgba(0,0,0,0.88))",
                boxShadow: `inset 0 1px 0 rgba(255,255,255,0.06), 0 0 36px ${C}${isDragging ? "40" : "18"}, 0 8px 28px rgba(0,0,0,0.4)`,
              }}
              role="slider"
              aria-label="Patch morph pad — drag to blend the four corner presets"
              aria-valuetext={`x ${Math.round(pos.x * 100)}%, y ${Math.round(pos.y * 100)}%`}
              aria-valuenow={Math.round(pos.x * 100)}
              aria-valuemin={0}
              aria-valuemax={100}
              title="Drag to weave · Double-click snaps to nearest corner"
            >
              <canvas
                ref={fieldCanvasRef}
                className="pointer-events-none absolute inset-0 block h-full w-full"
                aria-hidden
              />
              <div
                className="pointer-events-none absolute inset-0 animate-[morph-grid-pulse_3.6s_ease-in-out_infinite]"
                style={{
                  backgroundImage:
                    `linear-gradient(${C}33 1px, transparent 1px), linear-gradient(90deg, ${C}33 1px, transparent 1px)`,
                  backgroundSize: "40px 40px",
                }}
              />
              <div
                className="pointer-events-none absolute inset-0 animate-[morph-grid-breathe_4.8s_ease-in-out_infinite]"
                style={{
                  backgroundImage:
                    `linear-gradient(${C}18 1px, transparent 1px), linear-gradient(90deg, ${C}18 1px, transparent 1px)`,
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
                  className="pointer-events-none absolute rounded-full border animate-[morph-ripple_2.4s_ease-out_infinite]"
                  style={{
                    borderColor: `${C}55`,
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
                  background: "radial-gradient(circle at 35% 30%, rgba(255,255,255,0.55), rgba(255,200,140,0.25))",
                  boxShadow: `0 0 18px rgba(255,255,255,0.7), 0 0 36px ${C}66, inset 0 0 6px rgba(255,255,255,0.3)`,
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
                      boxShadow: w[c] > 0.2 ? `0 0 12px ${CORNER_META[c].color}44` : `0 0 8px ${CORNER_META[c].color}22`,
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
              <div className="mt-0.5 rounded-lg border px-2.5 py-2 text-[10px] leading-snug" style={{ borderColor: `${C}22`, background: `${C}0c`, color: `${C}99` }}>
                Drag the loom puck — numbers blend, discrete fields jump to the nearest corner.
                Double-click snaps to a corner. One drag = one undo step.
              </div>
            </div>
          </div>
        </>
      )}
      </div>
    </GlassPanel>
  );
}
