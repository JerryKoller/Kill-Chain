/**
 * ModuleBackdrop — gutter-frame art for Fire Command modules.
 * Content is inset (`.fc-mod-content-well`); art fills the margins around UI.
 * Crests/friezes are sized to fit wholly inside top/bottom gutters.
 */

import { useEffect, useRef, type ReactNode } from "react";
import { attachModuleArtFocus } from "./moduleArtFocus";
import "./moduleBackdrops.css";

export type ModuleBackdropProps = {
  moduleId?: string;
  color: string;
  awake?: boolean;
};

type RailKind = "sine" | "pulse" | "ladder" | "bead" | "chevron" | "spark" | "saw" | "gate" | "grain";
type FrameKind = "ring" | "hex" | "diamond" | "square" | "shield" | "oct";

type FrameArt = {
  medal: ReactNode;
  frieze: ReactNode;
  corner: ReactNode;
  rail: RailKind;
  flourish?: ReactNode;
};

const S = {
  fill: "none" as const,
  stroke: "currentColor",
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

/** Dense high-res sine path for rails / flourishes. */
function sinePath(amp: number, cycles: number, x0: number, y0: number, len: number, steps = 48) {
  let d = `M${x0} ${y0}`;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const y = y0 + t * len;
    const ox = Math.sin(t * Math.PI * 2 * cycles) * amp;
    d += ` L${x0 + ox} ${y}`;
  }
  return d;
}

function Rail({ kind }: { kind: RailKind }) {
  if (kind === "sine") {
    return (
      <svg viewBox="0 0 80 240" preserveAspectRatio="none" aria-hidden>
        <path {...S} strokeWidth="2.2" d={sinePath(14, 2.2, 40, 6, 228, 64)} opacity="0.78" />
        <path {...S} strokeWidth="1.1" d={sinePath(9, 2.2, 28, 6, 228, 64)} opacity="0.32" />
        <path {...S} strokeWidth="0.7" d={sinePath(5, 2.2, 52, 6, 228, 64)} opacity="0.22" />
        {Array.from({ length: 12 }, (_, i) => (
          <circle key={i} cx={40 + Math.sin((i / 12) * Math.PI * 2 * 2.2) * 14} cy={14 + i * 18.5} r="1.4" fill="currentColor" opacity="0.35" />
        ))}
      </svg>
    );
  }
  if (kind === "saw") {
    return (
      <svg viewBox="0 0 80 240" preserveAspectRatio="none" aria-hidden>
        <path
          {...S}
          strokeWidth="2"
          d="M18 8 L62 8 L18 36 L62 36 L18 64 L62 64 L18 92 L62 92 L18 120 L62 120 L18 148 L62 148 L18 176 L62 176 L18 204 L62 204 L18 228 L62 232"
          opacity="0.78"
        />
        <path
          {...S}
          strokeWidth="0.9"
          d="M26 12 L54 12 L26 36 L54 36 L26 64 L54 64 L26 92 L54 92 L26 120 L54 120 L26 148 L54 148 L26 176 L54 176 L26 204 L54 204"
          opacity="0.28"
        />
      </svg>
    );
  }
  if (kind === "pulse") {
    return (
      <svg viewBox="0 0 80 240" preserveAspectRatio="none" aria-hidden>
        <path
          {...S}
          strokeWidth="2"
          d="M40 6 V28 H58 V52 H22 V76 H58 V100 H22 V124 H58 V148 H22 V172 H58 V196 H40 V234"
          opacity="0.8"
        />
        <path
          {...S}
          strokeWidth="0.85"
          d="M40 10 V30 H54 V50 H26 V74 H54 V98 H26 V122 H54 V146 H26 V170 H54 V194 H40 V230"
          opacity="0.28"
        />
      </svg>
    );
  }
  if (kind === "gate") {
    return (
      <svg viewBox="0 0 80 240" preserveAspectRatio="none" aria-hidden>
        {Array.from({ length: 10 }, (_, i) => (
          <g key={i}>
            <rect x="18" y={10 + i * 22} width="44" height={i % 2 ? 14 : 5} rx="1.5" fill="currentColor" opacity={i % 2 ? 0.52 : 0.18} />
            <rect x="22" y={12 + i * 22} width="36" height={i % 2 ? 2 : 1} fill="currentColor" opacity="0.25" />
          </g>
        ))}
      </svg>
    );
  }
  if (kind === "ladder") {
    return (
      <svg viewBox="0 0 80 240" preserveAspectRatio="none" aria-hidden>
        <line x1="22" y1="6" x2="22" y2="234" stroke="currentColor" strokeWidth="1.6" opacity="0.42" />
        <line x1="58" y1="6" x2="58" y2="234" stroke="currentColor" strokeWidth="1.6" opacity="0.42" />
        <line x1="26" y1="6" x2="26" y2="234" stroke="currentColor" strokeWidth="0.6" opacity="0.2" />
        <line x1="54" y1="6" x2="54" y2="234" stroke="currentColor" strokeWidth="0.6" opacity="0.2" />
        {Array.from({ length: 16 }, (_, i) => (
          <g key={i}>
            <line x1="22" y1={12 + i * 14} x2="58" y2={12 + i * 14} stroke="currentColor" strokeWidth="1.5" opacity={0.28 + (i % 3) * 0.12} />
            <circle cx="22" cy={12 + i * 14} r="1.3" fill="currentColor" opacity="0.4" />
            <circle cx="58" cy={12 + i * 14} r="1.3" fill="currentColor" opacity="0.4" />
          </g>
        ))}
      </svg>
    );
  }
  if (kind === "bead") {
    return (
      <svg viewBox="0 0 80 240" preserveAspectRatio="none" aria-hidden>
        <line x1="40" y1="6" x2="40" y2="234" stroke="currentColor" strokeWidth="0.9" opacity="0.28" />
        {Array.from({ length: 18 }, (_, i) => (
          <g key={i}>
            <circle cx="40" cy={12 + i * 12.5} r={i % 3 === 0 ? 5.2 : 2.6} fill="currentColor" opacity={0.38 + (i % 4) * 0.08} />
            {i % 3 === 0 && <circle cx="40" cy={12 + i * 12.5} r="2.2" {...S} strokeWidth="0.8" opacity="0.45" />}
          </g>
        ))}
      </svg>
    );
  }
  if (kind === "chevron") {
    return (
      <svg viewBox="0 0 80 240" preserveAspectRatio="none" aria-hidden>
        {Array.from({ length: 14 }, (_, i) => (
          <g key={i}>
            <path {...S} strokeWidth="1.8" d={`M16 ${14 + i * 16} L40 ${24 + i * 16} L64 ${14 + i * 16}`} opacity={0.38 + (i % 3) * 0.12} />
            <path {...S} strokeWidth="0.7" d={`M24 ${16 + i * 16} L40 ${22 + i * 16} L56 ${16 + i * 16}`} opacity="0.25" />
          </g>
        ))}
      </svg>
    );
  }
  if (kind === "grain") {
    return (
      <svg viewBox="0 0 80 240" preserveAspectRatio="none" aria-hidden>
        {Array.from({ length: 36 }, (_, i) => (
          <circle
            key={i}
            cx={18 + (i % 5) * 11 + ((i * 3) % 4)}
            cy={8 + i * 6.3}
            r={1.2 + (i % 4) * 0.55}
            fill="currentColor"
            opacity={0.3 + (i % 5) * 0.08}
          />
        ))}
      </svg>
    );
  }
  // spark — 4-point crosses, never 5-point stars
  return (
    <svg viewBox="0 0 80 240" preserveAspectRatio="none" aria-hidden>
      {Array.from({ length: 11 }, (_, i) => {
        const cy = 14 + i * 20;
        const cx = 40 + ((i % 3) - 1) * 12;
        const r = 4.5 + (i % 3);
        return (
          <g key={i} opacity={0.32 + (i % 4) * 0.1}>
            <line x1={cx - r} y1={cy} x2={cx + r} y2={cy} stroke="currentColor" strokeWidth="1.5" />
            <line x1={cx} y1={cy - r} x2={cx} y2={cy + r} stroke="currentColor" strokeWidth="1.5" />
            <line x1={cx - r * 0.7} y1={cy - r * 0.7} x2={cx + r * 0.7} y2={cy + r * 0.7} stroke="currentColor" strokeWidth="0.8" opacity="0.55" />
            <line x1={cx + r * 0.7} y1={cy - r * 0.7} x2={cx - r * 0.7} y2={cy + r * 0.7} stroke="currentColor" strokeWidth="0.8" opacity="0.55" />
          </g>
        );
      })}
    </svg>
  );
}

