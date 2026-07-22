/**
 * fireMissionPacks — tactical genre templates for Fire Command (v1.6).
 *
 * A mission pack is a FULL workstation state, not just a synth patch:
 * Synth A patch, Synth B preset, drum grids, note riffs, sections + song
 * chain, bpm/swing/scale and sidechain settings. Deploying one loads the
 * whole thing through the same import path as a `.kcproj` file, so it's
 * sanitized, undo-able and immediately playable.
 *
 * Grid notation used below: one character per 16th step —
 *   'X' = full hit (1.0), 'x' = medium (0.7), 'o' = ghost (0.45), '-' = off.
 */

import { FIRE_PRESETS } from "@/state/fireCommandStore";

export interface MissionPack {
  id: string;
  name: string;
  desc: string;
  /** One-line sell shown in the browser card. */
  tagline: string;
  color: string;
  bpm: number;
  /** Payload for loadProjectData(): the full template. */
  payload: () => { patch: unknown; arp?: unknown; pattern: Record<string, unknown> };
}

// ── authoring helpers ──

let uid = 0;
const nid = () => `mp${(uid++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function rowSteps(row: string): number[] {
  const out = new Array<number>(row.length).fill(0);
  for (let i = 0; i < row.length; i++) {
    const c = row[i];
    out[i] = c === "X" ? 1 : c === "x" ? 0.7 : c === "o" ? 0.45 : 0;
  }
  return out;
}

type NoteSpec = [midi: number, step: number, len?: number, vel?: number, ch?: 0 | 1];

function notes(list: NoteSpec[]): unknown[] {
  return list.map(([midi, step, len = 1, vel = 0.85, ch = 0]) => ({
    id: nid(), midi, step, len, vel, ch,
  }));
}

interface SectionSpec {
  name: string;
  bars: number;
  drums?: Partial<Record<string, string>>; // lane id → grid row
  notes?: NoteSpec[];
}

function section(spec: SectionSpec): { id: string; sec: Record<string, unknown> } {
  const id = nid();
  const steps: Record<string, number[]> = {};
  for (const [lane, row] of Object.entries(spec.drums ?? {})) {
    if (row) steps[lane] = rowSteps(row);
  }
  return {
    id,
    sec: {
      id,
      name: spec.name,
      bars: spec.bars,
      notes: notes(spec.notes ?? []),
      drums: { steps },
      sampleSteps: {},
    },
  };
}

function patchOf(presetId: string): { patch: unknown; arp?: unknown } {
  const p = FIRE_PRESETS.find((x) => x.id === presetId) ?? FIRE_PRESETS[0];
  return { patch: p.patch, arp: p.arp };
}

interface TemplateSpec {
  bpm: number;
  swing?: number;
  scaleRoot: number;
  scaleId: string;
  presetA: string;
  /** Synth B factory preset id; omit to leave B disarmed. */
  presetB?: string;
  duck?: { amount: number; releaseMs: number };
  sections: SectionSpec[];
  /** Chain by section INDEX into `sections`. */
  chain: number[];
}

function template(spec: TemplateSpec): MissionPack["payload"] {
  return () => {
    const built = spec.sections.map(section);
    return {
      ...patchOf(spec.presetA),
      pattern: {
        bpm: spec.bpm,
        swing: spec.swing ?? 0,
        drumLevel: 0.9,
        synthEnabled: true,
        drumsEnabled: true,
        synthBEnabled: !!spec.presetB,
        synthBPresetId: spec.presetB ?? "hyperspace",
        activeChannel: 0,
        scaleRoot: spec.scaleRoot,
        scaleId: spec.scaleId,
        scaleSnap: true,
        drumSamples: {},
        samples: [],
        sections: built.map((b) => b.sec),
        activeSectionId: built[0].id,
        chain: spec.chain.map((i) => built[i].id),
        playMode: "song",
        duckEnabled: !!spec.duck,
        duckAmount: spec.duck?.amount ?? 0.6,
        duckReleaseMs: spec.duck?.releaseMs ?? 220,
        duckSource: "kick",
      },
    };
  };
}

// ── the packs ──
// Midi crib: C2=36 · C3=48 · C4=60. Every riff stays inside its stated scale.

export const MISSION_PACKS: MissionPack[] = [
  {
    id: "dark-trap",
    name: "Dark Trap",
    desc: "808 slides under a cold bell line — halftime menace at 140.",
    tagline: "Bells + 808 + rattling hats",
    color: "#c084fc",
    bpm: 140,
    payload: template({
      bpm: 140,
      scaleRoot: 1, // C# minor
      scaleId: "minor",
      presetA: "808-sub",
      presetB: "bell-keys",
      sections: [
        {
          name: "Hook",
          bars: 2,
          drums: {
            kick:  "X------------X--X---------------",
            snare: "--------X---------------X-------",
            chat:  "x-x-x-x-x-xxx-x-x-x-x-x-xxxx-x-x",
            ohat:  "------x---------------x---------",
          },
          notes: [
            // 808 line (A)
            [37, 0, 4, 0.95], [37, 13, 3, 0.9], [44, 16, 4, 0.9], [42, 24, 4, 0.9],
            // bell melody (B)
            [61, 0, 1.5, 0.7, 1], [64, 2, 1, 0.6, 1], [68, 4, 2, 0.7, 1],
            [66, 8, 1, 0.6, 1], [64, 10, 2, 0.65, 1],
            [61, 16, 1.5, 0.7, 1], [59, 20, 2, 0.6, 1], [61, 24, 4, 0.7, 1],
          ],
        },
        {
          name: "Drop",
          bars: 2,
          drums: {
            kick:  "X------X----X---X-----X---X-----",
            snare: "--------X---------------X------X",
            clap:  "--------X---------------X-------",
            chat:  "xxx-xxx-xx-xxxxxx-xxxxx-xxxxxxxx",
            ohat:  "------x-------x-------x---------",
            crash: "X-------------------------------",
          },
          notes: [
            [37, 0, 2, 1], [37, 4, 1, 0.85], [37, 7, 1, 0.85], [44, 8, 4, 0.95],
            [42, 16, 3, 0.95], [40, 20, 2, 0.85], [37, 24, 6, 1],
            [61, 0, 1, 0.75, 1], [64, 1.5, 1, 0.6, 1], [68, 3, 1, 0.7, 1],
            [73, 4, 3, 0.75, 1], [68, 8, 2, 0.65, 1], [66, 12, 3, 0.7, 1],
            [61, 16, 2, 0.75, 1], [64, 20, 2, 0.6, 1], [61, 24, 6, 0.75, 1],
          ],
        },
      ],
      chain: [0, 1, 0, 1],
    }),
  },
  {
    id: "cinematic-pulse",
    name: "Cinematic Pulse",
    desc: "Trailer heartbeat: a ticking pluck over swelling pads and sparse hits.",
    tagline: "Tension build for score work",
    color: "#f59e0b",
    bpm: 100,
    payload: template({
      bpm: 100,
      scaleRoot: 2, // D minor
      scaleId: "minor",
      presetA: "pluck-stack",
      presetB: "mothership",
      duck: { amount: 0.35, releaseMs: 320 },
      sections: [
        {
          name: "Pulse",
          bars: 2,
          drums: {
            kick: "X-------X-------X-------X-------",
            tom:  "----------------------------x-x-",
          },
          notes: [
            // ticking pluck ostinato (A)
            [62, 0, 1, 0.8], [62, 2, 1, 0.55], [65, 4, 1, 0.7], [62, 6, 1, 0.5],
            [69, 8, 1, 0.75], [65, 10, 1, 0.55], [62, 12, 1, 0.7], [65, 14, 1, 0.5],
            [62, 16, 1, 0.8], [62, 18, 1, 0.55], [67, 20, 1, 0.7], [65, 22, 1, 0.5],
            [70, 24, 1, 0.75], [67, 26, 1, 0.55], [65, 28, 1, 0.7], [62, 30, 1, 0.5],
            // drone (B)
            [38, 0, 16, 0.7, 1], [36, 16, 16, 0.7, 1],
          ],
        },
        {
          name: "Impact",
          bars: 2,
          drums: {
            kick:  "X-------X---X---X-------X---X-X-",
            snare: "--------X---------------X-------",
            tom:   "------------x-x-------------xxxx",
            crash: "X---------------X---------------",
          },
          notes: [
            [62, 0, 1, 0.9], [65, 2, 1, 0.7], [69, 4, 1, 0.85], [74, 6, 1, 0.7],
            [69, 8, 1, 0.85], [65, 10, 1, 0.7], [62, 12, 1, 0.85], [65, 14, 1, 0.7],
            [63, 16, 1, 0.9], [67, 18, 1, 0.7], [70, 20, 1, 0.85], [75, 22, 1, 0.7],
            [70, 24, 1, 0.85], [67, 26, 1, 0.7], [63, 28, 1, 0.85], [67, 30, 1, 0.7],
            [38, 0, 16, 0.8, 1], [41, 16, 16, 0.8, 1],
          ],
        },
      ],
      chain: [0, 0, 1, 1],
    }),
  },
  {
    id: "industrial-bass",
    name: "Industrial Bass",
    desc: "Four-on-the-floor stomp with a snarling reese pumped by the kick.",
    tagline: "Warehouse techno pressure",
    color: "#ef4444",
    bpm: 128,
    payload: template({
      bpm: 128,
      scaleRoot: 5, // F minor
      scaleId: "minor",
      presetA: "reese",
      duck: { amount: 0.75, releaseMs: 180 },
      sections: [
        {
          name: "Stomp",
          bars: 2,
          drums: {
            kick:  "X---X---X---X---X---X---X---X---",
            chat:  "--x---x---x---x---x---x---x---x-",
            rim:   "------o--------o------o---------",
          },
          notes: [
            [41, 0, 8, 0.95], [41, 8, 6, 0.85], [44, 14, 2, 0.8],
            [41, 16, 8, 0.95], [39, 24, 4, 0.85], [36, 28, 4, 0.9],
          ],
        },
        {
          name: "Clang",
          bars: 2,
          drums: {
            kick:  "X---X---X---X---X---X---X---X-X-",
            snare: "----X-------X-------X-------X---",
            chat:  "--x---x---x---x---x---x---x---x-",
            ohat:  "--------------x---------------x-",
            crash: "X-------------------------------",
          },
          notes: [
            [41, 0, 4, 0.95], [48, 4, 2, 0.8], [41, 6, 2, 0.8], [44, 8, 4, 0.9],
            [41, 12, 4, 0.85], [41, 16, 4, 0.95], [48, 20, 2, 0.8],
            [46, 22, 2, 0.8], [44, 24, 4, 0.9], [39, 28, 4, 0.9],
          ],
        },
      ],
      chain: [0, 1, 0, 1],
    }),
  },
  {
    id: "night-drive",
    name: "Night Drive",
    desc: "Synthwave cruise — supersaw chords gliding over a steady mid-tempo pulse.",
    tagline: "Neon highways at 2 AM",
    color: "#38bdf8",
    bpm: 110,
    payload: template({
      bpm: 110,
      scaleRoot: 9, // A minor
      scaleId: "minor",
      presetA: "supersaw",
      presetB: "808-sub",
      duck: { amount: 0.45, releaseMs: 260 },
      sections: [
        {
          name: "Cruise",
          bars: 2,
          drums: {
            kick:  "X-------X-------X-------X-------",
            snare: "--------X---------------X-------",
            chat:  "--x---x---x---x---x---x---x---x-",
          },
          notes: [
            // Am → F chord stabs (A)
            [57, 0, 3, 0.75], [60, 0, 3, 0.7], [64, 0, 3, 0.7],
            [57, 6, 2, 0.6], [60, 6, 2, 0.55], [64, 6, 2, 0.55],
            [53, 16, 3, 0.75], [57, 16, 3, 0.7], [60, 16, 3, 0.7],
            [53, 22, 2, 0.6], [57, 22, 2, 0.55], [60, 22, 2, 0.55],
            // bass (B)
            [45, 0, 6, 0.9, 1], [45, 8, 6, 0.8, 1], [41, 16, 6, 0.9, 1], [41, 24, 6, 0.8, 1],
          ],
        },
        {
          name: "Chorus",
          bars: 2,
          drums: {
            kick:  "X-------X-------X-------X----X--",
            snare: "--------X---------------X-------",
            clap:  "--------X---------------X-------",
            chat:  "x-x-x-x-x-x-x-x-x-x-x-x-x-x-x-x-",
            ohat:  "------x-------x-------x-------x-",
            crash: "X-------------------------------",
          },
          notes: [
            [60, 0, 3, 0.8], [64, 0, 3, 0.75], [67, 0, 3, 0.75],
            [60, 6, 2, 0.6], [64, 6, 2, 0.6], [67, 6, 2, 0.6],
            [59, 16, 3, 0.8], [62, 16, 3, 0.75], [67, 16, 3, 0.75],
            [59, 22, 2, 0.6], [62, 22, 2, 0.6], [67, 22, 2, 0.6],
            [48, 0, 6, 0.9, 1], [48, 8, 6, 0.8, 1], [43, 16, 6, 0.9, 1], [43, 24, 6, 0.8, 1],
          ],
        },
      ],
      chain: [0, 0, 1, 1],
    }),
  },
  {
    id: "drill",
    name: "Drill",
    desc: "Sliding 808s and skittering hats in the UK drill pocket at 144.",
    tagline: "Slide bass + ghost-note hats",
    color: "#a3e635",
    bpm: 144,
    payload: template({
      bpm: 144,
      swing: 0.12,
      scaleRoot: 7, // G minor
      scaleId: "minor",
      presetA: "808-sub",
      presetB: "pluck-stack",
      sections: [
        {
          name: "Verse",
          bars: 2,
          drums: {
            kick:  "X--------X----------X------X----",
            snare: "------X----------X--------X-----",
            chat:  "x-xo-xx-x-oxx-x-x-xo-xx-xox-x-xx",
          },
          notes: [
            [43, 0, 3, 0.95], [43, 9, 2, 0.85], [46, 12, 2, 0.85],
            [43, 16, 4, 0.95], [41, 22, 2, 0.85], [38, 26, 4, 0.9],
            // sparse pluck answers (B)
            [67, 4, 1, 0.6, 1], [70, 6, 1, 0.55, 1], [67, 14, 1, 0.6, 1],
            [74, 20, 1.5, 0.6, 1], [70, 28, 2, 0.55, 1],
          ],
        },
        {
          name: "Hook",
          bars: 2,
          drums: {
            kick:  "X--------X---X------X------X--X-",
            snare: "------X----------X--------X-----",
            clap:  "------X------------------X------",
            chat:  "x-xoxxx-xoxxx-xox-xoxxx-xoxxxoxx",
            ohat:  "--------x----------------x------",
            crash: "X-------------------------------",
          },
          notes: [
            [43, 0, 2, 1], [43, 5, 1, 0.8], [46, 8, 3, 0.9], [43, 13, 2, 0.85],
            [50, 16, 3, 0.95], [48, 20, 2, 0.85], [46, 24, 3, 0.9], [43, 28, 4, 0.95],
            [67, 0, 1, 0.65, 1], [70, 2, 1, 0.6, 1], [74, 4, 2, 0.65, 1],
            [70, 8, 1, 0.6, 1], [67, 12, 2, 0.65, 1],
            [74, 16, 2, 0.65, 1], [72, 20, 2, 0.6, 1], [67, 24, 4, 0.65, 1],
          ],
        },
      ],
      chain: [0, 1, 0, 1],
    }),
  },
  {
    id: "ambient-intel",
    name: "Ambient Intel",
    desc: "Slow reconnaissance: evolving pads, a distant pulse, no hurry at 80.",
    tagline: "Beatless-adjacent drift",
    color: "#2dd4bf",
    bpm: 80,
    payload: template({
      bpm: 80,
      scaleRoot: 4, // E minor
      scaleId: "dorian",
      presetA: "morpheus",
      presetB: "glass-choir",
      sections: [
        {
          name: "Drift",
          bars: 4,
          drums: {
            kick: "X---------------X---------------X---------------X---------------",
            rim:  "----------o---------------o---------------o---------------o----",
          },
          notes: [
            // slow pad movements (A)
            [52, 0, 16, 0.7], [59, 0, 16, 0.6], [64, 8, 8, 0.55],
            [50, 16, 16, 0.7], [57, 16, 16, 0.6], [62, 24, 8, 0.55],
            [52, 32, 16, 0.7], [60, 32, 16, 0.6], [67, 40, 8, 0.55],
            [55, 48, 16, 0.7], [62, 48, 16, 0.6], [66, 56, 8, 0.55],
            // choir swells (B)
            [71, 4, 12, 0.5, 1], [69, 20, 12, 0.5, 1], [72, 36, 12, 0.5, 1], [74, 52, 12, 0.5, 1],
          ],
        },
        {
          name: "Signal",
          bars: 4,
          drums: {
            kick: "X-------------X-X---------------X-------------X-X---------------",
            tom:  "------------------------x---------------------------x----------",
            chat: "--------x---------------x---------------x---------------x------",
          },
          notes: [
            [52, 0, 12, 0.7], [59, 0, 12, 0.6], [64, 0, 12, 0.55],
            [55, 16, 12, 0.7], [62, 16, 12, 0.6], [66, 16, 12, 0.55],
            [50, 32, 12, 0.7], [57, 32, 12, 0.6], [64, 32, 12, 0.55],
            [52, 48, 16, 0.75], [59, 48, 16, 0.65], [67, 48, 16, 0.55],
            [76, 8, 6, 0.5, 1], [74, 24, 6, 0.5, 1], [78, 40, 6, 0.5, 1], [79, 52, 10, 0.55, 1],
          ],
        },
      ],
      chain: [0, 1, 0],
    }),
  },
];
