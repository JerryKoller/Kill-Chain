/**
 * AutomationLane — draw parameter movement on the pattern timeline (v1.7).
 *
 * One collapsible strip under the piano roll. Pick a target (cutoff, reso,
 * osc A morph, delay/reverb mix, macros), then paint: left-drag sets points
 * on the 16th grid, right-drag erases. The scheduler interpolates between
 * points at play time and drives the ENGINE directly — the patch, presets and
 * undo history can restore lane clears / edits. Live sweeps still drive the
 * ENGINE directly during playback (patch knobs restore on stop). Lanes are
 * per-section and land in `.kcproj` saves.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useFireSequencerStore,
  getPlayheadStep,
  AUTO_PARAMS,
  autoValueAt,
  autoDenorm,
  STEPS_PER_BAR,
  type AutoParamDef,
  type AutoParamId,
} from "@/state/fireSequencerStore";
import { pushFireHistory } from "@/lib/fireHistory";
import { useUIStore } from "@/state/uiStore";
import { useRollFit, subscribeRollHScroll, setRollHScroll } from "./useRollFit";

const DEFAULT_LANE_H = 92;
const MIN_LANE_H = 56;
const MAX_LANE_H = 180;
const LS_LANE_H = "killchain.fire.autoLaneH";
const LS_RECENT = "killchain.fire.autoRecent";
const LS_FAVS = "killchain.fire.autoFavorites";
const CLIP_KEY = "killchain.fire.autoClip";

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

let laneClipboard: { param: AutoParamId; points: (number | null)[] } | null = null;

function readLaneH(): number {
  if (typeof window === "undefined") return DEFAULT_LANE_H;
  try {
    const v = Number(window.localStorage.getItem(LS_LANE_H));
    if (Number.isFinite(v)) return clamp(Math.round(v), MIN_LANE_H, MAX_LANE_H);
  } catch { /* ignore */ }
  return DEFAULT_LANE_H;
}

function readIdList(key: string): AutoParamId[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = JSON.parse(window.localStorage.getItem(key) ?? "[]");
    if (!Array.isArray(raw)) return [];
    const ids = new Set(AUTO_PARAMS.map((d) => d.id));
    return raw.filter((x): x is AutoParamId => typeof x === "string" && ids.has(x as AutoParamId));
  } catch {
    return [];
  }
}

function writeIdList(key: string, ids: AutoParamId[]) {
  try { window.localStorage.setItem(key, JSON.stringify(ids)); } catch { /* ignore */ }
}

function laneGroup(def: AutoParamDef): string {
  switch (def.patchKey) {
    case "filterCutoff":
    case "filterResonance":
      return "FILTER";
    case "oscAPos":
      return "OSC";
    case "delayMix":
    case "reverbMix":
      return "FX";
    default:
      return "MACRO";
  }
}

function laneSub(def: AutoParamDef): string {
  switch (def.id) {
    case "cutoff": return "CUTOFF";
    case "resonance": return "RESO";
    case "wtA": return "MORPH A";
    case "delayMix": return "DELAY";
    case "reverbMix": return "REVERB";
    case "macro1": return "1";
    case "macro2": return "2";
    case "macro3": return "3";
    case "macro4": return "4";
    default:
      return def.label.toUpperCase();
  }
}

function laneTitle(def: AutoParamDef): string {
  return `${laneGroup(def)} / ${laneSub(def)}`;
}

function fmtValue(paramId: AutoParamId, n: number): string {
  const def = AUTO_PARAMS.find((d) => d.id === paramId)!;
  const v = autoDenorm(def, n);
  if (def.patchKey === "filterCutoff") {
    return v >= 1000 ? `${(v / 1000).toFixed(1)} kHz` : `${Math.round(v)} Hz`;
  }
  if (def.patchKey === "filterResonance") return `Q ${v.toFixed(1)}`;
  return `${Math.round(v * 100)}%`;
}

function replaceAutomationLane(param: AutoParamId, arr: (number | null)[]) {
  const st = useFireSequencerStore.getState();
  pushFireHistory(`auto:${param}`);
  const automation = { ...st.automation };
  if (arr.every((v) => v == null)) delete automation[param];
  else automation[param] = arr;
  useFireSequencerStore.setState({ automation });
  st.setSelectionRange(st.selectionStart, st.selectionEnd);
}

