import { memo, useCallback, useEffect, useRef, useState } from "react";
import { uiTick } from "@/audio/uiSounds";

interface Props {
  value: number; // -1..1
  onChange: (v: number) => void;
  size?: number;
  color?: string;
  label?: string;
  hint?: string;
  bipolar?: boolean;
  /** Where the reset pip / double-click return to (default 0). */
  defaultValue?: number;
}

/**
 * Vertical-drag knob with a neon arc. No external dep — uses pointer events
 * directly. Sparkle/particle bursts were removed (they didn't fit the vibe);
 * the knob now stays clean and sharp while dragging.
 */
function KnobImpl({
  value,
  onChange,
  size = 110,
  color = "#22e8ff",
  label,
  hint,
  bipolar = true,
  defaultValue = 0,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const prevValueRef = useRef(value);
  const startY = useRef(0);
  const startV = useRef(0);
  const lastTickRef = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState("");
  // Distinguish "stationary click on the readout" (open editor) from a drag
  // that happened to start on the readout (adjust value as usual).
  const movedRef = useRef(false);

  // Keep prevValueRef in sync when the external value prop changes (e.g. preset
  // load, undo) so the tick throttle below measures from the right baseline.
  useEffect(() => {
    if (!dragging) {
      prevValueRef.current = value;
    }
  }, [value, dragging]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      (e.target as Element).setPointerCapture(e.pointerId);
      startY.current = e.clientY;
      startV.current = value;
      prevValueRef.current = value;
      movedRef.current = false;
      setDragging(true);
    },
    [value],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging) return;
      const dy = startY.current - e.clientY;
      if (Math.abs(dy) > 2) movedRef.current = true;
      // Shift = ultra-fine (~0.5 display units per pixel) so exact
      // percentages are reachable by hand. Re-anchor each move so toggling
      // shift mid-drag never jumps the value.
      const scale = e.shiftKey ? 2000 : 200;
      const range = bipolar ? 2 : 1;
      const next = clamp(
        startV.current + (dy / scale) * range,
        bipolar ? -1 : 0,
        1,
      );
      startY.current = e.clientY;
      startV.current = next;
      const delta = next - prevValueRef.current;
      // Only react to meaningful changes so a drag isn't a continuous buzz.
      if (Math.abs(delta) > 0.02) {
        prevValueRef.current = next;
        const now = performance.now();
        if (now - lastTickRef.current > 55) {
          lastTickRef.current = now;
          uiTick(bipolar ? (next + 1) / 2 : next);
        }
      }
      onChange(next);
    },
    [dragging, onChange, bipolar],
  );

  const endDrag = useCallback((e: React.PointerEvent) => {
    try {
      (e.target as Element).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    setDragging(false);
  }, []);

  const onDoubleClick = useCallback(() => {
    onChange(defaultValue);
  }, [onChange, defaultValue]);

  /** Commit typed text — interpreted on the displayed ×100 scale. */
  const commitTyped = useCallback(
    (raw: string) => {
      setEditing(false);
      const n = parseFloat(raw.replace(/\u2212/g, "-").replace(/%/g, "").trim());
      if (!Number.isFinite(n)) return;
      onChange(clamp(n / 100, bipolar ? -1 : 0, 1));
    },
    [onChange, bipolar],
  );

  // Kept in a ref so the wheel listener below registers once instead of
  // re-attaching on every value change mid-scroll.
  const nudgeRef = useRef<(dir: number, fine: boolean) => void>(() => {});
  nudgeRef.current = (dir, fine) => {
    const range = bipolar ? 2 : 1;
    const step = range * (fine ? 0.01 : 0.05);
    onChange(clamp(value + dir * step, bipolar ? -1 : 0, 1));
  };
  const nudge = useCallback((dir: number, fine: boolean) => nudgeRef.current(dir, fine), []);

  // Wheel-to-adjust. Registered manually so we can be non-passive and stop the
  // page from scrolling while tweaking a knob.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      nudge(e.deltaY < 0 ? 1 : -1, e.shiftKey);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [nudge]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowUp" || e.key === "ArrowRight") {
        e.preventDefault();
        nudge(1, e.shiftKey);
      } else if (e.key === "ArrowDown" || e.key === "ArrowLeft") {
        e.preventDefault();
        nudge(-1, e.shiftKey);
      } else if (e.key === "Home" || e.key === "0") {
        e.preventDefault();
        onChange(defaultValue);
      } else if (e.key === "Enter") {
        e.preventDefault();
        setEditText("");
        setEditing(true);
      }
    },
    [nudge, onChange, defaultValue],
  );

  // Map value to angle: bipolar -135°..+135°
  const min = bipolar ? -1 : 0;
  const max = 1;
  const norm = (value - min) / (max - min);
  const angle = -135 + norm * 270;

  const arcCenter = bipolar ? 0 : -135;
  const arcStartAngle = bipolar ? Math.min(arcCenter, angle) : -135;
  const arcEndAngle = bipolar
    ? Math.max(arcCenter, angle)
    : angle;

  const r = size / 2 - 8;
  const cx = size / 2;
  const cy = size / 2;
  const path = describeArc(cx, cy, r, arcStartAngle, arcEndAngle);
  const trackPath = describeArc(cx, cy, r, -135, 135);

  const indicatorX =
    cx + Math.sin((angle * Math.PI) / 180) * (r - 2);
  const indicatorY =
    cy - Math.cos((angle * Math.PI) / 180) * (r - 2);

  // Tick ring (Knob v2): 21 fine marks across the sweep. Marks inside the
  // travelled arc glow as a dim trail; the one under the needle ignites.
  const ticks = [];
  for (let i = 0; i <= 20; i++) {
    const a = -135 + (i / 20) * 270;
    const lit = Math.abs(a - angle) <= 7;
    const inTrail = bipolar
      ? (angle >= arcCenter ? a >= arcCenter && a <= angle : a <= arcCenter && a >= angle)
      : a <= angle;
    const rad = (a * Math.PI) / 180;
    const r0 = r + 5;
    const r1 = r + (lit ? 10 : i % 5 === 0 ? 9 : 7.5);
    ticks.push(
      <line
        key={i}
        x1={cx + Math.sin(rad) * r0}
        y1={cy - Math.cos(rad) * r0}
        x2={cx + Math.sin(rad) * r1}
        y2={cy - Math.cos(rad) * r1}
        stroke={lit ? color : inTrail ? `${color}55` : "rgba(255,255,255,0.13)"}
        strokeWidth={lit ? 2 : 1}
        strokeLinecap="round"
        style={{ transition: "stroke 120ms ease" }}
      />,
    );
  }

  const atDefault = Math.abs(value - defaultValue) < 1e-4;
  return (
    <div className="group relative flex flex-col items-center select-none">
      {!atDefault && (
        <button
          onClick={() => onChange(defaultValue)}
          tabIndex={-1}
          className="absolute top-0 right-0 z-10 w-4 h-4 rounded-full border border-white/20 bg-black/70 text-white/60 hover:text-white hover:border-white/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center leading-none"
          style={{ fontSize: 10 }}
          title={`Reset to ${Math.round(defaultValue * 100)}`}
          aria-label={`Reset ${label ?? "knob"} to default`}
        >⟲</button>
      )}
      <div
        ref={ref}
        role="slider"
        tabIndex={0}
        aria-label={label || "knob"}
        aria-valuemin={bipolar ? -100 : 0}
        aria-valuemax={100}
        aria-valuenow={Math.round(value * 100)}
        className="relative cursor-ns-resize rounded-full outline-none focus-visible:ring-2 focus-visible:ring-cyan/60"
        style={{
          width: size,
          height: size,
          touchAction: "none",
          transform: dragging ? "scale(1.04)" : "scale(1)",
          transition: "transform 160ms cubic-bezier(0.2, 1.4, 0.4, 1)",
          filter: dragging ? `drop-shadow(0 0 14px ${color}55)` : "none",
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={onDoubleClick}
        onKeyDown={onKeyDown}
        title="Drag or scroll to change · Double-click to reset · Shift for ultra-fine · Click the value to type it"
      >
        <svg width={size} height={size} className="overflow-visible">
          <defs>
            <radialGradient id={`bg-${color}`} cx="50%" cy="40%" r="60%">
              <stop offset="0%" stopColor="rgba(255,255,255,0.06)" />
              <stop offset="100%" stopColor="rgba(0,0,0,0.45)" />
            </radialGradient>
            <filter id={`glow-${color}`} x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation={dragging ? 5 : 3} result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          {/* Machined bezel: hairline outer ring + brushed inner face. */}
          <circle cx={cx} cy={cy} r={r + 2.5} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth={1} />
          <circle cx={cx} cy={cy} r={r + 2} fill={`url(#bg-${color})`} stroke="rgba(0,0,0,0.5)" />
          <circle cx={cx} cy={cy} r={r - 6} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth={1} />
          {ticks}
          <path
            d={trackPath}
            fill="none"
            stroke="rgba(255,255,255,0.07)"
            strokeWidth={4}
            strokeLinecap="round"
          />
          <path
            d={path}
            fill="none"
            stroke={color}
            strokeWidth={4}
            strokeLinecap="round"
            filter={`url(#glow-${color})`}
            style={{ transition: "stroke-width 120ms ease" }}
          />
          <line
            x1={cx}
            y1={cy}
            x2={indicatorX}
            y2={indicatorY}
            stroke={color}
            strokeWidth={2.5}
            strokeLinecap="round"
            filter={`url(#glow-${color})`}
          />
          <circle
            cx={indicatorX}
            cy={indicatorY}
            r={4}
            fill={color}
            filter={`url(#glow-${color})`}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          {editing ? (
            <input
              autoFocus
              value={editText}
              placeholder={(value * 100).toFixed(0)}
              onChange={(e) => setEditText(e.target.value)}
              onFocus={(e) => e.target.select()}
              onBlur={(e) => commitTyped(e.target.value)}
              onPointerDown={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitTyped((e.target as HTMLInputElement).value);
                else if (e.key === "Escape") setEditing(false);
                e.stopPropagation();
              }}
              className="w-11 text-[11px] font-mono tabular-nums text-center bg-black/80 border rounded text-white outline-none"
              style={{ borderColor: color }}
            />
          ) : (
            <button
              tabIndex={-1}
              onClick={() => {
                if (movedRef.current) return;
                setEditText("");
                setEditing(true);
              }}
              className={`text-[11px] font-mono tabular-nums transition-all rounded px-0.5 cursor-text hover:bg-white/10 ${dragging ? "text-white" : "text-dim hover:text-white"}`}
              style={
                dragging
                  ? { textShadow: `0 0 8px ${color}`, transform: "scale(1.25)" }
                  : undefined
              }
              title="Click to type an exact value"
            >
              {bipolar
                ? `${value >= 0 ? "+" : ""}${(value * 100).toFixed(0)}`
                : `${Math.round(value * 100)}`}
            </button>
          )}
        </div>
      </div>
      {label && (
        <div className="mt-2 text-xs tracking-wide font-medium uppercase text-white/85">
          {label}
        </div>
      )}
      {hint && (
        <div className="text-[10px] text-dim text-center max-w-[140px] mt-0.5">
          {hint}
        </div>
      )}
    </div>
  );
}

/**
 * Memoized so a parent re-render (e.g. another knob changing) doesn't force
 * every knob to re-render its SVG/filters. Only re-renders when its own props
 * actually change — pair with stable `onChange` (see ParamKnob).
 */
export const Knob = memo(KnobImpl);

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function describeArc(
  cx: number,
  cy: number,
  r: number,
  startAngle: number,
  endAngle: number,
): string {
  const start = polarToCartesian(cx, cy, r, endAngle);
  const end = polarToCartesian(cx, cy, r, startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";
  return [
    "M",
    start.x,
    start.y,
    "A",
    r,
    r,
    0,
    largeArcFlag,
    0,
    end.x,
    end.y,
  ].join(" ");
}
