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

/** Animated cable bay — active routes as bezier wires with traveling packets. */
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
    const size = { w: 400, h: 88 };

    const sync = () => {
      const dpr = Math.min(2.5, window.devicePixelRatio || 1);
      size.w = Math.max(1, Math.floor(wrap.clientWidth) || 1);
      size.h = 88;
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

    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      if (document.hidden || t - last < 24) return;
      last = t;
      const mx = stateRef.current;
      const { w: W, h: H } = size;
      ctx.clearRect(0, 0, W, H);

      // Green lattice depth
      const bg = ctx.createLinearGradient(0, 0, W, H);
      bg.addColorStop(0, "rgba(124,246,176,0.07)");
      bg.addColorStop(0.5, "rgba(4,14,10,0.55)");
      bg.addColorStop(1, "rgba(124,246,176,0.04)");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      // Faint lattice
      ctx.strokeStyle = "rgba(124,246,176,0.05)";
      for (let x = 0; x < W; x += 24) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
      }
      for (let y = 0; y < H; y += 18) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      }

      const routes = mx.filter((r) => r.source !== "none" && r.dest !== "none");
      const leftX = 70;
      const rightX = W - 70;
      const midY = H / 2;

      // Source / dest pillars
      ctx.fillStyle = "rgba(124,246,176,0.12)";
      ctx.fillRect(18, 12, 36, H - 24);
      ctx.fillRect(W - 54, 12, 36, H - 24);
      ctx.font = "600 8px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillStyle = "rgba(124,246,176,0.55)";
      ctx.fillText("SRC", 36, H - 8);
      ctx.fillText("DST", W - 36, H - 8);

      if (routes.length === 0) {
        ctx.fillStyle = "rgba(255,255,255,0.28)";
        ctx.font = "500 11px ui-sans-serif, system-ui, sans-serif";
        ctx.fillText(W < 360 ? "NO ACTIVE PATCHES" : "NO ACTIVE PATCHES — click a cell below", W / 2, midY + 4);
        return;
      }

      routes.slice(0, 12).forEach((r, i) => {
        const n = routes.length;
        const y1 = 18 + ((i + 0.5) / Math.max(1, n)) * (H - 36);
        const destIdx = DESTS.findIndex((d) => d.id === r.dest);
        const y2 = 18 + ((Math.max(0, destIdx) + 0.5) / DESTS.length) * (H - 36);
        const tint = srcTint(r.source);
        const color = r.amount >= 0 ? tint : AMB;
        const mag = Math.abs(r.amount);
        const cpx = (leftX + rightX) / 2;

        // Cable
        ctx.beginPath();
        ctx.moveTo(leftX, y1);
        ctx.bezierCurveTo(cpx - 40, y1, cpx + 40, y2, rightX, y2);
        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.25 + mag * 0.55;
        ctx.lineWidth = 1.2 + mag * 2;
        ctx.stroke();
        ctx.globalAlpha = 1;

        // Traveling packet along bezier
        const u = ((t / 1400) + i * 0.13) % 1;
        // Approximate point on cubic bezier
        const mt = 1 - u;
        const px =
          mt * mt * mt * leftX +
          3 * mt * mt * u * (cpx - 40) +
          3 * mt * u * u * (cpx + 40) +
          u * u * u * rightX;
        const py =
          mt * mt * mt * y1 +
          3 * mt * mt * u * y1 +
          3 * mt * u * u * y2 +
          u * u * u * y2;
        const rg = ctx.createRadialGradient(px, py, 0, px, py, 5);
        rg.addColorStop(0, "#fff");
        rg.addColorStop(0.4, color);
        rg.addColorStop(1, `${color}00`);
        ctx.fillStyle = rg;
        ctx.beginPath();
        ctx.arc(px, py, 5, 0, Math.PI * 2);
        ctx.fill();

        // End nodes
        ctx.fillStyle = color;
        ctx.beginPath(); ctx.arc(leftX, y1, 2.5, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(rightX, y2, 2.5, 0, Math.PI * 2); ctx.fill();
      });

      ctx.fillStyle = "rgba(124,246,176,0.45)";
      ctx.font = "600 9px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(`${routes.length} LIVE`, 12, 12);
    };

    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);

  return (
    <div
      ref={wrapRef}
      className="relative mb-2.5 overflow-hidden rounded-xl border border-[#7cf6b0]/15 bg-black/50 shadow-[inset_0_1px_0_rgba(124,246,176,0.06),0_8px_24px_rgba(0,0,0,0.3)]"
    >
      <canvas ref={canvasRef} className="block w-full" style={{ height: 88 }} aria-hidden />
      <span className="pointer-events-none absolute left-1.5 top-1.5 h-2 w-2 border-l border-t border-[#7cf6b0]/40" />
      <span className="pointer-events-none absolute right-1.5 top-1.5 h-2 w-2 border-r border-t border-[#7cf6b0]/40" />
      <span className="pointer-events-none absolute bottom-1.5 left-1.5 h-2 w-2 border-b border-l border-[#7cf6b0]/40" />
      <span className="pointer-events-none absolute bottom-1.5 right-1.5 h-2 w-2 border-b border-r border-[#7cf6b0]/40" />
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
