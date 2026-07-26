/**
 * fireMissionPacks — tactical genre templates for Fire Command.
 *
 * Full workstation states (Synth A/B, drums, notes, sections, chain).
 * Grid: one char per 16th — 'X'=1.0, 'x'=0.7, 'o'=0.45, '-'=off.
 * Midi crib: C2=36 · C3=48 · C4=60. Riffs stay inside the stated scale.
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
  return { patch: p.patch, arp: p.arp };
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
        drumLevel: spec.drumLevel ?? 0.9,
        synthEnabled: true,
        drumsEnabled: spec.drumsEnabled !== false,
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

export const MISSION_PACKS: MissionPack[] = [
  {
    id: "dark-trap",
    name: "Dark Trap",
    desc: "Halftime trap: booming 808, snare on three, rattling hat rolls, cold bells.",
    tagline: "808 boom · snare on 3 · hat rolls",
    color: "#c084fc",
    bpm: 140,
    payload: template({
      bpm: 140,
      swing: 0.06,
      scaleRoot: 1, // C# minor
      scaleId: "minor",
      presetA: "808-sub",
      presetB: "bell-keys",
      duck: { amount: 0.35, releaseMs: 280 },
      sections: [
        {
          name: "Pocket",
          bars: 2,
          drums: {
            // Classic trap: kick on 1 + late syncopations; snare ONLY on beat 3
            kick:  "X-----------X-------X-----X-----",
            snare: "--------X---------------X-------",
            clap:  "--------o---------------o-------",
            chat:  "x-x-x-x-x-x-Xxx-x-x-x-x-x-oxXx--",
            ohat:  "--------------X---------------X-",
          },
          notes: [
            // 808 — long holds with short “slide” grace notes into the root
            [49, 0, 0.5, 0.55], [37, 0.5, 7, 1],
            [42, 12, 0.5, 0.5], [37, 12.5, 3, 0.9],
            [44, 16, 0.4, 0.55], [40, 16.5, 6, 0.95],
            [42, 24, 0.4, 0.5], [37, 24.5, 6, 0.95],
            // cold bells — sparse, off the kick
            [61, 4, 1.5, 0.55, 1], [64, 8, 2, 0.5, 1], [68, 14, 1, 0.45, 1],
            [61, 20, 2, 0.55, 1], [59, 26, 3, 0.5, 1],
          ],
        },
        {
          name: "Roll",
          bars: 2,
          drums: {
            kick:  "X-----X-----X---X-------X---X---",
            snare: "--------X---------------X-------",
            clap:  "--------X---------------X------x",
            chat:  "xxxxxxxxXxxxXxx-xxxxxxxxXxxXxxXX",
            ohat:  "------X-------X-------X-------X-",
            crash: "X-------------------------------",
          },
          notes: [
            [37, 0, 3, 1], [49, 4, 0.4, 0.6], [37, 4.5, 2, 0.9],
            [44, 8, 4, 0.95], [42, 14, 2, 0.85],
            [40, 16, 4, 0.95], [37, 22, 2, 0.85], [32, 24, 7, 1],
            [61, 2, 1, 0.6, 1], [68, 6, 2, 0.55, 1], [73, 10, 2, 0.6, 1],
            [68, 16, 2, 0.55, 1], [66, 20, 2, 0.5, 1], [61, 24, 4, 0.6, 1],
          ],
        },
      ],
      chain: [0, 0, 1, 1],
    }),
  },
  {
    id: "cinematic-pulse",
    name: "Cinematic Pulse",
    desc: "Trailer tension: sparse boom, ticking pluck, low drone swell — space between hits.",
    tagline: "Heartbeat kick · ticking pluck · drone",
    color: "#f59e0b",
    bpm: 96,
    payload: template({
      bpm: 96,
      scaleRoot: 2, // D minor
      scaleId: "minor",
      presetA: "pluck-stack",
      presetB: "mothership",
      duck: { amount: 0.25, releaseMs: 400 },
      drumLevel: 0.75,
      sections: [
        {
          name: "Tension",
          bars: 4,
          drums: {
            kick: "X---------------X---------------X---------------X---------------",
            rim:  "----o-------o-------o-------o-------o-------o-------o-------o---",
            tom:  "------------------------------------------------------------x-x-",
          },
          notes: [
            // Slow pluck ticks — not a melody rush
            [62, 0, 1, 0.75], [62, 4, 1, 0.4], [65, 8, 1, 0.55], [62, 12, 1, 0.35],
            [69, 16, 1, 0.65], [65, 20, 1, 0.4], [62, 24, 1, 0.55], [65, 28, 1, 0.35],
            [62, 32, 1, 0.75], [67, 40, 1, 0.55], [70, 48, 1, 0.65], [62, 56, 1, 0.45],
            // Drone bed (B)
            [38, 0, 32, 0.65, 1], [36, 32, 32, 0.7, 1],
          ],
        },
        {
          name: "Impact",
          bars: 2,
          drums: {
            kick:  "X-------X-------X-------X---X-X-",
            snare: "--------X---------------X-------",
            tom:   "------------x-x-------------xxxx",
            crash: "X---------------X---------------",
          },
          notes: [
            [62, 0, 1, 0.9], [65, 2, 1, 0.55], [69, 4, 2, 0.75], [74, 8, 2, 0.7],
            [69, 12, 2, 0.65], [65, 16, 1, 0.8], [70, 20, 2, 0.7], [75, 24, 3, 0.75],
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
    desc: "Four-on-the-floor warehouse pressure — pumping reese, offbeat hats, industrial clanks.",
    tagline: "4/4 stomp · reese pump · offbeat hats",
    color: "#ef4444",
    bpm: 130,
    payload: template({
      bpm: 130,
      scaleRoot: 5, // F minor
      scaleId: "minor",
      presetA: "reese",
      presetB: "fm-bass",
      duck: { amount: 0.78, releaseMs: 160 },
      sections: [
        {
          name: "Floor",
          bars: 2,
          drums: {
            kick:  "X---X---X---X---X---X---X---X---",
            clap:  "--------X---------------X-------",
            chat:  "--x---x---x---x---x---x---x---x-",
            ohat:  "--X---X---X---X---X---X---X---X-",
            rim:   "------X-----------X-------X-----",
          },
          notes: [
            // Reese root pump locked to bars (A)
            [41, 0, 16, 0.95], [41, 16, 8, 0.9], [44, 24, 8, 0.85],
            // Low FM punch accents (B) — warehouse stabs
            [41, 0, 1, 0.7, 1], [41, 8, 1, 0.55, 1], [41, 16, 1, 0.7, 1], [36, 24, 1, 0.65, 1],
          ],
        },
        {
          name: "Peak",
          bars: 2,
          drums: {
            kick:  "X---X---X---X---X---X---X---X-X-",
            snare: "--------X---------------X-------",
            clap:  "--------X---------------X------X",
            chat:  "x-x-x-x-x-x-x-x-x-x-x-x-x-x-x-x-",
            ohat:  "--X---X---X---X---X---X---X---X-",
            crash: "X-------------------------------",
            rim:   "----X-------X-------X-------X---",
          },
          notes: [
            [41, 0, 8, 1], [48, 8, 4, 0.85], [41, 12, 4, 0.9],
            [44, 16, 8, 0.95], [39, 24, 4, 0.9], [36, 28, 4, 0.95],
            [53, 4, 1, 0.55, 1], [53, 12, 1, 0.5, 1], [48, 20, 1, 0.55, 1], [41, 28, 1, 0.6, 1],
          ],
        },
      ],
      chain: [0, 0, 1, 1],
    }),
  },
  {
    id: "night-drive",
    name: "Night Drive",
    desc: "80s synthwave cruise — sustained supersaw chords, octave bass, gated pulse.",
    tagline: "Neon chords · gated drums · cruise bass",
    color: "#38bdf8",
    bpm: 108,
    payload: template({
      bpm: 108,
      scaleRoot: 9, // A minor
      scaleId: "minor",
      presetA: "supersaw",
      presetB: "fm-bass",
      duck: { amount: 0.4, releaseMs: 280 },
      sections: [
        {
          name: "Cruise",
          bars: 4,
          drums: {
            kick:  "X-------X-------X-------X-------X-------X-------X-------X-------",
            snare: "--------X---------------X---------------X---------------X-------",
            clap:  "--------o---------------o---------------o---------------o-------",
            chat:  "--x---x---x---x---x---x---x---x---x---x---x---x---x---x---x---x-",
            ohat:  "------X-------X-------X-------X-------X-------X-------X-------X-",
          },
          notes: [
            // Held Am / F / G / Em-ish pads (A) — long chord beds
            [57, 0, 14, 0.7], [60, 0, 14, 0.65], [64, 0, 14, 0.65],
            [53, 16, 14, 0.7], [57, 16, 14, 0.65], [60, 16, 14, 0.65],
            [55, 32, 14, 0.7], [59, 32, 14, 0.65], [62, 32, 14, 0.65],
            [52, 48, 14, 0.7], [55, 48, 14, 0.65], [59, 48, 14, 0.65],
            // Driving octave bass (B)
            [33, 0, 4, 0.9, 1], [33, 8, 4, 0.8, 1], [33, 16, 4, 0.9, 1], [33, 24, 4, 0.8, 1],
            [29, 32, 4, 0.9, 1], [29, 40, 4, 0.8, 1], [31, 48, 4, 0.9, 1], [31, 56, 4, 0.8, 1],
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
            ohat:  "------X-------X-------X-------X-",
            crash: "X-------------------------------",
          },
          notes: [
            [60, 0, 14, 0.8], [64, 0, 14, 0.75], [67, 0, 14, 0.75],
            [59, 16, 14, 0.8], [62, 16, 14, 0.75], [67, 16, 14, 0.75],
            [36, 0, 4, 0.95, 1], [36, 8, 4, 0.85, 1], [31, 16, 4, 0.95, 1], [31, 24, 4, 0.85, 1],
          ],
        },
      ],
      chain: [0, 0, 1, 1],
    }),
  },
  {
    id: "drill",
    name: "Drill",
    desc: "UK drill pocket — sliding 808s, off-grid snares, skitter hats, cold pluck answers.",
    tagline: "Slide 808 · drill snare · ghost hats",
    color: "#a3e635",
    bpm: 142,
    payload: template({
      bpm: 142,
      swing: 0.14,
      scaleRoot: 7, // G minor
      scaleId: "minor",
      presetA: "808-sub",
      presetB: "pluck-stack",
      sections: [
        {
          name: "Verse",
          bars: 2,
          drums: {
            // Drill: kicks sparse/late; snares land off the even grid
            kick:  "X---------X-----------X----X----",
            snare: "------X---------X---------X-----",
            clap:  "------o------------------o------",
            chat:  "x-xo-xx-x-oxx-xox-xo-xx-xox-x-xx",
          },
          notes: [
            // Slide illusion: descending grace → long 808
            [55, 0, 0.35, 0.5], [50, 0.35, 0.35, 0.6], [43, 0.7, 5, 1],
            [46, 8, 0.4, 0.55], [43, 8.5, 3, 0.9],
            [50, 14, 0.35, 0.5], [46, 14.4, 0.35, 0.55], [38, 14.8, 5, 0.95],
            [43, 22, 2, 0.85], [41, 26, 4, 0.9],
            [67, 4, 1, 0.45, 1], [70, 12, 1, 0.4, 1], [74, 20, 1.5, 0.45, 1], [70, 28, 2, 0.4, 1],
          ],
        },
        {
          name: "Hook",
          bars: 2,
          drums: {
            kick:  "X--------X---X------X------X--X-",
            snare: "------X---------X-------X-------",
            clap:  "------X----------------X--------",
            chat:  "x-xoxxx-xoxxx-xox-xoxxx-xoxxxoxx",
            ohat:  "--------x----------------x------",
            crash: "X-------------------------------",
          },
          notes: [
            [55, 0, 0.3, 0.55], [43, 0.4, 3, 1], [46, 6, 2, 0.85],
            [50, 10, 0.35, 0.55], [43, 10.5, 3, 0.9],
            [55, 16, 0.3, 0.55], [50, 16.4, 0.3, 0.6], [43, 16.8, 4, 1],
            [48, 22, 2, 0.85], [46, 26, 2, 0.85], [38, 28, 4, 0.95],
            [67, 2, 1, 0.5, 1], [70, 8, 2, 0.5, 1], [74, 16, 2, 0.55, 1], [67, 24, 3, 0.5, 1],
          ],
        },
      ],
      chain: [0, 1, 0, 1],
    }),
  },
  {
    id: "ambient-intel",
    name: "Ambient Intel",
    desc: "Beatless recon — evolving pads and glass choir only. No kick grid.",
    tagline: "Pads · choir · no drums",
    color: "#2dd4bf",
    bpm: 72,
    payload: template({
      bpm: 72,
      scaleRoot: 4, // E dorian
      scaleId: "dorian",
      presetA: "morpheus",
      presetB: "glass-choir",
      drumsEnabled: false,
      drumLevel: 0,
      sections: [
        {
          name: "Drift",
          bars: 4,
          notes: [
            [52, 0, 24, 0.65], [59, 0, 24, 0.55], [64, 8, 16, 0.45],
            [50, 24, 24, 0.65], [57, 24, 24, 0.55], [62, 32, 16, 0.45],
            [52, 48, 16, 0.6], [59, 48, 16, 0.5],
            [71, 4, 20, 0.4, 1], [69, 28, 20, 0.4, 1], [74, 48, 16, 0.45, 1],
          ],
        },
        {
          name: "Bloom",
          bars: 4,
          notes: [
            [52, 0, 20, 0.7], [59, 0, 20, 0.6], [64, 0, 20, 0.5], [67, 8, 12, 0.4],
            [55, 24, 20, 0.7], [62, 24, 20, 0.6], [66, 24, 20, 0.5],
            [50, 48, 16, 0.65], [57, 48, 16, 0.55], [64, 48, 16, 0.45],
            [76, 6, 14, 0.4, 1], [74, 28, 14, 0.4, 1], [79, 48, 16, 0.45, 1],
          ],
        },
      ],
      chain: [0, 1, 0, 1],
    }),
  },
  {
    id: "neuro-assault",
    name: "Neuro Assault",
    desc: "Neurofunk DnB at 174 — two-step break, chopped growler, razor lead stabs.",
    tagline: "Two-step · neuro growl · razor stabs",
    color: "#f43f5e",
    bpm: 174,
    payload: template({
      bpm: 174,
      scaleRoot: 6, // F# minor
      scaleId: "minor",
      presetA: "talking-bass",
      presetB: "plasma-lead",
      duck: { amount: 0.5, releaseMs: 90 },
      sections: [
        {
          name: "Roller",
          bars: 2,
          drums: {
            // Two-step: K on 1, S on 2, K on 3-and, S on 4
            kick:  "X---------X-----X---------X-----",
            snare: "----X---------------X-----------",
            chat:  "x-x-x-x-xxo-x-x-x-x-xxo-x-x-x-x-",
            ohat:  "------X---------------X---------",
            rim:   "----------o-----------o---------",
          },
          notes: [
            // Chopped neuro — short phrases so the vowel LFO reads as wobble
            [42, 0, 2, 0.95], [42, 2, 2, 0.75], [45, 4, 2, 0.9], [42, 6, 2, 0.7],
            [47, 8, 2, 0.95], [45, 10, 2, 0.8], [42, 12, 2, 0.9], [40, 14, 2, 0.85],
            [42, 16, 2, 0.95], [49, 18, 2, 0.8], [47, 20, 2, 0.9], [45, 22, 2, 0.85],
            [42, 24, 2, 0.95], [40, 26, 2, 0.8], [42, 28, 4, 0.95],
            [66, 4, 0.5, 0.55, 1], [69, 12, 0.5, 0.5, 1], [73, 20, 0.5, 0.55, 1], [69, 28, 0.5, 0.5, 1],
          ],
        },
        {
          name: "Tear-Out",
          bars: 2,
          drums: {
            kick:  "X-----X---X-----X---X---X---X---",
            snare: "----X-------X-------X-------X---",
            clap:  "----X---------------X-----------",
            chat:  "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
            ohat:  "------X-------X-------X-------X-",
            crash: "X-------------------------------",
          },
          notes: [
            [42, 0, 1, 1], [42, 1, 1, 0.8], [45, 2, 2, 0.95], [47, 4, 2, 0.9],
            [49, 6, 2, 0.95], [47, 8, 2, 0.85], [45, 10, 2, 0.9], [42, 12, 4, 1],
            [40, 16, 2, 0.95], [42, 18, 2, 0.9], [45, 20, 2, 0.95], [47, 22, 2, 0.85],
            [49, 24, 2, 1], [47, 26, 2, 0.85], [42, 28, 4, 1],
            [66, 2, 1, 0.6, 1], [73, 8, 1, 0.55, 1], [78, 14, 1, 0.6, 1],
            [74, 22, 1.5, 0.55, 1], [69, 28, 2, 0.55, 1],
          ],
        },
      ],
      chain: [0, 1, 0, 1],
    }),
  },
  {
    id: "acid-offensive",
    name: "Acid Offensive",
    desc: "Classic acid techno — 303 squelch 16ths over relentless four-four and offbeat hats.",
    tagline: "303 line · 4/4 kick · offbeat hats",
    color: "#facc15",
    bpm: 136,
    payload: template({
      bpm: 136,
      scaleRoot: 9, // A minor
      scaleId: "minor",
      presetA: "acid-reactor",
      duck: { amount: 0.55, releaseMs: 140 },
      sections: [
        {
          name: "Simmer",
          bars: 2,
          drums: {
            kick: "X---X---X---X---X---X---X---X---",
            chat: "--x---x---x---x---x---x---x---x-",
            ohat: "--X---X---X---X---X---X---X---X-",
            rim:  "----------o-----------o---------",
          },
          notes: [
            // TB-303 style: octave jumps + accents, mostly 16ths, glide via mono preset
            [45, 0, 1, 1], [45, 1, 1, 0.4], [57, 2, 1, 0.9], [45, 3, 1, 0.45],
            [48, 4, 1, 0.55], [45, 5, 1, 0.4], [52, 6, 1, 0.85], [45, 7, 1, 0.45],
            [45, 8, 1, 1], [57, 9, 1, 0.5], [45, 10, 1, 0.45], [55, 11, 1, 0.8],
            [48, 12, 1, 0.5], [45, 13, 1, 0.4], [52, 14, 1, 0.9], [43, 15, 1, 0.7],
            [45, 16, 1, 1], [45, 17, 1, 0.4], [57, 18, 1, 0.9], [45, 19, 1, 0.45],
            [48, 20, 1, 0.55], [60, 21, 1, 0.75], [52, 22, 1, 0.85], [45, 23, 1, 0.45],
            [45, 24, 1, 1], [55, 25, 1, 0.55], [52, 26, 1, 0.8], [48, 27, 1, 0.5],
            [45, 28, 1, 0.9], [43, 29, 1, 0.7], [45, 30, 1, 0.55], [57, 31, 1, 0.85],
          ],
        },
        {
          name: "Boil",
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
            [45, 0, 1, 1], [57, 1, 1, 0.85], [45, 2, 1, 0.5], [60, 3, 1, 0.9],
            [48, 4, 1, 0.55], [57, 5, 1, 0.8], [52, 6, 1, 0.7], [45, 7, 1, 0.5],
            [45, 8, 1, 1], [55, 9, 1, 0.75], [57, 10, 1, 0.9], [52, 11, 1, 0.6],
            [48, 12, 1, 0.55], [60, 13, 1, 0.85], [55, 14, 1, 0.7], [45, 15, 1, 0.95],
            [45, 16, 1, 1], [57, 17, 1, 0.85], [59, 18, 1, 0.8], [45, 19, 1, 0.5],
            [48, 20, 1, 0.55], [60, 21, 1, 0.9], [52, 22, 1, 0.7], [43, 23, 1, 0.85],
            [45, 24, 1, 1], [55, 25, 1, 0.75], [57, 26, 1, 0.9], [52, 27, 1, 0.6],
            [48, 28, 1, 0.55], [43, 29, 1, 0.8], [45, 30, 2, 1],
          ],
        },
      ],
      chain: [0, 0, 1, 1],
    }),
  },
  {
    id: "trance-protocol",
    name: "Trance Protocol",
    desc: "Uplifting trance — supersaw lift chords, rolling offbeat bass on B, four-four drive.",
    tagline: "Supersaw lift · offbeat bass · 4/4",
    color: "#818cf8",
    bpm: 138,
    payload: template({
      bpm: 138,
      scaleRoot: 4, // E minor
      scaleId: "minor",
      presetA: "supersaw",
      presetB: "fm-bass",
      duck: { amount: 0.65, releaseMs: 220 },
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
            // Soft supersaw pads (A)
            [52, 0, 15, 0.55], [55, 0, 15, 0.5], [59, 0, 15, 0.5],
            [50, 16, 15, 0.55], [55, 16, 15, 0.5], [59, 16, 15, 0.5],
            // Classic offbeat trance bass (B) — 8ths on the "and"
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
            // Big minor lift chords (A)
            [52, 0, 7, 0.85], [55, 0, 7, 0.8], [59, 0, 7, 0.8], [64, 0, 7, 0.75],
            [52, 8, 7, 0.7], [55, 8, 7, 0.65], [59, 8, 7, 0.65],
            [55, 16, 7, 0.85], [59, 16, 7, 0.8], [62, 16, 7, 0.8], [67, 16, 7, 0.75],
            [50, 24, 7, 0.85], [55, 24, 7, 0.8], [59, 24, 7, 0.8], [64, 24, 7, 0.7],
            // Rolling bass denser (B)
            [40, 2, 1, 0.95, 1], [40, 4, 1, 0.7, 1], [40, 6, 1, 0.9, 1], [40, 8, 1, 0.7, 1],
            [40, 10, 1, 0.9, 1], [40, 12, 1, 0.7, 1], [40, 14, 1, 0.9, 1],
            [43, 18, 1, 0.95, 1], [43, 20, 1, 0.7, 1], [43, 22, 1, 0.9, 1],
            [38, 26, 1, 0.95, 1], [38, 28, 1, 0.7, 1], [38, 30, 1, 0.9, 1],
          ],
        },
      ],
      chain: [0, 0, 1, 1],
    }),
  },
  {
    id: "dubstep-sortie",
    name: "Dubstep Sortie",
    desc: "Halftime 140 — alien wobble between kick-on-one and snare-on-three.",
    tagline: "Halftime · wobble · snare on 3",
    color: "#22d3ee",
    bpm: 140,
    payload: template({
      bpm: 140,
      scaleRoot: 5, // F minor
      scaleId: "minor",
      presetA: "alien-bass",
      presetB: "laser",
      duck: { amount: 0.35, releaseMs: 180 },
      sections: [
        {
          name: "Wobble",
          bars: 2,
          drums: {
            // Pure half-time: kick 1, snare 3 — nothing on 2/4
            kick:  "X---------------X---------------",
            snare: "--------X---------------X-------",
            chat:  "x---x---x---x---x---x---x---x---",
            rim:   "----o-------o-------o-------o---",
          },
          notes: [
            // Phrase lengths match wobble cycles
            [41, 0, 4, 1], [41, 4, 4, 0.85], [44, 8, 4, 0.9], [41, 12, 4, 0.85],
            [39, 16, 4, 1], [39, 20, 4, 0.85], [36, 24, 8, 0.95],
            [65, 6, 0.5, 0.4, 1], [72, 14, 0.5, 0.4, 1], [68, 22, 0.5, 0.4, 1],
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
            ohat:  "------X---------------X---------",
            crash: "X-------------------------------",
          },
          notes: [
            [41, 0, 2, 1], [41, 2, 2, 0.85], [44, 4, 2, 0.9], [41, 6, 2, 0.85],
            [46, 8, 2, 0.95], [44, 10, 2, 0.85], [41, 12, 4, 1],
            [39, 16, 2, 1], [39, 18, 2, 0.85], [41, 20, 2, 0.9], [36, 22, 2, 0.85],
            [34, 24, 8, 1],
            [65, 2, 0.5, 0.45, 1], [68, 10, 0.5, 0.4, 1], [72, 18, 0.5, 0.45, 1], [77, 26, 1, 0.45, 1],
          ],
        },
      ],
      chain: [0, 1, 0, 1],
    }),
  },
];
