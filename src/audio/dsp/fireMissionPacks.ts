/**
 * fireMissionPacks — genre demos for Fire Command.
 *
 * Mix rules (v2.6.10):
 *   · Synth A = color (pads / leads / bells) — can be sidechained
 *   · Synth B = bass / 808 / wobble — bypasses duck, stays solid
 *   · One dominant low source; no snare+clap stack; sparse hats
 */

import { MISSION_SHOWCASE_PRESETS } from "@/audio/dsp/fireMissionPresets";

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

/** [midi, step, len?, vel?, ch?] — ch 0 = A (color), ch 1 = B (bass) */
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
    sec: { id, name: spec.name, bars: spec.bars, notes: notes(spec.notes ?? []), drums: { steps }, sampleSteps: {} },
  };
}

function patchOf(presetId: string): { patch: unknown; arp?: unknown } {
  const p = MISSION_SHOWCASE_PRESETS.find((x) => x.id === presetId) ?? MISSION_SHOWCASE_PRESETS[0];
  return { patch: structuredClone(p.patch), arp: p.arp ? structuredClone(p.arp) : undefined };
}

interface TemplateSpec {
  bpm: number;
  swing?: number;
  scaleRoot: number;
  scaleId: string;
  /** Color / lead / pad on Synth A (ducked when sidechain on). */
  presetA: string;
  /** Bass / 808 on Synth B (solid — bypasses duck). */
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
        drumLevel: spec.drumLevel ?? 1.05,
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
        duckAmount: spec.duck?.amount ?? 0.55,
        duckReleaseMs: spec.duck?.releaseMs ?? 200,
        duckSource: "kick",
      },
    };
  };
}