/** Medal frame — multi-stroke, high-detail so badges stay sharp when scaled. */
function MedalSvg({ frame = "ring", children }: { frame?: FrameKind; children: ReactNode }) {
  return (
    <svg viewBox="0 0 128 128" aria-hidden>
      <g transform="scale(2)">
        {frame === "ring" && (
          <>
            <circle cx="32" cy="32" r="30" {...S} strokeWidth="1.15" opacity="0.5" />
            <circle cx="32" cy="32" r="27.5" {...S} strokeWidth="0.45" opacity="0.28" />
            <circle cx="32" cy="32" r="24" {...S} strokeWidth="0.7" opacity="0.32" />
            {Array.from({ length: 24 }, (_, i) => {
              const a = (i / 24) * Math.PI * 2;
              const inner = i % 3 === 0 ? 28.2 : 29.2;
              return (
                <line
                  key={i}
                  x1={32 + Math.cos(a) * inner}
                  y1={32 + Math.sin(a) * inner}
                  x2={32 + Math.cos(a) * 30.4}
                  y2={32 + Math.sin(a) * 30.4}
                  stroke="currentColor"
                  strokeWidth={i % 3 === 0 ? 1 : 0.55}
                  opacity={i % 3 === 0 ? 0.45 : 0.22}
                />
              );
            })}
          </>
        )}
        {frame === "hex" && (
          <>
            <path {...S} strokeWidth="1.2" d="M32 3.5 L57 17.5 V46.5 L32 60.5 L7 46.5 V17.5 Z" opacity="0.5" />
            <path {...S} strokeWidth="0.55" d="M32 7 L53 19 V45 L32 57 L11 45 V19 Z" opacity="0.28" />
            <path {...S} strokeWidth="0.7" d="M32 10 L50 20.5 V43.5 L32 54 L14 43.5 V20.5 Z" opacity="0.3" />
            {[0, 1, 2, 3, 4, 5].map((i) => {
              const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
              return <circle key={i} cx={32 + Math.cos(a) * 26} cy={32 + Math.sin(a) * 26} r="1.1" fill="currentColor" opacity="0.4" />;
            })}
          </>
        )}
        {frame === "diamond" && (
          <>
            <path {...S} strokeWidth="1.2" d="M32 3 L60 32 L32 61 L4 32 Z" opacity="0.5" />
            <path {...S} strokeWidth="0.55" d="M32 8 L55 32 L32 56 L9 32 Z" opacity="0.28" />
            <path {...S} strokeWidth="0.7" d="M32 12 L50 32 L32 52 L14 32 Z" opacity="0.3" />
            {[[32, 5], [58, 32], [32, 59], [6, 32]].map(([x, y], i) => (
              <circle key={i} cx={x} cy={y} r="1.3" fill="currentColor" opacity="0.42" />
            ))}
          </>
        )}
        {frame === "square" && (
          <>
            <rect x="5" y="5" width="54" height="54" rx="5" {...S} strokeWidth="1.15" opacity="0.5" />
            <rect x="8" y="8" width="48" height="48" rx="3.5" {...S} strokeWidth="0.5" opacity="0.25" />
            <rect x="11.5" y="11.5" width="41" height="41" rx="3" {...S} strokeWidth="0.7" opacity="0.3" />
            {[[8, 8], [56, 8], [8, 56], [56, 56]].map(([x, y], i) => (
              <circle key={i} cx={x} cy={y} r="1.4" fill="currentColor" opacity="0.4" />
            ))}
            {Array.from({ length: 8 }, (_, i) => (
              <line key={i} x1={12 + i * 5.5} y1="5.5" x2={12 + i * 5.5} y2="8" stroke="currentColor" strokeWidth="0.6" opacity="0.28" />
            ))}
          </>
        )}
        {frame === "shield" && (
          <>
            <path {...S} strokeWidth="1.2" d="M32 4 L55 13.5 V34 C55 47 44 56.5 32 60.5 C20 56.5 9 47 9 34 V13.5 Z" opacity="0.5" />
            <path {...S} strokeWidth="0.55" d="M32 8 L50 16 V34 C50 44.5 41 52.5 32 56 C23 52.5 14 44.5 14 34 V16 Z" opacity="0.28" />
            <path {...S} strokeWidth="0.7" d="M32 11 L48 18 V34 C48 43 40 50 32 53.5 C24 50 16 43 16 34 V18 Z" opacity="0.3" />
          </>
        )}
        {frame === "oct" && (
          <>
            <path {...S} strokeWidth="1.15" d="M21 5 H43 L59 21 V43 L43 59 H21 L5 43 V21 Z" opacity="0.5" />
            <path {...S} strokeWidth="0.55" d="M23 9 H41 L55 23 V41 L41 55 H23 L9 41 V23 Z" opacity="0.28" />
            <path {...S} strokeWidth="0.7" d="M24 12 H40 L52 24 V40 L40 52 H24 L12 40 V24 Z" opacity="0.3" />
            {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
              const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
              return <circle key={i} cx={32 + Math.cos(a) * 27} cy={32 + Math.sin(a) * 27} r="1" fill="currentColor" opacity="0.38" />;
            })}
          </>
        )}
        {children}
      </g>
    </svg>
  );
}

/**
 * Frieze art — 2× internal resolution with hairline tick rail.
 * Motif coords stay in the original 400×40 space (scaled up).
 */
function SymFrieze({ left }: { left: ReactNode }) {
  return (
    <svg viewBox="0 0 800 80" preserveAspectRatio="none" aria-hidden>
      <g transform="scale(2)">
        <line x1="10" y1="20" x2="155" y2="20" stroke="currentColor" strokeWidth="0.55" opacity="0.28" />
        <line x1="245" y1="20" x2="390" y2="20" stroke="currentColor" strokeWidth="0.55" opacity="0.28" />
        <line x1="10" y1="16" x2="155" y2="16" stroke="currentColor" strokeWidth="0.35" opacity="0.14" />
        <line x1="245" y1="16" x2="390" y2="16" stroke="currentColor" strokeWidth="0.35" opacity="0.14" />
        <g transform="translate(200 20)">
          <g transform="translate(-40 0)">{left}</g>
          <g transform="scale(-1,1) translate(-40 0)">{left}</g>
        </g>
        <path {...S} strokeWidth="1.15" d="M158 10 L166 20 L158 30" opacity="0.5" />
        <path {...S} strokeWidth="1.15" d="M242 10 L234 20 L242 30" opacity="0.5" />
        <path {...S} strokeWidth="0.5" d="M160 12 L165 20 L160 28" opacity="0.28" />
        <path {...S} strokeWidth="0.5" d="M240 12 L235 20 L240 28" opacity="0.28" />
      </g>
      {Array.from({ length: 48 }, (_, i) => {
        const x = 24 + i * 15.5;
        if (x > 300 && x < 500) return null;
        return <line key={i} x1={x} y1="36" x2={x} y2={i % 4 === 0 ? 44 : 40} stroke="currentColor" strokeWidth="0.7" opacity={i % 4 === 0 ? 0.28 : 0.14} />;
      })}
    </svg>
  );
}

/** Corner art — higher internal res, multi-stroke L bracket. */
function CornerSvg({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 144 112" aria-hidden>
      <g transform="scale(2)">
        <path {...S} strokeWidth="1.7" d="M4 40 V10 Q4 4 10 4 H42" opacity="0.95" />
        <path {...S} strokeWidth="0.85" d="M10 34 V14 Q10 9 15 9 H36" opacity="0.4" />
        <path {...S} strokeWidth="0.45" d="M7 36 V12 Q7 6.5 12.5 6.5 H38" opacity="0.22" />
        <circle cx="10" cy="10" r="2" fill="currentColor" opacity="0.55" />
        <circle cx="10" cy="10" r="3.2" {...S} strokeWidth="0.5" opacity="0.28" />
        {children}
      </g>
      {[16, 28, 40, 52, 64].map((x) => (
        <line key={`t${x}`} x1={x} y1="8" x2={x} y2="14" stroke="currentColor" strokeWidth="0.8" opacity="0.22" />
      ))}
      {[16, 28, 40, 52, 64].map((y) => (
        <line key={`s${y}`} x1="8" y1={y} x2="14" y2={y} stroke="currentColor" strokeWidth="0.8" opacity="0.22" />
      ))}
    </svg>
  );
}

function Flourish({ kind }: { kind: RailKind }) {
  return (
    <svg viewBox="0 0 96 80" aria-hidden>
      <g transform="scale(2)">
        {kind === "sine" && (
          <>
            <path {...S} strokeWidth="1.4" d="M4 20 C12 6, 20 34, 28 20 S40 6, 44 20" opacity="0.85" />
            <path {...S} strokeWidth="0.55" d="M4 22 C12 10, 20 32, 28 22 S40 10, 44 22" opacity="0.3" />
          </>
        )}
        {kind === "saw" && <path {...S} strokeWidth="1.35" d="M4 28 L14 10 L14 28 L24 10 L24 28 L34 10 L34 28 L44 12" opacity="0.85" />}
        {kind === "pulse" && <path {...S} strokeWidth="1.35" d="M4 26 V14 H14 V28 H24 V10 H34 V26 H44" opacity="0.85" />}
        {kind === "gate" &&
          [6, 16, 26, 36].map((x, i) => (
            <rect key={x} x={x} y={i % 2 ? 10 : 16} width="8" height={i % 2 ? 20 : 10} rx="1" fill="currentColor" opacity={0.35 + i * 0.1} />
          ))}
        {kind === "ladder" && (
          <>
            <line x1="14" y1="6" x2="14" y2="34" stroke="currentColor" strokeWidth="1.1" opacity="0.5" />
            <line x1="34" y1="6" x2="34" y2="34" stroke="currentColor" strokeWidth="1.1" opacity="0.5" />
            {[10, 18, 26, 34].map((y) => (
              <line key={y} x1="14" y1={y} x2="34" y2={y} stroke="currentColor" strokeWidth="1.2" opacity="0.55" />
            ))}
          </>
        )}
        {kind === "bead" &&
          [8, 18, 28, 38].map((x, i) => (
            <circle key={x} cx={x} cy="20" r={i === 1 || i === 2 ? 3.5 : 2.2} fill="currentColor" opacity={0.45 + i * 0.08} />
          ))}
        {kind === "chevron" &&
          [8, 16, 24].map((y, i) => (
            <path key={y} {...S} strokeWidth="1.3" d={`M8 ${y} L24 ${y + 6} L40 ${y}`} opacity={0.45 + i * 0.12} />
          ))}
        {kind === "grain" &&
          Array.from({ length: 10 }, (_, i) => (
            <circle key={i} cx={8 + (i % 5) * 8} cy={10 + Math.floor(i / 5) * 16} r={1.3 + (i % 3) * 0.6} fill="currentColor" opacity={0.4 + (i % 4) * 0.1} />
          ))}
        {kind === "spark" &&
          Array.from({ length: 6 }, (_, i) => {
            const cx = 10 + (i % 3) * 14;
            const cy = 12 + Math.floor(i / 3) * 16;
            const r = 3.5 + (i % 2);
            // 4-point spark (cross) — not a 5-point star
            return (
              <g key={i} opacity={0.45 + (i % 3) * 0.12}>
                <line x1={cx - r} y1={cy} x2={cx + r} y2={cy} stroke="currentColor" strokeWidth="1.2" />
                <line x1={cx} y1={cy - r} x2={cx} y2={cy + r} stroke="currentColor" strokeWidth="1.2" />
                <line x1={cx - r * 0.65} y1={cy - r * 0.65} x2={cx + r * 0.65} y2={cy + r * 0.65} stroke="currentColor" strokeWidth="0.7" opacity="0.6" />
                <line x1={cx + r * 0.65} y1={cy - r * 0.65} x2={cx - r * 0.65} y2={cy + r * 0.65} stroke="currentColor" strokeWidth="0.7" opacity="0.6" />
              </g>
            );
          })}
      </g>
    </svg>
  );
}

