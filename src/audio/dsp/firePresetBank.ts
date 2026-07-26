/**
 * firePresetBank — the Fire Command factory preset library (1000 patches).
 *
 * Rather than shipping 1000 hand-written JSON blobs (hundreds of KB and
 * unmaintainable), the bank is *generated* at module load from 48 hand-tuned
 * musical archetype recipes (4-8 per category), each with its own sonic
 * identity: non-overlapping filter bands, waveform combos, unison/detune
 * spreads, modulation targets and FX sends — plus the newer synthesis layers
 * (cross FM, noise color, per-voice filter drive, stereo width, velocity
 * response). A seeded PRNG jitters each recipe inside deliberately WIDE
 * musical ranges and rolls per-preset "trait" branches, so:
 *
 *   · every preset is deterministic — the same name always means the same
 *     sound on every machine, every session (ids and params are stable),
 *   · two presets from the same archetype still differ audibly in at least
 *     3-4 significant parameters (tables, cutoff, envelopes, FX, traits),
 *   · the whole bank costs a few KB of code and <10 ms at startup.
 *
 * NAMING: each archetype carries its own callsign pools in the Fire Command
 * fire-control register. Three structures are mixed per archetype —
 * single CAPS callsigns ("BASILISK"), Adjective + Core designations
 * ("Rolling Diesel"), and numbered variants ("VANDAL-7"). A global NameForge
 * enforces real uniqueness: exact, token-multiset, and Levenshtein-distance
 * checks so no two presets in the bank read alike.
 */

import {
  DEFAULT_FIRE_PATCH,
  makeModMatrix,
  type FirePatch,
  type ModRoute,
  type ModSource,
  type ModDest,
  type LfoWave,
  type SubWave,
  type DriveMode,
  type FireFilterType,
} from "./FireCommandSynth";

// ── public types (the store re-exports these) ──

export type PresetCategory =
  | "Bass" | "Lead" | "Pluck" | "Pad" | "Keys" | "Arp" | "FX" | "Atmos";

export const PRESET_CATEGORIES: PresetCategory[] = [
  "Bass", "Lead", "Pluck", "Pad", "Keys", "Arp", "FX", "Atmos",
];

/** Loose arp shape (matches the store's ArpSettings without importing it — avoids a cycle). */
export interface PresetArp {
  enabled?: boolean;
  mode?: "up" | "down" | "updown" | "random" | "asplayed";
  bpm?: number;
  division?: "1/4" | "1/8" | "1/8T" | "1/16" | "1/16T" | "1/32";
  octaves?: number;
  gate?: number;
  hold?: boolean;
}

export interface FirePreset {
  id: string;
  name: string;
  desc: string;
  category: PresetCategory;
  patch: FirePatch;
  arp?: PresetArp;
}

// ── seeded PRNG (mulberry32) ──

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rng = () => number;
const R = (rng: Rng, lo: number, hi: number) => lo + rng() * (hi - lo);
const RI = (rng: Rng, lo: number, hi: number) => Math.round(R(rng, lo, hi));
const PK = <T,>(rng: Rng, arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)];
const CH = (rng: Rng, p: number) => rng() < p;

const P = (over: Partial<FirePatch>): FirePatch => ({ ...DEFAULT_FIRE_PATCH, ...over });
const MR = (source: ModSource, dest: ModDest, amount: number): ModRoute => ({ source, dest, amount });

// ════════════════════ name forge ════════════════════

/** Iterative two-row Levenshtein — names are short, this is startup-only. */
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (Math.abs(m - n) > 2) return 3; // we only care whether the distance ≤ 2
  let prev: number[] = [];
  for (let j = 0; j <= n; j++) prev.push(j);
  let cur: number[] = new Array<number>(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1),
      );
    }
    const tmp = prev; prev = cur; cur = tmp;
  }
  return prev[n];
}

interface NamePools {
  /** Single evocative CAPS callsigns — also seed numbered families. */
  solo: string[];
  /** Adjectives for two-word designations (Title Case). */
  adj: string[];
  /** Category/archetype nouns for two-word designations. */
  core: string[];
}

/** Hand-tuned flagship names live in the store; reserve them so a generated
 *  preset can never read the same (or confusingly close). */
const RESERVED_NAMES = [
  "Init", "Alien Bass", "Reese Driver", "808 Sub", "Talking Bass",
  "FM Punch Bass", "Macro Morph", "Supersaw Lead", "Plasma Lead",
  "Sync Screamer", "Pluck Stack", "Bell Keys", "Triple Threat", "Fuzz Saw",
  "Morpheus Pad", "Hyperspace Pad", "Glass Choir", "Phase Nebula",
  "Mothership Drone", "Star Cruiser", "Transformer", "TIE Fighter",
  "Laser Blaster", "Computer Talk", "Warp Sequence", "Gate Rider",
];

/**
 * Global (bank-wide) unique-name generator.
 *
 * Plain names (solo callsigns and Adj+Core pairs) must be new in ALL of:
 *   · exact string,
 *   · token multiset (numbers stripped) — kills "Iron Driver"/"Driver Iron",
 *   · Levenshtein distance ≥ 3 from every other plain name — kills
 *     near-duplicates like "Deep Sub" vs "Deep Stab".
 * Numbered variants ("VANDAL-7") are deliberate families: the base callsign
 * is reserved, and each member only needs a fresh number.
 */
class NameForge {
  private readonly exact = new Set<string>();
  private readonly tokenKeys = new Set<string>();
  private readonly plain: string[] = [];
  private readonly families = new Map<string, Set<number>>();

  constructor() {
    for (const n of RESERVED_NAMES) this.registerPlain(n);
  }

  private tokenKey(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .split(/[\s-]+/)
      .filter((t) => t.length > 0 && !/^\d+$/.test(t))
      .sort()
      .join("|");
  }

  private plainOk(name: string): boolean {
    const low = name.toLowerCase();
    if (this.exact.has(low)) return false;
    if (this.families.has(low)) return false; // base already a numbered family
    if (this.tokenKeys.has(this.tokenKey(name))) return false;
    for (const p of this.plain) if (editDistance(low, p) <= 2) return false;
    return true;
  }

  private registerPlain(name: string): void {
    this.exact.add(name.toLowerCase());
    this.tokenKeys.add(this.tokenKey(name));
    this.plain.push(name.toLowerCase());
  }

  /** Draw a unique name; structure mix ≈ 30% solo / 50% two-word / 20% numbered. */
  next(rng: Rng, pools: NamePools): string {
    for (let attempt = 0; attempt < 60; attempt++) {
      const roll = rng();
      if (roll < 0.3 && pools.solo.length > 0) {
        const solo = PK(rng, pools.solo);
        if (this.plainOk(solo)) { this.registerPlain(solo); return solo; }
      } else if (roll < 0.8) {
        const name = `${PK(rng, pools.adj)} ${PK(rng, pools.core)}`;
        if (this.plainOk(name)) { this.registerPlain(name); return name; }
      } else if (pools.solo.length > 0) {
        const name = this.tryNumbered(rng, PK(rng, pools.solo));
        if (name) return name;
      }
    }
    // Pools exhausted for this archetype — force a numbered family member
    // (guaranteed to terminate: 99 slots per callsign).
    for (const solo of pools.solo) {
      const name = this.tryNumbered(rng, solo);
      if (name) return name;
    }
    // Truly pathological (only possible with tiny pools): timestamp the adj.
    let i = 2;
    for (;;) {
      const name = `${pools.adj[0]} ${pools.core[0]} ${i++}`;
      if (!this.exact.has(name.toLowerCase())) { this.registerPlain(name); return name; }
    }
  }

  private tryNumbered(rng: Rng, base: string): string | null {
    const low = base.toLowerCase();
    // Don't fork a family off a callsign already used as a plain solo name.
    if (this.exact.has(low) && !this.families.has(low)) return null;
    let fam = this.families.get(low);
    if (!fam) { fam = new Set(); this.families.set(low, fam); }
    for (let tries = 0; tries < 24; tries++) {
      const num = CH(rng, 0.8) ? RI(rng, 1, 9) : RI(rng, 10, 19);
      if (fam.has(num)) continue;
      fam.add(num);
      const name = `${base}-${num}`;
      this.exact.add(name.toLowerCase());
      return name;
    }
    return null;
  }
}

// ════════════════════ archetype recipes ════════════════════
// Each returns a Partial<FirePatch>; DEFAULT_FIRE_PATCH fills the rest.
// Every recipe explicitly pins the params that define its identity — never
// rely on defaults for anything audible (the default chorusMix of 0.25 was
// silently gluing half the old bank together).

interface Archetype {
  category: PresetCategory;
  desc: string;
  count: number;
  names: NamePools;
  make: (rng: Rng) => { patch: Partial<FirePatch>; arp?: PresetArp };
}

const SUBS: SubWave[] = ["sine", "sine", "triangle", "square"];

