/**
 * ModPatchGrid — green signal bay.
 *
 * Sources are rows, destinations are columns. Click an empty cell to allocate
 * one of the 12 matrix slots; drag vertically for bipolar amount; right-click
 * clears. Display-only chrome on top: animated cable flow of active routes.
 */

import { useEffect, useRef, useState } from "react";
import { useFireCommandStore } from "@/state/fireCommandStore";
import type { ModSource, ModDest } from "@/audio/dsp/FireCommandSynth";

const GRN = "#7cf6b0";
const AMB = "#ffb35c";
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

const SOURCES: { id: ModSource; label: string; hint: string; tint: string }[] = [
  { id: "lfo1", label: "LFO 1", hint: "LFO 1", tint: "#62b6ff" },
  { id: "lfo2", label: "LFO 2", hint: "LFO 2", tint: "#62b6ff" },
  { id: "modenv", label: "M.Env", hint: "Mod envelope (per note)", tint: "#7cf6b0" },
  { id: "velocity", label: "Vel", hint: "Note velocity (per note)", tint: "#7cf6b0" },
  { id: "keytrack", label: "Key", hint: "Key tracking (per note)", tint: "#7cf6b0" },
  { id: "macro1", label: "M1", hint: "Macro 1", tint: "#ffb35c" },
  { id: "macro2", label: "M2", hint: "Macro 2", tint: "#ffb35c" },
  { id: "macro3", label: "M3", hint: "Macro 3", tint: "#ffb35c" },
  { id: "macro4", label: "M4", hint: "Macro 4", tint: "#ffb35c" },
  { id: "random", label: "Rnd", hint: "Random sample & hold", tint: "#c98bff" },
];

const DESTS: { id: ModDest; label: string; hint: string }[] = [
  { id: "pitch", label: "Pit", hint: "Pitch" },
  { id: "cutoff", label: "Cut", hint: "Filter cutoff" },
  { id: "resonance", label: "Res", hint: "Filter resonance" },
  { id: "wtA", label: "MoA", hint: "Osc A morph" },
  { id: "wtB", label: "MoB", hint: "Osc B morph" },
  { id: "wtC", label: "MoC", hint: "Osc C morph" },
  { id: "levelA", label: "LvA", hint: "Osc A level" },
  { id: "levelB", label: "LvB", hint: "Osc B level" },
  { id: "levelC", label: "LvC", hint: "Osc C level" },
  { id: "fm", label: "FM", hint: "FM amount" },
  { id: "pan", label: "Pan", hint: "Stereo pan" },
  { id: "volume", label: "Vol", hint: "Volume" },
  { id: "reverb", label: "Rev", hint: "Reverb send" },
  { id: "delay", label: "Dly", hint: "Delay send" },
];