function artFor(id: string): FrameArt {
  switch (id) {
    /* ── Sources ── */
    case "osc.a":
      return {
        rail: "sine",
        medal: (
          <MedalSvg frame="ring">
            <text x="32" y="18" textAnchor="middle" fill="currentColor" fontSize="9" fontWeight="700" opacity="0.55">A</text>
            <path {...S} strokeWidth="2.2" d="M8 36 C16 14, 24 54, 32 34 S44 14, 56 36" />
          </MedalSvg>
        ),
        frieze: (
          <SymFrieze
            left={
              <>
                <path {...S} strokeWidth="1.7" d="M-6 0 C-36 -12, -66 12, -100 0 S-145 -10, -170 0" />
                <text x="-88" y="3" textAnchor="middle" fill="currentColor" fontSize="8" opacity="0.45">OSC</text>
              </>
            }
          />
        ),
        corner: (
          <CornerSvg>
            <path {...S} strokeWidth="1.5" d="M18 36 C28 16, 38 44, 48 24 S60 14, 66 30" />
            <text x="52" y="18" fill="currentColor" fontSize="9" fontWeight="700" opacity="0.5">A</text>
          </CornerSvg>
        ),
      };

    case "osc.b":
      return {
        rail: "bead",
        medal: (
          <MedalSvg frame="ring">
            <text x="32" y="14" textAnchor="middle" fill="currentColor" fontSize="8" fontWeight="700" opacity="0.5">B</text>
            <circle cx="22" cy="36" r="12" {...S} strokeWidth="1.6" />
            <circle cx="42" cy="36" r="12" {...S} strokeWidth="1.6" />
            <circle cx="32" cy="36" r="4" fill="currentColor" opacity="0.35" />
          </MedalSvg>
        ),
        frieze: (
          <SymFrieze
            left={
              <>
                <circle cx="-36" cy="0" r="9" {...S} strokeWidth="1.3" />
                <circle cx="-58" cy="0" r="9" {...S} strokeWidth="1.3" />
                <circle cx="-120" cy="0" r="7" {...S} strokeWidth="1.1" opacity="0.55" />
                <circle cx="-138" cy="0" r="7" {...S} strokeWidth="1.1" opacity="0.55" />
              </>
            }
          />
        ),
        corner: (
          <CornerSvg>
            <circle cx="34" cy="30" r="12" {...S} strokeWidth="1.35" />
            <circle cx="50" cy="30" r="12" {...S} strokeWidth="1.35" />
          </CornerSvg>
        ),
      };

    case "osc.c":
      return {
        rail: "saw",
        medal: (
          <MedalSvg frame="hex">
            <text x="32" y="16" textAnchor="middle" fill="currentColor" fontSize="8" fontWeight="700" opacity="0.5">C</text>
            <ellipse cx="32" cy="40" rx="18" ry="8" {...S} strokeWidth="1.4" />
            <path {...S} strokeWidth="1.5" d="M18 40 L32 18 L46 40" />
          </MedalSvg>
        ),
        frieze: (
          <SymFrieze
            left={
              <>
                <path {...S} strokeWidth="1.4" d="M-8 6 H-170" />
                <path {...S} strokeWidth="1.1" d="M-20 -4 L-40 8 L-60 -4 L-80 8 L-100 -4 L-120 8 L-140 -4" opacity="0.7" />
              </>
            }
          />
        ),
        corner: (
          <CornerSvg>
            <ellipse cx="42" cy="34" rx="22" ry="10" {...S} strokeWidth="1.3" />
            <path {...S} strokeWidth="1.3" d="M28 34 L42 16 L56 34" />
          </CornerSvg>
        ),
      };

    case "fire.sec.warp":
      return {
        rail: "saw",
        medal: (
          <MedalSvg frame="diamond">
            {/* Harmonic forge — wavetable fold / brickwall comb */}
            <path {...S} strokeWidth="1.6" d="M12 16 L32 32 L12 48 M52 16 L32 32 L52 48" />
            <path {...S} strokeWidth="1.1" d="M18 20 L32 32 L18 44 M46 20 L32 32 L46 44" opacity="0.45" />
            <line x1="12" y1="32" x2="52" y2="32" stroke="currentColor" strokeWidth="1.2" opacity="0.55" />
            {[16, 24, 40, 48].map((x, i) => (
              <line key={x} x1={x} y1={28 - (i % 2) * 4} x2={x} y2={36 + (i % 2) * 4} stroke="currentColor" strokeWidth="1.1" opacity="0.5" />
            ))}
          </MedalSvg>
        ),
        frieze: (
          <SymFrieze
            left={
              <>
                <path {...S} strokeWidth="1.35" d="M-10 -8 L-50 0 L-10 8 M-70 -8 L-110 0 L-70 8 M-130 -6 L-160 0 L-130 6" />
                <line x1="-10" y1="0" x2="-170" y2="0" stroke="currentColor" strokeWidth="0.8" opacity="0.35" />
              </>
            }
          />
        ),
        corner: (
          <CornerSvg>
            <path {...S} strokeWidth="1.4" d="M18 14 L40 30 L18 46 M62 14 L40 30 L62 46" />
            <line x1="22" y1="30" x2="58" y2="30" stroke="currentColor" strokeWidth="1.1" opacity="0.5" />
          </CornerSvg>
        ),
      };

    case "chip":
      return {
        rail: "pulse",
        medal: (
          <MedalSvg frame="square">
            <path {...S} strokeWidth="1.8" d="M10 40 V28 H22 V40 H34 V20 H46 V40 H54" />
            {[0, 1, 2, 3, 4].map((i) => (
              <rect key={i} x={12 + i * 8} y={44 - (i % 3) * 6} width="6" height="5" fill="currentColor" opacity={0.35 + i * 0.08} rx="0.6" />
            ))}
          </MedalSvg>
        ),
        frieze: (
          <SymFrieze
            left={
              <>
                {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
                  <rect key={i} x={-14 - i * 20} y={-7} width="14" height="14" fill="currentColor" opacity={i % 2 ? 0.55 : 0.18} rx="1" />
                ))}
              </>
            }
          />
        ),
        corner: (
          <CornerSvg>
            <path {...S} strokeWidth="1.5" d="M16 40 V28 H28 V40 H40 V22 H52 V40 H64" />
            {[0, 1, 2, 3].map((i) => (
              <rect key={i} x={20 + i * 10} y={12 + (i % 2) * 4} width="7" height="7" fill="currentColor" opacity={0.35 + i * 0.1} rx="0.8" />
            ))}
          </CornerSvg>
        ),
      };

    case "noise":
      return {
        rail: "grain",
        medal: (
          <MedalSvg frame="oct">
            {Array.from({ length: 32 }, (_, i) => {
              const a = (i / 32) * Math.PI * 2;
              const r = 5 + ((i * 11) % 18);
              return <circle key={i} cx={32 + Math.cos(a) * r} cy={32 + Math.sin(a) * r} r={0.9 + (i % 3) * 0.6} fill="currentColor" opacity={0.35 + (i % 5) * 0.1} />;
            })}
          </MedalSvg>
        ),
        frieze: (
          <SymFrieze
            left={
              <>
                {Array.from({ length: 22 }, (_, i) => (
                  <circle key={i} cx={-10 - i * 7.5} cy={(i % 5) * 3 - 6} r={1 + (i % 3) * 0.7} fill="currentColor" opacity={0.4 + (i % 4) * 0.1} />
                ))}
              </>
            }
          />
        ),
        corner: (
          <CornerSvg>
            {Array.from({ length: 16 }, (_, i) => (
              <circle key={i} cx={18 + (i * 17) % 48} cy={12 + (i * 23) % 36} r={1.2 + (i % 3) * 0.7} fill="currentColor" opacity={0.4 + (i % 4) * 0.1} />
            ))}
          </CornerSvg>
        ),
      };

    case "sub":
      return {
        rail: "bead",
        medal: (
          <MedalSvg frame="shield">
            {/* Tectonic — fat fundamental + octave partials */}
            <ellipse cx="32" cy="38" rx="22" ry="12" {...S} strokeWidth="1.6" />
            <ellipse cx="32" cy="38" rx="12" ry="6" {...S} strokeWidth="1.1" opacity="0.5" />
            <path {...S} strokeWidth="1.8" d="M10 38 C18 30, 26 46, 32 38 S42 30, 54 38" opacity="0.7" />
            <line x1="32" y1="14" x2="32" y2="26" stroke="currentColor" strokeWidth="2" opacity="0.55" />
            <text x="32" y="16" textAnchor="middle" fill="currentColor" fontSize="7" fontWeight="700" opacity="0.45">SUB</text>
          </MedalSvg>
        ),
        frieze: (
          <SymFrieze
            left={
              <>
                <ellipse cx="-90" cy="0" rx="70" ry="10" {...S} strokeWidth="1.4" opacity="0.65" />
                <path {...S} strokeWidth="1.3" d="M-30 0 C-50 -6, -70 6, -90 0 S-130 -6, -150 0" opacity="0.55" />
              </>
            }
          />
        ),
        corner: (
          <CornerSvg>
            <ellipse cx="42" cy="34" rx="24" ry="12" {...S} strokeWidth="1.4" />
            <path {...S} strokeWidth="1.3" d="M22 34 C30 26, 36 42, 42 34 S52 26, 62 34" opacity="0.65" />
          </CornerSvg>
        ),
      };

    /* ── Tone ── */
    case "mixer.unison":
      return {
        rail: "chevron",
        medal: (
          <MedalSvg frame="hex">
            {[-36, -22, -10, 0, 10, 22, 36].map((a, i) => {
              const rad = (a * Math.PI) / 180;
              return (
                <line
                  key={a}
                  x1="32"
                  y1="48"
                  x2={32 + Math.sin(rad) * 22}
                  y2={48 - Math.cos(rad) * 22}
                  stroke="currentColor"
                  strokeWidth={i === 3 ? 2.1 : 1.1}
                  opacity={i === 3 ? 0.9 : 0.42}
                />
              );
            })}
          </MedalSvg>
        ),
        frieze: (
          <SymFrieze
            left={
              <>
                {[-20, -48, -76, -104, -132].map((x, i) => (
                  <line key={x} x1={x} y1="9" x2={x * 0.25} y2="-9" stroke="currentColor" strokeWidth={i === 2 ? 1.7 : 1.2} opacity="0.6" />
                ))}
              </>
            }
          />
        ),
        corner: (
          <CornerSvg>
            {[-28, -14, 0, 14, 28].map((a, i) => {
              const rad = (a * Math.PI) / 180;
              return <line key={a} x1="36" y1="44" x2={36 + Math.sin(rad) * 28} y2={44 - Math.cos(rad) * 28} stroke="currentColor" strokeWidth={i === 2 ? 1.7 : 1} opacity={i === 2 ? 0.85 : 0.4} />;
            })}
          </CornerSvg>
        ),
      };

    case "analog.life":
      return {
        rail: "sine",
        medal: (
          <MedalSvg frame="ring">
            {/* Organic Life — ECG pulse + slow drift, not circle-cluster */}
            <path
              {...S}
              strokeWidth="1.9"
              d="M6 34 H16 L20 34 L24 14 L28 50 L32 34 H42 L46 26 L50 34 H58"
            />
            <path {...S} strokeWidth="0.8" d="M8 42 C20 46, 36 40, 56 44" opacity="0.35" />
            <circle cx="48" cy="18" r="3" fill="currentColor" opacity="0.4" />
            <text x="32" y="58" textAnchor="middle" fill="currentColor" fontSize="6" opacity="0.4">LIFE</text>
          </MedalSvg>
        ),
        frieze: (
          <SymFrieze
            left={
              <path
                {...S}
                strokeWidth="1.45"
                d="M-6 2 H-28 L-36 2 L-44 -12 L-52 14 L-60 2 H-88 L-96 -6 L-104 2 H-140 L-148 8 L-156 2 H-170"
              />
            }
          />
        ),
        corner: (
          <CornerSvg>
            <path {...S} strokeWidth="1.5" d="M14 30 H24 L28 30 L32 12 L36 44 L40 30 H52 L56 22 L60 30 H66" />
          </CornerSvg>
        ),
      };

    case "filter":
      return {
        rail: "pulse",
        medal: (
          <MedalSvg frame="square">
            {/* Spectral blade — LP shelf with resonance peak */}
            <path {...S} strokeWidth="2" d="M8 46 H18 Q24 46 28 38 L34 12 L40 38 Q44 46 50 46 H56" />
            <line x1="34" y1="12" x2="34" y2="50" stroke="currentColor" strokeWidth="0.65" strokeDasharray="2 2.5" opacity="0.4" />
            <circle cx="34" cy="12" r="2.4" fill="currentColor" opacity="0.7" />
            <text x="32" y="58" textAnchor="middle" fill="currentColor" fontSize="7" opacity="0.45">CUT</text>
          </MedalSvg>
        ),
        frieze: (
          <SymFrieze left={<path {...S} strokeWidth="1.7" d="M-6 6 H-40 Q-58 6 -70 -2 L-88 -10 L-102 2 Q-118 8 -170 6" />} />
        ),
        corner: (
          <CornerSvg>
            <path {...S} strokeWidth="1.55" d="M16 42 H28 Q34 42 38 34 L46 14 L52 34 Q56 42 66 42" />
            <circle cx="46" cy="14" r="2.2" fill="currentColor" opacity="0.65" />
          </CornerSvg>
        ),
      };

    case "env.amp":
      return {
        rail: "pulse",
        medal: (
          <MedalSvg frame="square">
            {/* Breath contour — classic ADSR silhouette */}
            <path {...S} strokeWidth="1.9" d="M8 48 L16 12 H22 L32 28 H42 L52 48" />
            <path d="M8 48 L16 12 H22 L32 28 H42 L52 48 Z" fill="currentColor" opacity="0.14" />
            {[
              [12, "A"],
              [24, "D"],
              [36, "S"],
              [48, "R"],
            ].map(([x, t]) => (
              <text key={String(t)} x={x as number} y="58" textAnchor="middle" fill="currentColor" fontSize="6" opacity="0.42">{t as string}</text>
            ))}
          </MedalSvg>
        ),
        frieze: (
          <SymFrieze left={<path {...S} strokeWidth="1.55" d="M-6 8 L-30 -8 H-48 L-78 2 H-120 L-170 8" />} />
        ),
        corner: (
          <CornerSvg>
            <path {...S} strokeWidth="1.5" d="M16 42 L26 12 H32 L42 28 H52 L64 42" />
            <path d="M16 42 L26 12 H32 L42 28 H52 L64 42 Z" fill="currentColor" opacity="0.1" />
          </CornerSvg>
        ),
      };

    case "env.mod":
      return {
        rail: "chevron",
        medal: (
          <MedalSvg frame="diamond">
            {/* Morph weaver — multi-breakpoint editable curve */}
            <path {...S} strokeWidth="1.7" d="M10 44 L18 20 L28 36 L38 14 L48 40 L56 28" />
            {[[18, 20], [28, 36], [38, 14], [48, 40]].map(([x, y], i) => (
              <circle key={i} cx={x} cy={y} r="2.6" fill="currentColor" opacity="0.55" />
            ))}
            <text x="32" y="56" textAnchor="middle" fill="currentColor" fontSize="6" opacity="0.4">MORPH</text>
          </MedalSvg>
        ),
        frieze: (
          <SymFrieze
            left={
              <>
                <path {...S} strokeWidth="1.4" d="M-6 6 L-30 -6 L-52 4 L-78 -8 L-110 2 L-140 -4 L-170 6" />
                {[-30, -78, -140].map((x) => (
                  <circle key={x} cx={x} cy={x === -78 ? -8 : x === -30 ? -6 : -4} r="2.2" fill="currentColor" opacity="0.5" />
                ))}
              </>
            }
          />
        ),
        corner: (
          <CornerSvg>
            <path {...S} strokeWidth="1.4" d="M16 40 L26 16 L36 32 L46 12 L58 36 L66 24" />
            {[[26, 16], [36, 32], [46, 12]].map(([x, y], i) => (
              <circle key={i} cx={x} cy={y} r="2.3" fill="currentColor" opacity="0.5" />
            ))}
          </CornerSvg>
        ),
      };

    case "env.filt":
      return {
        rail: "saw",
        medal: (
          <MedalSvg frame="hex">
            {/* Cutoff sweep — rising blade with hold + fall */}
            <path {...S} strokeWidth="1.85" d="M8 46 L14 46 L24 14 H38 L48 40 H56" />
            <path {...S} strokeWidth="1" d="M24 14 L24 46" opacity="0.3" strokeDasharray="2 2" />
            <circle cx="24" cy="14" r="2.8" fill="currentColor" opacity="0.7" />
            <text x="32" y="56" textAnchor="middle" fill="currentColor" fontSize="6.5" opacity="0.4">FLT</text>
          </MedalSvg>
        ),
        frieze: (
          <SymFrieze left={<path {...S} strokeWidth="1.5" d="M-6 8 L-24 8 L-56 -8 H-100 L-130 4 H-170" />} />
        ),
        corner: (
          <CornerSvg>
            <path {...S} strokeWidth="1.45" d="M16 40 L22 40 L34 12 H48 L58 34 H66" />
            <circle cx="34" cy="12" r="2.4" fill="currentColor" opacity="0.65" />
          </CornerSvg>
        ),
      };

    case "pluck":
      return {
        rail: "gate",
        medal: (
          <MedalSvg frame="oct">
            {/* Vactrol strike — LED → LDR + plucked string decay (no stars) */}
            <circle cx="18" cy="20" r="5" {...S} strokeWidth="1.4" />
            <circle cx="18" cy="20" r="2" fill="currentColor" opacity="0.55" />
            <path {...S} strokeWidth="1.1" d="M23 20 H30" opacity="0.5" />
            <rect x="30" y="15" width="10" height="10" rx="1.5" {...S} strokeWidth="1.2" opacity="0.7" />
            {/* String */}
            <line x1="12" y1="40" x2="52" y2="40" stroke="currentColor" strokeWidth="1.3" opacity="0.55" />
            {/* Strike hammer */}
            <path {...S} strokeWidth="1.5" d="M32 28 V38" />
            <path {...S} strokeWidth="1.3" d="M28 28 H36" />
            {/* Exponential decay trail */}
            <path {...S} strokeWidth="1.6" d="M14 48 L22 34 H26 L34 42 H42 L52 48" opacity="0.75" />
            <text x="32" y="58" textAnchor="middle" fill="currentColor" fontSize="6" opacity="0.4">LPG</text>
          </MedalSvg>
        ),
        frieze: (
          <SymFrieze
            left={
              <>
                <line x1="-10" y1="4" x2="-170" y2="4" stroke="currentColor" strokeWidth="1.1" opacity="0.4" />
                <path {...S} strokeWidth="1.5" d="M-20 8 L-40 -6 H-52 L-72 4 H-100 L-130 8 L-170 8" />
                <path {...S} strokeWidth="1.2" d="M-88 -10 V2" />
                <path {...S} strokeWidth="1" d="M-94 -10 H-82" />
              </>
            }
          />
        ),
        corner: (
          <CornerSvg>
            <circle cx="24" cy="16" r="4.5" {...S} strokeWidth="1.2" />
            <circle cx="24" cy="16" r="1.8" fill="currentColor" opacity="0.5" />
            <rect x="34" y="12" width="8" height="8" rx="1" {...S} strokeWidth="1.1" />
            <line x1="18" y1="36" x2="60" y2="36" stroke="currentColor" strokeWidth="1.15" opacity="0.5" />
            <path {...S} strokeWidth="1.4" d="M22 44 L30 28 H34 L42 38 H52 L62 44" />
          </CornerSvg>
        ),
      };

    /* ── Mod ── */
    case "lfo.1":
      return {
        rail: "sine",
        medal: (
          <MedalSvg frame="ring">
            {/* Primary cyclic — phase dial + sine */}
            <circle cx="32" cy="32" r="18" {...S} strokeWidth="1.1" opacity="0.35" />
            <line x1="32" y1="32" x2="32" y2="16" stroke="currentColor" strokeWidth="1.6" opacity="0.75" />
            <circle cx="32" cy="16" r="2.2" fill="currentColor" opacity="0.7" />
            <path {...S} strokeWidth="1.6" d="M8 48 C14 40, 20 56, 26 48 S36 40, 42 48 S50 56, 56 48" opacity="0.85" />
            <text x="32" y="12" textAnchor="middle" fill="currentColor" fontSize="6.5" fontWeight="700" opacity="0.5">LFO1</text>
          </MedalSvg>
        ),
        frieze: (
          <SymFrieze
            left={
              <>
                <path {...S} strokeWidth="1.55" d="M-6 2 C-30 -8, -50 10, -74 2 S-110 -8, -134 2 S-160 10, -170 2" />
                <circle cx="-90" cy="-8" r="3" {...S} strokeWidth="0.9" opacity="0.5" />
                <line x1="-90" y1="-8" x2="-90" y2="2" stroke="currentColor" strokeWidth="0.9" opacity="0.45" />
              </>
            }
          />
        ),
        corner: (
          <CornerSvg>
            <circle cx="40" cy="24" r="12" {...S} strokeWidth="1.1" opacity="0.4" />
            <line x1="40" y1="24" x2="40" y2="14" stroke="currentColor" strokeWidth="1.4" />
            <path {...S} strokeWidth="1.35" d="M16 42 C24 34, 30 48, 38 40 S50 34, 60 42" />
          </CornerSvg>
        ),
      };

    case "lfo.2":
      return {
        rail: "saw",
        medal: (
          <MedalSvg frame="hex">
            {/* Twin orbit — mirrored / inverted companion */}
            <path {...S} strokeWidth="1.7" d="M8 28 L18 16 L28 28 L38 16 L48 28 L56 16" opacity="0.85" />
            <path {...S} strokeWidth="1.35" d="M8 40 L18 52 L28 40 L38 52 L48 40 L56 52" opacity="0.5" />
            <line x1="8" y1="34" x2="56" y2="34" stroke="currentColor" strokeWidth="0.5" opacity="0.3" />
            <text x="32" y="12" textAnchor="middle" fill="currentColor" fontSize="6.5" fontWeight="700" opacity="0.5">LFO2</text>
          </MedalSvg>
        ),
        frieze: (
          <SymFrieze
            left={
              <>
                <path {...S} strokeWidth="1.4" d="M-6 -4 L-30 6 L-54 -4 L-78 6 L-102 -4 L-126 6 L-150 -4 L-170 0" />
                <path {...S} strokeWidth="1.1" d="M-6 8 L-30 -2 L-54 8 L-78 -2 L-102 8 L-126 -2 L-150 8 L-170 4" opacity="0.45" />
              </>
            }
          />
        ),
        corner: (
          <CornerSvg>
            <path {...S} strokeWidth="1.4" d="M14 22 L26 12 L38 22 L50 12 L64 22" />
            <path {...S} strokeWidth="1.15" d="M14 36 L26 46 L38 36 L50 46 L64 36" opacity="0.5" />
          </CornerSvg>
        ),
      };

    case "fm":
      return {
        rail: "sine",
        medal: (
          <MedalSvg frame="oct">
            {/* Carrier + modulator sidebands */}
            <circle cx="22" cy="34" r="9" {...S} strokeWidth="1.5" />
            <path {...S} strokeWidth="1.5" d="M34 34 C40 18, 48 18, 54 34 C48 50, 40 50, 34 34" opacity="0.75" />
            <path {...S} strokeWidth="0.9" d="M22 34 L40 24 M22 34 L40 44" opacity="0.4" />
            <text x="32" y="14" textAnchor="middle" fill="currentColor" fontSize="7" fontWeight="700" opacity="0.5">FM</text>
          </MedalSvg>
        ),
        frieze: (
          <SymFrieze
            left={
              <>
                <circle cx="-36" r="6" {...S} strokeWidth="1.15" />
                <path {...S} strokeWidth="1.2" d="M-52 0 C-64 -10, -76 -10, -88 0 C-76 10, -64 10, -52 0" opacity="0.65" />
                <circle cx="-120" r="5" {...S} strokeWidth="1" opacity="0.5" />
                <path {...S} strokeWidth="1" d="M-134 0 C-144 -8, -154 -8, -164 0 C-154 8, -144 8, -134 0" opacity="0.4" />
              </>
            }
          />
        ),
        corner: (
          <CornerSvg>
            <circle cx="28" cy="28" r="8" {...S} strokeWidth="1.3" />
            <path {...S} strokeWidth="1.3" d="M40 28 C46 14, 54 14, 60 28 C54 42, 46 42, 40 28" opacity="0.7" />
          </CornerSvg>
        ),
      };

    case "fm.rack":
      return {
        rail: "ladder",
        medal: (
          <MedalSvg frame="diamond">
            {/* Vector lattice pad — 4 corners + crosshair */}
            <rect x="16" y="16" width="32" height="32" rx="2" {...S} strokeWidth="1.3" opacity="0.55" />
            <line x1="16" y1="32" x2="48" y2="32" stroke="currentColor" strokeWidth="0.7" opacity="0.4" />
            <line x1="32" y1="16" x2="32" y2="48" stroke="currentColor" strokeWidth="0.7" opacity="0.4" />
            {[[18, 18], [46, 18], [18, 46], [46, 46]].map(([x, y], i) => (
              <circle key={i} cx={x} cy={y} r="3.2" fill="currentColor" opacity="0.55" />
            ))}
            <circle cx="38" cy="26" r="2.5" fill="currentColor" opacity="0.75" />
            <text x="32" y="58" textAnchor="middle" fill="currentColor" fontSize="6" opacity="0.4">VEC</text>
          </MedalSvg>
        ),
        frieze: (
          <SymFrieze
            left={
              <>
                <rect x="-100" y="-8" width="60" height="16" rx="1.5" {...S} strokeWidth="1.1" opacity="0.5" />
                <line x1="-100" y1="0" x2="-40" y2="0" stroke="currentColor" strokeWidth="0.55" opacity="0.35" />
                <line x1="-70" y1="-8" x2="-70" y2="8" stroke="currentColor" strokeWidth="0.55" opacity="0.35" />
                {[[-96, -4], [-44, -4], [-96, 4], [-44, 4]].map(([x, y], i) => (
                  <circle key={i} cx={x} cy={y} r="2" fill="currentColor" opacity="0.5" />
                ))}
                <circle cx="-58" cy="-2" r="1.8" fill="currentColor" opacity="0.65" />
              </>
            }
          />
        ),
        corner: (
          <CornerSvg>
            <rect x="22" y="12" width="30" height="30" rx="2" {...S} strokeWidth="1.2" />
            {[[24, 14], [50, 14], [24, 40], [50, 40]].map(([x, y], i) => (
              <circle key={i} cx={x} cy={y} r="2.5" fill="currentColor" opacity="0.5" />
            ))}
            <circle cx="40" cy="24" r="2.2" fill="currentColor" opacity="0.7" />
          </CornerSvg>
        ),
      };

    case "pitch":
      return {
        rail: "chevron",
        medal: (
          <MedalSvg frame="shield">
            <path {...S} strokeWidth="1.9" d="M10 44 C22 44, 28 44, 36 22 S48 12, 56 12" />
            <polygon points="50,8 58,12 50,16" fill="currentColor" opacity="0.7" />
            <text x="32" y="56" textAnchor="middle" fill="currentColor" fontSize="6.5" opacity="0.4">GLIDE</text>
          </MedalSvg>
        ),
        frieze: (
          <SymFrieze
            left={
              <>
                <path {...S} strokeWidth="1.45" d="M-6 6 C-50 6, -80 6, -115 -6 S-160 -8, -170 -8" />
                <polygon points="-168,-12 -160,-8 -168,-4" fill="currentColor" opacity="0.55" />
              </>
            }
          />
        ),
        corner: (
          <CornerSvg>
            <path {...S} strokeWidth="1.5" d="M14 40 C30 40, 38 40, 48 18 S58 10, 66 10" />
            <polygon points="62,6 68,10 62,14" fill="currentColor" opacity="0.6" />
          </CornerSvg>
        ),
      };

    case "matrix":
      return {
        rail: "bead",
        medal: (
          <MedalSvg frame="square">
            {[18, 32, 46].map((x) =>
              [18, 32, 46].map((y) => (
                <circle key={`${x}-${y}`} cx={x} cy={y} r="3.2" fill="currentColor" opacity="0.55" />
              )),
            )}
            <path {...S} strokeWidth="1" d="M18 18 H46 M18 32 H46 M18 46 H46 M18 18 V46 M32 18 V46 M46 18 V46" opacity="0.35" />
          </MedalSvg>
        ),
        frieze: (
          <SymFrieze
            left={
              <>
                {[-24, -56, -88, -120, -152].map((x) => (
                  <circle key={x} cx={x} r="3.2" fill="currentColor" opacity="0.55" />
                ))}
                <path {...S} strokeWidth="0.8" d="M-24 0 H-152" opacity="0.35" />
              </>
            }
          />
        ),
        corner: (
          <CornerSvg>
            {[24, 40, 56].map((x) =>
              [16, 30, 44].map((y) => (
                <circle key={`${x}-${y}`} cx={x} cy={y} r="2.8" fill="currentColor" opacity="0.5" />
              )),
            )}
          </CornerSvg>
        ),
      };

    case "arp":
      return {
        rail: "ladder",
        medal: (
          <MedalSvg frame="square">
            {/* Cascade orbit — ascending stairs around a spiral hint */}
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <rect
                key={i}
                x={12 + i * 7}
                y={44 - i * 5}
                width="5.5"
                height={6 + i * 5}
                fill="currentColor"
                opacity={0.3 + i * 0.08}
                rx="0.8"
              />
            ))}
            <path {...S} strokeWidth="1.2" d="M14 18 Q32 8 50 18" opacity="0.45" />
            <path {...S} strokeWidth="0.9" d="M18 22 Q32 14 46 22" opacity="0.3" />
            <text x="32" y="12" textAnchor="middle" fill="currentColor" fontSize="6.5" fontWeight="700" opacity="0.5">ARP</text>
          </MedalSvg>
        ),
        frieze: (
          <SymFrieze
            left={
              <>
                {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
                  <rect
                    key={i}
                    x={-14 - i * 19}
                    y={4 - i * 1.2}
                    width="10"
                    height={6 + i * 1.5}
                    fill="currentColor"
                    opacity={0.25 + (i % 5) * 0.08}
                    rx="1"
                  />
                ))}
              </>
            }
          />
        ),
        corner: (
          <CornerSvg>
            {[0, 1, 2, 3, 4].map((i) => (
              <rect key={i} x={20 + i * 8} y={38 - i * 5} width="6" height={8 + i * 5} fill="currentColor" opacity={0.3 + i * 0.08} rx="0.7" />
            ))}
          </CornerSvg>
        ),
      };

    /* ── FX ── */
    case "fx.drive":
      return {
        rail: "saw",
        medal: (
          <MedalSvg frame="oct">
            {/* Shape crucible — soft sine into hard clip / fold */}
            <path {...S} strokeWidth="1.5" d="M8 40 C16 22, 22 22, 28 40" opacity="0.4" />
            <path {...S} strokeWidth="2" d="M28 40 V24 H36 V40 H44 V24 H52" />
            <path {...S} strokeWidth="1.2" d="M28 24 L32 18 L36 24 M44 24 L48 18 L52 24" opacity="0.55" />
            <text x="32" y="54" textAnchor="middle" fill="currentColor" fontSize="7" fontWeight="700" opacity="0.5">DRV</text>
          </MedalSvg>
        ),
        frieze: (
          <SymFrieze
            left={
              <path
                {...S}
                strokeWidth="1.5"
                d="M-6 4 C-24 -8, -36 -8, -48 4 V-6 H-64 V4 H-80 V-6 H-96 V4 C-120 -6, -140 -6, -170 4"
              />
            }
          />
        ),
        corner: (
          <CornerSvg>
            <path {...S} strokeWidth="1.2" d="M16 36 C24 22, 28 22, 34 36" opacity="0.4" />
            <path {...S} strokeWidth="1.6" d="M34 36 V22 H42 V36 H50 V22 H58" />
          </CornerSvg>
        ),
      };

    case "fx.vintage":
      return {
        rail: "bead",
        medal: (
          <MedalSvg frame="ring">
            {/* Oxide archive — twin tape reels + oxide dust */}
            <circle cx="20" cy="32" r="12" {...S} strokeWidth="1.5" />
            <circle cx="44" cy="32" r="12" {...S} strokeWidth="1.5" />
            <circle cx="20" cy="32" r="3.5" fill="currentColor" opacity="0.35" />
            <circle cx="44" cy="32" r="3.5" fill="currentColor" opacity="0.35" />
            <path {...S} strokeWidth="1.1" d="M28 26 H36 M28 38 H36" opacity="0.45" />
            {[12, 52].map((x, i) => (
              <circle key={x} cx={x} cy={18 + i * 4} r="1.3" fill="currentColor" opacity="0.4" />
            ))}
            <text x="32" y="56" textAnchor="middle" fill="currentColor" fontSize="6.5" opacity="0.4">AGE</text>
          </MedalSvg>
        ),
        frieze: (
          <SymFrieze
            left={
              <>
                <circle cx="-40" r="9" {...S} strokeWidth="1.2" />
                <circle cx="-68" r="9" {...S} strokeWidth="1.2" />
                <circle cx="-40" r="2.8" fill="currentColor" opacity="0.35" />
                <circle cx="-68" r="2.8" fill="currentColor" opacity="0.35" />
                <path {...S} strokeWidth="0.9" d="M-52 -4 H-56 M-52 4 H-56" opacity="0.4" />
                <circle cx="-120" r="7" {...S} strokeWidth="1" opacity="0.45" />
                <circle cx="-144" r="7" {...S} strokeWidth="1" opacity="0.45" />
              </>
            }
          />
        ),
        corner: (
          <CornerSvg>
            <circle cx="30" cy="28" r="11" {...S} strokeWidth="1.3" />
            <circle cx="50" cy="28" r="11" {...S} strokeWidth="1.3" />
            <circle cx="30" cy="28" r="3" fill="currentColor" opacity="0.3" />
            <circle cx="50" cy="28" r="3" fill="currentColor" opacity="0.3" />
          </CornerSvg>
        ),
      };

    case "fx.phaser":
      return {
        rail: "sine",
        medal: (
          <MedalSvg frame="hex">
            {/* Sweep veil — stacked allpass notches */}
            {[0, 1, 2, 3].map((i) => (
              <path
                key={i}
                {...S}
                strokeWidth="1.25"
                d={`M8 ${22 + i * 8} H${18 + i * 2} L${24 + i * 2} ${16 + i * 6} L${30 + i * 2} ${28 + i * 6} H56`}
                opacity={0.4 + i * 0.12}
              />
            ))}
            <text x="32" y="14" textAnchor="middle" fill="currentColor" fontSize="6" opacity="0.4">PHS</text>
          </MedalSvg>
        ),
        frieze: (
          <SymFrieze
            left={
              <>
                {[0, 1, 2].map((i) => (
                  <path
                    key={i}
                    {...S}
                    strokeWidth="1.1"
                    d={`M-6 ${-4 + i * 5} H${-40 - i * 4} L${-55 - i * 4} ${-10 + i * 4} L${-70 - i * 4} ${2 + i * 4} H-170`}
                    opacity={0.4 + i * 0.15}
                  />
                ))}
              </>
            }
          />
        ),
        corner: (
          <CornerSvg>
            {[0, 1, 2].map((i) => (
              <path
                key={i}
                {...S}
                strokeWidth="1.15"
                d={`M14 ${20 + i * 9} H${26 + i} L${34 + i} ${14 + i * 7} L${42 + i} ${26 + i * 7} H64`}
                opacity={0.45 + i * 0.12}
              />
            ))}
          </CornerSvg>
        ),
      };

    case "fx.chorus":
      return {
        rail: "chevron",
        medal: (
          <MedalSvg frame="ring">
            {/* Ensemble drift — three detuned voice stems */}
            {[0, 1, 2].map((i) => (
              <path
                key={i}
                {...S}
                strokeWidth="1.45"
                d={`M${14 + i * 10} 46 C${18 + i * 10} ${28 - i * 4}, ${22 + i * 10} ${28 - i * 4}, ${26 + i * 10} 46`}
                opacity={0.75 - i * 0.15}
              />
            ))}
            <path {...S} strokeWidth="0.8" d="M12 50 H52" opacity="0.3" />
            <text x="32" y="16" textAnchor="middle" fill="currentColor" fontSize="6" opacity="0.4">ENS</text>
          </MedalSvg>
        ),
        frieze: (
          <SymFrieze
            left={
              <>
                {[0, 1, 2].map((i) => (
                  <path
                    key={i}
                    {...S}
                    strokeWidth="1.2"
                    d={`M${-20 - i * 8} 8 C${-50 - i * 6} ${-6 - i * 2}, ${-90 - i * 6} ${-6 - i * 2}, ${-120 - i * 8} 8`}
                    opacity={0.6 - i * 0.12}
                  />
                ))}
              </>
            }
          />
        ),
        corner: (
          <CornerSvg>
            {[0, 1, 2].map((i) => (
              <path
                key={i}
                {...S}
                strokeWidth="1.25"
                d={`M${22 + i * 10} 42 C${26 + i * 10} ${24 - i * 3}, ${30 + i * 10} ${24 - i * 3}, ${34 + i * 10} 42`}
                opacity={0.7 - i * 0.12}
              />
            ))}
          </CornerSvg>
        ),
      };

    case "fx.delay":
      return {
        rail: "bead",
        medal: (
          <MedalSvg frame="diamond">
            {/* Ping cascade — bouncing echo path */}
            <path {...S} strokeWidth="1.6" d="M10 40 L20 18 L30 40 L40 18 L50 40" />
            {[20, 30, 40].map((x, i) => (
              <circle key={x} cx={x} cy={i % 2 ? 40 : 18} r={3.5 - i * 0.4} fill="currentColor" opacity={0.55 - i * 0.08} />
            ))}
            <text x="32" y="54" textAnchor="middle" fill="currentColor" fontSize="6.5" opacity="0.4">ECHO</text>
          </MedalSvg>
        ),
        frieze: (
          <SymFrieze
            left={
              <>
                <path {...S} strokeWidth="1.35" d="M-6 4 L-28 -6 L-50 4 L-72 -6 L-94 4 L-116 -6 L-138 4 L-160 -4 L-170 0" />
                {[-28, -72, -116].map((x, i) => (
                  <circle key={x} cx={x} cy={-6} r={3 - i * 0.4} fill="currentColor" opacity={0.5 - i * 0.08} />
                ))}
              </>
            }
          />
        ),
        corner: (
          <CornerSvg>
            <path {...S} strokeWidth="1.4" d="M16 38 L28 16 L40 38 L52 16 L64 38" />
            <circle cx="28" cy="16" r="2.8" fill="currentColor" opacity="0.55" />
            <circle cx="52" cy="16" r="2.2" fill="currentColor" opacity="0.4" />
          </CornerSvg>
        ),
      };

    case "fx.reverb":
      return {
        rail: "spark",
        medal: (
          <MedalSvg frame="shield">
            {/* Halo vault — room arches, not concentric rings */}
            <path {...S} strokeWidth="1.5" d="M12 48 V28 Q12 12 32 12 Q52 12 52 28 V48" />
            <path {...S} strokeWidth="1.1" d="M18 48 V30 Q18 18 32 18 Q46 18 46 30 V48" opacity="0.5" />
            <path {...S} strokeWidth="0.9" d="M24 48 V34 Q24 24 32 24 Q40 24 40 34 V48" opacity="0.35" />
            <line x1="12" y1="48" x2="52" y2="48" stroke="currentColor" strokeWidth="1.2" opacity="0.55" />
            <text x="32" y="58" textAnchor="middle" fill="currentColor" fontSize="6" opacity="0.4">VAULT</text>
          </MedalSvg>
        ),
        frieze: (
          <SymFrieze
            left={
              <>
                <path {...S} strokeWidth="1.3" d="M-30 8 V-2 Q-30 -10 -60 -10 Q-90 -10 -90 -2 V8" />
                <path {...S} strokeWidth="1" d="M-110 8 V0 Q-110 -6 -135 -6 Q-160 -6 -160 0 V8" opacity="0.5" />
                <line x1="-30" y1="8" x2="-90" y2="8" stroke="currentColor" strokeWidth="0.9" opacity="0.4" />
              </>
            }
          />
        ),
        corner: (
          <CornerSvg>
            <path {...S} strokeWidth="1.35" d="M20 42 V24 Q20 12 40 12 Q60 12 60 24 V42" />
            <path {...S} strokeWidth="1" d="M28 42 V26 Q28 18 40 18 Q52 18 52 26 V42" opacity="0.45" />
            <line x1="20" y1="42" x2="60" y2="42" stroke="currentColor" strokeWidth="1.1" opacity="0.5" />
          </CornerSvg>
        ),
      };

    case "fx.spectral":
      return {
        rail: "ladder",
        medal: (
          <MedalSvg frame="square">
            {/* Bin lattice — FFT bars with frequency axis */}
            {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
              <rect
                key={i}
                x={12 + i * 5.5}
                y={46 - (6 + ((i * 17) % 30))}
                width="4"
                height={6 + ((i * 17) % 30)}
                fill="currentColor"
                opacity={0.28 + (i % 5) * 0.1}
                rx="0.5"
              />
            ))}
            <line x1="10" y1="48" x2="54" y2="48" stroke="currentColor" strokeWidth="0.8" opacity="0.4" />
            <text x="32" y="12" textAnchor="middle" fill="currentColor" fontSize="6.5" opacity="0.4">FFT</text>
          </MedalSvg>
        ),
        frieze: (
          <SymFrieze
            left={
              <>
                {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => (
                  <rect
                    key={i}
                    x={-12 - i * 15}
                    y={-2}
                    width="8"
                    height={4 + ((i * 11) % 12)}
                    fill="currentColor"
                    opacity={0.3 + (i % 4) * 0.1}
                    rx="0.7"
                    transform={`translate(0 ${-((4 + ((i * 11) % 12)) / 2)})`}
                  />
                ))}
              </>
            }
          />
        ),
        corner: (
          <CornerSvg>
            {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
              <rect
                key={i}
                x={16 + i * 6.5}
                y={44 - (6 + ((i * 19) % 28))}
                width="5"
                height={6 + ((i * 19) % 28)}
                fill="currentColor"
                opacity={0.28 + (i % 5) * 0.08}
                rx="0.5"
              />
            ))}
          </CornerSvg>
        ),
      };

    /* ── Mix ── */
    case "mixer":
      return {
        rail: "ladder",
        medal: (
          <MedalSvg frame="square">
            {[0, 1, 2, 3].map((i) => (
              <g key={i}>
                <rect x={13 + i * 10} y="12" width="7" height="40" rx="1.5" {...S} strokeWidth="1.15" opacity="0.6" />
                <rect x={11 + i * 10} y={18 + i * 6} width="11" height="6" rx="1.2" fill="currentColor" opacity="0.55" />
              </g>
            ))}
          </MedalSvg>
        ),
        frieze: (
          <SymFrieze
            left={
              <>
                {[0, 1, 2, 3, 4].map((i) => (
                  <g key={i}>
                    <rect x={-20 - i * 30} y={-11} width="8" height="22" rx="1.4" {...S} strokeWidth="1.05" opacity="0.55" />
                    <rect x={-22 - i * 30} y={-3 + (i % 3) * 3} width="12" height="5" rx="1" fill="currentColor" opacity="0.45" />
                  </g>
                ))}
              </>
            }
          />
        ),
        corner: (
          <CornerSvg>
            {[0, 1, 2].map((i) => (
              <g key={i}>
                <rect x={22 + i * 14} y="12" width="8" height="36" rx="1.4" {...S} strokeWidth="1.1" opacity="0.55" />
                <rect x={20 + i * 14} y={18 + i * 5} width="12" height="5" rx="1" fill="currentColor" opacity="0.5" />
              </g>
            ))}
          </CornerSvg>
        ),
      };

    case "morph":
      return {
        rail: "chevron",
        medal: (
          <MedalSvg frame="diamond">
            <rect x="14" y="14" width="36" height="36" rx="3" {...S} strokeWidth="1.4" />
            <line x1="14" y1="32" x2="50" y2="32" stroke="currentColor" strokeWidth="0.7" opacity="0.4" />
            <line x1="32" y1="14" x2="32" y2="50" stroke="currentColor" strokeWidth="0.7" opacity="0.4" />
            <circle cx="38" cy="26" r="4" fill="currentColor" opacity="0.65" />
            <text x="32" y="58" textAnchor="middle" fill="currentColor" fontSize="6.5" opacity="0.4">XY</text>
          </MedalSvg>
        ),
        frieze: (
          <SymFrieze
            left={
              <>
                <rect x="-100" y="-9" width="70" height="18" rx="2" {...S} strokeWidth="1.1" opacity="0.5" />
                <line x1="-100" y1="0" x2="-30" y2="0" stroke="currentColor" strokeWidth="0.6" opacity="0.35" />
                <line x1="-65" y1="-9" x2="-65" y2="9" stroke="currentColor" strokeWidth="0.6" opacity="0.35" />
                <circle cx="-50" cy="-3" r="2.5" fill="currentColor" opacity="0.55" />
              </>
            }
          />
        ),
        corner: (
          <CornerSvg>
            <rect x="20" y="12" width="36" height="32" rx="2" {...S} strokeWidth="1.25" />
            <circle cx="42" cy="22" r="3.5" fill="currentColor" opacity="0.55" />
          </CornerSvg>
        ),
      };

    case "width":
      return {
        rail: "chevron",
        medal: (
          <MedalSvg frame="hex">
            <path {...S} strokeWidth="1.7" d="M10 32 H24 M40 32 H54" />
            <path {...S} strokeWidth="1.5" d="M24 22 L10 32 L24 42 M40 22 L54 32 L40 42" />
            <text x="20" y="36" textAnchor="middle" fill="currentColor" fontSize="8" fontWeight="700" opacity="0.55">L</text>
            <text x="44" y="36" textAnchor="middle" fill="currentColor" fontSize="8" fontWeight="700" opacity="0.55">R</text>
          </MedalSvg>
        ),
        frieze: (
          <SymFrieze
            left={
              <>
                <path {...S} strokeWidth="1.4" d="M-20 0 H-80 M-110 0 H-170" />
                <path {...S} strokeWidth="1.2" d="M-80 -8 L-95 0 L-80 8 M-110 -8 L-95 0 L-110 8" opacity="0.7" />
              </>
            }
          />
        ),
        corner: (
          <CornerSvg>
            <path {...S} strokeWidth="1.4" d="M18 28 H34 M42 28 H60" />
            <path {...S} strokeWidth="1.3" d="M34 18 L18 28 L34 38 M42 18 L60 28 L42 38" />
          </CornerSvg>
        ),
      };

    case "glue":
      return {
        rail: "gate",
        medal: (
          <MedalSvg frame="shield">
            <path {...S} strokeWidth="1.7" d="M18 18 H46 V28 L40 36 V48 H24 V36 L18 28 Z" />
            <path {...S} strokeWidth="1.2" d="M22 22 H42" opacity="0.5" />
            <rect x="26" y="38" width="12" height="6" rx="1" fill="currentColor" opacity="0.4" />
          </MedalSvg>
        ),
        frieze: (
          <SymFrieze
            left={
              <>
                <path {...S} strokeWidth="1.35" d="M-30 -8 H-90 V0 L-80 8 V14 H-40 V8 L-30 0 Z" />
                <path {...S} strokeWidth="1.1" d="M-110 -6 H-155 V0 L-148 6 V10 H-117 V6 L-110 0 Z" opacity="0.5" />
              </>
            }
          />
        ),
        corner: (
          <CornerSvg>
            <path {...S} strokeWidth="1.4" d="M24 12 H52 V22 L46 30 V42 H30 V30 L24 22 Z" />
          </CornerSvg>
        ),
      };

    case "air":
      return {
        rail: "spark",
        medal: (
          <MedalSvg frame="ring">
            <path {...S} strokeWidth="1.5" d="M10 40 Q32 10 54 40" />
            <path {...S} strokeWidth="1" d="M16 40 Q32 18 48 40" opacity="0.45" />
            {[18, 28, 38, 46].map((x, i) => (
              <circle key={x} cx={x} cy={22 - (i % 2) * 4} r={1.5 + (i % 3) * 0.5} fill="currentColor" opacity="0.55" />
            ))}
          </MedalSvg>
        ),
        frieze: (
          <SymFrieze
            left={
              <>
                <path {...S} strokeWidth="1.3" d="M-10 8 Q-90 -8 -170 8" />
                {[-40, -80, -120, -150].map((x, i) => (
                  <circle key={x} cx={x} cy={-4 + (i % 2) * 4} r="2" fill="currentColor" opacity="0.5" />
                ))}
              </>
            }
          />
        ),
        corner: (
          <CornerSvg>
            <path {...S} strokeWidth="1.35" d="M16 38 Q40 10 64 38" />
            {[28, 40, 52].map((x, i) => (
              <circle key={x} cx={x} cy={18 - (i % 2) * 3} r="2" fill="currentColor" opacity="0.5" />
            ))}
          </CornerSvg>
        ),
      };

    case "output":
      return {
        rail: "sine",
        medal: (
          <MedalSvg frame="square">
            <rect x="10" y="16" width="44" height="32" rx="3" {...S} strokeWidth="1.3" opacity="0.55" />
            <path {...S} strokeWidth="1.7" d="M14 32 C20 18, 26 46, 32 32 S42 18, 50 32" />
            <text x="32" y="56" textAnchor="middle" fill="currentColor" fontSize="6.5" opacity="0.4">SCOPE</text>
          </MedalSvg>
        ),
        frieze: (
          <SymFrieze
            left={
              <>
                <rect x="-160" y="-9" width="140" height="18" rx="2" {...S} strokeWidth="1" opacity="0.4" />
                <path {...S} strokeWidth="1.4" d="M-150 0 C-130 -10, -110 10, -90 0 S-50 -10, -30 0" />
              </>
            }
          />
        ),
        corner: (
          <CornerSvg>
            <rect x="18" y="14" width="42" height="28" rx="2" {...S} strokeWidth="1.2" opacity="0.5" />
            <path {...S} strokeWidth="1.4" d="M22 28 C28 16, 34 40, 40 28 S50 16, 56 28" />
          </CornerSvg>
        ),
      };

    case "performance":
      return {
        rail: "pulse",
        medal: (
          <MedalSvg frame="oct">
            <circle cx="32" cy="32" r="16" {...S} strokeWidth="1.4" />
            <circle cx="32" cy="32" r="6" fill="currentColor" opacity="0.35" />
            {[0, 1, 2, 3].map((i) => {
              const a = (i / 4) * Math.PI * 2 - Math.PI / 2;
              return <line key={i} x1={32 + Math.cos(a) * 8} y1={32 + Math.sin(a) * 8} x2={32 + Math.cos(a) * 20} y2={32 + Math.sin(a) * 20} stroke="currentColor" strokeWidth="1.5" opacity="0.6" />;
            })}
          </MedalSvg>
        ),
        frieze: (
          <SymFrieze
            left={
              <>
                <circle cx="-70" r="8" {...S} strokeWidth="1.2" />
                {[0, 1, 2, 3].map((i) => {
                  const a = (i / 4) * Math.PI * 2;
                  return <line key={i} x1="-70" y1="0" x2={-70 + Math.cos(a) * 18} y2={Math.sin(a) * 10} stroke="currentColor" strokeWidth="1.2" opacity="0.55" />;
                })}
                <circle cx="-140" r="6" {...S} strokeWidth="1" opacity="0.45" />
              </>
            }
          />
        ),
        corner: (
          <CornerSvg>
            <circle cx="40" cy="28" r="12" {...S} strokeWidth="1.3" />
            <circle cx="40" cy="28" r="4" fill="currentColor" opacity="0.35" />
          </CornerSvg>
        ),
      };

    /* ── Performance ── */
    case "macros":
      return {
        rail: "bead",
        medal: (
          <MedalSvg frame="square">
            {[[18, 18], [46, 18], [18, 46], [46, 46]].map(([x, y], i) => (
              <g key={i}>
                <circle cx={x} cy={y} r="9" {...S} strokeWidth="1.25" />
                <line x1={x} y1={y} x2={x + 5} y2={y - 5} stroke="currentColor" strokeWidth="1.4" />
              </g>
            ))}
          </MedalSvg>
        ),
        frieze: (
          <SymFrieze
            left={
              <>
                {[-30, -70, -110, -150].map((x) => (
                  <g key={x}>
                    <circle cx={x} r="7" {...S} strokeWidth="1.15" />
                    <line x1={x} y1="0" x2={x + 4} y2="-5" stroke="currentColor" strokeWidth="1.2" />
                  </g>
                ))}
              </>
            }
          />
        ),
        corner: (
          <CornerSvg>
            {[[28, 18], [52, 18], [28, 40], [52, 40]].map(([x, y], i) => (
              <g key={i}>
                <circle cx={x} cy={y} r="7" {...S} strokeWidth="1.15" />
                <line x1={x} y1={y} x2={x + 4} y2={y - 4} stroke="currentColor" strokeWidth="1.2" />
              </g>
            ))}
          </CornerSvg>
        ),
      };

    case "scenes":
      return {
        rail: "chevron",
        medal: (
          <MedalSvg frame="ring">
            <circle cx="32" cy="32" r="18" {...S} strokeWidth="1.3" opacity="0.45" />
            {[0, 1, 2, 3, 4, 5].map((i) => {
              const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
              return <circle key={i} cx={32 + Math.cos(a) * 18} cy={32 + Math.sin(a) * 18} r="3.5" fill="currentColor" opacity={0.35 + (i % 3) * 0.15} />;
            })}
            <circle cx="32" cy="32" r="4" fill="currentColor" opacity="0.45" />
          </MedalSvg>
        ),
        frieze: (
          <SymFrieze
            left={
              <>
                <path {...S} strokeWidth="1.1" d="M-20 0 A40 10 0 0 1 -160 0" opacity="0.5" />
                {[-40, -70, -100, -130].map((x, i) => (
                  <circle key={x} cx={x} cy={(i % 2) * 4 - 2} r="3" fill="currentColor" opacity="0.5" />
                ))}
              </>
            }
          />
        ),
        corner: (
          <CornerSvg>
            <path {...S} strokeWidth="1.2" d="M20 36 A24 14 0 0 1 64 36" opacity="0.5" />
            {[28, 40, 52].map((x, i) => (
              <circle key={x} cx={x} cy={22 + (i % 2) * 4} r="3" fill="currentColor" opacity="0.5" />
            ))}
          </CornerSvg>
        ),
      };

    case "gate":
      return {
        rail: "gate",
        medal: (
          <MedalSvg frame="square">
            {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
              <rect key={i} x={10 + i * 6} y={i % 2 ? 18 : 28} width="5" height={i % 2 ? 28 : 12} fill="currentColor" opacity={i % 2 ? 0.55 : 0.22} rx="0.8" />
            ))}
            <text x="32" y="14" textAnchor="middle" fill="currentColor" fontSize="6.5" opacity="0.45">GATE</text>
          </MedalSvg>
        ),
        frieze: (
          <SymFrieze
            left={
              <>
                {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
                  <rect key={i} x={-12 - i * 17} y={i % 2 ? -10 : -2} width="12" height={i % 2 ? 20 : 8} fill="currentColor" opacity={i % 2 ? 0.5 : 0.2} rx="1" />
                ))}
              </>
            }
          />
        ),
        corner: (
          <CornerSvg>
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <rect key={i} x={16 + i * 8} y={i % 2 ? 12 : 24} width="6" height={i % 2 ? 28 : 12} fill="currentColor" opacity={i % 2 ? 0.5 : 0.2} rx="0.7" />
            ))}
          </CornerSvg>
        ),
      };

    case "human":
      return {
        rail: "spark",
        medal: (
          <MedalSvg frame="ring">
            {[
              [20, 22], [36, 18], [48, 28], [28, 34], [16, 40], [40, 44], [52, 40], [24, 50],
            ].map(([x, y], i) => (
              <circle key={i} cx={x} cy={y} r={1.8 + (i % 3) * 0.7} fill="currentColor" opacity={0.4 + (i % 4) * 0.1} />
            ))}
            <path {...S} strokeWidth="1.1" d="M16 40 C24 28, 34 48, 44 30 S54 36, 56 42" opacity="0.45" />
          </MedalSvg>
        ),
        frieze: (
          <SymFrieze
            left={
              <>
                {[-16, -34, -48, -70, -88, -105, -128, -150, -168].map((x, i) => (
                  <circle key={x} cx={x} cy={(i % 5) * 2.5 - 5} r={1.4 + (i % 3) * 0.6} fill="currentColor" opacity={0.4 + (i % 4) * 0.1} />
                ))}
              </>
            }
          />
        ),
        corner: (
          <CornerSvg>
            {[
              [22, 16], [34, 12], [48, 20], [28, 28], [42, 34], [56, 30], [24, 42], [40, 44],
            ].map(([x, y], i) => (
              <circle key={i} cx={x} cy={y} r={1.5 + (i % 3) * 0.6} fill="currentColor" opacity={0.4 + (i % 4) * 0.1} />
            ))}
          </CornerSvg>
        ),
      };

    case "scale":
      return {
        rail: "ladder",
        medal: (
          <MedalSvg frame="square">
            {[0, 1, 2, 3, 4, 5, 6].map((i) => (
              <rect key={i} x={10 + i * 6.5} y="20" width="5.5" height="28" fill="currentColor" opacity={0.2} rx="0.5" stroke="currentColor" strokeWidth="0.6" />
            ))}
            {[1, 2, 4, 5].map((i) => (
              <rect key={i} x={14 + i * 6.5} y="20" width="4" height="16" fill="currentColor" opacity="0.55" rx="0.4" />
            ))}
          </MedalSvg>
        ),
        frieze: (
          <SymFrieze
            left={
              <>
                {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
                  <rect key={i} x={-12 - i * 17} y={-8} width="12" height="16" {...S} strokeWidth="0.9" opacity="0.45" rx="0.6" />
                ))}
                {[1, 2, 4, 5, 7].map((i) => (
                  <rect key={`b${i}`} x={-8 - i * 17} y={-8} width="7" height="9" fill="currentColor" opacity="0.45" rx="0.4" />
                ))}
              </>
            }
          />
        ),
        corner: (
          <CornerSvg>
            {[0, 1, 2, 3, 4].map((i) => (
              <rect key={i} x={18 + i * 9} y="16" width="7" height="28" {...S} strokeWidth="0.9" opacity="0.45" rx="0.5" />
            ))}
            {[1, 2, 4].map((i) => (
              <rect key={`k${i}`} x={22 + i * 9} y="16" width="5" height="15" fill="currentColor" opacity="0.5" rx="0.3" />
            ))}
          </CornerSvg>
        ),
      };

    case "chord":
      return {
        rail: "ladder",
        medal: (
          <MedalSvg frame="hex">
            {[0, 1, 2, 3].map((i) => (
              <ellipse key={i} cx="32" cy={18 + i * 10} rx={16 - i} ry="5" {...S} strokeWidth="1.25" opacity={0.65 - i * 0.1} />
            ))}
            <line x1="48" y1="18" x2="48" y2="48" stroke="currentColor" strokeWidth="1.3" opacity="0.55" />
          </MedalSvg>
        ),
        frieze: (
          <SymFrieze
            left={
              <>
                {[-2, 4, 10].map((dy, i) => (
                  <ellipse key={dy} cx="-90" cy={dy} rx={55 - i * 6} ry="5" {...S} strokeWidth="1.15" opacity={0.55 - i * 0.1} />
                ))}
              </>
            }
          />
        ),
        corner: (
          <CornerSvg>
            {[0, 1, 2].map((i) => (
              <ellipse key={i} cx="40" cy={16 + i * 12} rx={20 - i * 2} ry="5" {...S} strokeWidth="1.15" opacity={0.6 - i * 0.1} />
            ))}
            <line x1="58" y1="16" x2="58" y2="40" stroke="currentColor" strokeWidth="1.2" opacity="0.5" />
          </CornerSvg>
        ),
      };

    case "harmony":
      return {
        rail: "sine",
        medal: (
          <MedalSvg frame="ring">
            <circle cx="32" cy="32" r="10" {...S} strokeWidth="1.5" />
            {[0, 1, 2, 3, 4].map((i) => {
              const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
              return <circle key={i} cx={32 + Math.cos(a) * 20} cy={32 + Math.sin(a) * 20} r="5" {...S} strokeWidth="1.15" opacity="0.55" />;
            })}
          </MedalSvg>
        ),
        frieze: (
          <SymFrieze
            left={
              <>
                <circle cx="-90" r="7" {...S} strokeWidth="1.2" />
                {[-50, -70, -110, -130, -155].map((x, i) => (
                  <circle key={x} cx={x} cy={(i % 2) * 4 - 2} r="4.5" {...S} strokeWidth="1" opacity="0.5" />
                ))}
              </>
            }
          />
        ),
        corner: (
          <CornerSvg>
            <circle cx="40" cy="28" r="8" {...S} strokeWidth="1.3" />
            {[0, 1, 2, 3].map((i) => {
              const a = (i / 4) * Math.PI * 2;
              return <circle key={i} cx={40 + Math.cos(a) * 16} cy={28 + Math.sin(a) * 14} r="4" {...S} strokeWidth="1" opacity="0.5" />;
            })}
          </CornerSvg>
        ),
      };

    default:
      return {
        rail: "bead",
        medal: (
          <MedalSvg>
            <circle cx="32" cy="32" r="10" {...S} strokeWidth="1.4" />
          </MedalSvg>
        ),
        frieze: <SymFrieze left={<path {...S} strokeWidth="1.2" d="M-8 0 H-170" opacity="0.5" />} />,
        corner: (
          <CornerSvg>
            <path {...S} strokeWidth="1.3" d="M20 36 Q40 16 60 36" />
          </CornerSvg>
        ),
      };
  }
}