const ARCHETYPES: Archetype[] = [
  // ═══════════════════════ BASS (88) ═══════════════════════
  {
    category: "Bass",
    desc: "Pure sub-bass ordnance — pitch-drop weight, no fizz",
    count: 11,
    names: {
      solo: ["UNDERTOW", "SEISMIC", "EPICENTER", "FATHOM", "MAGNITUDE", "TREMOR", "LOWDOWN", "GRAVITON"],
      adj: ["Deep", "Seismic", "Subsonic", "Tectonic", "Low-Yield", "Concrete", "Gravity", "Bunkered"],
      core: ["Sub", "Depth Charge", "Foundation", "Anchor", "Floor", "Quake", "Bedrock", "Ballast"],
    },
    make: (rng) => ({ patch: {
      oscATable: "basic", oscAPos: R(rng, 0, 0.14), oscALevel: R(rng, 0.35, 0.55),
      oscBTable: "basic", oscBPos: R(rng, 0.6, 1), oscBOctave: -1, oscBLevel: CH(rng, 0.5) ? R(rng, 0.1, 0.28) : 0,
      oscCLevel: 0, unison: 1, unisonWidth: 0,
      subWave: PK(rng, ["sine", "sine", "triangle"] as SubWave[]), subLevel: R(rng, 0.72, 0.95), noiseLevel: 0,
      filterType: "lowpass", filterCutoff: RI(rng, 120, 260), filterResonance: R(rng, 0.5, 1.8), filterKeyTrack: R(rng, 0, 0.15),
      filterEnvAmount: R(rng, 0, 0.15),
      pitchEnvAmount: RI(rng, 6, 20), pitchEnvTime: R(rng, 0.1, 0.34),
      ampAttack: 0.004, ampDecay: R(rng, 0.35, 0.8), ampSustain: R(rng, 0.55, 0.85), ampRelease: R(rng, 0.2, 0.45),
      velAmount: R(rng, 0.1, 0.35), stereoWidth: R(rng, 0.5, 0.8),
      mono: true, glide: R(rng, 0.015, 0.07),
      drive: R(rng, 0.04, 0.2), driveMode: "tube", punch: R(rng, 0.2, 0.45),
      chorusMix: 0, delayMix: 0, reverbMix: 0,
      tone: RI(rng, 4500, 8000), masterGain: 0.85,
    }}),
  },
  {
    category: "Bass",
    desc: "Rolling detuned reese — twin-engine low-end armor",
    count: 11,
    names: {
      solo: ["WARPIG", "JUGGERNAUT", "BULLDOZER", "OVERLORD", "MAULER", "DREADNOUGHT", "LOWRIDER", "GRINDCREW"],
      adj: ["Rolling", "Grinding", "Twin-Engine", "Diesel", "Armored", "Snarling", "Heavyweight", "Detuned"],
      core: ["Reese", "Growler", "Crawler", "Engine", "War Machine", "Rumbler", "Convoy", "Tread"],
    },
    make: (rng) => ({ patch: {
      oscATable: "growl", oscAPos: R(rng, 0.25, 0.65), oscALevel: R(rng, 0.6, 0.8),
      oscBTable: PK(rng, ["growl", "saw", "saw"]), oscBPos: R(rng, 0.35, 0.75), oscBDetune: RI(rng, 20, 45), oscBLevel: R(rng, 0.5, 0.7),
      oscCLevel: 0,
      unison: PK(rng, [5, 5, 6, 7]), unisonDetune: RI(rng, 24, 40), unisonWidth: R(rng, 0.35, 0.7),
      subWave: "sine", subLevel: R(rng, 0.28, 0.5), noiseLevel: 0,
      fmBtoA: CH(rng, 0.5) ? R(rng, 0.05, 0.22) : 0,
      filterType: "lowpass", filterCutoff: RI(rng, 180, 450), filterResonance: R(rng, 3, 7),
      filterEnvAmount: R(rng, 0.08, 0.3), filtDecay: R(rng, 0.3, 0.55), filtSustain: R(rng, 0.3, 0.55),
      ampAttack: 0.006, ampDecay: 0.4, ampSustain: 0.95, ampRelease: R(rng, 0.2, 0.35),
      velAmount: R(rng, 0.2, 0.45), stereoWidth: R(rng, 0.65, 0.95),
      mono: true, glide: R(rng, 0.03, 0.1),
      drive: R(rng, 0.24, 0.45), driveMode: PK(rng, ["tube", "soft", "fuzz"] as DriveMode[]),
      chorusMix: 0, delayMix: 0, reverbMix: 0,
      tone: RI(rng, 7500, 11500), masterGain: 0.78,
      modMatrix: makeModMatrix(CH(rng, 0.6) ? [MR("macro1", "cutoff", R(rng, 0.4, 0.8))] : []),
    }}),
  },
  {
    category: "Bass",
    desc: "LFO wobble artillery — filter locked to the pattern clock",
    count: 11,
    names: {
      solo: ["SIDEWINDER", "THRESHER", "AGITATOR", "CENTRIFUGE", "PENDULUM", "GYROSCOPE", "ROTOVATOR", "TILTROTOR"],
      adj: ["Wobbling", "Rotary", "Sweeping", "Cyclic", "Hydraulic", "Oscillating", "Churning", "Lurching"],
      core: ["Wobble", "Cycle", "Rotor", "Turbine", "Sweep", "Wub", "Camshaft", "Undulator"],
    },
    make: (rng) => ({ patch: {
      oscATable: PK(rng, ["growl", "vocal", "fold"]), oscAPos: R(rng, 0.3, 0.7), oscALfo: R(rng, 0.2, 0.5), oscALevel: 0.75,
      oscBTable: "saw", oscBPos: R(rng, 0.4, 0.7), oscBDetune: RI(rng, 10, 22), oscBLevel: R(rng, 0.35, 0.6),
      oscCLevel: 0,
      unison: 3, unisonDetune: RI(rng, 14, 24), unisonWidth: 0.5,
      subWave: PK(rng, SUBS), subLevel: R(rng, 0.35, 0.6), noiseLevel: 0,
      filterType: "lowpass", filterCutoff: RI(rng, 280, 750), filterResonance: R(rng, 5, 11),
      filterEnvAmount: R(rng, 0.05, 0.25),
      lfo1Wave: PK(rng, ["triangle", "sine", "square"] as LfoWave[]),
      lfo1Rate: PK(rng, [1, 1.75, 2.33, 2.8, 3.5, 4.66, 5.6, 7]),
      lfo1Depth: R(rng, 0.55, 0.95), lfo1Dest: "filter",
      ampAttack: 0.005, ampDecay: 0.4, ampSustain: 0.95, ampRelease: 0.25,
      velAmount: R(rng, 0.15, 0.4), stereoWidth: R(rng, 0.7, 1),
      mono: true, glide: R(rng, 0.04, 0.1),
      drive: R(rng, 0.22, 0.42), driveMode: PK(rng, ["soft", "tube", "hard", "fold"] as DriveMode[]),
      crush: CH(rng, 0.3) ? R(rng, 0.1, 0.3) : 0,
      chorusMix: 0, delayMix: 0, reverbMix: 0,
      tone: RI(rng, 8500, 13000), masterGain: 0.8,
    }}),
  },
  {
    category: "Bass",
    desc: "Corrosive acid line — resonance riding the envelope",
    count: 11,
    names: {
      solo: ["CORROSIVE", "VITRIOL", "TOXIN", "SOLVENT", "REAGENT", "ALKALINE", "PEROXIDE", "DISSOLVER"],
      adj: ["Caustic", "Corrosive", "Squelching", "Toxic", "Burning", "Molar", "Etching", "Acrid"],
      core: ["Acid", "Squelch", "Line", "Dropper", "Injector", "Titrator", "Burn", "Residue"],
    },
    make: (rng) => ({ patch: {
      oscATable: PK(rng, ["saw", "saw", "basic", "pulse"]), oscAPos: R(rng, 0.55, 1), oscALevel: 0.8,
      oscBLevel: 0, oscCLevel: 0, unison: 1, unisonWidth: 0,
      subWave: "sine", subLevel: R(rng, 0, 0.22), noiseLevel: 0,
      filterType: "lowpass", filterCutoff: RI(rng, 300, 800), filterResonance: R(rng, 10, 18),
      filterEnvAmount: R(rng, 0.5, 0.85), filtDecay: R(rng, 0.08, 0.3), filtSustain: R(rng, 0, 0.2), filterKeyTrack: R(rng, 0.2, 0.5),
      filterDrive: R(rng, 0.25, 0.6),
      ampAttack: 0.002, ampDecay: R(rng, 0.16, 0.3), ampSustain: R(rng, 0.3, 0.6), ampRelease: 0.12,
      velAmount: R(rng, 0.55, 0.9),
      mono: true, glide: R(rng, 0.035, 0.12),
      drive: R(rng, 0.15, 0.38), driveMode: PK(rng, ["soft", "hard"] as DriveMode[]), punch: R(rng, 0.15, 0.35),
      chorusMix: 0, delayMix: CH(rng, 0.4) ? R(rng, 0.08, 0.18) : 0, delayTime: R(rng, 0.14, 0.3), delayFeedback: R(rng, 0.2, 0.35),
      reverbMix: 0, stereoWidth: R(rng, 0.6, 0.9),
      tone: RI(rng, 9500, 14000), masterGain: 0.78,
      modMatrix: makeModMatrix([MR("velocity", "cutoff", R(rng, 0.3, 0.65))]),
    }}),
  },
  {
    category: "Bass",
    desc: "Mutant neuro growl — osc B chews osc A via cross FM",
    count: 11,
    names: {
      solo: ["NEUROTOXIN", "BASILISK", "LEVIATHAN", "MUTAGEN", "HYDRA", "MANDIBLE", "ABERRANT", "SPLICER"],
      adj: ["Mutant", "Neural", "Warped", "Twisted", "Rabid", "Feral", "Venomous", "Serrated"],
      core: ["Neuro", "Snarl", "Mutation", "Specimen", "Gnasher", "Chewer", "Fang", "Gullet"],
    },
    make: (rng) => ({ patch: {
      oscATable: PK(rng, ["growl", "vocal", "sync"]), oscAPos: R(rng, 0.3, 0.75), oscAEnv: R(rng, -0.4, 0.45), oscALevel: 0.75,
      oscBTable: PK(rng, ["metallic", "fold", "bell"]), oscBPos: R(rng, 0.25, 0.7), oscBDetune: RI(rng, 8, 24),
      oscBLevel: CH(rng, 0.35) ? 0 : R(rng, 0.3, 0.55), // B sometimes a pure silent modulator
      oscCLevel: 0,
      unison: PK(rng, [1, 3, 3]), unisonDetune: RI(rng, 12, 26), unisonWidth: R(rng, 0.3, 0.6),
      subWave: "square", subLevel: R(rng, 0.3, 0.5), noiseLevel: 0,
      fmBtoA: R(rng, 0.3, 0.7),
      ringAmount: CH(rng, 0.4) ? R(rng, 0.1, 0.3) : 0, ringFreq: R(rng, 50, 220),
      filterType: PK(rng, ["lowpass", "lowpass", "bandpass", "notch"] as FireFilterType[]),
      filterCutoff: RI(rng, 350, 1200), filterResonance: R(rng, 3, 8),
      filterEnvAmount: R(rng, 0.1, 0.4), filtDecay: R(rng, 0.2, 0.45), filtSustain: R(rng, 0.2, 0.5),
      filterDrive: R(rng, 0.2, 0.5),
      modAttack: 0.005, modDecay: R(rng, 0.3, 0.7), modSustain: R(rng, 0.1, 0.4),
      ampAttack: 0.004, ampDecay: 0.35, ampSustain: 0.9, ampRelease: 0.22,
      velAmount: R(rng, 0.2, 0.5),
      mono: true, glide: 0.05,
      drive: R(rng, 0.3, 0.55), driveMode: PK(rng, ["fuzz", "hard", "fold"] as DriveMode[]),
      crush: CH(rng, 0.5) ? R(rng, 0.1, 0.35) : 0,
      chorusMix: 0, delayMix: 0, reverbMix: 0, stereoWidth: R(rng, 0.7, 1),
      tone: RI(rng, 8000, 12000), masterGain: 0.72,
      modMatrix: makeModMatrix([MR("modenv", "wtA", R(rng, 0.3, 0.7))]),
    }}),
  },
  {
    category: "Bass",
    desc: "Tight FM knock — bell-struck punch for close-quarters mixes",
    count: 11,
    names: {
      solo: ["PISTON", "IMPACTOR", "KNUCKLE", "BREACHER", "RAMROD", "PILEDRIVER", "HAMMERFALL", "STOMPER"],
      adj: ["Punching", "Knocking", "Solid", "Blunt", "Kinetic", "Forged", "Loaded", "Weighted"],
      core: ["Knock", "Piston", "Slug", "Fist", "Impact", "Mallet", "Ram", "Counterweight"],
    },
    make: (rng) => ({ patch: {
      oscATable: "bell", oscAPos: R(rng, 0.1, 0.4), oscAEnv: R(rng, 0.3, 0.6), oscALevel: R(rng, 0.6, 0.75),
      oscBTable: "basic", oscBPos: R(rng, 0.05, 0.3), oscBOctave: -1, oscBLevel: R(rng, 0.3, 0.5),
      oscCLevel: 0, unison: 1, unisonWidth: 0,
      subWave: "sine", subLevel: R(rng, 0.4, 0.62), noiseLevel: 0,
      fmAmount: R(rng, 0.18, 0.42), fmRatio: PK(rng, [1, 2, 2, 3, 5]),
      filterType: "lowpass", filterCutoff: RI(rng, 900, 2200), filterResonance: R(rng, 1.5, 4),
      filterEnvAmount: R(rng, 0.3, 0.5), filtDecay: R(rng, 0.1, 0.22), filtSustain: R(rng, 0.05, 0.3),
      modAttack: 0.002, modDecay: R(rng, 0.1, 0.26), modSustain: R(rng, 0, 0.2),
      ampAttack: 0.003, ampDecay: R(rng, 0.16, 0.3), ampSustain: R(rng, 0.35, 0.65), ampRelease: 0.18,
      velAmount: R(rng, 0.45, 0.8),
      mono: true, glide: 0.035,
      drive: R(rng, 0.1, 0.28), driveMode: "tube", punch: R(rng, 0.25, 0.5),
      chorusMix: 0, delayMix: 0, reverbMix: 0, stereoWidth: R(rng, 0.6, 0.85),
      tone: RI(rng, 9500, 13000), masterGain: 0.8,
    }}),
  },
  {
    category: "Bass",
    desc: "Vowel-morph talker — formant sweeps under fire-control",
    count: 11,
    names: {
      solo: ["MOUTHPIECE", "ORACLE", "SPOKESMAN", "MEGAPHONE", "LOUDHAILER", "PROPAGANDA", "DICTAPHONE", "INTERROGATOR"],
      adj: ["Talking", "Vowel", "Spoken", "Chanting", "Droning", "Muttering", "Barked", "Gargled"],
      core: ["Talker", "Voice", "Chant", "Speech", "Vowel", "Syllable", "Diction", "Order"],
    },
    make: (rng) => ({ patch: {
      oscATable: PK(rng, ["vocal", "formant2"]), oscAPos: R(rng, 0.15, 0.55), oscALfo: R(rng, 0.35, 0.7), oscALevel: 0.78,
      oscBTable: "growl", oscBPos: R(rng, 0.3, 0.6), oscBDetune: RI(rng, 8, 18), oscBLevel: R(rng, 0.3, 0.55),
      oscCLevel: 0,
      unison: 3, unisonDetune: RI(rng, 12, 20), unisonWidth: 0.5,
      subWave: "triangle", subLevel: R(rng, 0.38, 0.6), noiseLevel: 0,
      filterType: PK(rng, ["lowpass", "lowpass", "bandpass"] as FireFilterType[]),
      filterCutoff: RI(rng, 500, 1200), filterResonance: R(rng, 4, 9),
      filterEnvAmount: R(rng, 0.05, 0.25),
      lfo1Wave: PK(rng, ["triangle", "sine"] as LfoWave[]), lfo1Rate: R(rng, 1.6, 5.5), lfo1Depth: R(rng, 0.3, 0.6), lfo1Dest: "filter",
      ampAttack: 0.006, ampDecay: 0.3, ampSustain: 0.9, ampRelease: 0.22,
      velAmount: R(rng, 0.25, 0.5),
      mono: true, glide: R(rng, 0.04, 0.11),
      drive: R(rng, 0.18, 0.34), driveMode: "soft",
      chorusMix: 0, delayMix: 0, reverbMix: 0, stereoWidth: R(rng, 0.7, 0.95),
      tone: RI(rng, 9000, 12500), masterGain: 0.78,
      modMatrix: makeModMatrix(CH(rng, 0.5) ? [MR("macro1", "wtA", R(rng, 0.4, 0.8))] : []),
    }}),
  },
  {
    category: "Bass",
    desc: "Point-blank bass stab — all attack, zero sustain",
    count: 11,
    names: {
      solo: ["KNOCKOUT", "WALLOP", "HAYMAKER", "UPPERCUT", "BODYBLOW", "SLAMMER", "JOLT", "DOORKICK"],
      adj: ["Short-Fuse", "Snappy", "Clipped", "Point-Blank", "Stubby", "Abrupt", "Curt", "Sawn-Off"],
      core: ["Stab", "Jab", "Thump", "Hit", "Slam", "Strike", "Blow", "Clout"],
    },
    make: (rng) => ({ patch: {
      oscATable: PK(rng, ["saw", "growl", "pulse"]), oscAPos: R(rng, 0.4, 0.8), oscAEnv: R(rng, -0.5, -0.15), oscALevel: 0.78,
      oscBTable: "basic", oscBPos: R(rng, 0, 0.3), oscBOctave: -1, oscBLevel: R(rng, 0.25, 0.45),
      oscCLevel: 0,
      unison: PK(rng, [1, 1, 3]), unisonDetune: RI(rng, 8, 16), unisonWidth: R(rng, 0.2, 0.5),
      subWave: "sine", subLevel: R(rng, 0.3, 0.55), noiseLevel: 0,
      filterType: "lowpass", filterCutoff: RI(rng, 700, 1800), filterResonance: R(rng, 2, 6),
      filterEnvAmount: R(rng, 0.3, 0.6), filtDecay: R(rng, 0.06, 0.16), filtSustain: R(rng, 0, 0.15),
      filterDrive: R(rng, 0.15, 0.45),
      modAttack: 0.001, modDecay: R(rng, 0.08, 0.2), modSustain: 0,
      ampAttack: 0.002, ampDecay: R(rng, 0.1, 0.25), ampSustain: R(rng, 0, 0.2), ampRelease: R(rng, 0.08, 0.18),
      velAmount: R(rng, 0.5, 0.85),
      mono: CH(rng, 0.6), glide: 0.03,
      drive: R(rng, 0.15, 0.35), driveMode: PK(rng, ["tube", "hard"] as DriveMode[]), punch: R(rng, 0.3, 0.55),
      chorusMix: 0, delayMix: 0, reverbMix: 0, stereoWidth: R(rng, 0.6, 0.85),
      tone: RI(rng, 8500, 12500), masterGain: 0.8,
    }}),
  },

  // ═══════════════════════ LEAD (77) ═══════════════════════
  {
    category: "Lead",
    desc: "Main-stage supersaw — seven-voice air superiority",
    count: 11,
    names: {
      solo: ["AIRBURST", "STARSHELL", "SKYFIRE", "AFTERBURNER", "CONTRAIL", "SLIPSTREAM", "MACHLOOP", "CEILING"],
      adj: ["Soaring", "Anthemic", "Supersonic", "Stadium", "Radiant", "Full-Burn", "Wide-Wing", "High-Altitude"],
      core: ["Supersaw", "Anthem", "Formation", "Squadron", "Flight", "Altitude", "Airframe", "Jetstream"],
    },
    make: (rng) => ({ patch: {
      oscATable: "saw", oscAPos: R(rng, 0.65, 1), oscALevel: 0.75,
      oscBTable: "saw", oscBPos: R(rng, 0.5, 0.85), oscBDetune: RI(rng, 6, 16), oscBLevel: R(rng, 0.45, 0.65),
      oscCTable: "saw", oscCPos: R(rng, 0.5, 0.8), oscCOctave: PK(rng, [-1, 1]), oscCDetune: RI(rng, -8, 8),
      oscCLevel: CH(rng, 0.4) ? R(rng, 0.2, 0.4) : 0,
      unison: 7, unisonDetune: RI(rng, 18, 34), unisonWidth: R(rng, 0.85, 1),
      subWave: "sine", subLevel: R(rng, 0.05, 0.2), noiseLevel: 0,
      filterType: "lowpass", filterCutoff: RI(rng, 4500, 9000), filterResonance: R(rng, 0.7, 2), filterKeyTrack: R(rng, 0.2, 0.5),
      filterEnvAmount: R(rng, 0.15, 0.4),
      ampAttack: R(rng, 0.008, 0.04), ampDecay: 0.3, ampSustain: R(rng, 0.75, 0.95), ampRelease: R(rng, 0.3, 0.6),
      velAmount: R(rng, 0.3, 0.6), stereoWidth: R(rng, 1.1, 1.35),
      chorusRate: 0.5, chorusDepth: 0.5, chorusMix: R(rng, 0.28, 0.5),
      delayTime: PK(rng, [0.25, 0.3, 0.375]), delayFeedback: R(rng, 0.25, 0.4), delayMix: R(rng, 0.14, 0.28),
      reverbSize: R(rng, 2, 3.4), reverbMix: R(rng, 0.12, 0.26),
      drive: R(rng, 0.05, 0.16), driveMode: "soft", mono: false,
      tone: 16000, masterGain: 0.66,
    }}),
  },
  {
    category: "Lead",
    desc: "Screaming hard-sync solo — torn-edge sweep under the fingers",
    count: 11,
    names: {
      solo: ["BANSHEE", "RIPCORD", "SHRIKE", "WHIPLASH", "HOWLER", "RAZORBACK", "BUZZSAW", "SHREDDER"],
      adj: ["Screaming", "Torn", "Ripping", "Shrieking", "Serrated", "Keening", "Snapped", "Wailing"],
      core: ["Sync", "Scream", "Ripper", "Razor", "Edge", "Shred", "Tear", "Howl"],
    },
    make: (rng) => ({ patch: {
      oscATable: "sync", oscAPos: R(rng, 0.08, 0.4), oscAEnv: R(rng, 0.4, 0.85), oscALevel: 0.8,
      oscBTable: "saw", oscBPos: R(rng, 0.5, 0.75), oscBDetune: RI(rng, 6, 14), oscBLevel: R(rng, 0.3, 0.5),
      oscCLevel: 0,
      unison: PK(rng, [1, 3, 3]), unisonDetune: RI(rng, 10, 18), unisonWidth: R(rng, 0.4, 0.7),
      subLevel: R(rng, 0, 0.18), noiseLevel: 0,
      filterType: "lowpass", filterCutoff: RI(rng, 3000, 6500), filterResonance: R(rng, 2, 5),
      filterEnvAmount: R(rng, 0.3, 0.55),
      modAttack: 0.005, modDecay: R(rng, 0.35, 0.9), modSustain: R(rng, 0.15, 0.45),
      lfo1Wave: "sine", lfo1Rate: R(rng, 4.5, 6.5), lfo1Depth: R(rng, 0.05, 0.16), lfo1Dest: "pitch",
      ampAttack: 0.004, ampDecay: 0.25, ampSustain: 0.85, ampRelease: R(rng, 0.18, 0.4),
      velAmount: R(rng, 0.4, 0.7),
      mono: true, glide: R(rng, 0.025, 0.08),
      filterDrive: CH(rng, 0.5) ? R(rng, 0.2, 0.45) : 0,
      drive: R(rng, 0.18, 0.38), driveMode: PK(rng, ["tube", "hard"] as DriveMode[]),
      chorusMix: 0,
      delayTime: R(rng, 0.2, 0.34), delayFeedback: R(rng, 0.28, 0.42), delayMix: R(rng, 0.12, 0.24),
      reverbSize: 2, reverbMix: R(rng, 0.08, 0.18),
      tone: RI(rng, 11500, 15000), masterGain: 0.72,
    }}),
  },
  {
    category: "Lead",
    desc: "8-bit chip fire — quantized arcade offensive",
    count: 11,
    names: {
      solo: ["BITFIRE", "MICROSHOT", "CARTRIDGE", "GLITCHGUN", "SPRITE", "COINSLOT", "HISCORE", "PIXELSMITH"],
      adj: ["8-Bit", "Pixel", "Retro", "Glitch", "Quantized", "Micro", "Scanline", "Lo-Res"],
      core: ["Chip", "Blaster", "Console", "Stage", "Boss", "Bonus", "Invader", "Cabinet"],
    },
    make: (rng) => ({ patch: {
      oscATable: "chip", oscAPos: R(rng, 0, 1), oscALevel: 0.8,
      oscBTable: "pulse", oscBPos: R(rng, 0.2, 0.85), oscBDetune: RI(rng, 3, 9), oscBLevel: R(rng, 0.2, 0.45),
      oscCLevel: 0, unison: 1, unisonWidth: 0,
      subLevel: R(rng, 0.08, 0.25), noiseLevel: 0,
      filterType: "lowpass", filterCutoff: RI(rng, 4000, 9500), filterResonance: R(rng, 0.7, 2),
      filterEnvAmount: R(rng, 0.05, 0.3),
      ampAttack: 0.002, ampDecay: R(rng, 0.1, 0.26), ampSustain: R(rng, 0.5, 0.8), ampRelease: R(rng, 0.06, 0.2),
      lfo1Wave: PK(rng, ["sine", "square"] as LfoWave[]), lfo1Rate: R(rng, 5, 8),
      lfo1Depth: CH(rng, 0.6) ? R(rng, 0.05, 0.13) : 0, lfo1Dest: "pitch",
      velAmount: R(rng, 0.3, 0.6),
      crush: R(rng, 0.18, 0.45),
      chorusMix: 0,
      delayTime: R(rng, 0.16, 0.24), delayFeedback: R(rng, 0.22, 0.36), delayMix: R(rng, 0.1, 0.24),
      reverbMix: 0, stereoWidth: R(rng, 0.8, 1.05),
      mono: CH(rng, 0.5), glide: 0.03, drive: 0,
      tone: 15000, masterGain: 0.74,
    }}),
  },
  {
    category: "Lead",
    desc: "Formant voice lead — a synthetic singer on the front line",
    count: 11,
    names: {
      solo: ["CANTOR", "EVANGELIST", "ANNOUNCER", "HERALD", "ORATOR", "TOWNCRIER", "SOPRANO", "FALSETTO"],
      adj: ["Singing", "Wailing", "Crying", "Lyric", "Human", "Pleading", "Solo", "Aching"],
      core: ["Voice", "Cry", "Aria", "Call", "Hymn", "Verse", "Refrain", "Lament"],
    },
    make: (rng) => ({ patch: {
      oscATable: PK(rng, ["vocal", "formant2"]), oscAPos: R(rng, 0.2, 0.7), oscAEnv: R(rng, 0.15, 0.5), oscALevel: 0.78,
      oscBTable: "harmonic", oscBPos: R(rng, 0.3, 0.6), oscBDetune: RI(rng, 5, 11), oscBLevel: R(rng, 0.28, 0.5),
      oscCLevel: 0,
      unison: 3, unisonDetune: RI(rng, 10, 18), unisonWidth: R(rng, 0.5, 0.8),
      subLevel: R(rng, 0, 0.15), noiseLevel: CH(rng, 0.4) ? R(rng, 0.02, 0.07) : 0, noiseColor: R(rng, 0.3, 0.8),
      filterType: "lowpass", filterCutoff: RI(rng, 2500, 5200), filterResonance: R(rng, 1.5, 4.5),
      filterEnvAmount: R(rng, 0.2, 0.45),
      lfo1Wave: "sine", lfo1Rate: R(rng, 4.4, 6.2), lfo1Depth: R(rng, 0.07, 0.16), lfo1Dest: "pitch",
      ampAttack: R(rng, 0.01, 0.06), ampDecay: 0.3, ampSustain: 0.85, ampRelease: R(rng, 0.25, 0.5),
      velAmount: R(rng, 0.4, 0.75),
      chorusMix: R(rng, 0.15, 0.4),
      delayTime: 0.28, delayFeedback: 0.32, delayMix: R(rng, 0.1, 0.22),
      reverbSize: R(rng, 1.8, 2.8), reverbMix: R(rng, 0.1, 0.22),
      drive: R(rng, 0.08, 0.24), driveMode: "soft", mono: CH(rng, 0.5), glide: 0.045,
      stereoWidth: R(rng, 0.95, 1.2),
      tone: 14000, masterGain: 0.72,
      modMatrix: makeModMatrix([MR("macro1", "wtA", R(rng, 0.4, 0.75))]),
    }}),
  },
  {
    category: "Lead",
    desc: "Cross-FM alloy lead — inharmonic chrome under drive",
    count: 11,
    names: {
      solo: ["FOUNDRY", "ANVIL", "SMELTER", "GIRDER", "REBAR", "TUNGSTEN", "CROMWELL", "BILLET"],
      adj: ["Metallic", "Chrome", "Alloy", "Forged", "Tempered", "Galvanic", "Brazed", "Quenched"],
      core: ["Edge", "Blade", "Shard", "Spur", "Lathe", "Ingot", "Filament", "Burr"],
    },
    make: (rng) => ({ patch: {
      oscATable: PK(rng, ["bell", "metallic"]), oscAPos: R(rng, 0.3, 0.7), oscAEnv: R(rng, -0.4, 0.5), oscALevel: 0.78,
      oscBTable: PK(rng, ["saw", "sync"]), oscBPos: R(rng, 0.4, 0.8), oscBDetune: RI(rng, 6, 14), oscBLevel: R(rng, 0.25, 0.5),
      oscCLevel: 0,
      unison: PK(rng, [1, 3]), unisonDetune: RI(rng, 8, 16), unisonWidth: 0.6,
      subLevel: R(rng, 0, 0.15), noiseLevel: 0,
      fmBtoA: R(rng, 0.25, 0.55), fmAmount: CH(rng, 0.4) ? R(rng, 0.08, 0.2) : 0, fmRatio: PK(rng, [1.5, 2, 3, 3.5, 7]),
      ringAmount: CH(rng, 0.35) ? R(rng, 0.1, 0.28) : 0, ringFreq: R(rng, 200, 900),
      filterType: "lowpass", filterCutoff: RI(rng, 2800, 6000), filterResonance: R(rng, 1.5, 4.5),
      filterEnvAmount: R(rng, 0.25, 0.5), filterDrive: R(rng, 0.15, 0.4),
      ampAttack: 0.004, ampDecay: 0.3, ampSustain: 0.8, ampRelease: 0.3,
      velAmount: R(rng, 0.45, 0.75),
      mono: true, glide: 0.04,
      chorusMix: 0,
      delayTime: 0.26, delayFeedback: 0.35, delayMix: R(rng, 0.12, 0.24),
      reverbMix: CH(rng, 0.5) ? R(rng, 0.08, 0.16) : 0, reverbSize: 2,
      drive: R(rng, 0.18, 0.38), driveMode: PK(rng, ["tube", "fold"] as DriveMode[]),
      stereoWidth: R(rng, 0.85, 1.1),
      tone: RI(rng, 11500, 15000), masterGain: 0.7,
    }}),
  },
  {
    category: "Lead",
    desc: "Hollow PWM anthem — pulse width on slow patrol",
    count: 11,
    names: {
      solo: ["PULSAR", "TELEGRAPH", "SEMAPHORE", "WAVEGUIDE", "INTERVAL", "MODULATOR", "BEACONRUN", "KEYER"],
      adj: ["Pulsing", "Hollow", "Square-Rig", "Shifting", "Breathing", "Duty-Cycle", "Keyed", "Signal-Corps"],
      core: ["Pulse", "PWM", "Carrier", "Beacon", "Wave", "Keying", "Trace", "Marker"],
    },
    make: (rng) => ({ patch: {
      oscATable: "pulse", oscAPos: R(rng, 0.15, 0.85), oscALfo: R(rng, 0.15, 0.45), oscALevel: 0.75,
      oscBTable: "pulse", oscBPos: R(rng, 0.2, 0.8), oscBDetune: RI(rng, 8, 18), oscBLevel: R(rng, 0.4, 0.6),
      oscCLevel: 0,
      unison: PK(rng, [3, 5, 5]), unisonDetune: RI(rng, 12, 26), unisonWidth: R(rng, 0.65, 0.95),
      subLevel: R(rng, 0.08, 0.25), noiseLevel: 0,
      filterType: "lowpass", filterCutoff: RI(rng, 3800, 7800), filterResonance: R(rng, 0.8, 2.5),
      filterEnvAmount: R(rng, 0.1, 0.35),
      lfo1Wave: "triangle", lfo1Rate: R(rng, 0.3, 1.4), lfo1Depth: 0.3, lfo1Dest: "off",
      ampAttack: R(rng, 0.008, 0.05), ampDecay: 0.3, ampSustain: 0.9, ampRelease: R(rng, 0.3, 0.55),
      velAmount: R(rng, 0.3, 0.6),
      chorusMix: R(rng, 0.25, 0.5), chorusRate: R(rng, 0.4, 0.9), chorusDepth: R(rng, 0.3, 0.6),
      delayMix: R(rng, 0.1, 0.24), delayTime: 0.3, delayFeedback: 0.32,
      reverbSize: 2.4, reverbMix: R(rng, 0.1, 0.22),
      drive: R(rng, 0, 0.12), stereoWidth: R(rng, 1.05, 1.3),
      mono: false, tone: 15500, masterGain: 0.68,
    }}),
  },
  {
    category: "Lead",
    desc: "Overdriven war-cry — resonance and fuzz at the redline",
    count: 11,
    names: {
      solo: ["WARCRY", "RAMPAGE", "BERSERKER", "ONSLAUGHT", "FRENZY", "MAYHEM", "BLOODRUSH", "SKIRMISHER"],
      adj: ["Raging", "Feral", "Blistering", "Violent", "White-Hot", "Unhinged", "Livid", "Scalding"],
      core: ["Fury", "Riot", "Assault", "Havoc", "Charge", "Melee", "Uproar", "Offensive"],
    },
    make: (rng) => ({ patch: {
      oscATable: PK(rng, ["saw", "growl", "sync"]), oscAPos: R(rng, 0.5, 0.9), oscALevel: 0.8,
      oscBTable: "saw", oscBPos: R(rng, 0.5, 0.8), oscBDetune: RI(rng, 10, 22), oscBLevel: R(rng, 0.4, 0.6),
      oscCLevel: 0,
      unison: PK(rng, [3, 5]), unisonDetune: RI(rng, 14, 26), unisonWidth: R(rng, 0.5, 0.8),
      subLevel: R(rng, 0.1, 0.25), noiseLevel: R(rng, 0.05, 0.16), noiseColor: R(rng, 0.4, 0.9),
      filterType: "lowpass", filterCutoff: RI(rng, 2200, 5000), filterResonance: R(rng, 4, 9),
      filterEnvAmount: R(rng, 0.3, 0.6), filterDrive: R(rng, 0.3, 0.6),
      ampAttack: 0.004, ampDecay: 0.3, ampSustain: 0.88, ampRelease: R(rng, 0.15, 0.35),
      velAmount: R(rng, 0.35, 0.65),
      mono: true, glide: R(rng, 0.025, 0.07),
      drive: R(rng, 0.35, 0.6), driveMode: PK(rng, ["fuzz", "hard"] as DriveMode[]),
      crush: CH(rng, 0.35) ? R(rng, 0.08, 0.25) : 0,
      chorusMix: 0,
      delayTime: 0.24, delayFeedback: 0.3, delayMix: R(rng, 0.08, 0.18),
      reverbMix: R(rng, 0.06, 0.14), reverbSize: 1.8,
      stereoWidth: R(rng, 0.9, 1.15), punch: R(rng, 0.2, 0.4),
      tone: RI(rng, 10000, 13500), masterGain: 0.64,
    }}),
  },

  // ═══════════════════════ PLUCK (60) ═══════════════════════
  {
    category: "Pluck",
    desc: "Crystal pluck — polished glass off the top of the mix",
    count: 10,
    names: {
      solo: ["PRISM", "STILETTO", "ICEPICK", "FACET", "GLINT", "SPINDLE", "SPARKLET", "CUTGLASS"],
      adj: ["Glass", "Crystal", "Prismatic", "Polished", "Frosted", "Cut", "Clear", "Faceted"],
      core: ["Pluck", "Shard", "Chime", "Needle", "Splinter", "Sliver", "Point", "Bevel"],
    },
    make: (rng) => ({ patch: {
      oscATable: PK(rng, ["saw", "harmonic"]), oscAPos: R(rng, 0.4, 0.85), oscAEnv: R(rng, -0.55, -0.2), oscALevel: 0.75,
      oscBTable: "harmonic", oscBPos: R(rng, 0.3, 0.7), oscBDetune: RI(rng, 5, 10), oscBLevel: R(rng, 0.3, 0.5),
      oscCLevel: 0,
      unison: 3, unisonDetune: RI(rng, 10, 18), unisonWidth: R(rng, 0.6, 0.9),
      subLevel: R(rng, 0.05, 0.22), noiseLevel: 0,
      filterType: "lowpass", filterCutoff: RI(rng, 3800, 7500), filterResonance: R(rng, 2, 5), filterKeyTrack: R(rng, 0.3, 0.6),
      filterEnvAmount: R(rng, 0.4, 0.65), filtDecay: R(rng, 0.1, 0.24), filtSustain: R(rng, 0, 0.15),
      modAttack: 0.001, modDecay: R(rng, 0.12, 0.26), modSustain: 0,
      ampAttack: 0.002, ampDecay: R(rng, 0.15, 0.32), ampSustain: 0, ampRelease: R(rng, 0.18, 0.38),
      velAmount: R(rng, 0.55, 0.9),
      chorusMix: 0,
      delayTime: PK(rng, [0.25, 0.3, 0.375]), delayFeedback: R(rng, 0.3, 0.45), delayMix: R(rng, 0.18, 0.35),
      reverbSize: R(rng, 2, 3.2), reverbMix: R(rng, 0.14, 0.3),
      drive: 0, stereoWidth: R(rng, 1, 1.25),
      tone: 15500, masterGain: 0.74,
    }}),
  },
  {
    category: "Pluck",
    desc: "Shadow pluck — matte, dark-filtered, close and dry",
    count: 10,
    names: {
      solo: ["NIGHTSTICK", "BLACKJACK", "SANDBAG", "TRUNCHEON", "SAPPER", "GLOOM", "COSH", "MIDNIGHTER"],
      adj: ["Dark", "Shadow", "Matte", "Charcoal", "Dusk", "Hooded", "Muted", "Smothered"],
      core: ["Dart", "Tap", "Knuckle", "Pin", "Peg", "Prod", "Poke", "Nudge"],
    },
    make: (rng) => ({ patch: {
      oscATable: PK(rng, ["metallic", "fold", "growl"]), oscAPos: R(rng, 0.15, 0.55), oscAEnv: R(rng, -0.6, -0.3), oscALevel: 0.75,
      oscBTable: "saw", oscBPos: R(rng, 0.4, 0.7), oscBOctave: -1, oscBLevel: R(rng, 0.2, 0.42),
      oscCLevel: 0,
      unison: PK(rng, [1, 1, 3]), unisonDetune: RI(rng, 8, 14), unisonWidth: 0.5,
      subLevel: R(rng, 0.12, 0.3), noiseLevel: 0,
      fmBtoA: CH(rng, 0.45) ? R(rng, 0.08, 0.3) : 0,
      filterType: "lowpass", filterCutoff: RI(rng, 1300, 3200), filterResonance: R(rng, 2.5, 6),
      filterEnvAmount: R(rng, 0.35, 0.6), filtDecay: R(rng, 0.08, 0.2), filtSustain: 0,
      modAttack: 0.001, modDecay: R(rng, 0.1, 0.22), modSustain: 0,
      ampAttack: 0.002, ampDecay: R(rng, 0.14, 0.3), ampSustain: 0, ampRelease: R(rng, 0.15, 0.3),
      velAmount: R(rng, 0.5, 0.85),
      chorusMix: 0,
      delayTime: 0.26, delayFeedback: 0.3, delayMix: CH(rng, 0.5) ? R(rng, 0.08, 0.18) : 0,
      reverbSize: 1.8, reverbMix: R(rng, 0.05, 0.14),
      drive: R(rng, 0.08, 0.22), driveMode: "tube", stereoWidth: R(rng, 0.75, 1),
      tone: RI(rng, 11000, 14000), masterGain: 0.74,
    }}),
  },
  {
    category: "Pluck",
    desc: "Bit-crushed chip stab — one-frame arcade hit",
    count: 10,
    names: {
      solo: ["ZAPPER", "BLEEP", "CHIPSHOT", "NIBBLE", "QUANTIZER", "BITKNOCK", "DATAPICK", "MICROJAB"],
      adj: ["Bit", "Blip", "Stubby", "Quantized", "Chunky", "Stepped", "Aliased", "Crunchy"],
      core: ["Stab", "Blip", "Byte", "Tick", "Click", "Register", "Burst", "Pip"],
    },
    make: (rng) => ({ patch: {
      oscATable: "chip", oscAPos: R(rng, 0, 1), oscAEnv: R(rng, -0.5, -0.2), oscALevel: 0.8,
      oscBTable: "pulse", oscBPos: R(rng, 0.2, 0.8), oscBOctave: PK(rng, [0, 0, 1, -1]), oscBDetune: RI(rng, 3, 9),
      oscBLevel: CH(rng, 0.5) ? R(rng, 0.2, 0.4) : 0,
      oscCLevel: 0, unison: PK(rng, [1, 1, 2]), unisonDetune: RI(rng, 6, 14), unisonWidth: R(rng, 0, 0.5),
      subLevel: R(rng, 0, 0.3), noiseLevel: 0,
      pitchEnvAmount: CH(rng, 0.4) ? RI(rng, 4, 12) : 0, pitchEnvTime: R(rng, 0.025, 0.06),
      filterType: "lowpass", filterCutoff: RI(rng, 3400, 9000), filterResonance: R(rng, 0.8, 4),
      filterEnvAmount: R(rng, 0.25, 0.55), filtDecay: R(rng, 0.06, 0.2), filtSustain: 0,
      modAttack: 0.001, modDecay: 0.15, modSustain: 0,
      ampAttack: 0.001, ampDecay: R(rng, 0.08, 0.26), ampSustain: 0, ampRelease: R(rng, 0.08, 0.24),
      velAmount: R(rng, 0.4, 0.8),
      crush: R(rng, 0.15, 0.55),
      lfo1Wave: "square", lfo1Rate: R(rng, 7, 11), lfo1Depth: CH(rng, 0.25) ? R(rng, 0.05, 0.1) : 0, lfo1Dest: "pitch",
      chorusMix: 0,
      delayTime: R(rng, 0.14, 0.26), delayFeedback: R(rng, 0.22, 0.42), delayMix: CH(rng, 0.65) ? R(rng, 0.12, 0.3) : 0,
      reverbMix: 0, drive: 0, stereoWidth: R(rng, 0.8, 1.15),
      tone: RI(rng, 11500, 16000), masterGain: 0.75,
    }}),
  },
  {
    category: "Pluck",
    desc: "Rounded mallet — wood-and-felt percussion detail",
    count: 10,
    names: {
      solo: ["TIMBER", "GAMELAN", "BAMBOO", "KALIMBA", "TONEWOOD", "WOODBLOCK", "RESONATOR", "MARIMBOX"],
      adj: ["Wooden", "Soft", "Rounded", "Mellow", "Velvet", "Felted", "Hollowed", "Lacquered"],
      core: ["Mallet", "Key", "Block", "Bar", "Bowl", "Gourd", "Drumlet", "Tine"],
    },
    make: (rng) => ({ patch: {
      oscATable: "bell", oscAPos: R(rng, 0.08, 0.4), oscAEnv: R(rng, -0.4, -0.15), oscALevel: 0.8,
      oscBTable: "basic", oscBPos: R(rng, 0, 0.2), oscBOctave: 1, oscBLevel: R(rng, 0.12, 0.3),
      oscCLevel: 0, unison: 1, unisonWidth: 0,
      subLevel: R(rng, 0.12, 0.3), noiseLevel: 0,
      filterType: "lowpass", filterCutoff: RI(rng, 2600, 5200), filterResonance: R(rng, 0.7, 1.8),
      filterEnvAmount: R(rng, 0.25, 0.45), filtDecay: R(rng, 0.18, 0.36), filtSustain: 0,
      modAttack: 0.001, modDecay: R(rng, 0.22, 0.45), modSustain: 0,
      ampAttack: 0.002, ampDecay: R(rng, 0.26, 0.5), ampSustain: 0, ampRelease: R(rng, 0.25, 0.5),
      velAmount: R(rng, 0.55, 0.9),
      chorusMix: CH(rng, 0.4) ? R(rng, 0.12, 0.3) : 0,
      delayTime: 0.32, delayFeedback: 0.32, delayMix: R(rng, 0.12, 0.26),
      reverbSize: R(rng, 2.2, 3.4), reverbMix: R(rng, 0.16, 0.32),
      drive: 0, stereoWidth: R(rng, 0.9, 1.15),
      tone: 14000, masterGain: 0.75,
    }}),
  },
  {
    category: "Pluck",
    desc: "Snap-zap pluck — pitch snaps down like a released spring",
    count: 10,
    names: {
      solo: ["SNAPSHOT", "RICOCHET", "HAIRPIN", "QUICKDRAW", "BOLTCUTTER", "TRIPWIRE", "FLICKKNIFE", "LATCHKEY"],
      adj: ["Snapped", "Sprung", "Instant", "Split-Second", "Cocked", "Twitchy", "Recoiling", "Live-Wire"],
      core: ["Zap", "Snap", "Trigger", "Bolt", "Flick", "Twang", "Release", "Recoil"],
    },
    make: (rng) => ({ patch: {
      oscATable: PK(rng, ["basic", "sync", "saw"]), oscAPos: R(rng, 0.5, 1), oscALevel: 0.8,
      oscBLevel: 0, oscCLevel: 0,
      unison: PK(rng, [1, 1, 3]), unisonDetune: RI(rng, 8, 14), unisonWidth: 0.4,
      subLevel: R(rng, 0.1, 0.3), noiseLevel: 0,
      pitchEnvAmount: RI(rng, 8, 30), pitchEnvTime: R(rng, 0.03, 0.12),
      filterType: "lowpass", filterCutoff: RI(rng, 2500, 6000), filterResonance: R(rng, 1.5, 4),
      filterEnvAmount: R(rng, 0.3, 0.55), filtDecay: R(rng, 0.06, 0.16), filtSustain: 0,
      ampAttack: 0.001, ampDecay: R(rng, 0.1, 0.22), ampSustain: 0, ampRelease: R(rng, 0.08, 0.18),
      velAmount: R(rng, 0.5, 0.85),
      punch: R(rng, 0.2, 0.45), filterDrive: CH(rng, 0.4) ? R(rng, 0.15, 0.35) : 0,
      chorusMix: 0, delayMix: CH(rng, 0.4) ? R(rng, 0.1, 0.2) : 0, delayTime: 0.22, delayFeedback: 0.3,
      reverbMix: R(rng, 0.04, 0.12), reverbSize: 1.6,
      drive: R(rng, 0.05, 0.18), stereoWidth: R(rng, 0.85, 1.05),
      tone: 15000, masterGain: 0.76,
    }}),
  },
  {
    category: "Pluck",
    desc: "Uplift trance pluck — wide unison into a long wash",
    count: 10,
    names: {
      solo: ["UPLIFTER", "ALTITUDE", "THERMAL", "GLIDEPATH", "CUMULUS", "IONOSPHERE", "AIRLIFT", "APEXPOINT"],
      adj: ["Lifted", "Rushing", "Airy", "Ascending", "Weightless", "Climbing", "Billowing", "Updrafted"],
      core: ["Lift", "Rush", "Skylift", "Step", "Draft", "Buoy", "Crest", "Soar"],
    },
    make: (rng) => ({ patch: {
      oscATable: "saw", oscAPos: R(rng, 0.5, 0.85), oscAEnv: R(rng, -0.45, -0.15), oscALevel: 0.72,
      oscBTable: PK(rng, ["saw", "pulse"]), oscBPos: R(rng, 0.4, 0.7), oscBDetune: RI(rng, 8, 16), oscBLevel: R(rng, 0.4, 0.58),
      oscCLevel: 0,
      unison: 5, unisonDetune: RI(rng, 14, 26), unisonWidth: R(rng, 0.8, 1),
      subLevel: R(rng, 0.05, 0.18), noiseLevel: 0,
      filterType: "lowpass", filterCutoff: RI(rng, 3200, 6800), filterResonance: R(rng, 1.5, 3.5),
      filterEnvAmount: R(rng, 0.35, 0.55), filtDecay: R(rng, 0.12, 0.24), filtSustain: R(rng, 0, 0.12),
      modAttack: 0.001, modDecay: R(rng, 0.14, 0.26), modSustain: 0,
      ampAttack: 0.002, ampDecay: R(rng, 0.16, 0.3), ampSustain: 0, ampRelease: R(rng, 0.22, 0.4),
      velAmount: R(rng, 0.35, 0.65),
      chorusMix: R(rng, 0.15, 0.35),
      delayTime: PK(rng, [0.25, 0.3, 0.375]), delayFeedback: R(rng, 0.35, 0.5), delayMix: R(rng, 0.2, 0.38),
      reverbSize: R(rng, 2.6, 4), reverbMix: R(rng, 0.22, 0.42),
      drive: 0, stereoWidth: R(rng, 1.1, 1.35),
      tone: 15500, masterGain: 0.7,
    }}),
  },

  // ═══════════════════════ PAD (70) ═══════════════════════
  {
    category: "Pad",
    desc: "Warm analog blanket — slow filter weather over saw stacks",
    count: 10,
    names: {
      solo: ["WARMFRONT", "HEARTHSIDE", "EMBERGLOW", "SOLSTICE", "AFTERGLOW", "INSULATION", "EIDERDOWN", "LATESUMMER"],
      adj: ["Warm", "Analog", "Amber", "Golden", "Soft-Focus", "Sunlit", "Faded", "Honeyed"],
      core: ["Pad", "Blanket", "Field", "Glow", "Layer", "Wash", "Meadow", "Quilt"],
    },
    make: (rng) => ({ patch: {
      oscATable: "saw", oscAPos: R(rng, 0.3, 0.6), oscALevel: 0.7,
      oscBTable: "saw", oscBPos: R(rng, 0.4, 0.7), oscBDetune: RI(rng, 8, 16), oscBLevel: R(rng, 0.45, 0.65),
      oscCLevel: 0,
      unison: 5, unisonDetune: RI(rng, 12, 20), unisonWidth: R(rng, 0.7, 0.95),
      subLevel: R(rng, 0.12, 0.3), noiseLevel: 0,
      filterType: "lowpass", filterCutoff: RI(rng, 1200, 2600), filterResonance: R(rng, 0.7, 1.8),
      filterEnvAmount: R(rng, 0.1, 0.3), filtAttack: R(rng, 0.5, 1.2), filtSustain: 0.6,
      ampAttack: R(rng, 0.6, 1.4), ampDecay: 0.7, ampSustain: R(rng, 0.8, 0.95), ampRelease: R(rng, 1.2, 2.2),
      velAmount: R(rng, 0.15, 0.4),
      lfo1Wave: "sine", lfo1Rate: R(rng, 0.12, 0.4), lfo1Depth: R(rng, 0.22, 0.5), lfo1Dest: "filter",
      chorusRate: 0.35, chorusDepth: R(rng, 0.4, 0.7), chorusMix: R(rng, 0.35, 0.6),
      delayMix: 0,
      reverbSize: R(rng, 3, 4.5), reverbMix: R(rng, 0.22, 0.4),
      drive: R(rng, 0, 0.08), driveMode: "tube", stereoWidth: R(rng, 1.05, 1.25),
      drift: R(rng, 0.1, 0.3),
      tone: 13500, masterGain: 0.62,
    }}),
  },
  {
    category: "Pad",
    desc: "Vaulted choir — synthetic voices in a stone nave",
    count: 10,
    names: {
      solo: ["SANCTUM", "EVENSONG", "REQUIEM", "BASILICA", "LITURGY", "VESPERS", "PSALTERY", "CLOISTER"],
      adj: ["Choral", "Sacred", "Hallowed", "Vaulted", "Monastic", "Candlelit", "Processional", "Gregorian"],
      core: ["Choir", "Voices", "Chorale", "Congregation", "Mass", "Nave", "Antiphon", "Benediction"],
    },
    make: (rng) => ({ patch: {
      oscATable: "vocal", oscAPos: R(rng, 0.25, 0.6), oscALfo: R(rng, 0.1, 0.3), oscALevel: 0.7,
      oscBTable: "vocal", oscBPos: R(rng, 0.5, 0.85), oscBOctave: CH(rng, 0.6) ? 1 : 0, oscBDetune: RI(rng, 4, 9), oscBLevel: R(rng, 0.32, 0.5),
      oscCLevel: 0,
      unison: 4, unisonDetune: RI(rng, 10, 18), unisonWidth: R(rng, 0.8, 1),
      subLevel: R(rng, 0.05, 0.16), noiseLevel: CH(rng, 0.5) ? R(rng, 0.02, 0.06) : 0, noiseColor: R(rng, 0.4, 0.8),
      filterType: "lowpass", filterCutoff: RI(rng, 2400, 4200), filterResonance: R(rng, 0.7, 1.6),
      filterEnvAmount: R(rng, 0, 0.15),
      ampAttack: R(rng, 0.9, 1.8), ampDecay: 1, ampSustain: 0.9, ampRelease: R(rng, 1.8, 3),
      velAmount: R(rng, 0.1, 0.35),
      lfo1Wave: "sine", lfo1Rate: R(rng, 0.07, 0.2), lfo1Depth: R(rng, 0.2, 0.4), lfo1Dest: "pan",
      chorusRate: 0.3, chorusDepth: R(rng, 0.5, 0.8), chorusMix: R(rng, 0.45, 0.7),
      delayMix: 0,
      reverbSize: R(rng, 4, 5.5), reverbMix: R(rng, 0.32, 0.55),
      drive: 0, stereoWidth: R(rng, 1.1, 1.35),
      tone: 14500, masterGain: 0.58,
    }}),
  },
  {
    category: "Pad",
    desc: "Buried drone — low ring-mod dread under the floorboards",
    count: 10,
    names: {
      solo: ["UNDERCROFT", "CATACOMB", "OUBLIETTE", "SEPULCHER", "BLACKSITE", "CREVASSE", "ABYSSAL", "SUBLEVEL"],
      adj: ["Ominous", "Black", "Sunken", "Buried", "Grim", "Starless", "Airless", "Entombed"],
      core: ["Drone", "Hover", "Shroud", "Pit", "Crypt", "Void", "Cellar", "Underlayer"],
    },
    make: (rng) => ({ patch: {
      oscATable: PK(rng, ["growl", "vocal", "metallic"]), oscAPos: R(rng, 0.08, 0.4), oscALfo: R(rng, 0.08, 0.25), oscALevel: 0.62,
      oscBTable: PK(rng, ["metallic", "growl"]), oscBPos: R(rng, 0.2, 0.5), oscBOctave: -1, oscBLevel: R(rng, 0.28, 0.5),
      oscCLevel: 0,
      unison: 2, unisonDetune: RI(rng, 8, 14), unisonWidth: 0.6,
      subWave: "sine", subLevel: R(rng, 0.45, 0.75), noiseLevel: 0,
      ringAmount: R(rng, 0.06, 0.22), ringFreq: R(rng, 35, 90),
      fmBtoA: CH(rng, 0.4) ? R(rng, 0.05, 0.2) : 0,
      filterType: "lowpass", filterCutoff: RI(rng, 400, 900), filterResonance: R(rng, 1.5, 3.5),
      filterEnvAmount: R(rng, 0, 0.12),
      ampAttack: R(rng, 0.5, 1.1), ampDecay: 0.5, ampSustain: 0.9, ampRelease: R(rng, 1, 2),
      velAmount: R(rng, 0.1, 0.3),
      lfo1Wave: "sine", lfo1Rate: R(rng, 0.08, 0.25), lfo1Depth: R(rng, 0.25, 0.5), lfo1Dest: "filter",
      chorusMix: 0, delayMix: 0,
      reverbSize: R(rng, 4, 5.5), reverbMix: R(rng, 0.22, 0.4),
      drive: R(rng, 0.08, 0.22), driveMode: "tube", stereoWidth: R(rng, 0.85, 1.1),
      tone: RI(rng, 7000, 10000), masterGain: 0.64,
    }}),
  },
  {
    category: "Pad",
    desc: "Silver shimmer — high glass and breath over the ceiling",
    count: 10,
    names: {
      solo: ["STARFIELD", "IRIDIUM", "GOSSAMER", "PARHELION", "LUMENFALL", "SPECTRALINE", "HALOGEN", "STARDUST"],
      adj: ["Shimmering", "Glinting", "Silver", "Spectral", "Opaline", "Luminous", "Pearline", "Moonlit"],
      core: ["Shimmer", "Halo", "Veil", "Gleam", "Aura", "Corona", "Glitter", "Icelight"],
    },
    make: (rng) => ({ patch: {
      oscATable: "harmonic", oscAPos: R(rng, 0.5, 0.85), oscALfo: R(rng, 0.15, 0.4), oscALevel: 0.6,
      oscBTable: "bell", oscBPos: R(rng, 0.4, 0.8), oscBOctave: 1, oscBDetune: RI(rng, 4, 10), oscBLevel: R(rng, 0.25, 0.42),
      oscCLevel: 0,
      unison: 4, unisonDetune: RI(rng, 12, 20), unisonWidth: R(rng, 0.85, 1),
      subLevel: 0, noiseLevel: R(rng, 0.03, 0.09), noiseColor: R(rng, 0.4, 0.9),
      filterType: PK(rng, ["highpass", "lowpass"] as FireFilterType[]),
      filterCutoff: RI(rng, 500, 1100), filterResonance: R(rng, 0.7, 1.5),
      filterEnvAmount: 0,
      ampAttack: R(rng, 1.2, 2.4), ampDecay: 1, ampSustain: 0.9, ampRelease: R(rng, 2, 3.4),
      velAmount: R(rng, 0.1, 0.3),
      lfo1Wave: "sine", lfo1Rate: R(rng, 0.1, 0.25), lfo1Depth: R(rng, 0.35, 0.7), lfo1Dest: "pan",
      chorusRate: 0.3, chorusDepth: R(rng, 0.5, 0.75), chorusMix: R(rng, 0.4, 0.65),
      delayTime: 0.45, delayFeedback: R(rng, 0.4, 0.55), delayMix: R(rng, 0.2, 0.38),
      reverbSize: R(rng, 4.5, 6), reverbMix: R(rng, 0.38, 0.55),
      drive: 0, stereoWidth: R(rng, 1.15, 1.4),
      tone: 15500, masterGain: 0.56,
    }}),
  },
  {
    category: "Pad",
    desc: "Rotating motion pad — phaser and pan on slow gimbals",
    count: 10,
    names: {
      solo: ["GYRE", "VORTEX", "ORRERY", "MAELSTROM", "ROTORWASH", "CYCLOID", "PERIHELION", "LISSAJOUS"],
      adj: ["Swirling", "Orbiting", "Turning", "Phased", "Rotating", "Precessing", "Gimbaled", "Slow-Spun"],
      core: ["Motion", "Swirl", "Orbit", "Phase", "Spiral", "Current", "Revolution", "Carousel"],
    },
    make: (rng) => ({ patch: {
      oscATable: "additive", oscAPos: R(rng, 0.3, 0.6), oscALfo: R(rng, 0.15, 0.35), oscALevel: 0.62,
      oscBTable: "formant2", oscBPos: R(rng, 0.4, 0.7), oscBDetune: RI(rng, 7, 12), oscBLevel: R(rng, 0.38, 0.55),
      oscCTable: "saw", oscCPos: 0.5, oscCOctave: -1, oscCDetune: RI(rng, -9, -4), oscCLevel: CH(rng, 0.6) ? R(rng, 0.25, 0.45) : 0,
      unison: 3, unisonDetune: RI(rng, 10, 18), unisonWidth: R(rng, 0.8, 1),
      subLevel: R(rng, 0.08, 0.22), noiseLevel: 0,
      filterType: "lowpass", filterCutoff: RI(rng, 1800, 3400), filterResonance: R(rng, 1, 2.5),
      filterEnvAmount: R(rng, 0, 0.2),
      ampAttack: R(rng, 0.7, 1.3), ampDecay: 0.7, ampSustain: 0.88, ampRelease: R(rng, 1.4, 2.4),
      velAmount: R(rng, 0.1, 0.35),
      phaserRate: R(rng, 0.12, 0.5), phaserDepth: R(rng, 0.6, 0.9), phaserMix: R(rng, 0.35, 0.6),
      lfo2Wave: "sine", lfo2Rate: R(rng, 0.08, 0.22), lfo2Depth: R(rng, 0.4, 0.75), lfo2Dest: "pan",
      chorusMix: R(rng, 0.25, 0.5),
      delayMix: 0,
      reverbSize: R(rng, 3.4, 4.6), reverbMix: R(rng, 0.26, 0.45),
      drive: 0, stereoWidth: R(rng, 1.1, 1.35),
      tone: 14000, masterGain: 0.58,
    }}),
  },
  {
    category: "Pad",
    desc: "Holographic glass pad — clinical digital sheen, extra-wide",
    count: 10,
    names: {
      solo: ["VITRINE", "PERSPEX", "LUCITE", "WINDOWPANE", "HOLOGRAM", "MONITORGLOW", "RENDERFARM", "WIREFRAME"],
      adj: ["Digital", "Vitreous", "Clinical", "Holographic", "Translucent", "Backlit", "Anodized", "Polymer"],
      core: ["Glass", "Pane", "Screen", "Lattice", "Matrix", "Facade", "Glasswork", "Membrane"],
    },
    make: (rng) => ({ patch: {
      oscATable: PK(rng, ["additive", "metallic"]), oscAPos: R(rng, 0.25, 0.6), oscAEnv: R(rng, 0.1, 0.4), oscALevel: 0.64,
      oscBTable: PK(rng, ["bell", "harmonic"]), oscBPos: R(rng, 0.3, 0.7), oscBDetune: RI(rng, 5, 11), oscBLevel: R(rng, 0.3, 0.5),
      oscCLevel: 0,
      unison: PK(rng, [3, 4]), unisonDetune: RI(rng, 8, 16), unisonWidth: R(rng, 0.8, 1),
      subLevel: R(rng, 0.05, 0.15), noiseLevel: 0,
      filterType: "lowpass", filterCutoff: RI(rng, 2600, 5000), filterResonance: R(rng, 0.7, 1.8),
      filterEnvAmount: R(rng, 0.05, 0.25),
      modAttack: R(rng, 0.8, 1.6), modDecay: 1.2, modSustain: R(rng, 0.3, 0.6),
      ampAttack: R(rng, 0.5, 1.1), ampDecay: 0.8, ampSustain: 0.9, ampRelease: R(rng, 1.2, 2.2),
      velAmount: R(rng, 0.15, 0.4),
      chorusMix: R(rng, 0.2, 0.45),
      delayTime: R(rng, 0.35, 0.5), delayFeedback: R(rng, 0.35, 0.5), delayMix: R(rng, 0.15, 0.3),
      reverbSize: R(rng, 3, 4.2), reverbMix: R(rng, 0.2, 0.38),
      drive: 0, drift: R(rng, 0.15, 0.4), stereoWidth: R(rng, 1.2, 1.4),
      tone: 15000, masterGain: 0.6,
    }}),
  },
  {
    category: "Pad",
    desc: "Synthetic string section — bowed ensemble at the ready",
    count: 10,
    names: {
      solo: ["ENSEMBLE", "ARCO", "CANTABILE", "SOLINA", "OCTETTE", "CHAMBERLINE", "ROSINWIRE", "VIBRATO"],
      adj: ["Bowed", "Orchestral", "Cinematic", "Sweeping", "Strung", "Legato", "Sustained", "Symphonic"],
      core: ["Strings", "Section", "Octet", "Chamber", "Score", "Cellos", "Violas", "Tutti"],
    },
    make: (rng) => ({ patch: {
      oscATable: "saw", oscAPos: R(rng, 0.35, 0.6), oscALevel: 0.7,
      oscBTable: "pulse", oscBPos: R(rng, 0.3, 0.6), oscBDetune: RI(rng, 6, 14), oscBLevel: R(rng, 0.35, 0.55),
      oscCTable: "saw", oscCPos: 0.5, oscCOctave: -1, oscCDetune: RI(rng, -6, 6), oscCLevel: CH(rng, 0.5) ? R(rng, 0.2, 0.38) : 0,
      unison: PK(rng, [4, 5]), unisonDetune: RI(rng, 10, 18), unisonWidth: R(rng, 0.7, 0.95),
      subLevel: R(rng, 0.05, 0.18), noiseLevel: 0,
      filterType: "lowpass", filterCutoff: RI(rng, 2000, 4200), filterResonance: R(rng, 0.7, 1.6),
      filterEnvAmount: R(rng, 0.08, 0.25), filtAttack: R(rng, 0.2, 0.5),
      ampAttack: R(rng, 0.25, 0.6), ampDecay: 0.5, ampSustain: R(rng, 0.85, 0.95), ampRelease: R(rng, 0.7, 1.4),
      velAmount: R(rng, 0.25, 0.5),
      lfo1Wave: "sine", lfo1Rate: R(rng, 4.5, 6), lfo1Depth: R(rng, 0.03, 0.09), lfo1Dest: "pitch",
      chorusRate: R(rng, 0.4, 0.8), chorusDepth: R(rng, 0.45, 0.7), chorusMix: R(rng, 0.35, 0.6),
      delayMix: 0,
      reverbSize: R(rng, 2.6, 3.8), reverbMix: R(rng, 0.2, 0.36),
      drive: R(rng, 0, 0.06), stereoWidth: R(rng, 1.05, 1.3),
      tone: 14000, masterGain: 0.62,
    }}),
  },

  // ═══════════════════════ KEYS (50) ═══════════════════════
  {
    category: "Keys",
    desc: "Velvet electric piano — FM tines with velocity under the hood",
    count: 10,
    names: {
      solo: ["SUITCASE", "TINEDECK", "NIGHTSHIFT", "VELVETEEN", "SPEAKEASY", "AFTERHOURS", "BALLADEER", "LOUNGECAR"],
      adj: ["Electric", "Velvet", "Smoky", "Mellow", "Dusty", "Late-Night", "Brushed", "Amber-Lit"],
      core: ["Piano", "Keys", "Tines", "Ivories", "EP", "Chords", "Comping", "Ballad"],
    },
    make: (rng) => ({ patch: {
      oscATable: "bell", oscAPos: R(rng, 0.25, 0.55), oscAEnv: R(rng, -0.35, -0.15), oscALevel: 0.78,
      oscBTable: "bell", oscBPos: R(rng, 0.5, 0.8), oscBOctave: 1, oscBDetune: RI(rng, 2, 6), oscBLevel: R(rng, 0.22, 0.4),
      oscCLevel: 0, unison: 1, unisonWidth: 0,
      subLevel: R(rng, 0.06, 0.18), noiseLevel: 0,
      filterType: "lowpass", filterCutoff: RI(rng, 4500, 7500), filterResonance: R(rng, 0.7, 1.5), filterKeyTrack: R(rng, 0.4, 0.7),
      filterEnvAmount: R(rng, 0.18, 0.35), filtDecay: R(rng, 0.3, 0.5), filtSustain: R(rng, 0.15, 0.3),
      modAttack: 0.001, modDecay: R(rng, 0.5, 0.9), modSustain: 0,
      ampAttack: 0.002, ampDecay: R(rng, 0.5, 0.85), ampSustain: R(rng, 0.2, 0.4), ampRelease: R(rng, 0.35, 0.7),
      velAmount: R(rng, 0.6, 0.9),
      chorusRate: R(rng, 0.4, 0.9), chorusDepth: R(rng, 0.3, 0.5), chorusMix: R(rng, 0.22, 0.45),
      delayTime: 0.3, delayFeedback: 0.3, delayMix: R(rng, 0.06, 0.16),
      reverbSize: R(rng, 2.2, 3.2), reverbMix: R(rng, 0.14, 0.28),
      drive: R(rng, 0, 0.1), driveMode: "tube", stereoWidth: R(rng, 0.95, 1.15),
      tone: 15500, masterGain: 0.72,
      modMatrix: makeModMatrix([MR("velocity", "cutoff", R(rng, 0.25, 0.5))]),
    }}),
  },
  {
    category: "Keys",
    desc: "Tonewheel organ — drawbars, vibrato and tube breath",
    count: 10,
    names: {
      solo: ["DRAWBAR", "TONEWHEEL", "CHAPELHILL", "PIPEWORKS", "REVIVALIST", "ROTORGRILLE", "PULPIT", "CONGREGANT"],
      adj: ["Rotary", "Breathy", "Percussive", "Full-Stop", "Whirling", "Smoldering", "Sunday", "Vented"],
      core: ["Organ", "Drawbars", "Pipes", "Wheel", "Manual", "Registers", "Bench", "Loft"],
    },
    make: (rng) => ({ patch: {
      oscATable: "additive", oscAPos: R(rng, 0.15, 0.9), oscALevel: 0.75,
      oscBTable: "additive", oscBPos: R(rng, 0.25, 0.75), oscBOctave: PK(rng, [1, 1, 2]), oscBLevel: R(rng, 0.12, 0.45),
      oscCLevel: 0, unison: 1, unisonWidth: 0,
      subLevel: R(rng, 0.1, 0.4),
      // Optional key-click breath — a whisper of bright noise on each press.
      noiseLevel: CH(rng, 0.4) ? R(rng, 0.015, 0.05) : 0, noiseColor: R(rng, 0.5, 0.9),
      filterType: "lowpass", filterCutoff: RI(rng, 3200, 8000), filterResonance: 0.7,
      filterEnvAmount: CH(rng, 0.35) ? R(rng, 0.1, 0.2) : 0, filtDecay: R(rng, 0.06, 0.14), filtSustain: 0,
      ampAttack: PK(rng, [0.003, 0.004, 0.012]), ampDecay: 0.1, ampSustain: 0.95, ampRelease: R(rng, 0.05, 0.2),
      velAmount: R(rng, 0.05, 0.4),
      // Rotary speed: slow chorale vs fast tremolo cabinet.
      lfo1Wave: "sine", lfo1Rate: PK(rng, [0.8, 5.6, 6.2, 6.8]), lfo1Depth: CH(rng, 0.75) ? R(rng, 0.04, 0.13) : 0, lfo1Dest: "volume",
      chorusRate: PK(rng, [0.9, 1.3, 4.8, 6]), chorusDepth: R(rng, 0.25, 0.6), chorusMix: R(rng, 0.2, 0.55),
      delayMix: 0,
      reverbSize: R(rng, 1.4, 3), reverbMix: R(rng, 0.05, 0.26),
      drive: R(rng, 0.05, 0.32), driveMode: PK(rng, ["tube", "tube", "soft"] as DriveMode[]), stereoWidth: R(rng, 0.9, 1.25),
      tone: RI(rng, 12500, 15500), masterGain: 0.7,
    }}),
  },
  {
    category: "Keys",
    desc: "Wired funk clav — quack filter answering the velocity",
    count: 10,
    names: {
      solo: ["FUNKLINE", "STRUTTER", "BOOGALOO", "JIVEWIRE", "GETDOWN", "VAMPSTAMP", "GREASEFIRE", "SLAPBACK"],
      adj: ["Funky", "Greasy", "Percussive", "Syncopated", "Wired", "Rubber", "Strutting", "Slinky"],
      core: ["Clav", "Vamp", "Strut", "Comp", "Riff", "Groove", "Pocket", "Wah"],
    },
    make: (rng) => ({ patch: {
      oscATable: "pulse", oscAPos: R(rng, 0.5, 0.9), oscAEnv: R(rng, -0.4, -0.2), oscALevel: 0.78,
      oscBTable: "saw", oscBPos: R(rng, 0.5, 0.8), oscBDetune: RI(rng, 4, 9), oscBLevel: R(rng, 0.25, 0.45),
      oscCLevel: 0, unison: 1, unisonWidth: 0,
      subLevel: R(rng, 0.08, 0.2), noiseLevel: 0,
      filterType: "lowpass", filterCutoff: RI(rng, 1800, 3800), filterResonance: R(rng, 3, 6.5),
      filterEnvAmount: R(rng, 0.4, 0.65), filtDecay: R(rng, 0.1, 0.2), filtSustain: R(rng, 0.08, 0.25),
      filterDrive: CH(rng, 0.5) ? R(rng, 0.12, 0.3) : 0,
      modAttack: 0.001, modDecay: 0.15, modSustain: 0,
      ampAttack: 0.002, ampDecay: R(rng, 0.22, 0.42), ampSustain: R(rng, 0.22, 0.45), ampRelease: R(rng, 0.08, 0.18),
      velAmount: R(rng, 0.65, 0.95),
      chorusMix: 0, delayMix: 0, reverbMix: R(rng, 0.03, 0.1), reverbSize: 1.6,
      drive: R(rng, 0.12, 0.3), driveMode: "tube", punch: R(rng, 0.2, 0.42),
      stereoWidth: R(rng, 0.85, 1.05),
      tone: 13500, masterGain: 0.74,
      modMatrix: makeModMatrix([MR("velocity", "cutoff", R(rng, 0.35, 0.65))]),
    }}),
  },
  {
    category: "Keys",
    desc: "Peak-time rave stab — brass-bright chords for the drop",
    count: 10,
    names: {
      solo: ["WAREHOUSE", "RAVEHORN", "STROBELIT", "MAINROOM", "PEAKTIME", "PODIUM", "CLUBLAND", "AIRHORN"],
      adj: ["Rave", "Peak-Time", "Big-Room", "Classic", "Strobing", "Hands-Up", "Sweat-Soaked", "Sirened"],
      core: ["Stab", "Chord", "Jack", "Hit", "Hook", "Slice", "Drop", "Riser-Key"],
    },
    make: (rng) => ({ patch: {
      oscATable: PK(rng, ["saw", "pulse"]), oscAPos: R(rng, 0.55, 0.9), oscAEnv: R(rng, -0.35, -0.1), oscALevel: 0.78,
      oscBTable: "saw", oscBPos: R(rng, 0.5, 0.8), oscBDetune: RI(rng, 8, 16), oscBLevel: R(rng, 0.4, 0.6),
      oscCTable: "pulse", oscCPos: R(rng, 0.3, 0.7), oscCOctave: 1, oscCLevel: CH(rng, 0.45) ? R(rng, 0.2, 0.38) : 0,
      unison: PK(rng, [3, 5]), unisonDetune: RI(rng, 12, 22), unisonWidth: R(rng, 0.6, 0.9),
      subLevel: R(rng, 0.08, 0.2), noiseLevel: 0,
      filterType: "lowpass", filterCutoff: RI(rng, 3200, 6500), filterResonance: R(rng, 1.5, 3.5),
      filterEnvAmount: R(rng, 0.3, 0.5), filtDecay: R(rng, 0.12, 0.24), filtSustain: R(rng, 0.1, 0.3),
      modAttack: 0.001, modDecay: R(rng, 0.12, 0.24), modSustain: 0,
      ampAttack: 0.002, ampDecay: R(rng, 0.25, 0.45), ampSustain: R(rng, 0.15, 0.4), ampRelease: R(rng, 0.12, 0.26),
      velAmount: R(rng, 0.5, 0.8),
      chorusMix: R(rng, 0.1, 0.3),
      delayTime: R(rng, 0.18, 0.28), delayFeedback: R(rng, 0.2, 0.34), delayMix: R(rng, 0.08, 0.2),
      reverbSize: R(rng, 1.8, 2.6), reverbMix: R(rng, 0.08, 0.18),
      drive: R(rng, 0.1, 0.26), driveMode: PK(rng, ["soft", "tube"] as DriveMode[]), punch: R(rng, 0.25, 0.5),
      stereoWidth: R(rng, 1, 1.25),
      tone: 15000, masterGain: 0.7,
    }}),
  },
  {
    category: "Keys",
    desc: "Cast bells — long tolling decays in open air",
    count: 10,
    names: {
      solo: ["CARILLON", "GLOCKEN", "STEEPLE", "BELFRY", "ANGELUS", "TOLLGATE", "CAMPANILE", "PEALBREAK"],
      adj: ["Tolling", "Ringing", "Cast-Iron", "Brazen", "Wintry", "Distant", "Struck", "Weathered"],
      core: ["Bells", "Bell", "Chime", "Toll", "Peal", "Knell", "Clapper", "Bronze"],
    },
    make: (rng) => ({ patch: {
      oscATable: "bell", oscAPos: R(rng, 0.35, 0.75), oscAEnv: R(rng, -0.3, -0.1), oscALevel: 0.78,
      oscBTable: "metallic", oscBPos: R(rng, 0.2, 0.5), oscBOctave: 1, oscBDetune: RI(rng, 3, 8), oscBLevel: R(rng, 0.15, 0.32),
      oscCLevel: 0, unison: PK(rng, [1, 2]), unisonDetune: 8, unisonWidth: R(rng, 0.4, 0.7),
      subLevel: R(rng, 0.04, 0.14), noiseLevel: 0,
      fmAmount: CH(rng, 0.45) ? R(rng, 0.06, 0.18) : 0, fmRatio: PK(rng, [3, 3.5, 5, 7]),
      filterType: "lowpass", filterCutoff: RI(rng, 5000, 9000), filterResonance: R(rng, 0.7, 1.4),
      filterEnvAmount: R(rng, 0.1, 0.25), filtDecay: R(rng, 0.5, 0.9), filtSustain: 0,
      modAttack: 0.001, modDecay: R(rng, 0.8, 1.4), modSustain: 0,
      ampAttack: 0.002, ampDecay: R(rng, 0.9, 1.6), ampSustain: 0, ampRelease: R(rng, 1, 2.4),
      velAmount: R(rng, 0.5, 0.8),
      chorusMix: 0, delayTime: 0.38, delayFeedback: R(rng, 0.3, 0.45), delayMix: R(rng, 0.1, 0.24),
      reverbSize: R(rng, 3, 4.5), reverbMix: R(rng, 0.25, 0.45),
      drive: 0, stereoWidth: R(rng, 1, 1.3),
      tone: 16000, masterGain: 0.7,
    }}),
  },

  // ═══════════════════════ ARP (50) ═══════════════════════
  {
    category: "Arp",
    desc: "Relentless trance engine — sixteenths locked on the horizon",
    count: 10,
    names: {
      solo: ["INTERSTATE", "AUTOBAHN", "REDLINE", "HYPERLANE", "TAILLIGHT", "ODOMETER", "OVERPASS", "NIGHTDRIVE"],
      adj: ["Driving", "Relentless", "Highway", "Locked", "Midnight", "Full-Throttle", "Cruising", "Vanishing"],
      core: ["Sequence", "Run", "Cadence", "Motorik", "Pattern", "Lane", "Mile", "Pursuit"],
    },
    make: (rng) => ({
      patch: {
        oscATable: "saw", oscAPos: R(rng, 0.4, 0.7), oscAEnv: R(rng, 0.25, 0.5), oscALevel: 0.75,
        oscBTable: "saw", oscBPos: R(rng, 0.5, 0.7), oscBDetune: RI(rng, 7, 13), oscBLevel: R(rng, 0.4, 0.55),
        oscCLevel: 0,
        unison: 3, unisonDetune: RI(rng, 12, 18), unisonWidth: R(rng, 0.5, 0.8),
        subLevel: R(rng, 0.05, 0.16), noiseLevel: 0,
        filterType: "lowpass", filterCutoff: RI(rng, 1800, 3400), filterResonance: R(rng, 2, 4.5),
        filterEnvAmount: R(rng, 0.3, 0.5), filtDecay: R(rng, 0.12, 0.24), filtSustain: R(rng, 0.2, 0.4),
        modAttack: 0.002, modDecay: 0.2, modSustain: 0.2,
        ampAttack: 0.003, ampDecay: 0.2, ampSustain: R(rng, 0.4, 0.6), ampRelease: 0.18,
        velAmount: R(rng, 0.3, 0.55),
        chorusMix: R(rng, 0.15, 0.35),
        delayTime: PK(rng, [0.22, 0.25, 0.3, 0.375]), delayFeedback: R(rng, 0.35, 0.5), delayMix: R(rng, 0.2, 0.36),
        reverbSize: 2, reverbMix: R(rng, 0.1, 0.2),
        drive: R(rng, 0.06, 0.18), filterDrive: CH(rng, 0.4) ? R(rng, 0.1, 0.28) : 0,
        stereoWidth: R(rng, 1, 1.25),
        tone: 14500, masterGain: 0.72,
      },
      arp: {
        enabled: true, mode: PK(rng, ["up", "up", "updown"] as const), bpm: RI(rng, 126, 142),
        division: "1/16", octaves: PK(rng, [1, 2, 2]), gate: R(rng, 0.5, 0.8),
      },
    }),
  },
  {
    category: "Arp",
    desc: "Machine telemetry — random sample-and-hold chatter",
    count: 10,
    names: {
      solo: ["AUTOMATON", "TELETYPE", "MAINFRAME", "PUNCHCARD", "DATAFEED", "CALCULATRON", "ROBOTICA", "RELAYRACK"],
      adj: ["Random", "Robotic", "Telemetric", "Stochastic", "Machined", "Clattering", "Printed", "Ticker-Tape"],
      core: ["Chatter", "Code", "Telemetry", "Readout", "Datastream", "Printout", "Ticker", "Registry"],
    },
    make: (rng) => ({
      patch: {
        oscATable: PK(rng, ["basic", "chip", "pulse"]), oscAPos: R(rng, 0.6, 1), oscALfo: R(rng, 0.25, 0.5), oscALevel: 0.78,
        oscBTable: "basic", oscBPos: R(rng, 0.6, 1), oscBDetune: RI(rng, 3, 8), oscBLevel: R(rng, 0.18, 0.4),
        oscCLevel: 0, unison: 1, unisonWidth: 0,
        subLevel: R(rng, 0, 0.12), noiseLevel: 0,
        filterType: "lowpass", filterCutoff: RI(rng, 2200, 4400), filterResonance: R(rng, 3, 6.5),
        filterEnvAmount: R(rng, 0.1, 0.3),
        lfo1Wave: "sample-hold", lfo1Rate: R(rng, 6, 13), lfo1Depth: R(rng, 0.35, 0.7),
        lfo1Dest: PK(rng, ["pitch", "filter", "filter"] as const),
        ampAttack: 0.001, ampDecay: R(rng, 0.05, 0.12), ampSustain: R(rng, 0.2, 0.4), ampRelease: 0.06,
        velAmount: R(rng, 0.25, 0.5),
        crush: R(rng, 0.18, 0.42),
        chorusMix: 0,
        delayTime: R(rng, 0.14, 0.22), delayFeedback: R(rng, 0.2, 0.35), delayMix: R(rng, 0.15, 0.3),
        reverbSize: 1.6, reverbMix: R(rng, 0.05, 0.12),
        drive: 0, stereoWidth: R(rng, 0.85, 1.1),
        tone: RI(rng, 10500, 13000), masterGain: 0.75,
      },
      arp: {
        enabled: true, mode: "random", bpm: RI(rng, 138, 168),
        division: PK(rng, ["1/16", "1/16", "1/16T"] as const), octaves: PK(rng, [2, 3]), gate: R(rng, 0.35, 0.6),
      },
    }),
  },
  {
    category: "Arp",
    desc: "Trance-gate rider — the pattern clock chops the sustain",
    count: 10,
    names: {
      solo: ["STROBOSCOPE", "SHUTTERGATE", "APERTURE", "BLINKER", "HELIOGRAPH", "SIGNALLAMP", "FLICKERBOX", "SLATBLIND"],
      adj: ["Gated", "Chopped", "Strobing", "Clockwork", "Stuttered", "Notched", "Interrupted", "Slatted"],
      core: ["Gate", "Chop", "Stutter", "Strobe", "Grid", "Clock", "Slats", "Relay-Gate"],
    },
    make: (rng) => {
      const pattern = Array.from({ length: 16 }, (_, i) => (i % 4 === 0 ? 1 : CH(rng, 0.55) ? 1 : 0));
      return {
        patch: {
          oscATable: PK(rng, ["saw", "saw", "pulse", "growl"]), oscAPos: R(rng, 0.4, 0.9), oscALevel: 0.72,
          oscBTable: PK(rng, ["saw", "pulse", "harmonic"]), oscBPos: R(rng, 0.3, 0.75), oscBDetune: RI(rng, 7, 18), oscBLevel: R(rng, 0.35, 0.6),
          oscCTable: "saw", oscCPos: 0.5, oscCOctave: -1, oscCLevel: CH(rng, 0.35) ? R(rng, 0.2, 0.35) : 0,
          unison: PK(rng, [3, 5, 5, 7]), unisonDetune: RI(rng, 12, 30), unisonWidth: R(rng, 0.6, 1),
          subLevel: R(rng, 0, 0.25), noiseLevel: 0,
          filterType: "lowpass", filterCutoff: RI(rng, 2600, 7500), filterResonance: R(rng, 0.9, 3.5),
          filterEnvAmount: R(rng, 0.08, 0.35),
          ampAttack: R(rng, 0.006, 0.03), ampDecay: 0.3, ampSustain: 0.9, ampRelease: R(rng, 0.18, 0.45),
          velAmount: R(rng, 0.15, 0.5),
          gateOn: true, gateRate: PK(rng, [4, 6, 8, 8, 12, 16]), gateDepth: R(rng, 0.75, 1), gateSteps: PK(rng, [8, 12, 16, 16]),
          gatePattern: pattern,
          modMatrix: makeModMatrix([MR("macro1", "cutoff", R(rng, 0.4, 0.7))]),
          phaserMix: CH(rng, 0.3) ? R(rng, 0.25, 0.5) : 0, phaserRate: R(rng, 0.15, 0.6), phaserDepth: R(rng, 0.5, 0.8),
          chorusMix: R(rng, 0.12, 0.45),
          delayTime: PK(rng, [0.2, 0.26, 0.375]), delayFeedback: R(rng, 0.25, 0.42), delayMix: CH(rng, 0.7) ? R(rng, 0.1, 0.28) : 0,
          reverbSize: R(rng, 1.8, 3.2), reverbMix: R(rng, 0.08, 0.28),
          drive: R(rng, 0, 0.2), driveMode: PK(rng, ["soft", "tube"] as DriveMode[]), stereoWidth: R(rng, 0.95, 1.35),
          tone: RI(rng, 13000, 16000), masterGain: 0.68,
        },
      };
    },
  },
  {
    category: "Arp",
    desc: "Submerged dub sequence — dark eighths in a tank of echo",
    count: 10,
    names: {
      solo: ["UNDERCURRENT", "NIGHTTIDE", "DEEPWATER", "PERISCOPE", "MARIANA", "SONARPING", "DIVEPLANE", "BALLASTER"],
      adj: ["Deep", "Submerged", "Dub", "Hypnotic", "Tidal", "Pressurized", "Drowned", "Bottom-Dwelling"],
      core: ["Pulse", "Echo", "Tide", "Depthline", "Loop", "Ping", "Fathom-Run", "Sounding"],
    },
    make: (rng) => ({
      patch: {
        oscATable: PK(rng, ["basic", "growl", "pulse"]), oscAPos: R(rng, 0.2, 0.55), oscALevel: 0.75,
        oscBTable: "basic", oscBPos: R(rng, 0.1, 0.4), oscBOctave: -1, oscBLevel: R(rng, 0.25, 0.45),
        oscCLevel: 0,
        unison: PK(rng, [1, 2, 3]), unisonDetune: RI(rng, 8, 14), unisonWidth: R(rng, 0.4, 0.7),
        subLevel: R(rng, 0.3, 0.5), noiseLevel: 0,
        filterType: "lowpass", filterCutoff: RI(rng, 800, 2000), filterResonance: R(rng, 1.5, 4),
        filterEnvAmount: R(rng, 0.2, 0.4), filtDecay: R(rng, 0.14, 0.3), filtSustain: R(rng, 0.1, 0.3),
        ampAttack: 0.004, ampDecay: R(rng, 0.18, 0.3), ampSustain: R(rng, 0.3, 0.5), ampRelease: 0.2,
        velAmount: R(rng, 0.3, 0.55),
        chorusMix: 0,
        delayTime: PK(rng, [0.375, 0.42, 0.5]), delayFeedback: R(rng, 0.45, 0.6), delayMix: R(rng, 0.25, 0.42),
        reverbSize: R(rng, 2.6, 4), reverbMix: R(rng, 0.12, 0.26),
        drive: R(rng, 0.06, 0.18), driveMode: "tube", stereoWidth: R(rng, 0.9, 1.15),
        tone: RI(rng, 8500, 11500), masterGain: 0.72,
      },
      arp: {
        enabled: true, mode: PK(rng, ["up", "down", "asplayed"] as const), bpm: RI(rng, 100, 126),
        division: PK(rng, ["1/8", "1/8", "1/8T"] as const), octaves: PK(rng, [1, 2]), gate: R(rng, 0.45, 0.7),
      },
    }),
  },
  {
    category: "Arp",
    desc: "Cascading spark shower — triplet glitter three octaves up",
    count: 10,
    names: {
      solo: ["FIREFLY", "STARLING", "SPARKLER", "PINWHEEL", "TINSELRUN", "COMETTAIL", "GLIMMERTRAIL", "CASCADIA"],
      adj: ["Cascading", "Sparkling", "Tumbling", "Glittering", "Falling", "Scattering", "Showering", "Spiraling"],
      core: ["Cascade", "Sparkle", "Rain", "Shower", "Spiral", "Fall", "Scatter", "Drizzle"],
    },
    make: (rng) => ({
      patch: {
        oscATable: PK(rng, ["harmonic", "bell", "saw"]), oscAPos: R(rng, 0.4, 0.8), oscAEnv: R(rng, -0.45, -0.2), oscALevel: 0.75,
        oscBTable: "harmonic", oscBPos: R(rng, 0.3, 0.7), oscBOctave: 1, oscBDetune: RI(rng, 4, 9), oscBLevel: R(rng, 0.2, 0.4),
        oscCLevel: 0,
        unison: PK(rng, [1, 3]), unisonDetune: RI(rng, 8, 16), unisonWidth: R(rng, 0.6, 0.9),
        subLevel: 0, noiseLevel: 0,
        filterType: "lowpass", filterCutoff: RI(rng, 4200, 8000), filterResonance: R(rng, 1, 3),
        filterEnvAmount: R(rng, 0.3, 0.5), filtDecay: R(rng, 0.08, 0.18), filtSustain: 0,
        modAttack: 0.001, modDecay: R(rng, 0.1, 0.2), modSustain: 0,
        ampAttack: 0.001, ampDecay: R(rng, 0.08, 0.18), ampSustain: 0, ampRelease: R(rng, 0.08, 0.18),
        velAmount: R(rng, 0.4, 0.7),
        chorusMix: 0,
        delayTime: PK(rng, [0.167, 0.2, 0.25]), delayFeedback: R(rng, 0.35, 0.5), delayMix: R(rng, 0.22, 0.4),
        reverbSize: R(rng, 2.2, 3.4), reverbMix: R(rng, 0.16, 0.3),
        drive: 0, stereoWidth: R(rng, 1.1, 1.35),
        tone: 16000, masterGain: 0.72,
      },
      arp: {
        enabled: true, mode: PK(rng, ["up", "updown", "down"] as const), bpm: RI(rng, 130, 155),
        division: PK(rng, ["1/16T", "1/32", "1/16"] as const), octaves: PK(rng, [3, 3, 4]), gate: R(rng, 0.4, 0.65),
      },
    }),
  },

  // ═══════════════════════ FX (45) ═══════════════════════
  {
    category: "FX",
    desc: "Tension riser — pitch and noise climbing to the drop",
    count: 9,
    names: {
      solo: ["ASCENSION", "LIFTOFF", "APOGEE", "COUNTUP", "ESCALATOR", "CLIMBRATE", "ALTIMETER", "UPDRAFT"],
      adj: ["Rising", "Climbing", "Escalating", "Ascending", "Gathering", "Mounting", "Cresting", "Winding"],
      core: ["Riser", "Climb", "Ascent", "Build", "Surge", "Windup", "Ramp", "Escalation"],
    },
    make: (rng) => ({ patch: {
      oscATable: PK(rng, ["saw", "metallic", "harmonic"]), oscAPos: R(rng, 0.3, 0.7), oscALfo: R(rng, 0.15, 0.4), oscALevel: 0.7,
      oscBTable: "saw", oscBPos: 0.6, oscBDetune: RI(rng, 14, 30), oscBLevel: R(rng, 0.35, 0.6),
      oscCLevel: 0,
      unison: 5, unisonDetune: RI(rng, 20, 38), unisonWidth: 0.95,
      subLevel: 0, noiseLevel: R(rng, 0.15, 0.38), noiseColor: R(rng, 0.3, 0.85),
      filterType: PK(rng, ["lowpass", "bandpass"] as FireFilterType[]), filterCutoff: RI(rng, 800, 1900), filterResonance: R(rng, 2, 5),
      filterEnvAmount: R(rng, 0.1, 0.3),
      pitchEnvAmount: RI(rng, -26, -10), pitchEnvTime: R(rng, 1.4, 3.2),
      ampAttack: R(rng, 0.8, 2.2), ampDecay: 0.5, ampSustain: 0.9, ampRelease: R(rng, 0.8, 1.8),
      velAmount: R(rng, 0.1, 0.3),
      lfo1Wave: "sawtooth", lfo1Rate: R(rng, 0.2, 0.7), lfo1Depth: R(rng, 0.35, 0.7), lfo1Dest: "filter",
      chorusMix: 0,
      delayTime: 0.33, delayFeedback: R(rng, 0.4, 0.52), delayMix: R(rng, 0.2, 0.32),
      reverbSize: R(rng, 3.4, 5), reverbMix: R(rng, 0.26, 0.45),
      drive: R(rng, 0.08, 0.24), stereoWidth: R(rng, 1.15, 1.4),
      tone: 13500, masterGain: 0.66,
    }}),
  },
  {
    category: "FX",
    desc: "Directed-energy zap — pitch collapse through ping-pong",
    count: 9,
    names: {
      solo: ["PHOTON", "GIGAWATT", "MASER", "IONCANNON", "BEAMRIDER", "REFRACTOR", "COHERENCE", "WATTAGE"],
      adj: ["Photon", "Ion", "Charged", "Optical", "Focused", "Coherent", "Scattering", "Dazzling"],
      core: ["Laser", "Beam", "Ray", "Emitter", "Lancet", "Discharge", "Volt", "Arc-Light"],
    },
    make: (rng) => ({ patch: {
      oscATable: PK(rng, ["basic", "sync"]), oscAPos: R(rng, 0.7, 1), oscALevel: 0.8,
      oscBTable: "sync", oscBPos: R(rng, 0.3, 0.7), oscBDetune: RI(rng, 6, 14), oscBLevel: R(rng, 0.15, 0.4),
      oscCLevel: 0, unison: 1, unisonWidth: 0,
      subLevel: 0, noiseLevel: 0,
      filterType: "lowpass", filterCutoff: RI(rng, 5000, 9500), filterResonance: R(rng, 1.5, 4),
      filterEnvAmount: R(rng, 0, 0.2),
      pitchEnvAmount: RI(rng, 22, 48), pitchEnvTime: R(rng, 0.06, 0.24),
      ampAttack: 0.001, ampDecay: R(rng, 0.08, 0.2), ampSustain: 0, ampRelease: R(rng, 0.06, 0.16),
      velAmount: R(rng, 0.3, 0.6),
      chorusMix: 0,
      delayTime: R(rng, 0.1, 0.2), delayFeedback: R(rng, 0.35, 0.52), delayMix: R(rng, 0.28, 0.45),
      reverbSize: 2, reverbMix: R(rng, 0.12, 0.24),
      mono: true, glide: 0, drive: R(rng, 0.08, 0.2), stereoWidth: R(rng, 1, 1.3),
      tone: 16000, masterGain: 0.8,
    }}),
  },
  {
    category: "FX",
    desc: "Hydraulic servo — cross-FM machinery articulating under load",
    count: 9,
    names: {
      solo: ["ACTUATOR", "GEARBOX", "CAMSHAFT", "FLYWHEEL", "TORQUEBOX", "DYNAMO", "SERVOARM", "LOADCELL"],
      adj: ["Hydraulic", "Mechanized", "Servo", "Geared", "Articulated", "Pneumatic", "Motorized", "Calibrated"],
      core: ["Servo", "Motor", "Machine", "Mech", "Gear", "Linkage", "Pivot", "Manifold"],
    },
    make: (rng) => ({ patch: {
      oscATable: "metallic", oscAPos: R(rng, 0.2, 0.6), oscAEnv: R(rng, 0.3, 0.65), oscALevel: 0.72,
      oscBTable: PK(rng, ["saw", "fold"]), oscBPos: R(rng, 0.3, 0.6), oscBOctave: -1, oscBLevel: R(rng, 0.25, 0.5),
      oscCLevel: 0, unison: 1, unisonWidth: 0,
      subLevel: R(rng, 0.08, 0.2), noiseLevel: 0,
      fmBtoA: R(rng, 0.3, 0.65), fmAmount: CH(rng, 0.4) ? R(rng, 0.1, 0.3) : 0, fmRatio: PK(rng, [1.5, 2, 2.5]),
      ringAmount: R(rng, 0.1, 0.28), ringFreq: R(rng, 80, 260),
      filterType: "lowpass", filterCutoff: RI(rng, 1000, 2400), filterResonance: R(rng, 2, 4.5),
      filterEnvAmount: R(rng, 0.1, 0.3),
      modAttack: 0.005, modDecay: R(rng, 0.35, 0.75), modSustain: 0.2,
      pitchEnvAmount: RI(rng, 2, 8), pitchEnvTime: R(rng, 0.18, 0.42),
      ampAttack: 0.004, ampDecay: 0.3, ampSustain: 0.7, ampRelease: 0.25,
      velAmount: R(rng, 0.25, 0.5),
      drive: R(rng, 0.2, 0.4), driveMode: PK(rng, ["fold", "hard"] as DriveMode[]), crush: R(rng, 0.08, 0.28),
      chorusMix: 0, delayMix: 0, reverbMix: R(rng, 0.04, 0.12), reverbSize: 1.8,
      stereoWidth: R(rng, 0.9, 1.1),
      tone: RI(rng, 7500, 10500), masterGain: 0.74,
    }}),
  },
  {
    category: "FX",
    desc: "Battle-stations klaxon — square-wave alert on the tannoy",
    count: 9,
    names: {
      solo: ["KLAXONETTE", "AIRRAID", "CURFEW", "LOCKDOWN", "REDALERT", "SCRAMBLER", "ALLHANDS", "SIRENHEAD"],
      adj: ["Blaring", "Urgent", "Emergency", "Warning", "Critical", "Flashing", "Two-Tone", "Deafening"],
      core: ["Alarm", "Siren", "Klaxon", "Alert", "Horn", "Tannoy", "Bullhorn", "Wailer"],
    },
    make: (rng) => ({ patch: {
      oscATable: PK(rng, ["pulse", "basic", "saw"]), oscAPos: R(rng, 0.4, 0.95), oscALevel: 0.78,
      // Optional second tone a musical interval up — the two-tone klaxon.
      oscBTable: "pulse", oscBPos: R(rng, 0.3, 0.8), oscBDetune: PK(rng, [0, 300, 500, 700]),
      oscBLevel: CH(rng, 0.5) ? R(rng, 0.3, 0.5) : 0,
      oscCLevel: 0,
      unison: PK(rng, [1, 1, 2]), unisonDetune: RI(rng, 6, 16), unisonWidth: R(rng, 0.2, 0.6),
      subLevel: 0, noiseLevel: CH(rng, 0.35) ? R(rng, 0.05, 0.14) : 0, noiseColor: R(rng, 0.3, 0.8),
      filterType: PK(rng, ["bandpass", "bandpass", "lowpass"] as FireFilterType[]),
      filterCutoff: RI(rng, 800, 2200), filterResonance: R(rng, 1.5, 5),
      filterEnvAmount: 0,
      lfo1Wave: PK(rng, ["square", "triangle", "sawtooth"] as LfoWave[]), lfo1Rate: R(rng, 0.8, 7), lfo1Depth: R(rng, 0.25, 0.7), lfo1Dest: "pitch",
      ampAttack: R(rng, 0.005, 0.06), ampDecay: 0.2, ampSustain: 0.9, ampRelease: R(rng, 0.1, 0.3),
      velAmount: R(rng, 0.1, 0.3),
      drive: R(rng, 0.12, 0.4), driveMode: PK(rng, ["hard", "fuzz"] as DriveMode[]),
      chorusMix: 0,
      delayTime: R(rng, 0.16, 0.3), delayFeedback: R(rng, 0.15, 0.35), delayMix: CH(rng, 0.6) ? R(rng, 0.08, 0.22) : 0,
      reverbMix: R(rng, 0.03, 0.16), reverbSize: R(rng, 1.6, 2.8),
      mono: true, stereoWidth: R(rng, 0.75, 1.1),
      tone: RI(rng, 8000, 12500), masterGain: 0.7,
    }}),
  },
  {
    category: "FX",
    desc: "Terminal impact — detonation boom with a falling core",
    count: 9,
    names: {
      solo: ["GROUNDZERO", "SHOCKFRONT", "HYPOCENTER", "MEGATON", "DETONATOR", "WARSHOT", "CRATERMAKER", "BLASTYIELD"],
      adj: ["Concussive", "Detonating", "Kinetic", "Terminal", "Shattering", "Bunker-Busting", "Armor-Piercing", "Scorched-Earth"],
      core: ["Impact", "Detonation", "Blast", "Strike", "Shockwave", "Groundburst", "Crater", "Aftershock"],
    },
    make: (rng) => ({ patch: {
      oscATable: PK(rng, ["basic", "growl"]), oscAPos: R(rng, 0, 0.3), oscALevel: 0.78,
      oscBTable: "basic", oscBPos: R(rng, 0.5, 1), oscBOctave: -1, oscBLevel: R(rng, 0.3, 0.5),
      oscCLevel: 0, unison: 1, unisonWidth: 0,
      subWave: "sine", subLevel: R(rng, 0.55, 0.8), noiseLevel: R(rng, 0.12, 0.3), noiseColor: R(rng, -0.8, -0.3),
      filterType: "lowpass", filterCutoff: RI(rng, 300, 900), filterResonance: R(rng, 0.7, 2),
      filterEnvAmount: R(rng, 0.2, 0.45), filtDecay: R(rng, 0.25, 0.5), filtSustain: 0,
      pitchEnvAmount: RI(rng, 14, 40), pitchEnvTime: R(rng, 0.25, 0.7),
      ampAttack: 0.002, ampDecay: R(rng, 0.6, 1.4), ampSustain: 0, ampRelease: R(rng, 0.5, 1.2),
      velAmount: R(rng, 0.2, 0.5),
      punch: R(rng, 0.3, 0.55), drive: R(rng, 0.15, 0.35), driveMode: "tube",
      chorusMix: 0, delayMix: 0,
      reverbSize: R(rng, 3.5, 5.5), reverbMix: R(rng, 0.25, 0.45),
      mono: true, stereoWidth: R(rng, 0.9, 1.2),
      tone: RI(rng, 6000, 9000), masterGain: 0.78,
    }}),
  },

  // ═══════════════════════ ATMOS (40) ═══════════════════════
  {
    category: "Atmos",
    desc: "Reactor-deck drone — machinery idling below the hull",
    count: 8,
    names: {
      solo: ["TURBOFAN", "POWERPLANT", "SUBSTATION", "COOLANT", "FLUXFIELD", "REACTORHUM", "IDLECYCLE", "GENERATRIX"],
      adj: ["Humming", "Idling", "Nuclear", "Orbital", "Shielded", "Vented", "Pressurized", "Slow-Turning"],
      core: ["Drone", "Engine", "Hum", "Reactor", "Core", "Plant", "Deck", "Hold"],
    },
    make: (rng) => ({ patch: {
      oscATable: PK(rng, ["growl", "metallic"]), oscAPos: R(rng, 0.08, 0.35), oscALfo: R(rng, 0.08, 0.2), oscALevel: 0.6,
      oscBTable: "vocal", oscBPos: R(rng, 0.2, 0.5), oscBOctave: -1, oscBDetune: RI(rng, 4, 9), oscBLevel: R(rng, 0.25, 0.45),
      oscCLevel: 0,
      unison: 2, unisonDetune: RI(rng, 6, 12), unisonWidth: 0.7,
      subWave: "sine", subLevel: R(rng, 0.45, 0.7), noiseLevel: 0,
      fmBtoA: CH(rng, 0.5) ? R(rng, 0.04, 0.16) : 0,
      ringAmount: R(rng, 0.05, 0.16), ringFreq: R(rng, 28, 70),
      filterType: "lowpass", filterCutoff: RI(rng, 350, 750), filterResonance: R(rng, 1, 2.5),
      filterEnvAmount: 0,
      ampAttack: R(rng, 1, 2.2), ampDecay: 0.8, ampSustain: 0.92, ampRelease: R(rng, 1.5, 2.8),
      velAmount: R(rng, 0.05, 0.25),
      lfo1Wave: "sine", lfo1Rate: R(rng, 0.05, 0.16), lfo1Depth: R(rng, 0.25, 0.5), lfo1Dest: "filter",
      lfo2Wave: "sine", lfo2Rate: R(rng, 0.09, 0.2), lfo2Depth: R(rng, 0.25, 0.5), lfo2Dest: "pan",
      chorusMix: 0, delayMix: 0,
      reverbSize: R(rng, 4.4, 6), reverbMix: R(rng, 0.26, 0.45),
      drive: R(rng, 0.04, 0.14), stereoWidth: R(rng, 0.95, 1.2),
      tone: RI(rng, 6500, 9500), masterGain: 0.62,
    }}),
  },
  {
    category: "Atmos",
    desc: "Desert heat-haze — detuned glass rippling over the flats",
    count: 8,
    names: {
      solo: ["SIROCCO", "HEATWAVE", "DUNESEA", "SALTFLAT", "SUNSPOT", "MERIDIAN", "KILNWIND", "PARCHFIELD"],
      adj: ["Hazy", "Sweltering", "Desert", "Scorched", "Midsummer", "Rippling", "Sun-Bleached", "Anvil-Hot"],
      core: ["Haze", "Mirage", "Heat", "Glare", "Heatline", "Ripple", "Vapor", "Noon"],
    },
    make: (rng) => ({ patch: {
      oscATable: "harmonic", oscAPos: R(rng, 0.5, 0.85), oscALfo: R(rng, 0.2, 0.4), oscALevel: 0.58,
      oscBTable: "bell", oscBPos: R(rng, 0.4, 0.8), oscBOctave: 1, oscBDetune: RI(rng, 5, 11), oscBLevel: R(rng, 0.22, 0.4),
      oscCLevel: 0,
      unison: 4, unisonDetune: RI(rng, 12, 22), unisonWidth: 0.95,
      subLevel: 0, noiseLevel: R(rng, 0.04, 0.1), noiseColor: R(rng, 0.2, 0.7),
      filterType: "highpass", filterCutoff: RI(rng, 400, 950), filterResonance: 0.8,
      filterEnvAmount: 0,
      ampAttack: R(rng, 1.2, 2.4), ampDecay: 1, ampSustain: 0.9, ampRelease: R(rng, 2, 3.4),
      velAmount: R(rng, 0.05, 0.25),
      lfo1Wave: "sine", lfo1Rate: R(rng, 0.1, 0.26), lfo1Depth: R(rng, 0.4, 0.7), lfo1Dest: "pan",
      chorusRate: 0.3, chorusDepth: R(rng, 0.5, 0.75), chorusMix: R(rng, 0.4, 0.65),
      delayTime: 0.45, delayFeedback: R(rng, 0.42, 0.58), delayMix: R(rng, 0.22, 0.4),
      reverbSize: R(rng, 4.4, 6), reverbMix: R(rng, 0.35, 0.55),
      drive: 0, stereoWidth: R(rng, 1.2, 1.4),
      tone: 15000, masterGain: 0.56,
    }}),
  },
  {
    category: "Atmos",
    desc: "Numbers-station ghost — intercepted carrier through the static",
    count: 8,
    names: {
      solo: ["SHORTWAVE", "DEADCHANNEL", "WIRETAP", "EAVESDROP", "CRYPTOGRAM", "NUMBERSMAN", "STATICVEIL", "JAMSIGNAL"],
      adj: ["Haunted", "Encrypted", "Jammed", "Phantom", "Intercepted", "Scrambled", "Clandestine", "Untraceable"],
      core: ["Radio", "Broadcast", "Transmission", "Channel", "Frequency", "Cipher", "Deadband", "Listening Post"],
    },
    make: (rng) => ({ patch: {
      oscATable: PK(rng, ["formant2", "vocal"]), oscAPos: R(rng, 0.3, 0.7), oscALfo: R(rng, 0.25, 0.5), oscALevel: 0.6,
      oscBTable: "metallic", oscBPos: R(rng, 0.4, 0.8), oscBDetune: RI(rng, 10, 24), oscBLevel: R(rng, 0.18, 0.38),
      oscCLevel: 0,
      unison: 2, unisonDetune: RI(rng, 10, 18), unisonWidth: 0.8,
      subLevel: 0, noiseLevel: R(rng, 0.07, 0.18), noiseColor: R(rng, -0.3, 0.5),
      filterType: "bandpass", filterCutoff: RI(rng, 800, 2100), filterResonance: R(rng, 2, 4.5),
      filterEnvAmount: 0,
      ampAttack: R(rng, 0.6, 1.3), ampDecay: 0.7, ampSustain: 0.88, ampRelease: R(rng, 1.2, 2.2),
      velAmount: R(rng, 0.1, 0.3),
      lfo1Wave: "sample-hold", lfo1Rate: R(rng, 0.7, 2.6), lfo1Depth: R(rng, 0.18, 0.45), lfo1Dest: "filter",
      crush: R(rng, 0.1, 0.32),
      chorusMix: 0,
      delayTime: 0.38, delayFeedback: R(rng, 0.38, 0.55), delayMix: R(rng, 0.22, 0.4),
      reverbSize: R(rng, 3.4, 5), reverbMix: R(rng, 0.26, 0.45),
      drive: 0, stereoWidth: R(rng, 1, 1.25),
      tone: RI(rng, 8500, 12000), masterGain: 0.6,
    }}),
  },
  {
    category: "Atmos",
    desc: "Polar whiteout — filtered wind with almost no pitch left",
    count: 8,
    names: {
      solo: ["PERMAFROST", "WINDCHILL", "WHITEOUT", "GALEFORCE", "SNOWLINE", "NORTHERLY", "FROSTBITE", "ICEFIELD"],
      adj: ["Frozen", "Arctic", "Howling", "Glacial", "Polar", "Sub-Zero", "Windswept", "Numbing"],
      core: ["Wind", "Gale", "Squall", "Chill", "Blizzard", "Front", "Latitude", "Floe"],
    },
    make: (rng) => ({ patch: {
      oscATable: "harmonic", oscAPos: R(rng, 0.08, 0.35), oscALfo: R(rng, 0.08, 0.2), oscALevel: R(rng, 0.3, 0.5),
      oscBLevel: 0, oscCLevel: 0,
      unison: 3, unisonDetune: RI(rng, 14, 26), unisonWidth: 1,
      subLevel: 0, noiseLevel: R(rng, 0.35, 0.6), noiseColor: R(rng, -0.25, 0.55),
      filterType: "bandpass", filterCutoff: RI(rng, 500, 1500), filterResonance: R(rng, 1, 2.4),
      filterEnvAmount: 0,
      ampAttack: R(rng, 1.6, 2.8), ampDecay: 1, ampSustain: 0.9, ampRelease: R(rng, 2.4, 3.8),
      velAmount: R(rng, 0.05, 0.2),
      lfo1Wave: "sine", lfo1Rate: R(rng, 0.04, 0.14), lfo1Depth: R(rng, 0.5, 0.85), lfo1Dest: "filter",
      lfo2Wave: "sine", lfo2Rate: R(rng, 0.07, 0.18), lfo2Depth: R(rng, 0.4, 0.7), lfo2Dest: "pan",
      chorusMix: 0, delayMix: 0,
      reverbSize: R(rng, 5, 6), reverbMix: R(rng, 0.38, 0.55),
      drive: 0, stereoWidth: R(rng, 1.15, 1.4),
      tone: 12500, masterGain: 0.58,
    }}),
  },
  {
    category: "Atmos",
    desc: "Cavern watch — sparse drips of tone in a vast dark",
    count: 8,
    names: {
      solo: ["STALACTITE", "GROTTO", "AQUIFER", "SINKHOLE", "KARSTLINE", "SPELUNKER", "LIMESTONE", "HOLLOWEARTH"],
      adj: ["Cavernous", "Echoing", "Dripping", "Subterranean", "Vast", "Unlit", "Mineral", "Bottomless"],
      core: ["Cavern", "Cave", "Chamber", "Hollow", "Depths", "Gallery", "Passage", "Undervault"],
    },
    make: (rng) => ({ patch: {
      oscATable: PK(rng, ["bell", "additive"]), oscAPos: R(rng, 0.15, 0.5), oscAEnv: R(rng, -0.3, -0.1), oscALevel: 0.62,
      oscBTable: "basic", oscBPos: R(rng, 0, 0.25), oscBOctave: -1, oscBLevel: R(rng, 0.2, 0.4),
      oscCLevel: 0,
      unison: PK(rng, [1, 2]), unisonDetune: RI(rng, 6, 12), unisonWidth: R(rng, 0.5, 0.85),
      subWave: "sine", subLevel: R(rng, 0.25, 0.5), noiseLevel: 0,
      filterType: "lowpass", filterCutoff: RI(rng, 900, 2200), filterResonance: R(rng, 0.7, 2),
      filterEnvAmount: R(rng, 0.1, 0.3), filtDecay: R(rng, 0.4, 0.8), filtSustain: 0,
      ampAttack: R(rng, 0.15, 0.5), ampDecay: R(rng, 1, 2), ampSustain: R(rng, 0.15, 0.4), ampRelease: R(rng, 1.6, 3),
      velAmount: R(rng, 0.3, 0.6),
      lfo1Wave: "sine", lfo1Rate: R(rng, 0.06, 0.16), lfo1Depth: R(rng, 0.2, 0.45), lfo1Dest: "pan",
      chorusMix: 0,
      delayTime: PK(rng, [0.5, 0.66, 0.75]), delayFeedback: R(rng, 0.5, 0.64), delayMix: R(rng, 0.3, 0.48),
      reverbSize: R(rng, 5, 6), reverbMix: R(rng, 0.42, 0.6),
      drive: 0, stereoWidth: R(rng, 1.05, 1.3),
      tone: RI(rng, 9000, 12000), masterGain: 0.62,
    }}),
  },
];