function smoothLane(arr: (number | null)[], total: number): (number | null)[] {
  const out = arr.map((v) => v);
  for (let i = 0; i < total; i++) {
    if (arr[i] == null) continue;
    let sum = 0;
    let n = 0;
    for (const j of [i - 1, i, i + 1]) {
      if (j >= 0 && j < total && arr[j] != null) {
        sum += arr[j] as number;
        n++;
      }
    }
    if (n > 0) out[i] = sum / n;
  }
  return out;
}

function invertLane(arr: (number | null)[]): (number | null)[] {
  return arr.map((v) => (v == null ? null : 1 - v));
}

function readClipboard(): { param: AutoParamId; points: (number | null)[] } | null {
  if (laneClipboard) return laneClipboard;
  try {
    const raw = sessionStorage.getItem(CLIP_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { param?: AutoParamId; points?: (number | null)[] };
    if (!parsed?.param || !Array.isArray(parsed.points)) return null;
    return { param: parsed.param, points: parsed.points };
  } catch {
    return null;
  }
}

function writeClipboard(data: { param: AutoParamId; points: (number | null)[] }) {
  laneClipboard = data;
  try { sessionStorage.setItem(CLIP_KEY, JSON.stringify(data)); } catch { /* ignore */ }
}

function ParamChip({
  d,
  active,
  hasData,
  fav,
  onPick,
  onToggleFav,
}: {
  d: AutoParamDef;
  active: boolean;
  hasData: boolean;
  fav: boolean;
  onPick: () => void;
  onToggleFav: (e: React.MouseEvent) => void;
}) {
  return (
    <span className="inline-flex items-center">
      <button
        type="button"
        onClick={onPick}
        className={`px-2 py-0.5 rounded-md text-[10px] font-semibold border transition ${
          active
            ? "border-white/25 bg-white/[0.08]"
            : "border-white/8 bg-white/[0.02] text-white/45 hover:bg-white/[0.06]"
        }`}
        style={active ? { color: d.color } : undefined}
        title={`Automate ${d.label} (Synth A)`}
      >
        {hasData && (
          <span
            className="inline-block w-1.5 h-1.5 rounded-full mr-1 align-middle"
            style={{ background: d.color }}
          />
        )}
        {d.label}
      </button>
      <button
        type="button"
        onClick={onToggleFav}
        className={`ml-0.5 px-0.5 text-[10px] transition ${
          fav ? "text-amber-300" : "text-white/20 hover:text-white/50"
        }`}
        title={fav ? "Remove from favorites" : "Add to favorites"}
        aria-label={fav ? "Unfavorite" : "Favorite"}
      >
        {fav ? "★" : "☆"}
      </button>
    </span>
  );
}

export function AutomationLane() {
  const automation = useFireSequencerStore((s) => s.automation);
  const bars = useFireSequencerStore((s) => s.bars);
  const playing = useFireSequencerStore((s) => s.playing);
  const bpm = useFireSequencerStore((s) => s.bpm);
  const selectedClipId = useFireSequencerStore((s) => s.selectedClipId);
  const arrangement = useFireSequencerStore((s) => s.arrangement);
  const setPoint = useFireSequencerStore((s) => s.setAutomationPoint);
  const clearLane = useFireSequencerStore((s) => s.clearAutomationLane);
  const toast = useUIStore((s) => s.toast);

  const lanesWithData = AUTO_PARAMS.filter((d) => automation[d.id]).length;
  const [open, setOpen] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      if (window.localStorage.getItem("killchain.fire.autoOpen") === "1") return true;
    } catch { /* ignore */ }
    return false;
  });
  const [param, setParam] = useState<AutoParamId>("cutoff");
  const [hover, setHover] = useState<string | null>(null);
  const [laneH, setLaneH] = useState(readLaneH);
  const [search, setSearch] = useState("");
  const [recent, setRecent] = useState<AutoParamId[]>(() => readIdList(LS_RECENT));
  const [favorites, setFavorites] = useState<AutoParamId[]>(() => readIdList(LS_FAVS));

  const selectedClip = selectedClipId
    ? arrangement.find((c) => c.id === selectedClipId) ?? null
    : null;
  const isClipOverride = selectedClip?.unique === true;

  const touchParam = useCallback((id: AutoParamId) => {
    setParam(id);
    setRecent((prev) => {
      const next = [id, ...prev.filter((x) => x !== id)].slice(0, 5);
      writeIdList(LS_RECENT, next);
      return next;
    });
  }, []);

  const toggleFav = useCallback((id: AutoParamId) => {
    setFavorites((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      writeIdList(LS_FAVS, next);
      return next;
    });
  }, []);

  const searchLower = search.trim().toLowerCase();
  const filteredParams = useMemo(
    () => (searchLower
      ? AUTO_PARAMS.filter((d) => d.label.toLowerCase().includes(searchLower))
      : AUTO_PARAMS),
    [searchLower],
  );
  const recentDefs = useMemo(
    () => recent.map((id) => AUTO_PARAMS.find((d) => d.id === id)).filter(Boolean) as AutoParamDef[],
    [recent],
  );
  const favDefs = useMemo(
    () => favorites.map((id) => AUTO_PARAMS.find((d) => d.id === id)).filter(Boolean) as AutoParamDef[],
    [favorites],
  );

  // Open when any lane has data, or once on first Sequencer visit.
  useEffect(() => {
    if (lanesWithData > 0) {
      setOpen(true);
      return;
    }
    try {
      if (window.localStorage.getItem("killchain.fire.autoOpen") !== "1") {
        setOpen(true);
        window.localStorage.setItem("killchain.fire.autoOpen", "1");
      }
    } catch { /* ignore */ }
  }, [lanesWithData]);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const strokeRef = useRef<{ step: number; val: number; erase: boolean } | null>(null);

  const { cellW: stepW, gridW, gutter, fitMode } = useRollFit();
  const totalSteps = bars * STEPS_PER_BAR;
  const def = AUTO_PARAMS.find((d) => d.id === param)!;

  const cutoffPreview = automation.cutoff ?? null;

  useEffect(() => {
    if (!open) return;
    return subscribeRollHScroll((left) => {
      const el = scrollRef.current;
      if (el && Math.abs(el.scrollLeft - left) > 0.5) el.scrollLeft = left;
    });
  }, [open]);

  const doSmooth = () => {
    const arr = automation[param];
    if (!arr) return;
    replaceAutomationLane(param, smoothLane(arr, totalSteps));
    toast(`${def.label} smoothed`);
  };

  const doInvert = () => {
    const arr = automation[param];
    if (!arr) return;
    replaceAutomationLane(param, invertLane(arr));
    toast(`${def.label} inverted`);
  };

  const doCopy = () => {
    const arr = automation[param];
    if (!arr) {
      toast("Nothing to copy — lane is empty");
      return;
    }
    writeClipboard({ param, points: [...arr] });
    toast(`${def.label} lane copied`);
  };

  const doPaste = () => {
    const clip = readClipboard();
    if (!clip) {
      toast("Clipboard empty — copy a lane first");
      return;
    }
    const src = clip.points;
    const arr = new Array<number | null>(totalSteps).fill(null);
    for (let i = 0; i < totalSteps; i++) {
      arr[i] = i < src.length ? src[i] ?? null : null;
    }
    replaceAutomationLane(param, arr);
    toast(`Pasted ${AUTO_PARAMS.find((d) => d.id === clip.param)?.label ?? "lane"} → ${def.label}`);
  };

  // ── draw ──
  useEffect(() => {
    if (!open) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = gridW * dpr;
    canvas.height = laneH * dpr;
    canvas.style.width = `${gridW}px`;
    canvas.style.height = `${laneH}px`;
    const g = canvas.getContext("2d");
    if (!g) return;
    g.scale(dpr, dpr);
    g.clearRect(0, 0, gridW, laneH);

    g.fillStyle = "rgba(10,12,18,1)";
    g.fillRect(0, 0, gridW, laneH);
    g.fillStyle = "rgba(8,6,10,0.96)";
    g.fillRect(0, 0, gutter, laneH);
    g.fillStyle = "rgba(255,120,60,0.45)";
    g.fillRect(gutter - 2, 0, 2, laneH);

    for (let i = 0; i <= totalSteps; i++) {
      const x = gutter + i * stepW;
      const isBar = i % STEPS_PER_BAR === 0;
      const isBeat = i % 4 === 0;
      g.strokeStyle = isBar
        ? "rgba(255,150,80,0.28)"
        : isBeat
          ? "rgba(255,255,255,0.10)"
          : "rgba(255,255,255,0.04)";
      g.beginPath();
      g.moveTo(x + 0.5, 0);
      g.lineTo(x + 0.5, laneH);
      g.stroke();
    }
    g.strokeStyle = "rgba(255,255,255,0.06)";
    g.beginPath();
    g.moveTo(gutter, laneH / 2 + 0.5);
    g.lineTo(gridW, laneH / 2 + 0.5);
    g.stroke();

    const arr = automation[param];
    if (!arr || arr.length === 0) {
      g.fillStyle = "rgba(255,255,255,0.22)";
      g.font = "11px ui-sans-serif, system-ui, sans-serif";
      g.fillText(`Draw ${def.label} — left-drag paints, right-drag erases`, gutter + 10, laneH / 2 + 4);
      return;
    }

    const yOf = (n: number) => (1 - clamp(n, 0, 1)) * (laneH - 8) + 4;

    g.beginPath();
    let started = false;
    const SUB = 4;
    for (let i = 0; i <= totalSteps * SUB; i++) {
      const pos = i / SUB;
      const n = autoValueAt(arr, Math.min(pos, totalSteps - 0.001));
      if (n == null) continue;
      const x = gutter + pos * stepW;
      const y = yOf(n);
      if (!started) { g.moveTo(x, y); started = true; }
      else g.lineTo(x, y);
    }
    if (started) {
      g.strokeStyle = def.color;
      g.lineWidth = 1.8;
      g.stroke();
      g.lineTo(gridW, laneH);
      g.lineTo(gutter, laneH);
      g.closePath();
      g.fillStyle = `${def.color}22`;
      g.fill();
    }

    for (let i = 0; i < arr.length; i++) {
      const n = arr[i];
      if (n == null) continue;
      g.beginPath();
      g.arc(gutter + i * stepW + stepW / 2, yOf(n), 3.2, 0, Math.PI * 2);
      g.fillStyle = def.color;
      g.fill();
      g.strokeStyle = "rgba(0,0,0,0.5)";
      g.lineWidth = 1;
      g.stroke();
    }
  }, [open, automation, param, gridW, totalSteps, stepW, gutter, def, laneH]);

  // ── playhead (RAF, DOM transform — same pattern as the drum grid) ──
  useEffect(() => {
    const el = playheadRef.current;
    if (!el || !open) return;
    if (!playing) { el.style.opacity = "0"; return; }
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (document.hidden) return;
      const step = getPlayheadStep(bpm, bars);
      el.style.opacity = step < 0 ? "0" : "1";
      el.style.transform = `translateX(${gutter + Math.max(0, step) * stepW}px)`;
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [open, playing, bpm, bars, stepW, gutter]);

  // ── paint ──
  const paintAt = (e: React.PointerEvent, erase: boolean) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left;
    if (x < gutter) return;
    const step = clamp(Math.floor((x - gutter) / stepW), 0, totalSteps - 1);
    const val = clamp(1 - (e.clientY - rect.top - 4) / (laneH - 8), 0, 1);
    const prev = strokeRef.current;
    if (prev && prev.erase === erase && Math.abs(step - prev.step) > 1) {
      const dir = step > prev.step ? 1 : -1;
      for (let i = prev.step + dir; i !== step; i += dir) {
        const t = (i - prev.step) / (step - prev.step);
        setPoint(param, i, erase ? null : prev.val + (val - prev.val) * t);
      }
    }
    setPoint(param, step, erase ? null : val);
    strokeRef.current = { step, val, erase };
    setHover(erase ? "erasing" : fmtValue(param, val));
  };

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    paintAt(e, e.button === 2);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!strokeRef.current) {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (rect) {
        const val = clamp(1 - (e.clientY - rect.top - 4) / (laneH - 8), 0, 1);
        setHover(fmtValue(param, val));
      }
      return;
    }
    paintAt(e, strokeRef.current.erase);
  };
  const onPointerUp = () => { strokeRef.current = null; };

  const onResizePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = laneH;
    const onMove = (ev: PointerEvent) => {
      const next = clamp(startH + (ev.clientY - startY), MIN_LANE_H, MAX_LANE_H);
      setLaneH(next);
      try { window.localStorage.setItem(LS_LANE_H, String(next)); } catch { /* ignore */ }
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const renderParamSection = (label: string, defs: AutoParamDef[]) => {
    if (defs.length === 0) return null;
    return (
      <div key={label} className="flex flex-wrap items-center gap-1">
        <span className="text-[8px] uppercase tracking-[0.16em] text-white/30 mr-0.5">{label}</span>
        {defs.map((d) => (
          <ParamChip
            key={`${label}-${d.id}`}
            d={d}
            active={param === d.id}
            hasData={!!automation[d.id]}
            fav={favorites.includes(d.id)}
            onPick={() => touchParam(d.id)}
            onToggleFav={(ev) => { ev.stopPropagation(); toggleFav(d.id); }}
          />
        ))}
      </div>
    );
  };

  return (
    <div className="mt-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          onClick={() => setOpen(!open)}
          className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.25em] text-dim hover:text-white/70 transition"
          title="Automation: draw knob movement on the timeline — cutoff sweeps, morphs, FX sends. Per-section, plays back on Synth A. Live engine only — restores to the patch on stop."
        >
          <span>{open ? "▾" : "▸"} Automation</span>
          {lanesWithData > 0 && (
            <span className="text-[9px] font-mono normal-case tracking-normal px-1.5 py-0.5 rounded border border-white/12 text-white/50">
              {lanesWithData} lane{lanesWithData === 1 ? "" : "s"}
            </span>
          )}
        </button>
        {!open && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="flex items-center gap-2 min-w-0 flex-1 text-left"
            title="Open automation — draw cutoff motion"
          >
            <span className="text-[10px] text-white/40 normal-case tracking-normal shrink-0">
              {cutoffPreview ? "Cutoff motion" : "draw motion"}
            </span>
            <svg
              width="120"
              height="14"
              viewBox="0 0 120 14"
              className="opacity-80"
              aria-hidden
            >
              <path
                d={cutoffSparkPath(cutoffPreview, totalSteps)}
                fill="none"
                stroke="rgba(255,140,60,0.85)"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        )}
        {open && (
          <>
            <div className="w-px h-4 bg-white/10 mx-0.5" />
            <span
              className="text-[9px] font-black uppercase tracking-[0.2em] px-1.5 py-0.5 rounded border"
              style={
                isClipOverride
                  ? { color: "#7ce8d5", borderColor: "rgba(124,232,213,0.35)", background: "rgba(124,232,213,0.08)" }
                  : { color: "#ffb648", borderColor: "rgba(255,182,72,0.35)", background: "rgba(255,182,72,0.08)" }
              }
              title={
                isClipOverride
                  ? "Automation edits this unique clip's local override"
                  : "Automation edits the shared pattern section"
              }
            >
              {isClipOverride ? "CLIP OVERRIDE" : "PATTERN AUTOMATION"}
            </span>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search destination…"
              className="h-7 min-w-[8rem] max-w-[10rem] rounded-md border border-white/10 bg-black/40 px-2 text-[10px] text-white/75 outline-none placeholder:text-white/30"
              aria-label="Search automation destinations"
            />
            {searchLower ? (
              renderParamSection("Match", filteredParams)
            ) : (
              <>
                {renderParamSection("Recent", recentDefs)}
                {renderParamSection("Favs", favDefs)}
                <div className="flex flex-wrap items-center gap-1">
                  {AUTO_PARAMS.map((d) => (
                    <ParamChip
                      key={d.id}
                      d={d}
                      active={param === d.id}
                      hasData={!!automation[d.id]}
                      fav={favorites.includes(d.id)}
                      onPick={() => touchParam(d.id)}
                      onToggleFav={(ev) => { ev.stopPropagation(); toggleFav(d.id); }}
                    />
                  ))}
                </div>
              </>
            )}
            <span className="flex-1" />
            <span className="text-[9px] text-white/30 normal-case tracking-normal" title="Automation drives the live engine; the patch restores on stop">
              live → restores on stop
            </span>
            {hover && <span className="text-[10px] font-mono text-white/45">{hover}</span>}
            <div className="inline-flex items-center gap-0.5 rounded-md border border-white/8 bg-black/25 p-0.5">
              {([
                ["Smooth", doSmooth, "Average each point with neighbors"],
                ["Invert", doInvert, "Flip values (1 − v)"],
                ["Copy", doCopy, "Copy lane to clipboard"],
                ["Paste", doPaste, "Paste clipboard into this lane"],
              ] as const).map(([label, fn, tip]) => (
                <button
                  key={label}
                  type="button"
                  onClick={fn}
                  className="px-2 py-0.5 rounded text-[9px] font-semibold text-white/45 hover:text-white/75 hover:bg-white/[0.06] transition"
                  title={tip}
                >
                  {label}
                </button>
              ))}
              {automation[param] && (
                <button
                  onClick={() => {
                    clearLane(param);
                    toast(`${def.label} lane cleared (Ctrl+Z restores)`);
                  }}
                  className="px-2 py-0.5 rounded text-[9px] font-semibold text-white/40 hover:text-rose-300 transition"
                  title="Clear this lane in the active section"
                >
                  Clear
                </button>
              )}
            </div>
          </>
        )}
      </div>

      {open && (
        <div
          ref={scrollRef}
          onScroll={(e) => setRollHScroll(e.currentTarget.scrollLeft)}
          className="mt-1.5 rounded-xl border border-white/12 bg-[#0a0c12] editor-scroll overflow-x-auto"
        >
          <div
            className="flex items-center gap-2 px-2.5 py-1 border-b border-white/[0.06] bg-black/30"
            style={{ paddingLeft: gutter }}
          >
            <span
              className="text-[10px] font-black uppercase tracking-[0.22em]"
              style={{ color: def.color }}
            >
              {laneTitle(def)}
            </span>
          </div>
          <div className="relative" style={{ width: gridW, height: laneH, minWidth: "100%" }}>
            <canvas
              ref={canvasRef}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onPointerLeave={() => { if (!strokeRef.current) setHover(null); }}
              onContextMenu={(e) => e.preventDefault()}
              className="block touch-none select-none cursor-crosshair"
              aria-label={`Automation lane for ${def.label} — drag to draw, right-drag to erase`}
            />
            <div
              ref={playheadRef}
              className="absolute top-0 bottom-0 w-px pointer-events-none opacity-0"
              style={{
                background: "linear-gradient(180deg, rgba(255,220,150,0.9), rgba(255,110,50,0.65))",
                boxShadow: "0 0 8px rgba(255,140,60,0.8)",
                willChange: "transform",
              }}
            />
          </div>
          <div
            className="h-1.5 cursor-ns-resize hover:bg-white/15 transition-colors"
            onPointerDown={onResizePointerDown}
            title="Drag to resize automation lane height"
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize automation lane"
          />
        </div>
      )}
    </div>
  );
}

function cutoffSparkPath(arr: (number | null)[] | null | undefined, totalSteps: number): string {
  const w = 120;
  const h = 14;
  if (!arr || arr.length === 0) {
    return `M 2 ${h * 0.65} Q ${w * 0.35} ${h * 0.2}, ${w * 0.55} ${h * 0.55} T ${w - 2} ${h * 0.4}`;
  }
  const pts: string[] = [];
  const n = Math.max(totalSteps, arr.length);
  for (let i = 0; i < n; i++) {
    const v = autoValueAt(arr, i);
    const y = v == null ? h * 0.5 : (1 - clamp(v, 0, 1)) * (h - 4) + 2;
    const x = (i / Math.max(1, n - 1)) * (w - 4) + 2;
    pts.push(`${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`);
  }
  return pts.join(" ");
}
