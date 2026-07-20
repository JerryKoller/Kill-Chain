import type { ParametricBand } from "./types";
import { XM6_CORRECTION_BANDS } from "./xm6Profile";
import { DEVICE_PROFILES } from "./deviceProfiles";
import type { HeadphoneId } from "@/state/settingsStore";

/**
 * Pluggable correction profile per headphone model.
 *
 * Each profile is a list of parametric bands + an output-gain trim. The
 * bands are intentionally gentle (< 2 dB on most filters) so the corrected
 * baseline stays close to the source signal; the rest of Playground is
 * what dials in taste.
 *
 * `match` is a list of lowercase substrings compared against the active
 * Windows output device name when Companion Mode is enabled. If any
 * substring is found, that profile becomes the active correction.
 *
 * Profiles are best-effort gentle corrections derived from published
 * frequency-response measurements (Crinacle / Rtings / soundguys). They
 * are NOT lab-grade. The whole point of Calibration + the Hearing Test is
 * to let the user fine-tune from this starting point.
 */
export type HeadphoneFormFactor =
  | "over-ear"
  | "on-ear"
  | "iem"
  | "true-wireless"
  | "open-back"
  | "generic";

/**
 * Playback-device category for the correction catalog. Historic headphone
 * profiles omit the field (treated as "headphones"); everything else comes
 * from `deviceProfiles.ts`.
 */
export type DeviceType =
  | "headphones"
  | "bt-speaker"
  | "laptop"
  | "speaker"
  | "phone-tablet"
  | "tv-soundbar"
  | "car";

export interface HeadphoneProfile {
  id: HeadphoneId;
  name: string;
  brand: string;
  formFactor: HeadphoneFormFactor;
  /** Device category. Absent = classic headphone profile. */
  deviceType?: DeviceType;
  blurb: string;
  outputGainDb: number;
  bands: ParametricBand[];
  /** Lowercase substrings matched against the active OS output device. */
  match: string[];
}

/** Category of a profile, defaulting legacy headphone entries. */
export function deviceTypeOf(p: HeadphoneProfile): DeviceType {
  return p.deviceType ?? "headphones";
}

/** Display order of the picker's device-type groups. */
export const DEVICE_TYPE_ORDER: DeviceType[] = [
  "headphones",
  "bt-speaker",
  "laptop",
  "speaker",
  "phone-tablet",
  "tv-soundbar",
  "car",
];

export const DEVICE_TYPE_LABELS: Record<DeviceType, string> = {
  headphones: "Headphones",
  "bt-speaker": "Bluetooth Speakers",
  laptop: "Laptops",
  speaker: "Speakers & Smart Speakers",
  "phone-tablet": "Phones & Tablets",
  "tv-soundbar": "TVs & Soundbars",
  car: "Car Audio",
};

// ─────────────────────────────────────────────────────────────────────────
// Band builders to keep the catalog compact and consistent.
// ─────────────────────────────────────────────────────────────────────────

function mk(
  prefix: string,
  bands: Array<[freq: number, gain: number, q: number, type?: BiquadFilterType, label?: string]>,
): ParametricBand[] {
  return bands.map(([freq, gain, q, type = "peaking", label], i) => ({
    id: `${prefix}-b${i}`,
    freq,
    gain,
    q,
    type,
    label: label ?? `${prefix} ${i + 1}`,
  }));
}

// ─────────────────────────────────────────────────────────────────────────
// SONY
// ─────────────────────────────────────────────────────────────────────────

const XM5_BANDS = mk("xm5", [
  [32,   0.6, 0.7, "lowshelf",  "Rumble"],
  [110, -0.5, 1.0, "peaking",   "Bass Tame"],
  [380, -0.4, 1.3, "peaking",   "De-Mud"],
  [2700, 1.6, 1.0, "peaking",   "Presence"],
  [5400,-0.6, 1.4, "peaking",   "Edge Polish"],
  [9200, 1.0, 0.9, "peaking",   "Air"],
  [13500,1.2, 0.7, "highshelf", "Top End"],
]);

const XM4_BANDS = mk("xm4", [
  [32,   0.5, 0.7, "lowshelf", "Rumble"],
  [90,  -0.8, 1.0, "peaking",  "Bass Tame"],
  [240, -0.3, 1.0, "peaking",  "Warmth Trim"],
  [2500, 1.8, 1.0, "peaking",  "Presence"],
  [5500,-0.4, 1.4, "peaking",  "Edge Polish"],
  [9000, 0.8, 0.9, "peaking",  "Air"],
  [13000,1.1, 0.7, "highshelf","Top End"],
]);

const XM3_BANDS = mk("xm3", [
  [40,  -0.4, 0.7, "lowshelf",  "Sub Trim"],
  [80,  -1.2, 1.0, "peaking",   "Bass Tame"],
  [350, -0.6, 1.2, "peaking",   "De-Mud"],
  [2400, 2.0, 1.0, "peaking",   "Presence"],
  [5500,-0.8, 1.4, "peaking",   "Edge Polish"],
  [9500, 1.1, 0.9, "peaking",   "Air"],
  [13500,1.2, 0.7, "highshelf", "Top End"],
]);

const WF_XM5_BANDS = mk("wf-xm5", [
  [60,  -0.4, 0.7, "peaking",   "Sub Tame"],
  [180, -0.6, 1.0, "peaking",   "Warmth Trim"],
  [3000, 1.4, 1.1, "peaking",   "Presence"],
  [5500,-0.5, 1.4, "peaking",   "Sibilance"],
  [10000,0.8, 0.9, "peaking",   "Air"],
]);

const WF_XM4_BANDS = mk("wf-xm4", [
  [60,  -0.6, 0.7, "peaking",   "Sub Tame"],
  [200, -0.5, 1.0, "peaking",   "Warmth Trim"],
  [3000, 1.6, 1.1, "peaking",   "Presence"],
  [6000,-0.8, 1.4, "peaking",   "Sibilance"],
  [10000,1.0, 0.9, "peaking",   "Air"],
]);

const LINKBUDS_S_BANDS = mk("linkbuds-s", [
  [60,  -0.3, 0.7, "peaking", "Sub Trim"],
  [400, -0.8, 1.0, "peaking", "De-Mud"],
  [2500, 1.6, 1.0, "peaking", "Presence"],
  [10000,1.0, 0.9, "peaking", "Air"],
]);

// ─────────────────────────────────────────────────────────────────────────
// APPLE
// ─────────────────────────────────────────────────────────────────────────

const APM_BANDS = mk("apm", [
  [36,   0.4, 0.7, "lowshelf",  "Rumble"],
  [100, -0.2, 1.0, "peaking",   "Bass Trim"],
  [280,  0.3, 1.0, "peaking",   "Warmth"],
  [3500, 1.0, 1.1, "peaking",   "Presence"],
  [10000,0.6, 0.9, "peaking",   "Air"],
  [14000,0.5, 0.7, "highshelf", "Top End"],
]);

const APP2_BANDS = mk("app2", [
  [40,   0.5, 0.7, "lowshelf",  "Rumble"],
  [120, -0.4, 1.0, "peaking",   "Bass Trim"],
  [3000, 1.2, 1.0, "peaking",   "Presence"],
  [6000,-0.5, 1.4, "peaking",   "Sibilance"],
  [11000,0.8, 0.9, "highshelf", "Air"],
]);

const APP_BANDS = mk("app", [
  [40,   0.3, 0.7, "lowshelf",  "Rumble"],
  [120, -0.3, 1.0, "peaking",   "Bass Trim"],
  [2800, 1.3, 1.0, "peaking",   "Presence"],
  [5500,-0.5, 1.4, "peaking",   "Sibilance"],
  [10000,0.6, 0.9, "highshelf", "Air"],
]);

// ─────────────────────────────────────────────────────────────────────────
// BOSE
// ─────────────────────────────────────────────────────────────────────────

const BOSE_QC_ULTRA_BANDS = mk("qc-ultra", [
  [40,  -0.5, 0.7, "lowshelf", "Sub Tame"],
  [110, -0.6, 1.0, "peaking",  "Bass Tame"],
  [350, -0.2, 1.2, "peaking",  "De-Mud"],
  [3000, 1.6, 1.0, "peaking",  "Presence"],
  [9000, 1.2, 0.9, "peaking",  "Air"],
  [13000,1.0, 0.7, "highshelf","Top End"],
]);

const BOSE_QC45_BANDS = mk("qc45", [
  [60,  -0.8, 0.8, "peaking",  "Bass Tame"],
  [300, -0.5, 1.2, "peaking",  "De-Mud"],
  [2500, 1.4, 1.0, "peaking",  "Presence"],
  [8000, 1.0, 1.0, "peaking",  "Air"],
  [13000,1.0, 0.7, "highshelf","Top End"],
]);

const BOSE_QC35_BANDS = mk("qc35", [
  [60,  -0.5, 0.8, "peaking", "Bass Tame"],
  [400, -0.4, 1.2, "peaking", "De-Mud"],
  [2500, 1.6, 1.0, "peaking", "Presence"],
  [9000, 1.2, 1.0, "peaking", "Air"],
]);

const BOSE_QC_EARBUDS_BANDS = mk("qc-eb", [
  [60,  -0.4, 0.7, "peaking", "Bass Tame"],
  [3000, 1.5, 1.1, "peaking", "Presence"],
  [10000,1.0, 0.9, "peaking", "Air"],
]);

// ─────────────────────────────────────────────────────────────────────────
// SENNHEISER
// ─────────────────────────────────────────────────────────────────────────

