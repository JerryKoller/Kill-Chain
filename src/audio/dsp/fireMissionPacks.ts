/**
 * fireMissionPacks — capability showcase demos for Fire Command.
 * Five packs that put major synthesis systems on display (not genre templates).
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
        drumLevel: spec.drumLevel ?? 1.0,
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
    id: "cap-unison",
    name: "Unison Width",
    desc: "Hold long chords — five-voice detune and stereo width fill the room.",
    tagline: "unison · width · chorus bloom",
    color: "#ffbfa0",
    bpm: 90,
    payload: template({
      bpm: 90,
      scaleRoot: 0,
      scaleId: "major",
      presetA: "ms-cap-unison",
      drumsEnabled: false,
      sections: [
        {
          name: "Bloom",
          bars: 4,
          notes: [
            [48, 0, 16, 0.75], [55, 0, 16, 0.7], [60, 0, 16, 0.72], [64, 0, 16, 0.68],
            [50, 16, 16, 0.75], [57, 16, 16, 0.7], [62, 16, 16, 0.72], [65, 16, 16, 0.68],
            [48, 32, 16, 0.75], [55, 32, 16, 0.7], [60, 32, 16, 0.72], [67, 32, 16, 0.65],
            [53, 48, 16, 0.75], [60, 48, 16, 0.7], [65, 48, 16, 0.72], [69, 48, 16, 0.65],
          ],
        },
      ],
      chain: [0, 0],
    }),
  },
  {
    id: "cap-fm",
    name: "Cross-FM Forge",
    desc: "Short mono stabs that show FM amount, B→A cross-mod, and ring.",
    tagline: "FM · cross-mod · ring punch",
    color: "#62b6ff",
    bpm: 110,
    payload: template({
      bpm: 110,
      scaleRoot: 2,
      scaleId: "minor",
      presetA: "ms-cap-fm",
      duck: { amount: 0.35, releaseMs: 160 },
      sections: [
        {
          name: "Forge",
          bars: 2,
          drums: {
            kick:  "X-------X-------X-------X-------",
            snare: "--------X---------------X-------",
            chat:  "x-x-x-x-x-x-x-x-x-x-x-x-x-x-x-x-",
          },
          notes: [
            [45, 0, 2, 0.95], [45, 4, 1, 0.8], [48, 8, 2, 0.9], [43, 12, 2, 0.85],
            [45, 16, 2, 0.95], [50, 20, 2, 0.85], [48, 24, 2, 0.9], [45, 28, 3, 0.9],
          ],
        },
      ],
      chain: [0, 0],
    }),
  },
  {
    id: "cap-spectral",
    name: "Spectral Freeze",
    desc: "Long sustains — freeze the spectrum and listen to the lattice hold.",
    tagline: "spectral freeze · slow drift",
    color: "#c4b5fd",
    bpm: 72,
    payload: template({
      bpm: 72,
      scaleRoot: 4,
      scaleId: "minor",
      presetA: "ms-cap-spectral",
      drumsEnabled: false,
      sections: [
        {
          name: "Hold",
          bars: 4,
          notes: [
            [40, 0, 32, 0.7], [47, 0, 32, 0.65], [52, 8, 24, 0.6],
            [43, 32, 32, 0.7], [50, 32, 32, 0.65], [55, 40, 24, 0.55],
          ],
        },
      ],
      chain: [0],
    }),
  },
  {
    id: "cap-gate",
    name: "Gate · Matrix Pulse",
    desc: "Trance gate chops the pad; macros ride cutoff and delay.",
    tagline: "gate · macros · delay trails",
    color: "#9be564",
    bpm: 128,
    payload: template({
      bpm: 128,
      scaleRoot: 7,
      scaleId: "minor",
      presetA: "ms-cap-gate",
      duck: { amount: 0.45, releaseMs: 180 },
      sections: [
        {
          name: "Pulse",
          bars: 2,
          drums: {
            kick:  "X---X---X---X---X---X---X---X---",
            snare: "--------X---------------X-------",
            chat:  "--x---x---x---x---x---x---x---x-",
          },
          notes: [
            [55, 0, 16, 0.8], [62, 0, 16, 0.75], [67, 0, 16, 0.7],
            [53, 16, 16, 0.8], [60, 16, 16, 0.75], [65, 16, 16, 0.7],
          ],
        },
      ],
      chain: [0, 0],
    }),
  },
  {
    id: "cap-vintage",
    name: "Vintage Age Bus",
    desc: "Cassette, wow/flutter, hiss and VHS — the Age stage as the star.",
    tagline: "cassette · wow · hiss · VHS",
    color: "#ffd166",
    bpm: 96,
    payload: template({
      bpm: 96,
      swing: 0.06,
      scaleRoot: 5,
      scaleId: "major",
      presetA: "ms-cap-vintage",
      sections: [
        {
          name: "Worn",
          bars: 2,
          drums: {
            kick:  "X-------X-------X-------X-------",
            snare: "--------X---------------X-------",
            chat:  "x-x-x-x-x-x-x-x-x-x-x-x-x-x-x-x-",
          },
          notes: [
            [53, 0, 8, 0.75], [57, 0, 8, 0.7], [60, 0, 8, 0.68],
            [55, 8, 8, 0.75], [58, 8, 8, 0.7], [62, 8, 8, 0.68],
            [53, 16, 8, 0.75], [57, 16, 8, 0.7], [60, 16, 8, 0.68],
            [50, 24, 8, 0.75], [53, 24, 8, 0.7], [57, 24, 8, 0.68],
          ],
        },
      ],
      chain: [0, 0],
    }),
  },
];