export function ModuleBackdrop({ moduleId, color, awake = true }: ModuleBackdropProps) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = rootRef.current;
    if (!el || !moduleId || !awake) return;

    let detach: (() => void) | null = null;
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries.some((e) => e.isIntersecting);
        if (visible && !detach) {
          detach = attachModuleArtFocus(el);
        } else if (!visible && detach) {
          detach();
          detach = null;
          el.style.setProperty("--fc-art-focus", "0");
          el.classList.remove("fc-mod-backdrop--centered");
          el.classList.add("fc-mod-backdrop--dim");
        }
      },
      // Attach slightly before on-screen so the glow can ramp in.
      { rootMargin: "120px 0px" },
    );
    io.observe(el);

    return () => {
      io.disconnect();
      detach?.();
    };
  }, [moduleId, awake]);

  if (!moduleId) return null;
  const art = artFor(moduleId);
  const flourish = art.flourish ?? <Flourish kind={art.rail} />;
  return (
    <div
      ref={rootRef}
      className={`fc-mod-backdrop fc-mod-backdrop--dim${awake ? "" : " fc-mod-backdrop--asleep"}`}
      style={{ color, ["--fc-art-focus" as string]: 0 }}
      aria-hidden
    >
      <div className="fc-mod-backdrop__pulse">
        <div className="fc-mod-backdrop__wash" />
        <div className="fc-mod-backdrop__grain" />
        <div className="fc-mod-backdrop__frame">
          <div className="fc-mod-backdrop__frieze fc-mod-backdrop__frieze--top">{art.frieze}</div>
          <div className="fc-mod-backdrop__frieze fc-mod-backdrop__frieze--bot">{art.frieze}</div>

          <div className="fc-mod-backdrop__crest fc-mod-backdrop__crest--top">{art.medal}</div>
          <div className="fc-mod-backdrop__crest fc-mod-backdrop__crest--bot">{art.medal}</div>

          <div className="fc-mod-backdrop__side fc-mod-backdrop__side--l">
            <div className="fc-mod-backdrop__side-rail"><Rail kind={art.rail} /></div>
            <div className="fc-mod-backdrop__medallion">{art.medal}</div>
            <div className="fc-mod-backdrop__side-rail"><Rail kind={art.rail} /></div>
          </div>
          <div className="fc-mod-backdrop__side fc-mod-backdrop__side--r">
            <div className="fc-mod-backdrop__side-rail"><Rail kind={art.rail} /></div>
            <div className="fc-mod-backdrop__medallion">{art.medal}</div>
            <div className="fc-mod-backdrop__side-rail"><Rail kind={art.rail} /></div>
          </div>

          <div className="fc-mod-backdrop__flourish fc-mod-backdrop__flourish--l fc-mod-backdrop__flourish--hi">{flourish}</div>
          <div className="fc-mod-backdrop__flourish fc-mod-backdrop__flourish--l fc-mod-backdrop__flourish--lo">{flourish}</div>
          <div className="fc-mod-backdrop__flourish fc-mod-backdrop__flourish--r fc-mod-backdrop__flourish--hi">{flourish}</div>
          <div className="fc-mod-backdrop__flourish fc-mod-backdrop__flourish--r fc-mod-backdrop__flourish--lo">{flourish}</div>

          <div className="fc-mod-backdrop__corner fc-mod-backdrop__corner--tl">{art.corner}</div>
          <div className="fc-mod-backdrop__corner fc-mod-backdrop__corner--tr">{art.corner}</div>
          <div className="fc-mod-backdrop__corner fc-mod-backdrop__corner--bl">{art.corner}</div>
          <div className="fc-mod-backdrop__corner fc-mod-backdrop__corner--br">{art.corner}</div>
        </div>
      </div>
    </div>
  );
}
