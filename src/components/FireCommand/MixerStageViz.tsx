/**
 * Mixer — Sum Deck stage visualizer.
 * Five bus strips + master (Signal Path Mix · FC.mixer).
 * Drag slot: Level ↕ / Pan ↔ (parts). Double-click: reset level.
 * Click label zone: toggle mute. Shift+click: solo.
 */

import { useCallback, useEffect, useRef, type MutableRefObject, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import {
  useFireSequencerStore,
  MIXER_PARTS,
  type MixerStripId,
} from "@/state/fireSequencerStore";
import { FC, FC_BAND, bandShade } from "./fireColors";
import { startStageVizLoop } from "./stageVizRaf";

const H = 168;
const C = FC.mixer;
const C_DEEP = bandShade(FC_BAND.mix, 0.22);
const C_MID = bandShade(FC_BAND.mix, 0.45);
const C_HOT = bandShade(FC_BAND.mix, 0.62);
const C_GLOW = bandShade(FC_BAND.mix, 0.92);

const STRIP_COLORS: Record<MixerStripId, string> = {
  a: bandShade(FC_BAND.mix, 0.38),
  b: bandShade(FC_BAND.mix, 0.5),
  drums: bandShade(FC_BAND.mix, 0.62),
  samples: bandShade(FC_BAND.mix, 0.74),
  master: bandShade(FC_BAND.mix, 0.9),
};

const STRIP_SHORT: Record<MixerStripId, string> = {
  a: "A",
  b: "B",
  drums: "DRM",
  samples: "SMP",
  master: "MST",
};

const IDS: MixerStripId[] = [...MIXER_PARTS, "master"];

function hexAlpha(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((ch) => ch + ch).join("") : h;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, a))})`;
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function useHiDpi(
  wrapRef: RefObject<HTMLDivElement | null>,
  canvasRef: RefObject<HTMLCanvasElement | null>,
  cssH: number,
  sizeRef: MutableRefObject<{ w: number; h: number }>,
) {
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const sync = () => {
      const dpr = Math.min(2.5, window.devicePixelRatio || 1);
      const cssW = Math.max(1, Math.floor(wrap.clientWidth) || 1);
      sizeRef.current = { w: cssW, h: cssH };
      canvas.width = Math.floor(cssW * dpr);
      canvas.height = Math.floor(cssH * dpr);
      canvas.style.width = "100%";
      canvas.style.height = `${cssH}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [wrapRef, canvasRef, cssH, sizeRef]);
}

type Props = {
  liveRef: MutableRefObject<Record<MixerStripId, number>>;
};