const SENN_M4_BANDS = mk("senn-m4", [
  [60,  -0.6, 0.7, "peaking",  "Bass Tame"],
  [200, -0.4, 1.0, "peaking",  "Warmth Trim"],
  [2500, 1.6, 1.0, "peaking",  "Presence"],
  [6000,-0.8, 1.4, "peaking",  "Edge Polish"],
  [10000,0.9, 0.9, "highshelf","Air"],
]);

const HD660S_BANDS = mk("hd660s", [
  [80,   0.4, 0.7, "lowshelf",  "Body Lift"],
  [200,  0.2, 1.0, "peaking",   "Warmth"],
  [3000, 0.5, 1.0, "peaking",   "Presence"],
  [12000,0.8, 0.8, "highshelf", "Air"],
]);

const HD600_BANDS = mk("hd600", [
  [60,   0.6, 0.7, "lowshelf", "Body Lift"],
  [3000, 1.0, 1.0, "peaking",  "Presence"],
  [13000,1.0, 0.8, "highshelf","Air"],
]);

const HD800S_BANDS = mk("hd800s", [
  [40,   1.2, 0.7, "lowshelf", "Sub Lift"],
  [120,  0.6, 1.0, "peaking",  "Body"],
  [6000,-1.5, 1.4, "peaking",  "Edge Tame"],
  [10000,-0.4,0.9, "peaking",  "Glare Tame"],
]);

// ─────────────────────────────────────────────────────────────────────────
// BOWERS & WILKINS
// ─────────────────────────────────────────────────────────────────────────

const BW_PX7_S2_BANDS = mk("bw-px7", [
  [50,  -0.4, 0.7, "peaking",  "Bass Tame"],
  [3000, 1.5, 1.0, "peaking",  "Presence"],
  [9000, 1.0, 0.9, "peaking",  "Air"],
]);

const BW_PX8_BANDS = mk("bw-px8", [
  [50,  -0.3, 0.7, "peaking",  "Bass Tame"],
  [3000, 1.3, 1.0, "peaking",  "Presence"],
  [10000,1.1, 0.9, "highshelf","Air"],
]);

// ─────────────────────────────────────────────────────────────────────────
// AUDIO-TECHNICA / BEYERDYNAMIC / AKG / FOCAL / SHURE / JBL / HIFIMAN / BEATS
// ─────────────────────────────────────────────────────────────────────────

const M50X_BANDS = mk("m50x", [
  [50,  -0.6, 0.7, "peaking",  "Bass Tame"],
  [180, -0.4, 1.0, "peaking",  "De-Mud"],
  [3000, 1.4, 1.0, "peaking",  "Presence"],
  [6500,-1.0, 1.4, "peaking",  "Edge Polish"],
  [10000,0.8, 0.9, "highshelf","Air"],
]);

const DT990_BANDS = mk("dt990", [
  [80,   0.6, 0.7, "lowshelf", "Body Lift"],
  [200,  0.2, 1.0, "peaking",  "Warmth"],
  [8000,-1.6, 1.4, "peaking",  "Treble Tame"],
  [10000,-0.6,0.9, "peaking",  "Glare Tame"],
]);

const DT770_BANDS = mk("dt770", [
  [60,  -0.4, 0.7, "peaking", "Bass Tame"],
  [8000,-1.4, 1.4, "peaking", "Treble Tame"],
  [12000,-0.5,0.9, "peaking", "Glare Tame"],
]);

const K371_BANDS = mk("k371", [
  [60,   0.4, 0.7, "lowshelf", "Sub Lift"],
  [3000, 0.6, 1.0, "peaking",  "Presence"],
  [10000,0.8, 0.9, "highshelf","Air"],
]);

const FOCAL_BATHYS_BANDS = mk("bathys", [
  [60,  -0.5, 0.7, "peaking",  "Bass Tame"],
  [3000, 1.3, 1.0, "peaking",  "Presence"],
  [9000, 0.9, 0.9, "highshelf","Air"],
]);

const SHURE_AONIC50_BANDS = mk("aonic50", [
  [60,   0.3, 0.7, "lowshelf", "Body Lift"],
  [3000, 1.4, 1.0, "peaking",  "Presence"],
  [10000,1.0, 0.9, "highshelf","Air"],
]);

const JBL_TOUR1M2_BANDS = mk("jbl-t1m2", [
  [60,  -0.6, 0.7, "peaking",  "Bass Tame"],
  [3000, 1.4, 1.0, "peaking",  "Presence"],
  [9000, 1.0, 0.9, "highshelf","Air"],
]);

const HIFIMAN_SUNDARA_BANDS = mk("sundara", [
  [60,   0.5, 0.7, "lowshelf", "Body Lift"],
  [3000, 0.6, 1.0, "peaking",  "Presence"],
  [12000,0.8, 0.8, "highshelf","Air"],
]);

const HIFIMAN_EDX_BANDS = mk("edition-xs", [
  [60,   0.7, 0.7, "lowshelf", "Body Lift"],
  [3000, 0.4, 1.0, "peaking",  "Presence"],
  [10000,1.0, 0.9, "highshelf","Air"],
]);

const BEATS_STUDIO_PRO_BANDS = mk("beats-sp", [
  [50,  -0.8, 0.7, "lowshelf", "Bass Tame"],
  [120, -0.5, 1.0, "peaking",  "Sub Tame"],
  [3000, 1.4, 1.0, "peaking",  "Presence"],
  [9000, 1.0, 0.9, "highshelf","Air"],
]);

const ARCTIS_NOVA_PRO_BANDS = mk("arctis-np", [
  [60,  -0.3, 0.7, "peaking",  "Bass Tame"],
  [3000, 1.5, 1.0, "peaking",  "Presence"],
  [6000,-0.6, 1.4, "peaking",  "Edge Polish"],
  [10000,1.0, 0.9, "highshelf","Air"],
]);

const NOTHING_EAR2_BANDS = mk("nothing-2", [
  [60,  -0.3, 0.7, "peaking",  "Sub Trim"],
  [3000, 1.5, 1.0, "peaking",  "Presence"],
  [10000,0.9, 0.9, "highshelf","Air"],
]);

const SAMSUNG_GBUDS2_PRO_BANDS = mk("gbuds2pro", [
  [60,  -0.4, 0.7, "peaking",  "Sub Trim"],
  [3000, 1.4, 1.0, "peaking",  "Presence"],
  [9000, 0.9, 0.9, "highshelf","Air"],
]);

const PIXEL_BUDS_PRO_BANDS = mk("pbpro", [
  [60,  -0.5, 0.7, "peaking",  "Sub Trim"],
  [3000, 1.4, 1.0, "peaking",  "Presence"],
  [10000,1.0, 0.9, "highshelf","Air"],
]);

const HARMAN_BANDS = mk("harman", [
  [60,   1.0, 0.7, "lowshelf",  "Harman Bass"],
  [200,  0.4, 1.0, "peaking",   "Warmth"],
  [3000, 1.5, 1.0, "peaking",   "Presence"],
  [10000,0.5, 0.9, "highshelf", "Air"],
]);

// ─────────────────────────────────────────────────────────────────────────
// CATALOG
// ─────────────────────────────────────────────────────────────────────────

