/**
 * KCDS icon set — custom tactical-instrument SVG marks (v2.2).
 * Replaces the emoji sidebar glyphs. All icons are 24×24 stroke-based,
 * inherit `currentColor`, and stay legible at 18px.
 */
import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement>;

function base(props: P) {
  return {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    ...props,
  };
}

/** Library — stacked media tray with a waveform lid. */
export function IconLibrary(props: P) {
  return (
    <svg {...base(props)}>
      <path d="M4 9.5h16" />
      <path d="M6 9.5V6.8a1.3 1.3 0 0 1 1.3-1.3h9.4A1.3 1.3 0 0 1 18 6.8v2.7" />
      <rect x="3.5" y="9.5" width="17" height="9" rx="1.6" />
      <path d="M7 14.7v-1.4M10 15.6v-3.2M13 15.2v-2.4M16.5 15.9v-3.8" />
    </svg>
  );
}

/** Fire Command — launch chevron over a firing pad. */
export function IconFire(props: P) {
  return (
    <svg {...base(props)}>
      <path d="M12 3.5 16.5 10h-9L12 3.5Z" />
      <path d="M12 10v6" />
      <path d="M8 13.5 12 17l4-3.5" />
      <path d="M5 20.5h14" />
    </svg>
  );
}

/** Airspace — radar dish sweeping the sky. */
export function IconAirspace(props: P) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 3.5A8.5 8.5 0 0 1 20.5 12" strokeWidth="2.6" opacity="0.45" />
      <path d="M12 12l5.2-5.2" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <path d="M6.5 15.5c1.4 1.1 3.3 1.8 5.5 1.8s4.1-.7 5.5-1.8" opacity="0.55" />
    </svg>
  );
}

/** Sculptor — EQ curve with a grabbed node. */
export function IconSculptor(props: P) {
  return (
    <svg {...base(props)}>
      <path d="M3.5 15.5c3 0 3.5-7 6.5-7s3 5 5.5 5 2.5-2.5 5-2.5" />
      <circle cx="10" cy="8.6" r="2" fill="currentColor" stroke="none" />
      <path d="M3.5 19.5h17" opacity="0.4" />
    </svg>
  );
}

/** Tractor Beam — beam cone locking a target dot. */
export function IconTractor(props: P) {
  return (
    <svg {...base(props)}>
      <path d="M8.5 4h7" />
      <path d="M9.5 4 6.5 14.5M14.5 4l3 10.5" />
      <ellipse cx="12" cy="15" rx="6" ry="2.4" opacity="0.55" />
      <circle cx="12" cy="19.2" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Calibration — crosshair with tick ring. */
export function IconCalibration(props: P) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="6.5" />
      <path d="M12 2.8v3M12 18.2v3M2.8 12h3M18.2 12h3" />
      <circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Morph Lab — two blended droplets / XY pad. */
export function IconMorph(props: P) {
  return (
    <svg {...base(props)}>
      <circle cx="9.2" cy="12" r="5.2" />
      <circle cx="14.8" cy="12" r="5.2" opacity="0.55" />
      <circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Reactor — radiation core with pads. */
export function IconReactor(props: P) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="2.2" />
      <path d="M12 4.2a7.8 7.8 0 0 1 6.75 3.9l-3.4 1.96" />
      <path d="M19.4 15.9a7.8 7.8 0 0 1-7.4 4l.02-3.93" />
      <path d="M4.6 15.9a7.8 7.8 0 0 1 .65-7.8l3.4 1.97" />
    </svg>
  );
}

/** 3rd Dimension — isometric room with a source point. */
export function IconDimension(props: P) {
  return (
    <svg {...base(props)}>
      <path d="M12 3.5 20 8v8l-8 4.5L4 16V8l8-4.5Z" />
      <path d="M12 3.5V12M12 12l8-4M12 12 4 8" opacity="0.5" />
      <circle cx="12" cy="15.2" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Kill Chain — linked signal nodes. */
export function IconChain(props: P) {
  return (
    <svg {...base(props)}>
      <circle cx="5.5" cy="6" r="2.2" />
      <circle cx="18.5" cy="6" r="2.2" />
      <circle cx="12" cy="18" r="2.2" />
      <path d="M7.5 7.2 10.4 16M16.5 7.2 13.6 16M7.7 6h8.6" opacity="0.7" />
    </svg>
  );
}

/** Scope — oscilloscope trace in a frame. */
export function IconScope(props: P) {
  return (
    <svg {...base(props)}>
      <rect x="3.5" y="5" width="17" height="14" rx="2" />
      <path d="M5.5 12h2.5l1.5-3.5 2.5 7 2-4.5 1.2 1h3.3" />
    </svg>
  );
}

/** Golden Ears — headphone arc with a focus tick. */
export function IconEars(props: P) {
  return (
    <svg {...base(props)}>
      <path d="M4.5 14v-2a7.5 7.5 0 0 1 15 0v2" />
      <rect x="3.5" y="13.5" width="4" height="6" rx="1.6" />
      <rect x="16.5" y="13.5" width="4" height="6" rx="1.6" />
    </svg>
  );
}

/** Armory — supply crate with an accent latch. */
export function IconArmory(props: P) {
  return (
    <svg {...base(props)}>
      <rect x="4" y="7" width="16" height="12" rx="1.8" />
      <path d="M4 11h16" />
      <path d="M10 11v2.6h4V11" />
      <path d="M9 7V5.4A1.4 1.4 0 0 1 10.4 4h3.2A1.4 1.4 0 0 1 15 5.4V7" />
    </svg>
  );
}

/** Glossary — field manual. */
export function IconGlossary(props: P) {
  return (
    <svg {...base(props)}>
      <path d="M5 4.8A1.8 1.8 0 0 1 6.8 3H19v16.2H6.8A1.8 1.8 0 0 0 5 21V4.8Z" />
      <path d="M5 17.5A1.8 1.8 0 0 1 6.8 16H19" opacity="0.6" />
      <path d="M9 8h6M9 11h4" opacity="0.7" />
    </svg>
  );
}

/** Settings — machined adjustment screw. */
export function IconSettings(props: P) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7" />
    </svg>
  );
}

/** Small inline marks used by KCDS components */
export function IconCheck(props: P) {
  return (
    <svg {...base(props)}>
      <path d="M5 12.5 10 17.5 19 7" />
    </svg>
  );
}

export function IconWarning(props: P) {
  return (
    <svg {...base(props)}>
      <path d="M12 4 21 19H3L12 4Z" />
      <path d="M12 10v4M12 16.8v.2" />
    </svg>
  );
}