export function MixerStageViz({ liveRef }: Props) {
  const mixer = useFireSequencerStore((s) => s.mixer);
  const setMixerStrip = useFireSequencerStore((s) => s.setMixerStrip);
  const fireLimiterOn = useFireSequencerStore((s) => s.fireLimiterOn);
  const duckEnabled = useFireSequencerStore((s) => s.duckEnabled);
  const duckAmount = useFireSequencerStore((s) => s.duckAmount);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ w: 480, h: H });
  const flashRef = useRef(0);
  const dragId = useRef<MixerStripId | null>(null);
  const prevKey = useRef("");
  const st = useRef({ mixer, fireLimiterOn, duckEnabled, duckAmount });
  st.current = { mixer, fireLimiterOn, duckEnabled, duckAmount };

  const anyLive =
    MIXER_PARTS.some((id) => !mixer[id].mute && mixer[id].level > 0.02) ||
    (!mixer.master.mute && mixer.master.level > 0.02);

  useEffect(() => {
    const key = IDS.map((id) => {
      const s = mixer[id];
      return `${s.level.toFixed(2)}|${s.pan.toFixed(2)}|${s.mute}|${s.solo}`;
    }).join(";") + `|${fireLimiterOn}|${duckEnabled}|${duckAmount.toFixed(2)}`;
    if (key !== prevKey.current) {
      prevKey.current = key;
      flashRef.current = 1;
    }
  }, [mixer, fireLimiterOn, duckEnabled, duckAmount]);

  useHiDpi(wrapRef, canvasRef, H, sizeRef);

  const slotAt = useCallback((clientX: number) => {
    const wrap = wrapRef.current;
    if (!wrap) return null;
    const rect = wrap.getBoundingClientRect();
    const x = clientX - rect.left;
    const padX = 10;
    const gap = 8;
    const slotW = (rect.width - padX * 2 - gap * (IDS.length - 1)) / IDS.length;
    const i = Math.floor((x - padX) / (slotW + gap));
    if (i < 0 || i >= IDS.length) return null;
    return { id: IDS[i]!, i, slotW, padX, gap, rect };
  }, []);

  const applyDrag = useCallback(
    (clientX: number, clientY: number) => {
      const id = dragId.current;
      if (!id) return;
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const slot = slotAt(clientX);
      const y = clamp((clientY - rect.top - 18) / Math.max(1, rect.height - 40), 0, 1);
      const level = Math.round((1 - y) * 1.5 * 50) / 50;
      setMixerStrip(id, { level: clamp(level, 0, 1.5) });
      if (id !== "master" && slot) {
        const localX = (clientX - rect.left - slot.padX - slot.i * (slot.slotW + slot.gap)) / slot.slotW;
        const pan = clamp(localX * 2 - 1, -1, 1);
        setMixerStrip(id, { pan: Math.round(pan * 20) / 20 });
      }
    },
    [setMixerStrip, slotAt],
  );

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const slot = slotAt(e.clientX);
      if (!slot) return;
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const yRel = (e.clientY - rect.top) / rect.height;

      // Top label zone → mute
      if (yRel < 0.14) {
        const cur = useFireSequencerStore.getState().mixer[slot.id];
        setMixerStrip(slot.id, { mute: !cur.mute });
        return;
      }
      // Shift+click → solo (parts only)
      if (e.shiftKey && slot.id !== "master") {
        const cur = useFireSequencerStore.getState().mixer[slot.id];
        setMixerStrip(slot.id, { solo: !cur.solo });
        return;
      }

      dragId.current = slot.id;
      wrap.setPointerCapture(e.pointerId);
      applyDrag(e.clientX, e.clientY);
    },
    [slotAt, setMixerStrip, applyDrag],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!dragId.current) return;
      applyDrag(e.clientX, e.clientY);
    },
    [applyDrag],
  );

  const onPointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragId.current) return;
    dragId.current = null;
    try {
      wrapRef.current?.releasePointerCapture(e.pointerId);
    } catch { /* */ }
  }, []);

  const onDoubleClick = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const slot = slotAt(e.clientX);
      if (!slot) return;
      setMixerStrip(slot.id, { level: 1, pan: 0, mute: false });
    },
    [slotAt, setMixerStrip],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
        const smooth = new Map<MixerStripId, number>(IDS.map((id) => [id, 0]));
    const peakHold = new Map<MixerStripId, number>(IDS.map((id) => [id, 0]));

    const stopLoop = startStageVizLoop(
      (now) => {
      const { w: W, h: Hh } = sizeRef.current;
      const p = st.current;
      flashRef.current *= 0.88;
      const liv = liveRef.current;

      ctx.clearRect(0, 0, W, Hh);

      // Tangerine console plate
      const bg = ctx.createLinearGradient(0, 0, 0, Hh);
      bg.addColorStop(0, hexAlpha(C_HOT, 0.1 + flashRef.current * 0.15));
      bg.addColorStop(0.45, hexAlpha(C_DEEP, 0.85));
      bg.addColorStop(1, "rgba(8,4,2,0.98)");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, Hh);

      // Duck pulse wash over A/B
      if (p.duckEnabled) {
        const pulse = 0.5 + 0.5 * Math.sin(now / (180 - p.duckAmount * 80));
        const wash = ctx.createLinearGradient(0, 0, W * 0.4, 0);
        wash.addColorStop(0, hexAlpha(C_HOT, (0.08 + p.duckAmount * 0.18) * pulse));
        wash.addColorStop(1, hexAlpha(C_HOT, 0));
        ctx.fillStyle = wash;
        ctx.fillRect(0, 0, W * 0.42, Hh);
      }

      const padX = 10;
      const gap = 8;
      const slotW = (W - padX * 2 - gap * (IDS.length - 1)) / IDS.length;
      const meterTop = 22;
      const meterBot = Hh - 22;
      const meterH = meterBot - meterTop;
      const segs = 18;

      IDS.forEach((id, i) => {
        const strip = p.mixer[id];
        const col = STRIP_COLORS[id];
        const fader = Math.max(0, Math.min(1.2, strip.mute ? 0 : strip.level)) / 1.2;
        const signal = Math.max(0, Math.min(1, liv[id] ?? 0));
        const target = Math.max(fader * 0.35, signal * (strip.mute ? 0 : 1));
        const prev = smooth.get(id) ?? 0;
        const v = prev + (target - prev) * 0.3;
        smooth.set(id, v);
        const held = Math.max(v, (peakHold.get(id) ?? 0) * 0.972);
        peakHold.set(id, held);

        const x = padX + i * (slotW + gap);
        const isMaster = id === "master";

        // Slot plate
        ctx.fillStyle = isMaster ? hexAlpha(C_GLOW, 0.08) : hexAlpha(col, 0.06);
        ctx.fillRect(x, meterTop - 6, slotW, meterH + 12);
        ctx.strokeStyle = strip.solo
          ? hexAlpha(C_GLOW, 0.75)
          : strip.mute
            ? "rgba(255,255,255,0.08)"
            : hexAlpha(col, 0.35 + flashRef.current * 0.25);
        ctx.lineWidth = strip.solo ? 2 : 1;
        ctx.strokeRect(x + 0.5, meterTop - 5.5, slotW - 1, meterH + 11);

        // Live bloom
        if (v > 0.04 && !strip.mute) {
          const bloom = ctx.createRadialGradient(
            x + slotW / 2,
            meterBot - v * meterH,
            0,
            x + slotW / 2,
            meterBot,
            slotW * 0.75,
          );
          bloom.addColorStop(0, hexAlpha(col, 0.28));
          bloom.addColorStop(1, hexAlpha(col, 0));
          ctx.fillStyle = bloom;
          ctx.fillRect(x, meterTop, slotW, meterH);
        }

        // Pan indicator (parts)
        if (!isMaster) {
          const panX = x + slotW * 0.5 + strip.pan * (slotW * 0.38);
          ctx.fillStyle = hexAlpha(col, 0.5 + Math.abs(strip.pan) * 0.4);
          ctx.beginPath();
          ctx.arc(panX, meterTop - 1, 2.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = hexAlpha(col, 0.25);
          ctx.beginPath();
          ctx.moveTo(x + 4, meterTop - 1);
          ctx.lineTo(x + slotW - 4, meterTop - 1);
          ctx.stroke();
        }

        // Segmented LED meter
        const barW = Math.min(20, slotW * 0.36);
        const barX = x + (slotW - barW) / 2;
        for (let s = 0; s < segs; s++) {
          const thresh = (s + 1) / segs;
          const y = meterBot - (s + 1) * (meterH / segs) + 1;
          const segH = meterH / segs - 2;
          const on = v >= thresh - 0.02 && !strip.mute;
          let segCol = col;
          if (thresh > 0.85) segCol = "#ff5d5d";
          else if (thresh > 0.7) segCol = bandShade(FC_BAND.mix, 0.85);
          ctx.fillStyle = on ? segCol : "rgba(255,255,255,0.05)";
          if (on) {
            ctx.shadowBlur = 5;
            ctx.shadowColor = segCol;
          }
          ctx.fillRect(barX, y, barW, segH);
          ctx.shadowBlur = 0;
        }

        // Peak tick
        if (held > 0.02 && !strip.mute) {
          const py = meterBot - held * meterH;
          ctx.fillStyle = "rgba(255,255,255,0.9)";
          ctx.fillRect(barX - 2, py - 1, barW + 4, 2);
        }

        // Fader ghost
        const fy = meterBot - fader * meterH;
        ctx.strokeStyle = hexAlpha(col, strip.mute ? 0.2 : 0.55);
        ctx.setLineDash([2, 3]);
        ctx.beginPath();
        ctx.moveTo(barX - 3, fy);
        ctx.lineTo(barX + barW + 3, fy);
        ctx.stroke();
        ctx.setLineDash([]);

        // Mute veil
        if (strip.mute) {
          ctx.fillStyle = "rgba(0,0,0,0.45)";
          ctx.fillRect(x, meterTop - 6, slotW, meterH + 12);
          ctx.font = "800 9px ui-sans-serif, system-ui, sans-serif";
          ctx.fillStyle = "rgba(255,120,120,0.7)";
          ctx.textAlign = "center";
          ctx.fillText("M", x + slotW / 2, meterTop + meterH * 0.5);
        }

        // Label
        ctx.fillStyle = strip.mute ? "rgba(255,255,255,0.25)" : hexAlpha(col, 0.95);
        ctx.font = "800 9px ui-sans-serif, system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(STRIP_SHORT[id], x + slotW / 2, Hh - 6);

        // Solo badge
        if (strip.solo) {
          ctx.fillStyle = hexAlpha(C_GLOW, 0.9);
          ctx.font = "700 7px ui-sans-serif, system-ui, sans-serif";
          ctx.fillText("SOLO", x + slotW / 2, meterTop + 8);
        }

        // Limiter badge on master
        if (isMaster && p.fireLimiterOn) {
          ctx.fillStyle = hexAlpha(C_GLOW, 0.85);
          ctx.font = "700 7px ui-sans-serif, system-ui, sans-serif";
          ctx.fillText("LIM", x + slotW / 2, meterTop + 8);
          ctx.strokeStyle = hexAlpha(C_GLOW, 0.4 + flashRef.current * 0.3);
          ctx.strokeRect(x + 2, meterTop - 4, slotW - 4, meterH + 8);
        }
      });

      ctx.font = "700 8px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.fillStyle = hexAlpha(C_GLOW, 0.75);
      ctx.fillText("MIX · SUM DECK", 12, 12);
      ctx.textAlign = "right";
      ctx.fillStyle = hexAlpha(p.duckEnabled ? C_HOT : C_MID, 0.7);
      const duckTag = p.duckEnabled ? `DUCK ${Math.round(p.duckAmount * 100)}` : "BUS";
      ctx.fillText(duckTag, W - 12, 12);
    
      },
      () => ({
        flash: flashRef.current,
        active: false,
        dragging: false,
        particles: 0,
        motionKey: JSON.stringify(st.current),
      }),
      { minIntervalMs: 20 },
    );
    return stopLoop;
  }, [liveRef]);

  return (
    <div
      ref={wrapRef}
      className="relative mb-3 overflow-hidden rounded-2xl border-2 select-none"
      style={{
        borderColor: hexAlpha(C, anyLive ? 0.5 : 0.28),
        height: H,
        cursor: "ns-resize",
        boxShadow: `inset 0 1px 0 rgba(255,255,255,0.06), 0 0 40px ${hexAlpha(C, anyLive ? 0.22 : 0.08)}, 0 10px 28px rgba(0,0,0,0.4)`,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      title="Drag: Level ↕ / Pan ↔ · Top click: Mute · Shift+click: Solo · Double-click: unity"
      role="img"
      aria-label="Mixer sum deck"
    >
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full pointer-events-none" aria-hidden />
      <div
        className="pointer-events-none absolute left-3 top-1 text-[8px] font-black uppercase tracking-[0.28em]"
        style={{ color: hexAlpha(C_GLOW, 0.7) }}
      >
        Sum Deck
      </div>
    </div>
  );
}