export const HEADPHONES: Record<HeadphoneId, HeadphoneProfile> = {
  // Sony --------------------------------------------------------------
  xm6: {
    id: "xm6", name: "Sony WH-1000XM6", brand: "Sony", formFactor: "over-ear",
    blurb: "Flagship ANC. Warm-detailed, slight mid presence dip.",
    outputGainDb: -4.0, bands: XM6_CORRECTION_BANDS,
    match: ["wh-1000xm6", "xm6"],
  },
  xm5: {
    id: "xm5", name: "Sony WH-1000XM5", brand: "Sony", formFactor: "over-ear",
    blurb: "Smoother top end, a touch more low-mid lift than XM6.",
    outputGainDb: -4.0, bands: XM5_BANDS, match: ["wh-1000xm5", "xm5"],
  },
  xm4: {
    id: "xm4", name: "Sony WH-1000XM4", brand: "Sony", formFactor: "over-ear",
    blurb: "Punchier bass tilt, recessed presence around 3 kHz.",
    outputGainDb: -4.0, bands: XM4_BANDS, match: ["wh-1000xm4", "xm4"],
  },
  xm3: {
    id: "xm3", name: "Sony WH-1000XM3", brand: "Sony", formFactor: "over-ear",
    blurb: "Older flagship - bigger bass shelf, smoother treble.",
    outputGainDb: -4.0, bands: XM3_BANDS, match: ["wh-1000xm3", "xm3"],
  },
  "wf-xm5": {
    id: "wf-xm5", name: "Sony WF-1000XM5", brand: "Sony", formFactor: "true-wireless",
    blurb: "Compact flagship IEM. Slight bass lift, polite treble.",
    outputGainDb: -3.5, bands: WF_XM5_BANDS, match: ["wf-1000xm5"],
  },
  "wf-xm4": {
    id: "wf-xm4", name: "Sony WF-1000XM4", brand: "Sony", formFactor: "true-wireless",
    blurb: "Predecessor TWE. Slightly warmer tilt.",
    outputGainDb: -3.5, bands: WF_XM4_BANDS, match: ["wf-1000xm4"],
  },
  "linkbuds-s": {
    id: "linkbuds-s", name: "Sony LinkBuds S", brand: "Sony", formFactor: "true-wireless",
    blurb: "Compact lifestyle TWE - mid-forward correction.",
    outputGainDb: -3.5, bands: LINKBUDS_S_BANDS, match: ["linkbuds s", "linkbuds-s"],
  },

  // Apple --------------------------------------------------------------
  "airpods-max": {
    id: "airpods-max", name: "AirPods Max", brand: "Apple", formFactor: "over-ear",
    blurb: "Adaptive EQ. Mild Harman tilt - very gentle correction.",
    outputGainDb: -3.5, bands: APM_BANDS,
    match: ["airpods max", "apm", "h1 headphones"],
  },
  "airpods-pro-2": {
    id: "airpods-pro-2", name: "AirPods Pro 2", brand: "Apple", formFactor: "true-wireless",
    blurb: "TWE with adaptive EQ. Polite presence boost.",
    outputGainDb: -3.5, bands: APP2_BANDS, match: ["airpods pro"],
  },
  "airpods-3": {
    id: "airpods-3", name: "AirPods (3rd gen)", brand: "Apple", formFactor: "true-wireless",
    blurb: "Open-fit. Bass-light by physics, presence-friendly EQ.",
    outputGainDb: -3.0, bands: APP_BANDS, match: ["airpods"],
  },

  // Bose ---------------------------------------------------------------
  "bose-qc-ultra": {
    id: "bose-qc-ultra", name: "Bose QC Ultra Headphones", brand: "Bose", formFactor: "over-ear",
    blurb: "Class-leading ANC. Slightly recessed presence by default.",
    outputGainDb: -4.0, bands: BOSE_QC_ULTRA_BANDS,
    match: ["qc ultra", "quietcomfort ultra", "qcultra"],
  },
  "bose-qc45": {
    id: "bose-qc45", name: "Bose QC45", brand: "Bose", formFactor: "over-ear",
    blurb: "Comfort-first. Warm, mid-forward voicing.",
    outputGainDb: -4.0, bands: BOSE_QC45_BANDS, match: ["qc45", "quietcomfort 45"],
  },
  "bose-qc35-ii": {
    id: "bose-qc35-ii", name: "Bose QC35 II", brand: "Bose", formFactor: "over-ear",
    blurb: "Older QC flagship. Slightly bass-bloomy.",
    outputGainDb: -4.0, bands: BOSE_QC35_BANDS, match: ["qc35", "quietcomfort 35"],
  },
  "bose-qc-earbuds": {
    id: "bose-qc-earbuds", name: "Bose QC Earbuds II", brand: "Bose", formFactor: "true-wireless",
    blurb: "Bose's TWE. CustomTune sets bass; we lift presence.",
    outputGainDb: -3.5, bands: BOSE_QC_EARBUDS_BANDS, match: ["qc earbuds"],
  },

  // Sennheiser ---------------------------------------------------------
  "senn-m4": {
    id: "senn-m4", name: "Sennheiser Momentum 4 Wireless", brand: "Sennheiser", formFactor: "over-ear",
    blurb: "Smooth, slightly dark default - lift presence + air.",
    outputGainDb: -4.0, bands: SENN_M4_BANDS, match: ["momentum 4", "momentum_4"],
  },
  hd660s: {
    id: "hd660s", name: "Sennheiser HD 660S", brand: "Sennheiser", formFactor: "open-back",
    blurb: "Wired open-back reference. Very gentle tweaks.",
    outputGainDb: -3.0, bands: HD660S_BANDS, match: ["hd 660", "hd660"],
  },
  hd600: {
    id: "hd600", name: "Sennheiser HD 600", brand: "Sennheiser", formFactor: "open-back",
    blurb: "Long-standing mixing reference. Add a tiny bit of warmth + presence.",
    outputGainDb: -3.0, bands: HD600_BANDS, match: ["hd 600", "hd600"],
  },
  hd800s: {
    id: "hd800s", name: "Sennheiser HD 800S", brand: "Sennheiser", formFactor: "open-back",
    blurb: "Wide-stage flagship. Tames the famous 6 kHz peak.",
    outputGainDb: -3.0, bands: HD800S_BANDS, match: ["hd 800", "hd800"],
  },

  // B&W ----------------------------------------------------------------
  "bw-px7-s2": {
    id: "bw-px7-s2", name: "B&W Px7 S2", brand: "B&W", formFactor: "over-ear",
    blurb: "Polite default - lift presence + air.",
    outputGainDb: -3.5, bands: BW_PX7_S2_BANDS, match: ["px7", "px7 s2"],
  },
  "bw-px8": {
    id: "bw-px8", name: "B&W Px8", brand: "B&W", formFactor: "over-ear",
    blurb: "Premium flagship. Bit more energetic than Px7.",
    outputGainDb: -3.5, bands: BW_PX8_BANDS, match: ["px8"],
  },

  // Audio-Technica / Beyerdynamic / AKG / Focal / Shure / JBL ---------
  m50x: {
    id: "m50x", name: "Audio-Technica M50x", brand: "Audio-Technica", formFactor: "over-ear",
    blurb: "Studio staple. Slight V-shape - we flatten it.",
    outputGainDb: -3.5, bands: M50X_BANDS, match: ["m50x", "ath-m50"],
  },
  dt990: {
    id: "dt990", name: "Beyerdynamic DT 990 Pro", brand: "Beyerdynamic", formFactor: "open-back",
    blurb: "Sparkly treble. Tame the famous 8 kHz peak.",
    outputGainDb: -3.0, bands: DT990_BANDS, match: ["dt 990", "dt990"],
  },
  dt770: {
    id: "dt770", name: "Beyerdynamic DT 770 Pro", brand: "Beyerdynamic", formFactor: "over-ear",
    blurb: "Closed studio classic. Tame the upper-treble glare.",
    outputGainDb: -3.0, bands: DT770_BANDS, match: ["dt 770", "dt770"],
  },
  k371: {
    id: "k371", name: "AKG K371", brand: "AKG", formFactor: "over-ear",
    blurb: "Harman-tuned. Very gentle correction.",
    outputGainDb: -3.5, bands: K371_BANDS, match: ["k371", "k 371"],
  },
  bathys: {
    id: "bathys", name: "Focal Bathys", brand: "Focal", formFactor: "over-ear",
    blurb: "Premium ANC. Polite default voicing.",
    outputGainDb: -3.5, bands: FOCAL_BATHYS_BANDS, match: ["bathys"],
  },
  aonic50: {
    id: "aonic50", name: "Shure Aonic 50", brand: "Shure", formFactor: "over-ear",
    blurb: "Vocal-clarity tilt. Light presence + air lift.",
    outputGainDb: -3.5, bands: SHURE_AONIC50_BANDS, match: ["aonic 50", "aonic50"],
  },
  "jbl-tour-one-m2": {
    id: "jbl-tour-one-m2", name: "JBL Tour One M2", brand: "JBL", formFactor: "over-ear",
    blurb: "Pro-leaning. Slight bass tame, presence + air lift.",
    outputGainDb: -3.5, bands: JBL_TOUR1M2_BANDS, match: ["tour one"],
  },
  sundara: {
    id: "sundara", name: "HiFiMan Sundara", brand: "HiFiMan", formFactor: "open-back",
    blurb: "Planar magnetic. Very flat - just add body + air.",
    outputGainDb: -3.0, bands: HIFIMAN_SUNDARA_BANDS, match: ["sundara"],
  },
  "edition-xs": {
    id: "edition-xs", name: "HiFiMan Edition XS", brand: "HiFiMan", formFactor: "open-back",
    blurb: "Wide-stage planar. Body lift, gentle air.",
    outputGainDb: -3.0, bands: HIFIMAN_EDX_BANDS, match: ["edition xs"],
  },
  "beats-studio-pro": {
    id: "beats-studio-pro", name: "Beats Studio Pro", brand: "Beats", formFactor: "over-ear",
    blurb: "Bass-forward. We tame it, lift presence + air.",
    outputGainDb: -4.0, bands: BEATS_STUDIO_PRO_BANDS, match: ["studio pro", "beats studio"],
  },
  "arctis-nova-pro": {
    id: "arctis-nova-pro", name: "Steelseries Arctis Nova Pro", brand: "Steelseries", formFactor: "over-ear",
    blurb: "Gaming flagship. Lift presence, tame edge.",
    outputGainDb: -3.5, bands: ARCTIS_NOVA_PRO_BANDS, match: ["arctis nova"],
  },
  "nothing-ear-2": {
    id: "nothing-ear-2", name: "Nothing Ear (2)", brand: "Nothing", formFactor: "true-wireless",
    blurb: "Stylish TWE. Slight sub tame, presence + air.",
    outputGainDb: -3.5, bands: NOTHING_EAR2_BANDS, match: ["nothing ear"],
  },
  "galaxy-buds-2-pro": {
    id: "galaxy-buds-2-pro", name: "Samsung Galaxy Buds 2 Pro", brand: "Samsung", formFactor: "true-wireless",
    blurb: "Samsung flagship TWE. Mid-forward correction.",
    outputGainDb: -3.5, bands: SAMSUNG_GBUDS2_PRO_BANDS, match: ["galaxy buds"],
  },
  "pixel-buds-pro": {
    id: "pixel-buds-pro", name: "Google Pixel Buds Pro", brand: "Google", formFactor: "true-wireless",
    blurb: "Google TWE. Light correction, presence + air.",
    outputGainDb: -3.5, bands: PIXEL_BUDS_PRO_BANDS, match: ["pixel buds"],
  },

  // ═══════════════════════════════════════════════════════════════════
  // MORE POPULAR / CONSUMER  (wireless · ANC · earbuds · gaming)
  // Gentle, measurement-informed corrections toward a neutral/Harman tilt.
  // ═══════════════════════════════════════════════════════════════════
  "wf-xm3": {
    id: "wf-xm3", name: "Sony WF-1000XM3", brand: "Sony", formFactor: "true-wireless",
    blurb: "Warm TWE with a soft top — lift presence + air.",
    outputGainDb: -3.5, match: ["wf-1000xm3"],
    bands: mk("wf-xm3", [[70,-0.6,0.7,"peaking","Bass Tame"],[220,-0.4,1.0,"peaking","Warmth Trim"],[3000,1.6,1.0,"peaking","Presence"],[9000,1.1,0.9,"highshelf","Air"]]),
  },
  "wh-ch720n": {
    id: "wh-ch720n", name: "Sony WH-CH720N", brand: "Sony", formFactor: "over-ear",
    blurb: "Budget ANC, mild V — even it out.",
    outputGainDb: -3.5, match: ["wh-ch720n", "ch720n"],
    bands: mk("ch720n", [[60,-0.5,0.7,"peaking","Bass Tame"],[3000,1.2,1.0,"peaking","Presence"],[6000,-0.6,1.4,"peaking","Edge Polish"],[10000,0.8,0.9,"highshelf","Air"]]),
  },
  "sony-ult-wear": {
    id: "sony-ult-wear", name: "Sony ULT Wear", brand: "Sony", formFactor: "over-ear",
    blurb: "Big ULT bass — tame the low end, open the top.",
    outputGainDb: -4.0, match: ["ult wear"],
    bands: mk("ult-wear", [[40,-1.5,0.7,"lowshelf","Sub Tame"],[90,-1.0,1.0,"peaking","Bass Tame"],[3000,1.4,1.0,"peaking","Presence"],[10000,0.9,0.9,"highshelf","Air"]]),
  },
  "inzone-h9": {
    id: "inzone-h9", name: "Sony INZONE H9", brand: "Sony", formFactor: "over-ear",
    blurb: "Gaming ANC — presence-forward, tame the edge.",
    outputGainDb: -3.5, match: ["inzone h9", "inzone"],
    bands: mk("inzone-h9", [[50,-0.4,0.7,"peaking","Bass Tame"],[3000,1.0,1.0,"peaking","Presence"],[6000,-0.8,1.4,"peaking","Edge Polish"],[10000,0.8,0.9,"highshelf","Air"]]),
  },
  "airpods-pro-1": {
    id: "airpods-pro-1", name: "AirPods Pro (1st gen)", brand: "Apple", formFactor: "true-wireless",
    blurb: "Near-Harman TWE — very gentle nudge.",
    outputGainDb: -3.5, match: ["airpods pro"],
    bands: mk("app1", [[40,0.4,0.7,"lowshelf","Rumble"],[3000,1.0,1.0,"peaking","Presence"],[6000,-0.5,1.4,"peaking","Sibilance"],[10000,0.6,0.9,"highshelf","Air"]]),
  },
  "airpods-2": {
    id: "airpods-2", name: "AirPods (2nd gen)", brand: "Apple", formFactor: "true-wireless",
    blurb: "Open-fit, bass-light by physics — add low end.",
    outputGainDb: -3.0, match: ["airpods"],
    bands: mk("ap2", [[40,0.8,0.7,"lowshelf","Rumble"],[120,0.4,1.0,"peaking","Body"],[3000,1.0,1.0,"peaking","Presence"],[8000,0.4,0.9,"highshelf","Air"]]),
  },
  "beats-fit-pro": {
    id: "beats-fit-pro", name: "Beats Fit Pro", brand: "Beats", formFactor: "true-wireless",
    blurb: "Balanced bass lift — tame + lift presence.",
    outputGainDb: -3.5, match: ["fit pro"],
    bands: mk("fitpro", [[60,-0.6,0.7,"peaking","Bass Tame"],[3000,1.2,1.0,"peaking","Presence"],[10000,0.8,0.9,"highshelf","Air"]]),
  },
  "beats-studio-buds-plus": {
    id: "beats-studio-buds-plus", name: "Beats Studio Buds +", brand: "Beats", formFactor: "true-wireless",
    blurb: "Fairly neutral TWE — light presence + air.",
    outputGainDb: -3.5, match: ["studio buds"],
    bands: mk("sbudsp", [[60,-0.3,0.7,"peaking","Bass Trim"],[3000,1.1,1.0,"peaking","Presence"],[9000,0.8,0.9,"highshelf","Air"]]),
  },
  "powerbeats-pro": {
    id: "powerbeats-pro", name: "Powerbeats Pro", brand: "Beats", formFactor: "true-wireless",
    blurb: "Bass-forward sport TWE — tame, lift presence.",
    outputGainDb: -3.5, match: ["powerbeats"],
    bands: mk("pbpro2", [[70,-0.7,0.7,"peaking","Bass Tame"],[3000,1.2,1.0,"peaking","Presence"],[9000,0.8,0.9,"highshelf","Air"]]),
  },
  "beats-solo-4": {
    id: "beats-solo-4", name: "Beats Solo 4", brand: "Beats", formFactor: "on-ear",
    blurb: "Warm V — tame bass, open the mids + top.",
    outputGainDb: -3.5, match: ["solo 4", "solo4"],
    bands: mk("solo4", [[80,-0.6,0.7,"peaking","Bass Tame"],[300,-0.4,1.0,"peaking","De-Mud"],[3000,1.3,1.0,"peaking","Presence"],[9000,0.9,0.9,"highshelf","Air"]]),
  },
  "beats-studio3": {
    id: "beats-studio3", name: "Beats Studio3", brand: "Beats", formFactor: "over-ear",
    blurb: "Bassy with recessed mids — balance it out.",
    outputGainDb: -4.0, match: ["studio3", "studio 3"],
    bands: mk("studio3", [[60,-0.8,0.7,"lowshelf","Bass Tame"],[250,-0.4,1.0,"peaking","De-Mud"],[3000,1.4,1.0,"peaking","Presence"],[9000,1.0,0.9,"highshelf","Air"]]),
  },
  "bose-700": {
    id: "bose-700", name: "Bose Noise Cancelling 700", brand: "Bose", formFactor: "over-ear",
    blurb: "Smooth, slightly recessed presence — lift it.",
    outputGainDb: -4.0, match: ["bose 700", "nc 700", "noise cancelling 700"],
    bands: mk("bose700", [[110,-0.4,1.0,"peaking","Bass Tame"],[3000,1.4,1.0,"peaking","Presence"],[9000,1.0,0.9,"highshelf","Air"]]),
  },
  "bose-qc-ultra-earbuds": {
    id: "bose-qc-ultra-earbuds", name: "Bose QC Ultra Earbuds", brand: "Bose", formFactor: "true-wireless",
    blurb: "CustomTune TWE — lift presence + air.",
    outputGainDb: -3.5, match: ["qc ultra earbuds", "quietcomfort ultra earbuds"],
    bands: mk("qcue", [[60,-0.3,0.7,"peaking","Bass Trim"],[3000,1.4,1.0,"peaking","Presence"],[9000,0.9,0.9,"highshelf","Air"]]),
  },
  "senn-m3": {
    id: "senn-m3", name: "Sennheiser Momentum 3", brand: "Sennheiser", formFactor: "over-ear",
    blurb: "Warm with a treble dip — open presence + air.",
    outputGainDb: -4.0, match: ["momentum 3", "momentum_3"],
    bands: mk("senn-m3", [[80,-0.5,0.7,"peaking","Bass Tame"],[3000,1.5,1.0,"peaking","Presence"],[6000,-0.6,1.4,"peaking","Edge Polish"],[10000,1.0,0.9,"highshelf","Air"]]),
  },
  "senn-mtw3": {
    id: "senn-mtw3", name: "Sennheiser Momentum TW 3", brand: "Sennheiser", formFactor: "true-wireless",
    blurb: "Warm TWE — lift presence + air.",
    outputGainDb: -3.5, match: ["momentum true wireless", "momentum tw"],
    bands: mk("mtw3", [[60,-0.4,0.7,"peaking","Bass Tame"],[3000,1.4,1.0,"peaking","Presence"],[9000,0.9,0.9,"highshelf","Air"]]),
  },
  "senn-accentum": {
    id: "senn-accentum", name: "Sennheiser Accentum", brand: "Sennheiser", formFactor: "over-ear",
    blurb: "Budget warm ANC — open the upper mids.",
    outputGainDb: -3.5, match: ["accentum"],
    bands: mk("accentum", [[60,-0.4,0.7,"peaking","Bass Tame"],[3000,1.4,1.0,"peaking","Presence"],[9000,0.9,0.9,"highshelf","Air"]]),
  },
  "jbl-live-660nc": {
    id: "jbl-live-660nc", name: "JBL Live 660NC", brand: "JBL", formFactor: "over-ear",
    blurb: "V-shaped ANC — flatten it.",
    outputGainDb: -3.5, match: ["live 660"],
    bands: mk("jbl660", [[60,-0.5,0.7,"peaking","Bass Tame"],[3000,1.2,1.0,"peaking","Presence"],[6000,-0.6,1.4,"peaking","Edge Polish"],[10000,0.8,0.9,"highshelf","Air"]]),
  },
  "jbl-tune-760nc": {
    id: "jbl-tune-760nc", name: "JBL Tune 760NC", brand: "JBL", formFactor: "over-ear",
    blurb: "Bassy budget V — tame, lift presence.",
    outputGainDb: -4.0, match: ["tune 760"],
    bands: mk("jbl760", [[60,-0.7,0.7,"peaking","Bass Tame"],[3000,1.2,1.0,"peaking","Presence"],[10000,0.8,0.9,"highshelf","Air"]]),
  },
  "jabra-elite-85t": {
    id: "jabra-elite-85t", name: "Jabra Elite 85t", brand: "Jabra", formFactor: "true-wireless",
    blurb: "Neutral-ish TWE — gentle presence lift.",
    outputGainDb: -3.5, match: ["elite 85t"],
    bands: mk("jabra85t", [[60,-0.3,0.7,"peaking","Bass Trim"],[3000,1.2,1.0,"peaking","Presence"],[9000,0.7,0.9,"highshelf","Air"]]),
  },
  "jabra-elite-10": {
    id: "jabra-elite-10", name: "Jabra Elite 10", brand: "Jabra", formFactor: "true-wireless",
    blurb: "Warm Dolby TWE — open presence + air.",
    outputGainDb: -3.5, match: ["elite 10"],
    bands: mk("jabra10", [[60,-0.4,0.7,"peaking","Bass Tame"],[3000,1.3,1.0,"peaking","Presence"],[9000,0.8,0.9,"highshelf","Air"]]),
  },
  "galaxy-buds-live": {
    id: "galaxy-buds-live", name: "Samsung Galaxy Buds Live", brand: "Samsung", formFactor: "true-wireless",
    blurb: "Open bean-fit, bass-light — add low end.",
    outputGainDb: -3.0, match: ["galaxy buds live"],
    bands: mk("gblive", [[50,0.6,0.7,"lowshelf","Rumble"],[3000,1.2,1.0,"peaking","Presence"],[9000,0.6,0.9,"highshelf","Air"]]),
  },
  "galaxy-buds-3-pro": {
    id: "galaxy-buds-3-pro", name: "Samsung Galaxy Buds 3 Pro", brand: "Samsung", formFactor: "true-wireless",
    blurb: "Balanced flagship TWE — light presence lift.",
    outputGainDb: -3.5, match: ["galaxy buds3", "galaxy buds 3"],
    bands: mk("gb3pro", [[60,-0.3,0.7,"peaking","Bass Trim"],[3000,1.2,1.0,"peaking","Presence"],[9000,0.8,0.9,"highshelf","Air"]]),
  },
  "pixel-buds-pro-2": {
    id: "pixel-buds-pro-2", name: "Google Pixel Buds Pro 2", brand: "Google", formFactor: "true-wireless",
    blurb: "Refined TWE — light correction.",
    outputGainDb: -3.5, match: ["pixel buds pro 2"],
    bands: mk("pbpro2g", [[60,-0.4,0.7,"peaking","Bass Trim"],[3000,1.3,1.0,"peaking","Presence"],[10000,0.9,0.9,"highshelf","Air"]]),
  },
  "soundcore-liberty-4": {
    id: "soundcore-liberty-4", name: "Soundcore Liberty 4", brand: "Soundcore", formFactor: "true-wireless",
    blurb: "V-shaped TWE — flatten it.",
    outputGainDb: -3.5, match: ["liberty 4"],
    bands: mk("liberty4", [[60,-0.5,0.7,"peaking","Bass Tame"],[3000,1.2,1.0,"peaking","Presence"],[6000,-0.5,1.4,"peaking","Edge Polish"],[10000,0.8,0.9,"highshelf","Air"]]),
  },
  "soundcore-space-q45": {
    id: "soundcore-space-q45", name: "Soundcore Space Q45", brand: "Soundcore", formFactor: "over-ear",
    blurb: "Warm ANC value pick — open the top.",
    outputGainDb: -3.5, match: ["space q45", "q45"],
    bands: mk("spaceq45", [[60,-0.5,0.7,"peaking","Bass Tame"],[3000,1.3,1.0,"peaking","Presence"],[9000,0.8,0.9,"highshelf","Air"]]),
  },
  "arctis-nova-7": {
    id: "arctis-nova-7", name: "SteelSeries Arctis Nova 7", brand: "Steelseries", formFactor: "over-ear",
    blurb: "Gaming wireless — presence lift, tame edge.",
    outputGainDb: -3.5, match: ["arctis nova 7", "nova 7"],
    bands: mk("nova7", [[60,-0.3,0.7,"peaking","Bass Trim"],[3000,1.4,1.0,"peaking","Presence"],[6000,-0.6,1.4,"peaking","Edge Polish"],[10000,0.9,0.9,"highshelf","Air"]]),
  },
  "logitech-g-pro-x-2": {
    id: "logitech-g-pro-x-2", name: "Logitech G Pro X 2", brand: "Logitech", formFactor: "over-ear",
    blurb: "Warm-ish gaming — open presence + air.",
    outputGainDb: -3.5, match: ["pro x 2", "g pro x"],
    bands: mk("gprox2", [[60,-0.4,0.7,"peaking","Bass Tame"],[3000,1.2,1.0,"peaking","Presence"],[10000,0.8,0.9,"highshelf","Air"]]),
  },
  "hyperx-cloud-iii": {
    id: "hyperx-cloud-iii", name: "HyperX Cloud III", brand: "HyperX", formFactor: "over-ear",
    blurb: "Bassy gaming staple — tame, lift presence.",
    outputGainDb: -3.5, match: ["cloud iii", "cloud 3"],
    bands: mk("cloud3", [[70,-0.6,0.7,"peaking","Bass Tame"],[3000,1.1,1.0,"peaking","Presence"],[9000,0.7,0.9,"highshelf","Air"]]),
  },
  "sonos-ace": {
    id: "sonos-ace", name: "Sonos Ace", brand: "Sonos", formFactor: "over-ear",
    blurb: "Well-tuned, slight warmth — open presence.",
    outputGainDb: -3.5, match: ["sonos ace"],
    bands: mk("sonosace", [[110,-0.3,1.0,"peaking","Bass Trim"],[3000,1.2,1.0,"peaking","Presence"],[9000,0.9,0.9,"highshelf","Air"]]),
  },
  "technics-az80": {
    id: "technics-az80", name: "Technics EAH-AZ80", brand: "Technics", formFactor: "true-wireless",
    blurb: "Balanced flagship TWE — gentle presence lift.",
    outputGainDb: -3.5, match: ["az80", "eah-az80"],
    bands: mk("az80", [[60,-0.3,0.7,"peaking","Bass Trim"],[3000,1.2,1.0,"peaking","Presence"],[9000,0.8,0.9,"highshelf","Air"]]),
  },
  "bo-h95": {
    id: "bo-h95", name: "Bang & Olufsen Beoplay H95", brand: "Bang & Olufsen", formFactor: "over-ear",
    blurb: "Lush, warm luxury — open the top.",
    outputGainDb: -3.5, match: ["beoplay h95", "h95"],
    bands: mk("boh95", [[80,-0.4,0.7,"peaking","Bass Tame"],[3000,1.2,1.0,"peaking","Presence"],[9000,0.9,0.9,"highshelf","Air"]]),
  },
  "skullcandy-crusher-anc2": {
    id: "skullcandy-crusher-anc2", name: "Skullcandy Crusher ANC 2", brand: "Skullcandy", formFactor: "over-ear",
    blurb: "Sensory-bass monster — tame hard, open mids.",
    outputGainDb: -4.0, match: ["crusher"],
    bands: mk("crusher2", [[40,-2.0,0.7,"lowshelf","Sub Tame"],[90,-1.2,1.0,"peaking","Bass Tame"],[3000,1.3,1.0,"peaking","Presence"],[9000,0.9,0.9,"highshelf","Air"]]),
  },
  "ath-m40x": {
    id: "ath-m40x", name: "Audio-Technica ATH-M40x", brand: "Audio-Technica", formFactor: "over-ear",
    blurb: "Flat-ish studio monitor — tiny presence + de-glare.",
    outputGainDb: -3.5, match: ["m40x", "ath-m40"],
    bands: mk("m40x", [[3000,0.8,1.0,"peaking","Presence"],[6000,-0.6,1.4,"peaking","Edge Polish"],[10000,0.6,0.9,"highshelf","Air"]]),
  },

  // ═══════════════════════════════════════════════════════════════════
  // AUDIOPHILE / ENTHUSIAST  (wired · planar · open-back · IEM)
  // ═══════════════════════════════════════════════════════════════════
  hd650: {
    id: "hd650", name: "Sennheiser HD 650", brand: "Sennheiser", formFactor: "open-back",
    blurb: "Warm reference — add a little body + air.",
    outputGainDb: -3.0, match: ["hd 650", "hd650"],
    bands: mk("hd650", [[45,0.6,0.7,"lowshelf","Sub Lift"],[3000,0.6,1.0,"peaking","Presence"],[12000,1.2,0.8,"highshelf","Air"]]),
  },
  hd6xx: {
    id: "hd6xx", name: "Drop + Sennheiser HD 6XX", brand: "Sennheiser", formFactor: "open-back",
    blurb: "HD 650 voicing — body + air lift.",
    outputGainDb: -3.0, match: ["hd 6xx", "hd6xx"],
    bands: mk("hd6xx", [[45,0.6,0.7,"lowshelf","Sub Lift"],[3000,0.6,1.0,"peaking","Presence"],[12000,1.2,0.8,"highshelf","Air"]]),
  },
  hd660s2: {
    id: "hd660s2", name: "Sennheiser HD 660S2", brand: "Sennheiser", formFactor: "open-back",
    blurb: "More sub than 660S — light presence + air.",
    outputGainDb: -3.0, match: ["hd 660s2", "hd660s2"],
    bands: mk("hd660s2", [[40,0.3,0.7,"lowshelf","Sub"],[3000,0.5,1.0,"peaking","Presence"],[12000,0.8,0.8,"highshelf","Air"]]),
  },
  hd560s: {
    id: "hd560s", name: "Sennheiser HD 560S", brand: "Sennheiser", formFactor: "open-back",
    blurb: "Neutral, slight treble peak — tame + add sub.",
    outputGainDb: -3.0, match: ["hd 560s", "hd560s"],
    bands: mk("hd560s", [[40,0.4,0.7,"lowshelf","Sub Lift"],[8000,-0.8,1.4,"peaking","Treble Tame"]]),
  },
  hd58x: {
    id: "hd58x", name: "Drop + Sennheiser HD 58X", brand: "Sennheiser", formFactor: "open-back",
    blurb: "Warm, bassy for Senn — open the top.",
    outputGainDb: -3.0, match: ["hd 58x", "hd58x"],
    bands: mk("hd58x", [[100,-0.3,1.0,"peaking","Bass Trim"],[3000,0.6,1.0,"peaking","Presence"],[11000,0.9,0.8,"highshelf","Air"]]),
  },
  hd599: {
    id: "hd599", name: "Sennheiser HD 599", brand: "Sennheiser", formFactor: "open-back",
    blurb: "Bass-light, mid-forward — add low end.",
    outputGainDb: -3.0, match: ["hd 599", "hd599"],
    bands: mk("hd599", [[40,0.8,0.7,"lowshelf","Sub Lift"],[120,0.4,1.0,"peaking","Body"],[10000,0.6,0.8,"highshelf","Air"]]),
  },
  hd25: {
    id: "hd25", name: "Sennheiser HD 25", brand: "Sennheiser", formFactor: "on-ear",
    blurb: "DJ on-ear, bright + punchy — tame bass + treble.",
    outputGainDb: -3.0, match: ["hd 25", "hd25"],
    bands: mk("hd25", [[80,-0.6,0.7,"peaking","Bass Tame"],[8000,-0.8,1.4,"peaking","Treble Tame"]]),
  },
  ie600: {
    id: "ie600", name: "Sennheiser IE 600", brand: "Sennheiser", formFactor: "iem",
    blurb: "Detailed IEM with a treble peak — soften it.",
    outputGainDb: -3.0, match: ["ie 600", "ie600"],
    bands: mk("ie600", [[40,0.3,0.7,"lowshelf","Sub"],[8000,-1.2,1.4,"peaking","Treble Tame"]]),
  },
  ie900: {
    id: "ie900", name: "Sennheiser IE 900", brand: "Sennheiser", formFactor: "iem",
    blurb: "Flagship IEM, treble peaks — gently tame.",
    outputGainDb: -3.0, match: ["ie 900", "ie900"],
    bands: mk("ie900", [[6000,-1.0,1.4,"peaking","Peak Tame"],[10000,-0.6,0.9,"peaking","Glare Tame"],[3000,0.4,1.0,"peaking","Presence"]]),
  },
  dt880: {
    id: "dt880", name: "Beyerdynamic DT 880", brand: "Beyerdynamic", formFactor: "open-back",
    blurb: "Bright, bass-light — add sub, tame 8 kHz.",
    outputGainDb: -3.0, match: ["dt 880", "dt880"],
    bands: mk("dt880", [[40,0.8,0.7,"lowshelf","Sub Lift"],[8000,-1.4,1.4,"peaking","Treble Tame"],[10000,-0.6,0.9,"peaking","Glare Tame"]]),
  },
  dt1990: {
    id: "dt1990", name: "Beyerdynamic DT 1990 Pro", brand: "Beyerdynamic", formFactor: "open-back",
    blurb: "Reference-bright — tame the 8 kHz peak.",
    outputGainDb: -3.0, match: ["dt 1990", "dt1990"],
    bands: mk("dt1990", [[40,0.4,0.7,"lowshelf","Sub Lift"],[8000,-1.6,1.4,"peaking","Treble Tame"],[10000,-0.6,0.9,"peaking","Glare Tame"]]),
  },
  "dt900-pro-x": {
    id: "dt900-pro-x", name: "Beyerdynamic DT 900 Pro X", brand: "Beyerdynamic", formFactor: "open-back",
    blurb: "Smoother Beyer — light treble tame.",
    outputGainDb: -3.0, match: ["dt 900", "dt900"],
    bands: mk("dt900x", [[40,0.4,0.7,"lowshelf","Sub Lift"],[8000,-1.0,1.4,"peaking","Treble Tame"]]),
  },
  "dt700-pro-x": {
    id: "dt700-pro-x", name: "Beyerdynamic DT 700 Pro X", brand: "Beyerdynamic", formFactor: "over-ear",
    blurb: "Closed studio — tame upper treble.",
    outputGainDb: -3.0, match: ["dt 700", "dt700"],
    bands: mk("dt700x", [[60,-0.3,0.7,"peaking","Bass Trim"],[3000,0.4,1.0,"peaking","Presence"],[8000,-0.8,1.4,"peaking","Treble Tame"]]),
  },
  he400se: {
    id: "he400se", name: "HiFiMan HE400se", brand: "HiFiMan", formFactor: "open-back",
    blurb: "Neutral-bright planar, bass-light — add sub.",
    outputGainDb: -3.0, match: ["he400se", "he-400se", "he400"],
    bands: mk("he400se", [[40,0.8,0.7,"lowshelf","Sub Lift"],[3000,0.5,1.0,"peaking","Presence"],[8000,-0.6,1.4,"peaking","Treble Tame"]]),
  },
  arya: {
    id: "arya", name: "HiFiMan Arya", brand: "HiFiMan", formFactor: "open-back",
    blurb: "Wide planar — gentle sub + treble smoothing.",
    outputGainDb: -3.0, match: ["arya"],
    bands: mk("arya", [[40,0.5,0.7,"lowshelf","Sub Lift"],[5000,0.4,1.0,"peaking","Presence"],[9000,-0.6,1.2,"peaking","Glare Tame"]]),
  },
  ananda: {
    id: "ananda", name: "HiFiMan Ananda", brand: "HiFiMan", formFactor: "open-back",
    blurb: "Bright planar — add sub, tame upper-mid glare.",
    outputGainDb: -3.0, match: ["ananda"],
    bands: mk("ananda", [[40,0.6,0.7,"lowshelf","Sub Lift"],[3000,0.4,1.0,"peaking","Presence"],[6000,-0.6,1.4,"peaking","Glare Tame"]]),
  },
  "he1000-stealth": {
    id: "he1000-stealth", name: "HiFiMan HE1000 Stealth", brand: "HiFiMan", formFactor: "open-back",
    blurb: "Airy flagship planar — barely-there lift.",
    outputGainDb: -3.0, match: ["he1000", "he-1000"],
    bands: mk("he1000", [[40,0.4,0.7,"lowshelf","Sub Lift"],[13000,0.6,0.8,"highshelf","Air"]]),
  },
  susvara: {
    id: "susvara", name: "HiFiMan Susvara", brand: "HiFiMan", formFactor: "open-back",
    blurb: "Reference flagship — feather-light touch.",
    outputGainDb: -3.0, match: ["susvara"],
    bands: mk("susvara", [[40,0.4,0.7,"lowshelf","Sub Lift"],[3000,0.3,1.0,"peaking","Presence"],[12000,0.5,0.8,"highshelf","Air"]]),
  },
  he6se: {
    id: "he6se", name: "HiFiMan HE6se", brand: "HiFiMan", formFactor: "open-back",
    blurb: "Power-hungry, bass-light, bright — add sub.",
    outputGainDb: -3.0, match: ["he6se", "he-6se", "he6"],
    bands: mk("he6se", [[40,0.8,0.7,"lowshelf","Sub Lift"],[3000,0.4,1.0,"peaking","Presence"],[8000,-0.6,1.4,"peaking","Treble Tame"]]),
  },
  "focal-clear-mg": {
    id: "focal-clear-mg", name: "Focal Clear MG", brand: "Focal", formFactor: "open-back",
    blurb: "Detailed, slight 4-5 kHz glare — soften it.",
    outputGainDb: -3.0, match: ["clear mg", "focal clear"],
    bands: mk("clearmg", [[40,0.4,0.7,"lowshelf","Sub Lift"],[4500,-0.8,1.4,"peaking","Glare Tame"],[9000,0.4,0.9,"highshelf","Air"]]),
  },
  "focal-utopia": {
    id: "focal-utopia", name: "Focal Utopia", brand: "Focal", formFactor: "open-back",
    blurb: "Flagship — tame upper-mid energy lightly.",
    outputGainDb: -3.0, match: ["utopia"],
    bands: mk("utopia", [[40,0.3,0.7,"lowshelf","Sub Lift"],[4500,-0.6,1.4,"peaking","Glare Tame"],[12000,0.4,0.8,"highshelf","Air"]]),
  },
  "focal-elex": {
    id: "focal-elex", name: "Drop + Focal Elex", brand: "Focal", formFactor: "open-back",
    blurb: "Great bass, 5 kHz peak — tame it.",
    outputGainDb: -3.0, match: ["elex"],
    bands: mk("elex", [[40,0.3,0.7,"lowshelf","Sub Lift"],[5000,-1.0,1.4,"peaking","Peak Tame"]]),
  },
  "focal-elegia": {
    id: "focal-elegia", name: "Focal Elegia", brand: "Focal", formFactor: "over-ear",
    blurb: "Closed, mid dip + treble spike — balance.",
    outputGainDb: -3.0, match: ["elegia"],
    bands: mk("elegia", [[3000,0.6,1.0,"peaking","Presence"],[6000,-0.6,1.4,"peaking","Edge Polish"]]),
  },
  "focal-stellia": {
    id: "focal-stellia", name: "Focal Stellia", brand: "Focal", formFactor: "over-ear",
    blurb: "Lush closed flagship — light presence balance.",
    outputGainDb: -3.0, match: ["stellia"],
    bands: mk("stellia", [[40,0.3,0.7,"lowshelf","Sub Lift"],[3000,0.6,1.0,"peaking","Presence"],[5000,-0.5,1.4,"peaking","Glare Tame"]]),
  },
  "audeze-lcd-x": {
    id: "audeze-lcd-x", name: "Audeze LCD-X", brand: "Audeze", formFactor: "open-back",
    blurb: "Bright-neutral planar — open presence + air.",
    outputGainDb: -3.0, match: ["lcd-x", "lcd x"],
    bands: mk("lcdx", [[40,0.4,0.7,"lowshelf","Sub Lift"],[3000,0.6,1.0,"peaking","Presence"],[10000,0.6,0.9,"highshelf","Air"]]),
  },
  "audeze-lcd-2": {
    id: "audeze-lcd-2", name: "Audeze LCD-2", brand: "Audeze", formFactor: "open-back",
    blurb: "Warm/dark planar — open mids + air.",
    outputGainDb: -3.0, match: ["lcd-2", "lcd 2"],
    bands: mk("lcd2", [[60,-0.3,0.7,"peaking","Bass Trim"],[3000,0.8,1.0,"peaking","Presence"],[10000,1.2,0.8,"highshelf","Air"]]),
  },
  "audeze-mm500": {
    id: "audeze-mm500", name: "Audeze MM-500", brand: "Audeze", formFactor: "open-back",
    blurb: "Pro-neutral planar — light presence + air.",
    outputGainDb: -3.0, match: ["mm-500", "mm500"],
    bands: mk("mm500", [[3000,0.5,1.0,"peaking","Presence"],[10000,0.6,0.9,"highshelf","Air"]]),
  },
  "audeze-maxwell": {
    id: "audeze-maxwell", name: "Audeze Maxwell", brand: "Audeze", formFactor: "over-ear",
    blurb: "Gaming planar, warm — open presence + air.",
    outputGainDb: -3.5, match: ["maxwell"],
    bands: mk("maxwell", [[60,-0.3,0.7,"peaking","Bass Trim"],[3000,0.8,1.0,"peaking","Presence"],[10000,0.8,0.9,"highshelf","Air"]]),
  },
  "audeze-lcd-gx": {
    id: "audeze-lcd-gx", name: "Audeze LCD-GX", brand: "Audeze", formFactor: "open-back",
    blurb: "Open gaming planar, warm — open the top.",
    outputGainDb: -3.0, match: ["lcd-gx", "lcd gx"],
    bands: mk("lcdgx", [[3000,0.8,1.0,"peaking","Presence"],[10000,1.0,0.8,"highshelf","Air"]]),
  },
  "ath-r70x": {
    id: "ath-r70x", name: "Audio-Technica ATH-R70x", brand: "Audio-Technica", formFactor: "open-back",
    blurb: "Neutral open, bass-light — add sub.",
    outputGainDb: -3.0, match: ["r70x", "ath-r70"],
    bands: mk("r70x", [[40,0.8,0.7,"lowshelf","Sub Lift"],[3000,0.4,1.0,"peaking","Presence"],[10000,0.5,0.9,"highshelf","Air"]]),
  },
  "ath-ad700x": {
    id: "ath-ad700x", name: "Audio-Technica ATH-AD700X", brand: "Audio-Technica", formFactor: "open-back",
    blurb: "Very bass-light soundstage king — add low end.",
    outputGainDb: -3.0, match: ["ad700x", "ad700"],
    bands: mk("ad700x", [[40,1.2,0.7,"lowshelf","Sub Lift"],[100,0.4,1.0,"peaking","Body"],[6000,-0.6,1.4,"peaking","Edge Polish"]]),
  },
  "ath-m70x": {
    id: "ath-m70x", name: "Audio-Technica ATH-M70x", brand: "Audio-Technica", formFactor: "over-ear",
    blurb: "Bright studio monitor — tame treble.",
    outputGainDb: -3.0, match: ["m70x", "ath-m70"],
    bands: mk("m70x", [[40,0.3,0.7,"lowshelf","Sub"],[3000,0.4,1.0,"peaking","Presence"],[8000,-0.8,1.4,"peaking","Treble Tame"]]),
  },
  "akg-k701": {
    id: "akg-k701", name: "AKG K701", brand: "AKG", formFactor: "open-back",
    blurb: "Bass-light, 2 kHz-forward, 10 kHz peak — balance.",
    outputGainDb: -3.0, match: ["k701", "k 701"],
    bands: mk("k701", [[40,1.0,0.7,"lowshelf","Sub Lift"],[2000,-0.6,1.2,"peaking","Mid Tame"],[10000,-0.6,0.9,"peaking","Peak Tame"]]),
  },
  "akg-k702": {
    id: "akg-k702", name: "AKG K702", brand: "AKG", formFactor: "open-back",
    blurb: "K701 sibling — add sub, ease 2 kHz + 10 kHz.",
    outputGainDb: -3.0, match: ["k702", "k 702"],
    bands: mk("k702", [[40,1.0,0.7,"lowshelf","Sub Lift"],[2000,-0.5,1.2,"peaking","Mid Tame"],[10000,-0.6,0.9,"peaking","Peak Tame"]]),
  },
  "akg-k712": {
    id: "akg-k712", name: "AKG K712 Pro", brand: "AKG", formFactor: "open-back",
    blurb: "More bass than K701 — gentle balance.",
    outputGainDb: -3.0, match: ["k712", "k 712"],
    bands: mk("k712", [[40,0.6,0.7,"lowshelf","Sub Lift"],[2000,-0.4,1.2,"peaking","Mid Tame"],[10000,-0.5,0.9,"peaking","Peak Tame"]]),
  },
  "akg-k240": {
    id: "akg-k240", name: "AKG K240 Studio", brand: "AKG", formFactor: "open-back",
    blurb: "Semi-open, bass-light, mid-forward — add low end.",
    outputGainDb: -3.0, match: ["k240", "k 240"],
    bands: mk("k240", [[40,0.8,0.7,"lowshelf","Sub Lift"],[3000,0.4,1.0,"peaking","Presence"]]),
  },
  "grado-sr80x": {
    id: "grado-sr80x", name: "Grado SR80x", brand: "Grado", formFactor: "on-ear",
    blurb: "Bright, bass-light, forward mids — balance it.",
    outputGainDb: -3.0, match: ["sr80x", "sr80"],
    bands: mk("sr80x", [[40,0.8,0.7,"lowshelf","Sub Lift"],[2000,-0.5,1.2,"peaking","Mid Tame"],[8000,-0.8,1.4,"peaking","Treble Tame"]]),
  },
  "grado-sr325x": {
    id: "grado-sr325x", name: "Grado SR325x", brand: "Grado", formFactor: "on-ear",
    blurb: "Aggressive + bright — tame treble, add sub.",
    outputGainDb: -3.0, match: ["sr325x", "sr325"],
    bands: mk("sr325x", [[40,0.8,0.7,"lowshelf","Sub Lift"],[2000,-0.5,1.2,"peaking","Mid Tame"],[8000,-1.2,1.4,"peaking","Treble Tame"]]),
  },
  "fidelio-x2hr": {
    id: "fidelio-x2hr", name: "Philips Fidelio X2HR", brand: "Philips", formFactor: "open-back",
    blurb: "Warm, slight bass bump — open presence + air.",
    outputGainDb: -3.0, match: ["x2hr", "fidelio x2"],
    bands: mk("x2hr", [[100,-0.4,1.0,"peaking","Bass Trim"],[3000,0.6,1.0,"peaking","Presence"],[9000,0.6,0.9,"highshelf","Air"]]),
  },
  shp9500: {
    id: "shp9500", name: "Philips SHP9500", brand: "Philips", formFactor: "open-back",
    blurb: "Bright, bass-light budget classic — add low end.",
    outputGainDb: -3.0, match: ["shp9500"],
    bands: mk("shp9500", [[40,1.0,0.7,"lowshelf","Sub Lift"],[3000,0.4,1.0,"peaking","Presence"],[6000,-0.6,1.4,"peaking","Edge Polish"]]),
  },
  "koss-ksc75": {
    id: "koss-ksc75", name: "Koss KSC75", brand: "Koss", formFactor: "on-ear",
    blurb: "Bright clip-on, bass-light — add sub, tame top.",
    outputGainDb: -3.0, match: ["ksc75"],
    bands: mk("ksc75", [[40,1.2,0.7,"lowshelf","Sub Lift"],[8000,-0.8,1.4,"peaking","Treble Tame"]]),
  },
  "koss-porta-pro": {
    id: "koss-porta-pro", name: "Koss Porta Pro", brand: "Koss", formFactor: "on-ear",
    blurb: "Warm, bassy retro — open presence + air.",
    outputGainDb: -3.0, match: ["porta pro", "portapro"],
    bands: mk("portapro", [[80,-0.6,0.7,"peaking","Bass Tame"],[3000,0.6,1.0,"peaking","Presence"],[9000,0.8,0.9,"highshelf","Air"]]),
  },
  "mdr-7506": {
    id: "mdr-7506", name: "Sony MDR-7506", brand: "Sony", formFactor: "over-ear",
    blurb: "Studio classic, sibilant 8 kHz — tame it.",
    outputGainDb: -3.0, match: ["mdr-7506", "7506"],
    bands: mk("mdr7506", [[40,0.3,0.7,"lowshelf","Sub"],[6000,-0.4,1.4,"peaking","Edge Polish"],[8000,-1.2,1.4,"peaking","Sibilance"]]),
  },
  "mdr-z1r": {
    id: "mdr-z1r", name: "Sony MDR-Z1R", brand: "Sony", formFactor: "over-ear",
    blurb: "Warm flagship, treble dip + peak — balance.",
    outputGainDb: -3.0, match: ["z1r", "mdr-z1r"],
    bands: mk("z1r", [[80,-0.4,0.7,"peaking","Bass Tame"],[3000,0.6,1.0,"peaking","Presence"],[10000,0.8,0.8,"highshelf","Air"]]),
  },
  "dca-aeon2": {
    id: "dca-aeon2", name: "Dan Clark Aeon 2", brand: "Dan Clark Audio", formFactor: "over-ear",
    blurb: "Warm closed planar, treble dip — open the top.",
    outputGainDb: -3.0, match: ["aeon 2", "aeon2"],
    bands: mk("aeon2", [[3000,0.8,1.0,"peaking","Presence"],[9000,1.0,0.8,"highshelf","Air"]]),
  },
  "dca-stealth": {
    id: "dca-stealth", name: "Dan Clark Stealth", brand: "Dan Clark Audio", formFactor: "over-ear",
    blurb: "Reference closed flagship — feather touch.",
    outputGainDb: -3.0, match: ["stealth"],
    bands: mk("dcastealth", [[3000,0.4,1.0,"peaking","Presence"],[10000,0.5,0.9,"highshelf","Air"]]),
  },
  "zmf-verite": {
    id: "zmf-verite", name: "ZMF Vérité", brand: "ZMF", formFactor: "open-back",
    blurb: "Musical dynamic — light presence + air.",
    outputGainDb: -3.0, match: ["verite", "vérité"],
    bands: mk("verite", [[3000,0.6,1.0,"peaking","Presence"],[10000,0.6,0.9,"highshelf","Air"]]),
  },
  "zmf-atticus": {
    id: "zmf-atticus", name: "ZMF Atticus", brand: "ZMF", formFactor: "over-ear",
    blurb: "Dark, warm dynamic — open mids + air.",
    outputGainDb: -3.0, match: ["atticus"],
    bands: mk("atticus", [[80,-0.5,0.7,"peaking","Bass Tame"],[3000,0.8,1.0,"peaking","Presence"],[9000,1.2,0.8,"highshelf","Air"]]),
  },
  "meze-99-classics": {
    id: "meze-99-classics", name: "Meze 99 Classics", brand: "Meze", formFactor: "over-ear",
    blurb: "Bassy + warm, recessed mids — balance it.",
    outputGainDb: -3.5, match: ["99 classics", "99classics"],
    bands: mk("meze99", [[60,-1.2,0.7,"lowshelf","Bass Tame"],[200,-0.5,1.0,"peaking","De-Mud"],[3000,1.0,1.0,"peaking","Presence"],[9000,0.9,0.9,"highshelf","Air"]]),
  },
  "meze-109-pro": {
    id: "meze-109-pro", name: "Meze 109 Pro", brand: "Meze", formFactor: "open-back",
    blurb: "Warm open dynamic — open presence + air.",
    outputGainDb: -3.0, match: ["109 pro", "109pro"],
    bands: mk("meze109", [[100,-0.4,1.0,"peaking","Bass Trim"],[3000,0.6,1.0,"peaking","Presence"],[9000,0.8,0.9,"highshelf","Air"]]),
  },
  "meze-empyrean": {
    id: "meze-empyrean", name: "Meze Empyrean", brand: "Meze", formFactor: "open-back",
    blurb: "Warm planar flagship, mid dip — open it.",
    outputGainDb: -3.0, match: ["empyrean"],
    bands: mk("empyrean", [[60,-0.3,0.7,"peaking","Bass Trim"],[3000,0.8,1.0,"peaking","Presence"],[10000,0.8,0.8,"highshelf","Air"]]),
  },
  "meze-elite": {
    id: "meze-elite", name: "Meze Elite", brand: "Meze", formFactor: "open-back",
    blurb: "More neutral than Empyrean — light lift.",
    outputGainDb: -3.0, match: ["meze elite"],
    bands: mk("mezeelite", [[3000,0.5,1.0,"peaking","Presence"],[10000,0.6,0.9,"highshelf","Air"]]),
  },
  "moondrop-aria": {
    id: "moondrop-aria", name: "Moondrop Aria", brand: "Moondrop", formFactor: "iem",
    blurb: "Harman IEM, slight treble — soften it.",
    outputGainDb: -3.0, match: ["aria"],
    bands: mk("aria", [[6000,-0.6,1.4,"peaking","Edge Polish"],[3000,0.3,1.0,"peaking","Presence"]]),
  },
  "moondrop-blessing3": {
    id: "moondrop-blessing3", name: "Moondrop Blessing 3", brand: "Moondrop", formFactor: "iem",
    blurb: "Neutral hybrid IEM — barely-there balance.",
    outputGainDb: -3.0, match: ["blessing 3", "blessing3"],
    bands: mk("blessing3", [[3000,0.3,1.0,"peaking","Presence"],[6000,-0.4,1.4,"peaking","Edge Polish"]]),
  },
  "moondrop-chu": {
    id: "moondrop-chu", name: "Moondrop Chu", brand: "Moondrop", formFactor: "iem",
    blurb: "Budget Harman IEM, treble peak — tame it.",
    outputGainDb: -3.0, match: ["moondrop chu"],
    bands: mk("chu", [[40,0.3,0.7,"lowshelf","Sub"],[6000,-0.8,1.4,"peaking","Peak Tame"]]),
  },
  "truthear-hexa": {
    id: "truthear-hexa", name: "Truthear Hexa", brand: "Truthear", formFactor: "iem",
    blurb: "Neutral hybrid IEM — featherweight touch.",
    outputGainDb: -3.0, match: ["hexa"],
    bands: mk("hexa", [[3000,0.3,1.0,"peaking","Presence"],[6000,-0.3,1.4,"peaking","Edge Polish"]]),
  },
  "7hz-timeless": {
    id: "7hz-timeless", name: "7Hz Timeless", brand: "7Hz", formFactor: "iem",
    blurb: "Planar IEM, treble peak — soften the top.",
    outputGainDb: -3.0, match: ["timeless"],
    bands: mk("timeless", [[3000,0.4,1.0,"peaking","Presence"],[8000,-0.8,1.4,"peaking","Treble Tame"]]),
  },
  "etymotic-er2se": {
    id: "etymotic-er2se", name: "Etymotic ER2SE", brand: "Etymotic", formFactor: "iem",
    blurb: "Flat, deep-insertion reference — tiny lift.",
    outputGainDb: -3.0, match: ["er2se", "er2"],
    bands: mk("er2se", [[40,0.4,0.7,"lowshelf","Sub"],[10000,0.4,0.9,"highshelf","Air"]]),
  },
  "shure-se846": {
    id: "shure-se846", name: "Shure SE846", brand: "Shure", formFactor: "iem",
    blurb: "Bassy, dark IEM — tame bass, open the top.",
    outputGainDb: -3.0, match: ["se846"],
    bands: mk("se846", [[60,-0.8,0.7,"lowshelf","Bass Tame"],[3000,0.4,1.0,"peaking","Presence"],[8000,0.8,0.9,"highshelf","Air"]]),
  },
  "thieaudio-monarch": {
    id: "thieaudio-monarch", name: "ThieAudio Monarch MkII", brand: "ThieAudio", formFactor: "iem",
    blurb: "Tribrid, near-neutral — light balance.",
    outputGainDb: -3.0, match: ["monarch"],
    bands: mk("monarch", [[3000,0.3,1.0,"peaking","Presence"],[8000,-0.4,1.4,"peaking","Edge Polish"]]),
  },
  "fiio-ft3": {
    id: "fiio-ft3", name: "FiiO FT3", brand: "FiiO", formFactor: "open-back",
    blurb: "Neutral-bright dynamic — tame treble.",
    outputGainDb: -3.0, match: ["ft3"],
    bands: mk("ft3", [[40,0.4,0.7,"lowshelf","Sub Lift"],[3000,0.4,1.0,"peaking","Presence"],[8000,-0.6,1.4,"peaking","Treble Tame"]]),
  },
  "fiio-ft5": {
    id: "fiio-ft5", name: "FiiO FT5", brand: "FiiO", formFactor: "open-back",
    blurb: "Neutral planar — light presence balance.",
    outputGainDb: -3.0, match: ["ft5"],
    bands: mk("ft5", [[40,0.3,0.7,"lowshelf","Sub"],[3000,0.4,1.0,"peaking","Presence"],[9000,-0.5,1.2,"peaking","Glare Tame"]]),
  },

  // Reference targets --------------------------------------------------
  harman: {
    id: "harman", name: "Harman Target (generic)", brand: "Reference", formFactor: "generic",
    blurb: "Apply the Harman over-ear target to a flat headphone.",
    outputGainDb: -3.5, bands: HARMAN_BANDS, match: [],
  },
  neutral: {
    id: "neutral", name: "Neutral / unknown", brand: "Reference", formFactor: "generic",
    blurb: "No correction. Pure source signal goes into Playground EQ.",
    outputGainDb: -3.0, bands: [], match: [],
  },

  // Non-headphone playback devices (BT speakers, laptops, smart speakers,
  // phones, TVs, car). Spread LAST so device-name matching prefers
  // headphones. See deviceProfiles.ts for the voicing rationale.
  ...DEVICE_PROFILES,
};

/**
 * Try to guess which headphone profile to use based on the active output
 * device name. Returns null if no match found.
 */
export function matchHeadphoneByDeviceName(name: string): HeadphoneId | null {
  const lower = name.toLowerCase();
  for (const profile of Object.values(HEADPHONES)) {
    if (profile.match.some((m) => lower.includes(m))) {
      return profile.id;
    }
  }
  return null;
}

/** All distinct brand names in the catalog (sorted). */
export function headphoneBrands(): string[] {
  return Array.from(new Set(Object.values(HEADPHONES).map((h) => h.brand))).sort();
}

/** Returns profiles matching a search query (case-insensitive name+brand). */
export function searchHeadphones(query: string): HeadphoneProfile[] {
  const q = query.trim().toLowerCase();
  const list = Object.values(HEADPHONES);
  if (!q) return list;
  return list.filter((h) =>
    h.name.toLowerCase().includes(q) ||
    h.brand.toLowerCase().includes(q) ||
    h.id.toLowerCase().includes(q),
  );
}