/** Animated cable bay — patchbay personality with glowing trunks + dual packets. */
function SignalFlowViz() {
  const matrix = useFireCommandStore((s) => s.patch.modMatrix);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef(matrix);
  stateRef.current = matrix;

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    let last = 0;
    const size = { w: 400, h: 108 };

    const sync = () => {
      const dpr = Math.min(2.5, window.devicePixelRatio || 1);
      size.w = Math.max(1, Math.floor(wrap.clientWidth) || 1);
      size.h = 108;
      canvas.width = Math.floor(size.w * dpr);
      canvas.height = Math.floor(size.h * dpr);
      canvas.style.width = "100%";
      canvas.style.height = `${size.h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(wrap);

    const srcTint = (id: string) => SOURCES.find((s) => s.id === id)?.tint ?? GRN;
    const srcLabel = (id: string) => SOURCES.find((s) => s.id === id)?.label ?? id;
    const destLabel = (id: string) => DESTS.find((d) => d.id === id)?.label ?? id;

    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      if (document.hidden || t - last < 22) return;
      last = t;
      const mx = stateRef.current;
      const { w: W, h: H } = size;
      ctx.clearRect(0, 0, W, H);

      const bg = ctx.createRadialGradient(W * 0.5, H * 0.45, 8, W * 0.5, H * 0.5, W * 0.55);
      bg.addColorStop(0, "rgba(124,246,176,0.1)");
      bg.addColorStop(0.55, "rgba(4,14,10,0.7)");
      bg.addColorStop(1, "rgba(0,0,0,0.45)");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      ctx.fillStyle = "rgba(124,246,176,0.05)";
      for (let y = 16; y < H - 14; y += 10) {
        for (let x = 62; x < W - 62; x += 14) {
          ctx.beginPath();
          ctx.arc(x + ((y / 10) % 2) * 4, y, 1.1, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      const routes = mx.filter((r) => r.source !== "none" && r.dest !== "none");
      const leftX = 78;
      const rightX = W - 78;
      const midY = H / 2;

      const railGrad = ctx.createLinearGradient(0, 12, 0, H - 12);
      railGrad.addColorStop(0, "rgba(124,246,176,0.18)");
      railGrad.addColorStop(0.5, "rgba(124,246,176,0.08)");
      railGrad.addColorStop(1, "rgba(124,246,176,0.18)");
      ctx.fillStyle = railGrad;
      ctx.fillRect(14, 10, 48, H - 20);
      ctx.fillRect(W - 62, 10, 48, H - 20);
      ctx.strokeStyle = "rgba(124,246,176,0.25)";
      ctx.strokeRect(14.5, 10.5, 47, H - 21);
      ctx.strokeRect(W - 61.5, 10.5, 47, H - 21);

      ctx.font = "700 8px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillStyle = "rgba(124,246,176,0.6)";
      ctx.fillText("SRC", 38, H - 6);
      ctx.fillText("DST", W - 38, H - 6);

      if (routes.length === 0) {
        ctx.fillStyle = "rgba(255,255,255,0.3)";
        ctx.font = "500 11px ui-sans-serif, system-ui, sans-serif";
        ctx.fillText(W < 360 ? "PATCH BAY IDLE" : "PATCH BAY IDLE — click a cell below", W / 2, midY + 4);
        return;
      }

      routes.slice(0, 12).forEach((r, i) => {
        const n = Math.min(12, routes.length);
        const y1 = 18 + ((i + 0.5) / Math.max(1, n)) * (H - 40);
        const destIdx = DESTS.findIndex((d) => d.id === r.dest);
        const y2 = 18 + ((Math.max(0, destIdx) + 0.5) / DESTS.length) * (H - 40);
        const tint = srcTint(r.source);
        const color = r.amount >= 0 ? tint : AMB;
        const mag = Math.abs(r.amount);
        const cpx = (leftX + rightX) / 2;
        const bend = 28 + mag * 36;

        // Elevated cable energy — outer energy field
        ctx.beginPath();
        ctx.moveTo(leftX, y1);
        ctx.bezierCurveTo(cpx - bend, y1, cpx + bend, y2, rightX, y2);
        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.15 + mag * 0.28;
        ctx.lineWidth = 6 + mag * 6;
        ctx.stroke();
        ctx.globalAlpha = 1;

        // Mid-layer glow
        ctx.beginPath();
        ctx.moveTo(leftX, y1);
        ctx.bezierCurveTo(cpx - bend, y1, cpx + bend, y2, rightX, y2);
        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.4 + mag * 0.5;
        ctx.lineWidth = 2.5 + mag * 3.5;
        ctx.stroke();
        ctx.globalAlpha = 1;

        // Core bright cable
        ctx.beginPath();
        ctx.moveTo(leftX, y1);
        ctx.bezierCurveTo(cpx - bend, y1, cpx + bend, y2, rightX, y2);
        ctx.strokeStyle = mag > 0.5 ? "#fff" : color;
        ctx.globalAlpha = 0.5 + mag * 0.45;
        ctx.lineWidth = 1 + mag * 2;
        ctx.stroke();
        ctx.globalAlpha = 1;

        // Enhanced energy packets with trailing wake
        const packetCount = mag > 0.6 ? 3 : 2;
        for (let p = 0; p < packetCount; p++) {
          const u = ((t / (1100 - mag * 350)) + i * 0.11 + p * (1 / packetCount)) % 1;
          const mt = 1 - u;
          const px =
            mt * mt * mt * leftX +
            3 * mt * mt * u * (cpx - bend) +
            3 * mt * u * u * (cpx + bend) +
            u * u * u * rightX;
          const py =
            mt * mt * mt * y1 +
            3 * mt * mt * u * y1 +
            3 * mt * u * u * y2 +
            u * u * u * y2;
          
          // Packet wake trail
          const wakeGrad = ctx.createRadialGradient(px, py, 0, px, py, 10 + mag * 6);
          wakeGrad.addColorStop(0, `${color}88`);
          wakeGrad.addColorStop(0.5, `${color}33`);
          wakeGrad.addColorStop(1, `${color}00`);
          ctx.fillStyle = wakeGrad;
          ctx.beginPath();
          ctx.arc(px, py, 10 + mag * 6, 0, Math.PI * 2);
          ctx.fill();
          
          // Core packet
          const rg = ctx.createRadialGradient(px, py, 0, px, py, 4 + mag * 3);
          rg.addColorStop(0, "#fff");
          rg.addColorStop(0.4, color);
          rg.addColorStop(1, `${color}00`);
          ctx.fillStyle = rg;
          ctx.beginPath();
          ctx.arc(px, py, 4 + mag * 3, 0, Math.PI * 2);
          ctx.fill();
        }

        // Enhanced junction nodes with pulsing energy
        const junctionPulse = 0.9 + 0.1 * Math.sin(t / 600 + i * 0.5);
        ctx.fillStyle = color;
        ctx.shadowBlur = 10 + mag * 8;
        ctx.shadowColor = color;
        ctx.beginPath();
        ctx.arc(leftX, y1, 3.5 + mag * 1.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(rightX, y2, 3.5 + mag * 1.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;

        // Outer junction glow rings
        if (mag > 0.3) {
          ctx.strokeStyle = color;
          ctx.globalAlpha = (mag - 0.3) * 0.6 * junctionPulse;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(leftX, y1, 6 + mag * 2, 0, Math.PI * 2);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(rightX, y2, 6 + mag * 2, 0, Math.PI * 2);
          ctx.stroke();
          ctx.globalAlpha = 1;
        }

        if (W > 420 && i < 6) {
          ctx.font = "600 7px ui-sans-serif, system-ui, sans-serif";
          ctx.fillStyle = `${color}aa`;
          ctx.textAlign = "right";
          ctx.fillText(srcLabel(r.source), leftX - 8, y1 + 2);
          ctx.textAlign = "left";
          ctx.fillText(destLabel(r.dest), rightX + 8, y2 + 2);
        }
      });

      ctx.fillStyle = "rgba(124,246,176,0.55)";
      ctx.font = "700 9px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(`${routes.length} LIVE CABLE${routes.length === 1 ? "" : "S"}`, 14, 12);
    };

    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);

  return (
    <div
      ref={wrapRef}
      className="relative mb-2.5 overflow-hidden rounded-md border border-[#7cf6b0]/25 bg-[#050a08]/90 shadow-[inset_0_0_0_1px_rgba(124,246,176,0.06),inset_0_0_28px_rgba(0,0,0,0.55),0_6px_18px_rgba(0,0,0,0.3)]"
    >
      <canvas ref={canvasRef} className="block w-full" style={{ height: 108 }} aria-hidden />
      <span className="pointer-events-none absolute inset-x-3 top-1 h-px bg-[#7cf6b0]/35" />
      <span className="pointer-events-none absolute inset-x-3 bottom-1 h-px bg-[#7cf6b0]/35" />
    </div>
  );
}

export function ModPatchGrid() {
  const matrix = useFireCommandStore((s) => s.patch.modMatrix);
  const setModRoute = useFireCommandStore((s) => s.setModRoute);
  const [budgetFlash, setBudgetFlash] = useState(false);
  const [hover, setHover] = useState<{ r: number; c: number } | null>(null);
  const dragRef = useRef<{ slot: number; startY: number; startAmount: number } | null>(null);

  const slotOf = (src: ModSource, dest: ModDest) =>
    matrix.findIndex((r) => r.source === src && r.dest === dest);
  const used = matrix.filter((r) => r.source !== "none" && r.dest !== "none").length;

  const onCellDown = (e: React.PointerEvent, src: ModSource, dest: ModDest) => {
    e.preventDefault();
    let slot = slotOf(src, dest);
    if (e.button === 2) {
      if (slot >= 0) setModRoute(slot, { source: "none", dest: "none", amount: 0 });
      return;
    }
    let startAmount: number;
    if (slot === -1) {
      const free = matrix.findIndex((r) => r.source === "none" || r.dest === "none");
      if (free === -1) {
        setBudgetFlash(true);
        setTimeout(() => setBudgetFlash(false), 900);
        return;
      }
      slot = free;
      startAmount = 0.5;
      setModRoute(slot, { source: src, dest, amount: startAmount });
    } else {
      startAmount = matrix[slot].amount;
    }
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { slot, startY: e.clientY, startAmount };
  };

  const onCellMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const amount = clamp(d.startAmount + (d.startY - e.clientY) / 110, -1, 1);
    setModRoute(d.slot, { amount: Math.round(amount * 100) / 100 });
  };

  const onCellUp = () => { dragRef.current = null; };

  return (
    <div>
      <SignalFlowViz />

      <div className="overflow-x-auto rounded-xl border border-white/[0.06] bg-black/30 p-2">
        <table className="border-separate w-full" style={{ borderSpacing: 3 }}>
          <thead>
            <tr>
              <th className="w-10" />
              {DESTS.map((dst, ci) => (
                <th
                  key={dst.id}
                  className="text-[8.5px] font-semibold uppercase tracking-wide pb-1 min-w-[26px] transition-colors"
                  style={{ color: hover?.c === ci ? "#fff" : "rgba(255,255,255,0.38)" }}
                  title={dst.hint}
                >
                  {dst.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody onPointerLeave={() => setHover(null)}>
            {SOURCES.map((src, ri) => (
              <tr key={src.id}>
                <td
                  className="text-[9px] font-semibold uppercase tracking-wide pr-1.5 text-right whitespace-nowrap transition-colors"
                  style={{ color: hover?.r === ri ? src.tint : "rgba(255,255,255,0.42)" }}
                  title={src.hint}
                >
                  {src.label}
                </td>
                {DESTS.map((dst, ci) => {
                  const slot = slotOf(src.id, dst.id);
                  const amount = slot >= 0 ? matrix[slot].amount : 0;
                  const active = slot >= 0;
                  const mag = Math.abs(amount);
                  const color = amount >= 0 ? GRN : AMB;
                  const inCross = hover !== null && (hover.r === ri || hover.c === ci);
                  return (
                    <td key={dst.id} className="p-0">
                      <div
                        onPointerDown={(e) => onCellDown(e, src.id, dst.id)}
                        onPointerMove={onCellMove}
                        onPointerUp={onCellUp}
                        onPointerCancel={onCellUp}
                        onPointerEnter={() => setHover({ r: ri, c: ci })}
                        onContextMenu={(e) => e.preventDefault()}
                        className="mx-auto flex h-[24px] w-[26px] items-center justify-center rounded-md border cursor-pointer touch-none select-none transition-all"
                        style={{
                          borderColor: active
                            ? `${color}88`
                            : inCross
                              ? `${src.tint}44`
                              : "rgba(255,255,255,0.06)",
                          background: active
                            ? `radial-gradient(circle at 50% 40%, ${color}33, ${color}0a)`
                            : inCross
                              ? `${src.tint}12`
                              : "rgba(255,255,255,0.02)",
                          boxShadow: active ? `inset 0 0 8px ${color}33, 0 0 ${4 + mag * 6}px ${color}22` : undefined,
                        }}
                        title={
                          active
                            ? `${src.hint} → ${dst.hint}: ${amount >= 0 ? "+" : ""}${Math.round(amount * 100)}% · drag ↕ = amount · right-click = clear`
                            : `${src.hint} → ${dst.hint} — click to patch (slot budget: ${used}/${matrix.length})`
                        }
                        role="button"
                        aria-label={`${src.hint} to ${dst.hint}${active ? `, amount ${Math.round(amount * 100)} percent` : ", unpatched"}`}
                      >
                        {active && (
                          <span
                            className="rounded-full"
                            style={{
                              width: 4 + mag * 12,
                              height: 4 + mag * 12,
                              background: `radial-gradient(circle at 35% 35%, #fff, ${color})`,
                              boxShadow: mag > 0.02 ? `0 0 ${4 + mag * 10}px ${color}` : undefined,
                              opacity: 0.5 + mag * 0.5,
                            }}
                          />
                        )}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[10px] text-dim">
        <div className="flex items-center gap-2">
          <span
            className={`font-mono px-1.5 py-0.5 rounded border transition ${
              budgetFlash
                ? "border-rose-400/70 text-rose-300 bg-rose-500/15"
                : "border-white/10 text-white/50"
            }`}
          >
            {used}/{matrix.length} slots
          </span>
          <span className="flex items-center gap-[3px]" aria-hidden>
            {matrix.map((r, i) => {
              const on = r.source !== "none" && r.dest !== "none";
              return (
                <span
                  key={i}
                  className="h-[10px] w-[5px] rounded-[2px] transition-colors"
                  style={{
                    background: on ? (r.amount >= 0 ? GRN : AMB) : "rgba(255,255,255,0.08)",
                    boxShadow: on ? `0 0 5px ${(r.amount >= 0 ? GRN : AMB)}66` : "none",
                  }}
                />
              );
            })}
          </span>
        </div>
        <span className="text-right">
          click to patch · drag ↕ depth ({" "}
          <span style={{ color: GRN }}>green +</span> /{" "}
          <span style={{ color: AMB }}>amber −</span> ) · right-click clears
        </span>
      </div>
    </div>
  );
}
