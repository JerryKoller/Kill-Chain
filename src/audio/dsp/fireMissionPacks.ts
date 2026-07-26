/**
 * fireMissionPacks — genre demo templates for Fire Command.
 * Each pack uses specialized `ms-*` showcase presets and lean arrangements
 * so the genre reads clearly (drums + one bass role + one color role).
 *
 * Grid: one char per 16th — X=1.0, x=0.7, o=0.45, -=off.
 * Midi: C2=36 · C3=48 · C4=60.
 */

import { FIRE_PRESETS } from "@/state/fireCommandStore";

export interface MissionPack {
  id: string;
  name: string;
  desc: string;
  tagline: string;
  color: string;
  bpm: number;
  payload: () => { patch: unknown; arp?: unknown; pattern: Record<string, unknown> };
}

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
  drums?: Partial<Record<string, string>>;
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
  return { patch: structuredClone(p.patch), arp: p.arp ? structuredClone(p.arp) : undefined };
}

interface TemplateSpec {
  bpm: number;
  swing?: number;
  scaleRoot: number;
  scaleId: string;
  presetA: string;
  presetB?: string;
  duck?: { amount: number; releaseMs: number };
  drumLevel?: number;
  drumsEnabled?: boolean;
  sections: SectionSpec[];
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
        drumLevel: spec.drumLevel ?? 0.92,
        synthEnabled: true,
        drumsEnabled: spec.drumsEnabled !== false,
        synthBEnabled: !!spec.presetB,
        synthBPresetId: spec.presetB ?? "init",
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

export const MISSION_PACKS: MissionPack[] = [
  {
    id: "dark-trap",
    name: "Dark Trap",
    desc: "Halftime boom — 808 on the one, snare on three, ice bells between the hits.",
    tagline: "Trap pocket · Mission 808 + Ice Bell",
    color: "#c084fc",
    bpm: 140,
    payload: template({
      bpm: 140,
      swing: 0.05,
      scaleRoot: 1,
      scaleId: "minor",
      presetA: "ms-trap-808",
      presetB: "ms-trap-bell",
      duck: { amount: 0.3, releaseMs: 260 },
      sections: [
        {
          name: "Pocket",
          bars: 2,
          drums: {
            kick:  "X-----------X-------X-----------",
            snare: "--------X---------------X-------",
            clap:  "--------o---------------o-------",
            chat:  "x-x-x-x-x-x-Xxx-x-x-x-x-x-x-Xx--",
            ohat:  "--------------X---------------X-",
          },
          notes: [
            // A: long 808s only
            [37, 0, 8, 1], [37, 12, 4, 0.9], [32, 16, 8, 1], [37, 24, 8, 0.95],
            // B: sparse bells off the kick
            [61, 4, 2, 0.55, 1], [68, 10, 2, 0.45, 1], [64, 20, 3, 0.5, 1], [61, 28, 3, 0.5, 1],
          ],
        },
        {
          name: "Roll",
          bars: 2,
          drums: {
            kick:  "X-----X-----X---X-------X-------",
            snare: "--------X---------------X-------",
            clap:  "--------X---------------X-------",
            chat:  "xxxxxxxxXxxxxxxx-xxxxxxxXxxXxxXX",
            crash: "X-------------------------------",
          },
          notes: [
            [37, 0, 4, 1], [37, 6, 2, 0.85], [44, 8, 6, 0.95],
            [40, 16, 4, 0.95], [37, 22, 2, 0.85], [32, 24, 8, 1],
            [68, 2, 2, 0.55, 1], [73, 8, 3, 0.5, 1], [61, 18, 2, 0.5, 1], [68, 26, 3, 0.55, 1],
          ],
        },
      ],
      chain: [0, 0, 1, 1],
    }),
  },
  {
    id: "cinematic-pulse",
    name: "Cinematic Pulse",
    desc: "Trailer space — one heartbeat kick, ticking pluck, low drone.",
    tagline: "Tension tick · low drone",
    color: "#f59e0b",
    bpm: 90,
    payload: template({
      bpm: 90,
      scaleRoot: 2,
      scaleId: "minor",
      presetA: "ms-cinema-tick",
      presetB: "ms-cinema-drone",
      duck: { amount: 0.2, releaseMs: 420 },
      drumLevel: 0.8,
      sections: [
        {
          name: "Tension",
          bars: 4,
          drums: {
            kick: "X---------------X---------------X---------------X---------------",
            rim:  "----o-------o-------o-------o-------o-------o-------o-------o---",
          },
          notes: [
            [62, 0, 1, 0.8], [62, 8, 1, 0.45], [65, 16, 1, 0.6], [62, 24, 1, 0.4],
            [69, 32, 1, 0.7], [65, 40, 1, 0.45], [62, 48, 1, 0.55], [70, 56, 1, 0.5],
            [38, 0, 64, 0.7, 1],
          ],
        },
        {
          name: "Impact",
          bars: 2,
          drums: {
            kick:  "X-------X-------X-------X---X---",
            snare: "--------X---------------X-------",
            crash: "X-------------------------------",
          },
          notes: [
            [62, 0, 1, 0.9], [69, 4, 2, 0.7], [74, 8, 2, 0.65], [69, 12, 2, 0.6],
            [65, 16, 1, 0.8], [70, 20, 2, 0.65], [75, 24, 4, 0.7],
            [38, 0, 16, 0.85, 1], [41, 16, 16, 0.85, 1],
          ],
        },
      ],
      chain: [0, 0, 1],
    }),
  },
  {
    id: "industrial-bass",
    name: "Warehouse Techno",
    desc: "Straight 4/4 warehouse — pumping reese, offbeat hats, rare stabs.",
    tagline: "4/4 · Floor Reese · warehouse stab",
    color: "#ef4444",
    bpm: 128,
    payload: template({
      bpm: 128,
      scaleRoot: 5,
      scaleId: "minor",
      presetA: "ms-techno-reese",
      presetB: "ms-techno-stab",
      duck: { amount: 0.82, releaseMs: 140 },
      sections: [
        {
          name: "Floor",
          bars: 2,
          drums: {
            kick:  "X---X---X---X---X---X---X---X---",
            clap:  "--------X---------------X-------",
            chat:  "--x---x---x---x---x---x---x---x-",
            ohat:  "--X---X---X---X---X---X---X---X-",
          },
          notes: [
            // One held reese root — the duck does the pumping
            [41, 0, 32, 0.95],
          ],
        },
        {
          name: "Peak",
          bars: 2,
          drums: {
            kick:  "X---X---X---X---X---X---X---X---",
            snare: "--------X---------------X-------",
            clap:  "--------X---------------X-------",
            chat:  "x-x-x-x-x-x-x-x-x-x-x-x-x-x-x-x-",
            ohat:  "--X---X---X---X---X---X---X---X-",
            crash: "X-------------------------------",
          },
          notes: [
            [41, 0, 16, 1], [44, 16, 8, 0.9], [36, 24, 8, 0.95],
            [53, 8, 1, 0.6, 1], [53, 24, 1, 0.55, 1], [48, 28, 1, 0.5, 1],
          ],
        },
      ],
      chain: [0, 0, 1, 1],
    }),
  },
  {
    id: "night-drive",
    name: "Night Drive",
    desc: "Synthwave cruise — gated neon chords over a steady octave bass.",
    tagline: "Neon Chord · Cruise Bass",
    color: "#38bdf8",
    bpm: 108,
    payload: template({
      bpm: 108,
      scaleRoot: 9,
      scaleId: "minor",
      presetA: "ms-wave-chord",
      presetB: "ms-wave-bass",
      duck: { amount: 0.38, releaseMs: 260 },
      sections: [
        {
          name: "Cruise",
          bars: 4,
          drums: {
            kick:  "X-------X-------X-------X-------X-------X-------X-------X-------",
            snare: "--------X---------------X---------------X---------------X-------",
            chat:  "--x---x---x---x---x---x---x---x---x---x---x---x---x---x---x---x-",
            ohat:  "------X-------X-------X-------X-------X-------X-------X-------X-",
          },
          notes: [
            // Am F G Em chord beds
            [57, 0, 15, 0.75], [60, 0, 15, 0.7], [64, 0, 15, 0.7],
            [53, 16, 15, 0.75], [57, 16, 15, 0.7], [60, 16, 15, 0.7],
            [55, 32, 15, 0.75], [59, 32, 15, 0.7], [62, 32, 15, 0.7],
            [52, 48, 15, 0.75], [55, 48, 15, 0.7], [59, 48, 15, 0.7],
            // Bass pulse
            [33, 0, 3, 0.9, 1], [33, 8, 3, 0.8, 1], [33, 16, 3, 0.9, 1], [33, 24, 3, 0.8, 1],
            [29, 32, 3, 0.9, 1], [29, 40, 3, 0.8, 1], [31, 48, 3, 0.9, 1], [31, 56, 3, 0.8, 1],
          ],
        },
        {
          name: "Chorus",
          bars: 2,
          drums: {
            kick:  "X-------X-------X-------X-------",
            snare: "--------X---------------X-------",
            clap:  "--------X---------------X-------",
            chat:  "x-x-x-x-x-x-x-x-x-x-x-x-x-x-x-x-",
            ohat:  "------X-------X-------X-------X-",
            crash: "X-------------------------------",
          },
          notes: [
            [60, 0, 15, 0.8], [64, 0, 15, 0.75], [67, 0, 15, 0.75],
            [59, 16, 15, 0.8], [62, 16, 15, 0.75], [67, 16, 15, 0.75],
            [36, 0, 3, 0.95, 1], [36, 8, 3, 0.85, 1], [31, 16, 3, 0.95, 1], [31, 24, 3, 0.85, 1],
          ],
        },
      ],
      chain: [0, 0, 1, 1],
    }),
  },
  {
    id: "drill",
    name: "Drill",
    desc: "UK drill pocket — sliding 808s, off-grid snares, cold pluck answers.",
    tagline: "Drill Slide · Drill Pluck",
    color: "#a3e635",
    bpm: 140,
    payload: template({
      bpm: 140,
      swing: 0.12,
      scaleRoot: 7,
      scaleId: "minor",
      presetA: "ms-drill-808",
      presetB: "ms-drill-pluck",
      sections: [
        {
          name: "Verse",
          bars: 2,
          drums: {
            kick:  "X---------X-----------X----X----",
            snare: "------X---------X---------X-----",
            chat:  "x-xo-xx-x-oxx-xox-xo-xx-xox-x-xx",
          },
          notes: [
            // Slide into long notes (grace → hold)
            [55, 0, 0.35, 0.45], [43, 0.4, 6, 1],
            [46, 9, 3, 0.85],
            [50, 14, 0.35, 0.5], [38, 14.5, 5, 0.95],
            [43, 22, 2, 0.85], [41, 26, 4, 0.9],
            [67, 6, 1, 0.4, 1], [70, 16, 1, 0.35, 1], [74, 28, 2, 0.4, 1],
          ],
        },
        {
          name: "Hook",
          bars: 2,
          drums: {
            kick:  "X--------X---X------X------X----",
            snare: "------X---------X-------X-------",
            clap:  "------X----------------X--------",
            chat:  "x-xoxxx-xoxxx-xox-xoxxx-xoxxxoxx",
            crash: "X-------------------------------",
          },
          notes: [
            [55, 0, 0.3, 0.5], [43, 0.35, 4, 1],
            [46, 7, 3, 0.9],
            [50, 12, 0.3, 0.5], [43, 12.4, 3, 0.9],
            [55, 16, 0.3, 0.5], [43, 16.4, 5, 1],
            [38, 24, 8, 0.95],
            [70, 4, 1, 0.45, 1], [74, 10, 2, 0.4, 1], [67, 20, 2, 0.45, 1],
          ],
        },
      ],
      chain: [0, 1, 0, 1],
    }),
  },
  {
    id: "ambient-intel",
    name: "Ambient Intel",
    desc: "Beatless drift — morphing pad and glass choir only.",
    tagline: "Drift Pad · Glass Choir · no drums",
    color: "#2dd4bf",
    bpm: 70,
    payload: template({
      bpm: 70,
      scaleRoot: 4,
      scaleId: "dorian",
      presetA: "ms-ambi-morph",
      presetB: "ms-ambi-choir",
      drumsEnabled: false,
      drumLevel: 0,
      sections: [
        {
          name: "Drift",
          bars: 4,
          notes: [
            [52, 0, 32, 0.7], [59, 0, 32, 0.55],
            [50, 32, 32, 0.7], [57, 32, 32, 0.55],
            [71, 8, 24, 0.4, 1], [74, 40, 24, 0.4, 1],
          ],
        },
        {
          name: "Bloom",
          bars: 4,
          notes: [
            [52, 0, 28, 0.75], [59, 0, 28, 0.6], [64, 0, 28, 0.45],
            [55, 32, 32, 0.7], [62, 32, 32, 0.55],
            [76, 8, 20, 0.4, 1], [79, 40, 24, 0.45, 1],
          ],
        },
      ],
      chain: [0, 1],
    }),
  },
  {
    id: "neuro-assault",
    name: "Neuro Assault",
    desc: "174 two-step — neuro growl locked to the break, razor stabs on the snare.",
    tagline: "Neuro Growl · Razor Stab · two-step",
    color: "#f43f5e",
    bpm: 174,
    payload: template({
      bpm: 174,
      scaleRoot: 6,
      scaleId: "minor",
      presetA: "ms-neuro-growl",
      presetB: "ms-neuro-razor",
      duck: { amount: 0.45, releaseMs: 80 },
      sections: [
        {
          name: "Roller",
          bars: 2,
          drums: {
            kick:  "X---------X-----X---------X-----",
            snare: "----X---------------X-----------",
            chat:  "x-x-x-x-x-x-x-x-x-x-x-x-x-x-x-x-",
            ohat:  "------X---------------X---------",
          },
          notes: [
            // Quarter chops so the LFO reads as wobble
            [42, 0, 4, 0.95], [42, 4, 4, 0.85], [45, 8, 4, 0.9], [42, 12, 4, 0.85],
            [42, 16, 4, 0.95], [47, 20, 4, 0.85], [45, 24, 4, 0.9], [42, 28, 4, 0.9],
            [66, 4, 0.5, 0.5, 1], [73, 12, 0.5, 0.45, 1], [69, 20, 0.5, 0.5, 1], [74, 28, 0.5, 0.45, 1],
          ],
        },
        {
          name: "Tear",
          bars: 2,
          drums: {
            kick:  "X-----X---X-----X---X---X-------",
            snare: "----X-------X-------X-------X---",
            chat:  "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
            crash: "X-------------------------------",
          },
          notes: [
            [42, 0, 2, 1], [45, 2, 2, 0.9], [47, 4, 2, 0.95], [42, 6, 2, 0.85],
            [49, 8, 2, 0.95], [47, 10, 2, 0.85], [45, 12, 4, 0.95],
            [42, 16, 2, 1], [40, 18, 2, 0.9], [42, 20, 2, 0.95], [45, 22, 2, 0.85],
            [47, 24, 4, 1], [42, 28, 4, 0.95],
            [66, 4, 1, 0.55, 1], [73, 12, 1, 0.5, 1], [78, 20, 1, 0.55, 1], [69, 28, 2, 0.5, 1],
          ],
        },
      ],
      chain: [0, 1, 0, 1],
    }),
  },
  {
    id: "acid-offensive",
    name: "Acid Offensive",
    desc: "Acid techno — resonant 303 16ths over relentless four-four.",
    tagline: "Acid 303 · warehouse kick",
    color: "#facc15",
    bpm: 134,
    payload: template({
      bpm: 134,
      scaleRoot: 9,
      scaleId: "minor",
      presetA: "ms-acid-303",
      duck: { amount: 0.5, releaseMs: 130 },
      sections: [
        {
          name: "Simmer",
          bars: 2,
          drums: {
            kick: "X---X---X---X---X---X---X---X---",
            chat: "--x---x---x---x---x---x---x---x-",
            ohat: "--X---X---X---X---X---X---X---X-",
          },
          notes: [
            [45, 0, 1, 1], [45, 1, 1, 0.35], [57, 2, 1, 0.9], [45, 3, 1, 0.4],
            [48, 4, 1, 0.5], [45, 5, 1, 0.35], [52, 6, 1, 0.85], [45, 7, 1, 0.4],
            [45, 8, 1, 1], [57, 9, 1, 0.45], [45, 10, 1, 0.4], [55, 11, 1, 0.8],
            [48, 12, 1, 0.5], [45, 13, 1, 0.35], [52, 14, 1, 0.9], [43, 15, 1, 0.7],
            [45, 16, 1, 1], [45, 17, 1, 0.35], [57, 18, 1, 0.9], [45, 19, 1, 0.4],
            [48, 20, 1, 0.5], [60, 21, 1, 0.75], [52, 22, 1, 0.85], [45, 23, 1, 0.4],
            [45, 24, 1, 1], [55, 25, 1, 0.5], [52, 26, 1, 0.8], [48, 27, 1, 0.45],
            [45, 28, 1, 0.9], [43, 29, 1, 0.7], [45, 30, 1, 0.5], [57, 31, 1, 0.85],
          ],
        },
        {
          name: "Boil",
          bars: 2,
          drums: {
            kick:  "X---X---X---X---X---X---X---X---",
            clap:  "--------X---------------X-------",
            chat:  "x-x-x-x-x-x-x-x-x-x-x-x-x-x-x-x-",
            ohat:  "--X---X---X---X---X---X---X---X-",
            crash: "X-------------------------------",
          },
          notes: [
            [45, 0, 1, 1], [57, 1, 1, 0.85], [45, 2, 1, 0.45], [60, 3, 1, 0.9],
            [48, 4, 1, 0.5], [57, 5, 1, 0.8], [52, 6, 1, 0.7], [45, 7, 1, 0.45],
            [45, 8, 1, 1], [55, 9, 1, 0.75], [57, 10, 1, 0.9], [52, 11, 1, 0.55],
            [48, 12, 1, 0.5], [60, 13, 1, 0.85], [55, 14, 1, 0.7], [45, 15, 1, 0.95],
            [45, 16, 1, 1], [57, 17, 1, 0.85], [59, 18, 1, 0.8], [45, 19, 1, 0.45],
            [48, 20, 1, 0.5], [60, 21, 1, 0.9], [52, 22, 1, 0.7], [43, 23, 1, 0.85],
            [45, 24, 1, 1], [55, 25, 1, 0.75], [57, 26, 1, 0.9], [52, 27, 1, 0.55],
            [48, 28, 1, 0.5], [43, 29, 1, 0.8], [45, 30, 2, 1],
          ],
        },
      ],
      chain: [0, 0, 1, 1],
    }),
  },
  {
    id: "trance-protocol",
    name: "Trance Protocol",
    desc: "Uplifting trance — supersaw lift chords, rolling offbeat bass, four-four drive.",
    tagline: "Uplift Saw · Offbeat Bass",
    color: "#818cf8",
    bpm: 138,
    payload: template({
      bpm: 138,
      scaleRoot: 4,
      scaleId: "minor",
      presetA: "ms-trance-saw",
      presetB: "ms-trance-bass",
      duck: { amount: 0.68, releaseMs: 200 },
      sections: [
        {
          name: "Build",
          bars: 2,
          drums: {
            kick: "X---X---X---X---X---X---X---X---",
            clap: "--------X---------------X-------",
            chat: "--x---x---x---x---x---x---x---x-",
            ohat: "--X---X---X---X---X---X---X---X-",
          },
          notes: [
            [52, 0, 15, 0.6], [55, 0, 15, 0.55], [59, 0, 15, 0.55],
            [50, 16, 15, 0.6], [55, 16, 15, 0.55], [59, 16, 15, 0.55],
            [40, 2, 1, 0.9, 1], [40, 6, 1, 0.85, 1], [40, 10, 1, 0.9, 1], [40, 14, 1, 0.85, 1],
            [43, 18, 1, 0.9, 1], [43, 22, 1, 0.85, 1], [38, 26, 1, 0.9, 1], [38, 30, 1, 0.85, 1],
          ],
        },
        {
          name: "Lift",
          bars: 2,
          drums: {
            kick:  "X---X---X---X---X---X---X---X---",
            snare: "--------X---------------X-------",
            clap:  "--------X---------------X-------",
            chat:  "x-x-x-x-x-x-x-x-x-x-x-x-x-x-x-x-",
            ohat:  "--X---X---X---X---X---X---X---X-",
            crash: "X---------------X---------------",
          },
          notes: [
            [52, 0, 7, 0.85], [55, 0, 7, 0.8], [59, 0, 7, 0.8], [64, 0, 7, 0.75],
            [52, 8, 7, 0.7], [55, 8, 7, 0.65], [59, 8, 7, 0.65],
            [55, 16, 7, 0.85], [59, 16, 7, 0.8], [62, 16, 7, 0.8], [67, 16, 7, 0.75],
            [50, 24, 7, 0.85], [55, 24, 7, 0.8], [59, 24, 7, 0.8],
            [40, 2, 1, 0.95, 1], [40, 6, 1, 0.9, 1], [40, 10, 1, 0.9, 1], [40, 14, 1, 0.9, 1],
            [43, 18, 1, 0.95, 1], [43, 22, 1, 0.9, 1], [38, 26, 1, 0.95, 1], [38, 30, 1, 0.9, 1],
          ],
        },
      ],
      chain: [0, 0, 1, 1],
    }),
  },
  {
    id: "dubstep-sortie",
    name: "Dubstep Sortie",
    desc: "Halftime 140 — wobble between kick-on-one and snare-on-three.",
    tagline: "Halftime Wobble · Laser Zap",
    color: "#22d3ee",
    bpm: 140,
    payload: template({
      bpm: 140,
      scaleRoot: 5,
      scaleId: "minor",
      presetA: "ms-dub-wobble",
      presetB: "ms-dub-zap",
      duck: { amount: 0.3, releaseMs: 160 },
      sections: [
        {
          name: "Wobble",
          bars: 2,
          drums: {
            kick:  "X---------------X---------------",
            snare: "--------X---------------X-------",
            chat:  "x---x---x---x---x---x---x---x---",
          },
          notes: [
            // 4-step phrases = one wobble cycle each
            [41, 0, 4, 1], [41, 4, 4, 0.85], [44, 8, 4, 0.9], [41, 12, 4, 0.85],
            [39, 16, 4, 1], [39, 20, 4, 0.85], [36, 24, 8, 0.95],
            [65, 6, 0.5, 0.4, 1], [72, 14, 0.5, 0.35, 1],
          ],
        },
        {
          name: "Drop",
          bars: 2,
          drums: {
            kick:  "X-------------X-X---------------",
            snare: "--------X---------------X-------",
            clap:  "--------X---------------X-------",
            chat:  "x-x-x-x-x-x-x-x-x-x-x-x-x-x-x-x-",
            crash: "X-------------------------------",
          },
          notes: [
            [41, 0, 4, 1], [44, 4, 4, 0.9], [41, 8, 4, 0.95], [46, 12, 4, 0.9],
            [39, 16, 4, 1], [41, 20, 4, 0.9], [36, 24, 8, 1],
            [68, 2, 0.5, 0.4, 1], [72, 10, 0.5, 0.4, 1], [77, 26, 1, 0.4, 1],
          ],
        },
      ],
      chain: [0, 1, 0, 1],
    }),
  },
];