export const MISSION_PACKS: MissionPack[] = [
  {
    id: "dark-trap",
    name: "Dark Trap",
    desc: "Halftime trap — fat 808 owns the low end, ice bells float, snare on three.",
    tagline: "808 boom · snare on 3 · ice bells",
    color: "#c084fc",
    bpm: 140,
    payload: template({
      bpm: 140,
      swing: 0.04,
      scaleRoot: 1,
      scaleId: "minor",
      presetA: "ms-trap-bell",
      presetB: "ms-trap-808",
      // Duck bells only (A); 808 on B stays huge
      duck: { amount: 0.4, releaseMs: 240 },
      sections: [
        {
          name: "Pocket",
          bars: 2,
          drums: {
            kick:  "X-----------X-------------------",
            snare: "--------X---------------X-------",
            chat:  "x-x-x-x-x-x-Xxx-x-x-x-x-x-x-Xx--",
            ohat:  "--------------X-----------------",
          },
          notes: [
            // B: 808 — long and loud
            [37, 0, 10, 1, 1], [37, 12, 4, 0.9, 1], [32, 16, 8, 1, 1], [37, 24, 8, 0.95, 1],
            // A: sparse bells
            [61, 4, 2, 0.6], [68, 10, 2, 0.5], [64, 20, 3, 0.55], [61, 28, 3, 0.55],
          ],
        },
        {
          name: "Roll",
          bars: 2,
          drums: {
            kick:  "X-----X-----X---X---------------",
            snare: "--------X---------------X-------",
            chat:  "x-x-x-x-Xxx-x-x-x-x-x-x-Xxx-XxXX",
            crash: "X-------------------------------",
          },
          notes: [
            [37, 0, 4, 1, 1], [37, 6, 2, 0.9, 1], [44, 8, 6, 0.95, 1],
            [40, 16, 4, 0.95, 1], [37, 22, 2, 0.85, 1], [32, 24, 8, 1, 1],
            [68, 2, 2, 0.55], [73, 8, 3, 0.55], [61, 18, 2, 0.5], [68, 26, 3, 0.55],
          ],
        },
      ],
      chain: [0, 0, 1, 1],
    }),
  },
  {
    id: "cinematic-pulse",
    name: "Cinematic Pulse",
    desc: "Trailer tension — heartbeat kick, ticking pluck, low drone bed.",
    tagline: "Heartbeat · tick · drone",
    color: "#f59e0b",
    bpm: 88,
    payload: template({
      bpm: 88,
      scaleRoot: 2,
      scaleId: "minor",
      presetA: "ms-cinema-tick",
      presetB: "ms-cinema-drone",
      duck: { amount: 0.35, releaseMs: 380 },
      drumLevel: 1.0,
      sections: [
        {
          name: "Tension",
          bars: 4,
          drums: {
            kick: "X---------------X---------------X---------------X---------------",
            rim:  "--------o---------------o---------------o---------------o-------",
          },
          notes: [
            [62, 0, 1, 0.85], [62, 8, 1, 0.4], [65, 16, 1, 0.65], [62, 24, 1, 0.4],
            [69, 32, 1, 0.75], [65, 40, 1, 0.45], [62, 48, 1, 0.55], [70, 56, 1, 0.55],
            [38, 0, 64, 0.85, 1],
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
            [62, 0, 1, 0.95], [69, 4, 2, 0.7], [74, 8, 2, 0.65], [69, 12, 2, 0.6],
            [65, 16, 1, 0.85], [70, 20, 2, 0.65], [75, 24, 4, 0.7],
            [38, 0, 16, 0.9, 1], [41, 16, 16, 0.9, 1],
          ],
        },
      ],
      chain: [0, 0, 1],
    }),
  },
  {
    id: "industrial-bass",
    name: "Warehouse Techno",
    desc: "4/4 warehouse — pumping reese on the duck, offbeat hats, rare stabs.",
    tagline: "4/4 · reese pump · warehouse stab",
    color: "#ef4444",
    bpm: 128,
    payload: template({
      bpm: 128,
      scaleRoot: 5,
      scaleId: "minor",
      // Reese on A so duck pumps it; stabs on B stay dry
      presetA: "ms-techno-reese",
      presetB: "ms-techno-stab",
      duck: { amount: 0.55, releaseMs: 180 },
      sections: [
        {
          name: "Floor",
          bars: 2,
          drums: {
            kick:  "X---X---X---X---X---X---X---X---",
            clap:  "--------X---------------X-------",
            ohat:  "--X---X---X---X---X---X---X---X-",
          },
          notes: [
            [41, 0, 32, 1], // held reese — duck does the pump
          ],
        },
        {
          name: "Peak",
          bars: 2,
          drums: {
            kick:  "X---X---X---X---X---X---X---X---",
            clap:  "--------X---------------X-------",
            chat:  "x---x---x---x---x---x---x---x---",
            ohat:  "--X---X---X---X---X---X---X---X-",
            crash: "X-------------------------------",
          },
          notes: [
            [41, 0, 16, 1], [44, 16, 8, 0.95], [36, 24, 8, 1],
            [53, 8, 1, 0.7, 1], [53, 24, 1, 0.65, 1],
          ],
        },
      ],
      chain: [0, 0, 1, 1],
    }),
  },
  {
    id: "night-drive",
    name: "Night Drive",
    desc: "Synthwave cruise — neon chords pump over a solid octave bass.",
    tagline: "Neon chords · cruise bass",
    color: "#38bdf8",
    bpm: 108,
    payload: template({
      bpm: 108,
      scaleRoot: 9,
      scaleId: "minor",
      presetA: "ms-wave-chord",
      presetB: "ms-wave-bass",
      duck: { amount: 0.45, releaseMs: 240 },
      sections: [
        {
          name: "Cruise",
          bars: 4,
          drums: {
            kick:  "X-------X-------X-------X-------X-------X-------X-------X-------",
            snare: "--------X---------------X---------------X---------------X-------",
            ohat:  "------X-------X-------X-------X-------X-------X-------X-------X-",
          },
          notes: [
            [57, 0, 15, 0.8], [60, 0, 15, 0.75], [64, 0, 15, 0.75],
            [53, 16, 15, 0.8], [57, 16, 15, 0.75], [60, 16, 15, 0.75],
            [55, 32, 15, 0.8], [59, 32, 15, 0.75], [62, 32, 15, 0.75],
            [52, 48, 15, 0.8], [55, 48, 15, 0.75], [59, 48, 15, 0.75],
            [33, 0, 3, 0.95, 1], [33, 8, 3, 0.85, 1], [33, 16, 3, 0.95, 1], [33, 24, 3, 0.85, 1],
            [29, 32, 3, 0.95, 1], [29, 40, 3, 0.85, 1], [31, 48, 3, 0.95, 1], [31, 56, 3, 0.85, 1],
          ],
        },
        {
          name: "Chorus",
          bars: 2,
          drums: {
            kick:  "X-------X-------X-------X-------",
            snare: "--------X---------------X-------",
            chat:  "x-x-x-x-x-x-x-x-x-x-x-x-x-x-x-x-",
            ohat:  "------X-------X-------X-------X-",
            crash: "X-------------------------------",
          },
          notes: [
            [60, 0, 15, 0.85], [64, 0, 15, 0.8], [67, 0, 15, 0.8],
            [59, 16, 15, 0.85], [62, 16, 15, 0.8], [67, 16, 15, 0.8],
            [36, 0, 3, 1, 1], [36, 8, 3, 0.9, 1], [31, 16, 3, 1, 1], [31, 24, 3, 0.9, 1],
          ],
        },
      ],
      chain: [0, 0, 1, 1],
    }),
  },
  {
    id: "drill",
    name: "Drill",
    desc: "UK drill — sliding 808s, off-grid snares, cold pluck answers.",
    tagline: "Slide 808 · drill snare · pluck",
    color: "#a3e635",
    bpm: 140,
    payload: template({
      bpm: 140,
      swing: 0.12,
      scaleRoot: 7,
      scaleId: "minor",
      presetA: "ms-drill-pluck",
      presetB: "ms-drill-808",
      duck: { amount: 0.3, releaseMs: 200 },
      sections: [
        {
          name: "Verse",
          bars: 2,
          drums: {
            kick:  "X---------X-----------X----X----",
            snare: "------X---------X---------X-----",
            chat:  "x-xo-xx---oxx-xo--xo-xx---ox-x--",
          },
          notes: [
            [55, 0, 0.35, 0.5, 1], [43, 0.4, 6, 1, 1],
            [46, 9, 3, 0.9, 1],
            [50, 14, 0.35, 0.55, 1], [38, 14.5, 5, 0.95, 1],
            [43, 22, 2, 0.85, 1], [41, 26, 4, 0.9, 1],
            [67, 6, 1, 0.45], [70, 16, 1, 0.4], [74, 28, 2, 0.45],
          ],
        },
        {
          name: "Hook",
          bars: 2,
          drums: {
            kick:  "X--------X---X------X------X----",
            snare: "------X---------X-------X-------",
            chat:  "x-xoxx--xoxx--xo--xoxx--xoxx-ox-",
            crash: "X-------------------------------",
          },
          notes: [
            [55, 0, 0.3, 0.55, 1], [43, 0.35, 4, 1, 1],
            [46, 7, 3, 0.9, 1],
            [50, 12, 0.3, 0.55, 1], [43, 12.4, 3, 0.9, 1],
            [55, 16, 0.3, 0.55, 1], [43, 16.4, 5, 1, 1],
            [38, 24, 8, 0.95, 1],
            [70, 4, 1, 0.5], [74, 10, 2, 0.45], [67, 20, 2, 0.5],
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
    tagline: "Pads · choir · no drums",
    color: "#2dd4bf",
    bpm: 68,
    payload: template({
      bpm: 68,
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
            [52, 0, 32, 0.8], [59, 0, 32, 0.65],
            [50, 32, 32, 0.8], [57, 32, 32, 0.65],
            [71, 8, 24, 0.5, 1], [74, 40, 24, 0.5, 1],
          ],
        },
        {
          name: "Bloom",
          bars: 4,
          notes: [
            [52, 0, 28, 0.85], [59, 0, 28, 0.7], [64, 0, 28, 0.5],
            [55, 32, 32, 0.8], [62, 32, 32, 0.65],
            [76, 8, 20, 0.5, 1], [79, 40, 24, 0.55, 1],
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
    tagline: "Two-step · neuro growl · razor",
    color: "#f43f5e",
    bpm: 174,
    payload: template({
      bpm: 174,
      scaleRoot: 6,
      scaleId: "minor",
      presetA: "ms-neuro-razor",
      presetB: "ms-neuro-growl",
      duck: { amount: 0.35, releaseMs: 90 },
      sections: [
        {
          name: "Roller",
          bars: 2,
          drums: {
            kick:  "X---------X-----X---------X-----",
            snare: "----X---------------X-----------",
            chat:  "x---x---x---x---x---x---x---x---",
            ohat:  "------X---------------X---------",
          },
          notes: [
            [42, 0, 4, 1, 1], [42, 4, 4, 0.9, 1], [45, 8, 4, 0.95, 1], [42, 12, 4, 0.9, 1],
            [42, 16, 4, 1, 1], [47, 20, 4, 0.9, 1], [45, 24, 4, 0.95, 1], [42, 28, 4, 0.95, 1],
            [66, 4, 0.5, 0.6], [73, 12, 0.5, 0.55], [69, 20, 0.5, 0.6], [74, 28, 0.5, 0.55],
          ],
        },
        {
          name: "Tear",
          bars: 2,
          drums: {
            kick:  "X-----X---X-----X---X---X-------",
            snare: "----X-------X-------X-------X---",
            chat:  "x-x-x-x-x-x-x-x-x-x-x-x-x-x-x-x-",
            crash: "X-------------------------------",
          },
          notes: [
            [42, 0, 2, 1, 1], [45, 2, 2, 0.95, 1], [47, 4, 2, 1, 1], [42, 6, 2, 0.9, 1],
            [49, 8, 2, 1, 1], [47, 10, 2, 0.9, 1], [45, 12, 4, 1, 1],
            [42, 16, 2, 1, 1], [40, 18, 2, 0.95, 1], [42, 20, 2, 1, 1], [45, 22, 2, 0.9, 1],
            [47, 24, 4, 1, 1], [42, 28, 4, 1, 1],
            [66, 4, 1, 0.65], [73, 12, 1, 0.6], [78, 20, 1, 0.65], [69, 28, 2, 0.6],
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
    tagline: "303 squelch · 4/4 kick",
    color: "#facc15",
    bpm: 134,
    payload: template({
      bpm: 134,
      scaleRoot: 9,
      scaleId: "minor",
      // Acid is the only voice — sits on A with moderate duck
      presetA: "ms-acid-303",
      duck: { amount: 0.4, releaseMs: 120 },
      sections: [
        {
          name: "Simmer",
          bars: 2,
          drums: {
            kick: "X---X---X---X---X---X---X---X---",
            ohat: "--X---X---X---X---X---X---X---X-",
          },
          notes: [
            [45, 0, 1, 1], [45, 1, 1, 0.35], [57, 2, 1, 0.95], [45, 3, 1, 0.4],
            [48, 4, 1, 0.55], [45, 5, 1, 0.35], [52, 6, 1, 0.9], [45, 7, 1, 0.4],
            [45, 8, 1, 1], [57, 9, 1, 0.5], [45, 10, 1, 0.4], [55, 11, 1, 0.85],
            [48, 12, 1, 0.55], [45, 13, 1, 0.35], [52, 14, 1, 0.95], [43, 15, 1, 0.75],
            [45, 16, 1, 1], [45, 17, 1, 0.35], [57, 18, 1, 0.95], [45, 19, 1, 0.4],
            [48, 20, 1, 0.55], [60, 21, 1, 0.8], [52, 22, 1, 0.9], [45, 23, 1, 0.4],
            [45, 24, 1, 1], [55, 25, 1, 0.55], [52, 26, 1, 0.85], [48, 27, 1, 0.5],
            [45, 28, 1, 0.95], [43, 29, 1, 0.75], [45, 30, 1, 0.55], [57, 31, 1, 0.9],
          ],
        },
        {
          name: "Boil",
          bars: 2,
          drums: {
            kick:  "X---X---X---X---X---X---X---X---",
            clap:  "--------X---------------X-------",
            ohat:  "--X---X---X---X---X---X---X---X-",
            crash: "X-------------------------------",
          },
          notes: [
            [45, 0, 1, 1], [57, 1, 1, 0.9], [45, 2, 1, 0.45], [60, 3, 1, 0.95],
            [48, 4, 1, 0.55], [57, 5, 1, 0.85], [52, 6, 1, 0.75], [45, 7, 1, 0.45],
            [45, 8, 1, 1], [55, 9, 1, 0.8], [57, 10, 1, 0.95], [52, 11, 1, 0.6],
            [48, 12, 1, 0.55], [60, 13, 1, 0.9], [55, 14, 1, 0.75], [45, 15, 1, 1],
            [45, 16, 1, 1], [57, 17, 1, 0.9], [59, 18, 1, 0.85], [45, 19, 1, 0.45],
            [48, 20, 1, 0.55], [60, 21, 1, 0.95], [52, 22, 1, 0.75], [43, 23, 1, 0.9],
            [45, 24, 1, 1], [55, 25, 1, 0.8], [57, 26, 1, 0.95], [52, 27, 1, 0.6],
            [48, 28, 1, 0.55], [43, 29, 1, 0.85], [45, 30, 2, 1],
          ],
        },
      ],
      chain: [0, 0, 1, 1],
    }),
  },
  {
    id: "trance-protocol",
    name: "Trance Protocol",
    desc: "Uplifting trance — supersaw lift pumps over a solid offbeat bass.",
    tagline: "Supersaw lift · offbeat bass",
    color: "#818cf8",
    bpm: 138,
    payload: template({
      bpm: 138,
      scaleRoot: 4,
      scaleId: "minor",
      presetA: "ms-trance-saw",
      presetB: "ms-trance-bass",
      duck: { amount: 0.55, releaseMs: 200 },
      sections: [
        {
          name: "Build",
          bars: 2,
          drums: {
            kick: "X---X---X---X---X---X---X---X---",
            clap: "--------X---------------X-------",
            ohat: "--X---X---X---X---X---X---X---X-",
          },
          notes: [
            [52, 0, 15, 0.7], [55, 0, 15, 0.65], [59, 0, 15, 0.65],
            [50, 16, 15, 0.7], [55, 16, 15, 0.65], [59, 16, 15, 0.65],
            [40, 2, 1, 0.95, 1], [40, 6, 1, 0.9, 1], [40, 10, 1, 0.95, 1], [40, 14, 1, 0.9, 1],
            [43, 18, 1, 0.95, 1], [43, 22, 1, 0.9, 1], [38, 26, 1, 0.95, 1], [38, 30, 1, 0.9, 1],
          ],
        },
        {
          name: "Lift",
          bars: 2,
          drums: {
            kick:  "X---X---X---X---X---X---X---X---",
            clap:  "--------X---------------X-------",
            chat:  "x---x---x---x---x---x---x---x---",
            ohat:  "--X---X---X---X---X---X---X---X-",
            crash: "X---------------X---------------",
          },
          notes: [
            [52, 0, 7, 0.9], [55, 0, 7, 0.85], [59, 0, 7, 0.85], [64, 0, 7, 0.8],
            [52, 8, 7, 0.75], [55, 8, 7, 0.7], [59, 8, 7, 0.7],
            [55, 16, 7, 0.9], [59, 16, 7, 0.85], [62, 16, 7, 0.85], [67, 16, 7, 0.8],
            [50, 24, 7, 0.9], [55, 24, 7, 0.85], [59, 24, 7, 0.85],
            [40, 2, 1, 1, 1], [40, 6, 1, 0.95, 1], [40, 10, 1, 0.95, 1], [40, 14, 1, 0.95, 1],
            [43, 18, 1, 1, 1], [43, 22, 1, 0.95, 1], [38, 26, 1, 1, 1], [38, 30, 1, 0.95, 1],
          ],
        },
      ],
      chain: [0, 0, 1, 1],
    }),
  },
  {
    id: "dubstep-sortie",
    name: "Dubstep Sortie",
    desc: "Halftime 140 — nasty wobble between kick-on-one and snare-on-three.",
    tagline: "Halftime · wobble · snare on 3",
    color: "#22d3ee",
    bpm: 140,
    payload: template({
      bpm: 140,
      scaleRoot: 5,
      scaleId: "minor",
      presetA: "ms-dub-zap",
      presetB: "ms-dub-wobble",
      // No duck — wobble needs full weight under the half-time kick
      sections: [
        {
          name: "Wobble",
          bars: 2,
          drums: {
            kick:  "X---------------X---------------",
            snare: "--------X---------------X-------",
            chat:  "x-------x-------x-------x-------",
          },
          notes: [
            [41, 0, 4, 1, 1], [41, 4, 4, 0.9, 1], [44, 8, 4, 0.95, 1], [41, 12, 4, 0.9, 1],
            [39, 16, 4, 1, 1], [39, 20, 4, 0.9, 1], [36, 24, 8, 1, 1],
            [65, 6, 0.5, 0.5], [72, 14, 0.5, 0.45],
          ],
        },
        {
          name: "Drop",
          bars: 2,
          drums: {
            kick:  "X-------------X-X---------------",
            snare: "--------X---------------X-------",
            chat:  "x---x---x---x---x---x---x---x---",
            crash: "X-------------------------------",
          },
          notes: [
            [41, 0, 4, 1, 1], [44, 4, 4, 0.95, 1], [41, 8, 4, 1, 1], [46, 12, 4, 0.95, 1],
            [39, 16, 4, 1, 1], [41, 20, 4, 0.95, 1], [36, 24, 8, 1, 1],
            [68, 2, 0.5, 0.5], [72, 10, 0.5, 0.5], [77, 26, 1, 0.5],
          ],
        },
      ],
      chain: [0, 1, 0, 1],
    }),
  },
];