// ════════════════════ the generated bank ════════════════════

/**
 * MK IV expansion target: 1000 total presets = 27 hand-tuned flagships (in
 * fireCommandStore) + 973 generated here. Generation runs in TWO passes:
 *   · pass 1 is byte-identical to the pre-MK IV bank (same seed, same counts,
 *     same draw order) so every existing preset id/name/sound is preserved,
 *   · pass 2 round-robins the same archetypes on an INDEPENDENT seeded stream
 *     until the target is reached (ids carry an `mk4-` prefix). The NameForge
 *     is shared across both passes, so names stay unique bank-wide.
 */
const TARGET_GENERATED = 973;

function buildBank(): FirePreset[] {
  const out: FirePreset[] = [];
  const rng = mulberry32(0xf17ecafe); // "FIRECAFE" — never change: preset ids/params derive from it
  const forge = new NameForge();
  const usedIds = new Set<string>();
  const push = (arch: Archetype, prefix: string, r: Rng) => {
    const { patch, arp } = arch.make(r);
    const name = forge.next(r, arch.names);
    let id = `${prefix}-${arch.category.toLowerCase()}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
    // Names are globally unique, but slugging could theoretically collide
    // ("X-Ray"/"X Ray") — de-dupe deterministically just in case.
    while (usedIds.has(id)) id += "-i";
    usedIds.add(id);
    out.push({
      id,
      name,
      desc: arch.desc,
      category: arch.category,
      patch: P(patch),
      arp,
    });
  };
  // Pass 1 — the legacy bank, byte-stable.
  for (const arch of ARCHETYPES) {
    for (let i = 0; i < arch.count; i++) push(arch, "bank", rng);
  }
  // Pass 2 — MK IV reinforcements on a separate stream (pass 1 untouched).
  const rng2 = mulberry32(0x4d4b4956); // "MKIV" — never change: pass-2 ids/params derive from it
  let ai = 0;
  while (out.length < TARGET_GENERATED) {
    push(ARCHETYPES[ai % ARCHETYPES.length], "mk4", rng2);
    ai++;
  }
  return out;
}

/** 973 generated presets. Combined with the 27 hand-tuned flagships → 1000. */
export const GENERATED_PRESETS: FirePreset[] = buildBank();
