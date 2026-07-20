/**
 * Correction profiles for NON-headphone playback devices: Bluetooth
 * speakers, laptops, desktop & smart speakers, phones/tablets, TVs,
 * soundbars and car systems. Merged into the master catalog in
 * `headphoneProfiles.ts` (so persisted selection, Companion Mode matching
 * and search all keep working unchanged).
 *
 * Same philosophy as the headphone catalog: gentle, plausible corrections
 * (mostly < 3 dB, never asking a driver to do what it physically can't)
 * informed by how each device class behaves — NOT lab measurements.
 * Calibration + the Hearing Test remain the fine-tuning path.
 *
 * Data-driven layout: each category has a voiced template function (see
 * the rationale block above each one) and every device supplies small
 * hand-tuned frequency/gain offsets from that template, so each profile
 * stays distinct but class-plausible.
 */
import type { ParametricBand } from "./types";
import type { DeviceType, HeadphoneProfile } from "./headphoneProfiles";
import type { HeadphoneId } from "@/state/settingsStore";

// [freq, gain, q, type?, label?] — same shorthand as the headphone catalog.
type Spec = [freq: number, gain: number, q: number, type?: BiquadFilterType, label?: string];

/** [centerFreq Hz, gain dB] pair — the per-device tuning knob. */
type FG = [freq: number, gainDb: number];

function mkb(prefix: string, specs: Spec[]): ParametricBand[] {
  return specs.map(([freq, gain, q, type = "peaking", label], i) => ({
    id: `${prefix}-b${i}`,
    freq,
    gain,
    q,
    type,
    label: label ?? `${prefix} ${i + 1}`,
  }));
}

function profile(
  deviceType: DeviceType,
  id: HeadphoneId,
  name: string,
  brand: string,
  blurb: string,
  bands: ParametricBand[],
  match: string[] = [],
  outputGainDb = -3.0,
): HeadphoneProfile {
  return { id, name, brand, formFactor: "generic", deviceType, blurb, outputGainDb, bands, match };
}

// ═════════════════════════════════════════════════════════════════════════
// BLUETOOTH SPEAKERS — voicing rationale
//
// Small sealed enclosures with passive radiators and aggressive DSP that
// already pushes bass to the driver's excursion limit. Boosting sub bass
// they can't reproduce only buys distortion, so instead we:
//   · guard the rolloff with a low-shelf CUT at the physical limit
//     (tiny speakers ~150-200 Hz, big party boxes ~55-70 Hz),
//   · reduce the boxy 300-600 Hz enclosure bloom,
//   · tame the harsh 2-5 kHz driver/port resonance these tunings lean on
//     to fake "loudness",
//   · add a touch of high-shelf sparkle the small tweeters lose off-axis.
// ═════════════════════════════════════════════════════════════════════════

function btBands(
  prefix: string,
  o: { roll: FG; box?: FG; harsh?: FG; edge?: FG; spark?: FG },
): ParametricBand[] {
  const s: Spec[] = [[o.roll[0], o.roll[1], 0.8, "lowshelf", "Rolloff Guard"]];
  if (o.box) s.push([o.box[0], o.box[1], 1.1, "peaking", "De-Box"]);
  if (o.harsh) s.push([o.harsh[0], o.harsh[1], 1.6, "peaking", "Resonance Tame"]);
  if (o.edge) s.push([o.edge[0], o.edge[1], 1.8, "peaking", "Edge Polish"]);
  if (o.spark) s.push([o.spark[0], o.spark[1], 0.8, "highshelf", "Top End"]);
  return mkb(prefix, s);
}

const BT_SPEAKERS: HeadphoneProfile[] = [
  profile("bt-speaker", "jbl-flip-6", "JBL Flip 6", "JBL", "Punchy cylinder — guard rolloff, de-box, tame 4 kHz.",
    btBands("flip6", { roll: [95, -2.5], box: [450, -1.2], harsh: [3800, -1.2], spark: [9500, 0.8] }), ["flip 6", "flip6"]),
  profile("bt-speaker", "jbl-flip-5", "JBL Flip 5", "JBL", "Older Flip — a bit boxier, softer top.",
    btBands("flip5", { roll: [100, -2.6], box: [480, -1.4], harsh: [3500, -1.0], spark: [9000, 0.6] }), ["flip 5", "flip5"]),
  profile("bt-speaker", "jbl-charge-5", "JBL Charge 5", "JBL", "Bigger radiators — lower guard, tame the 4 kHz bite.",
    btBands("charge5", { roll: [80, -2.2], box: [420, -1.3], harsh: [4000, -1.4], spark: [9500, 0.8] }), ["charge 5", "charge5"]),
  profile("bt-speaker", "jbl-xtreme-3", "JBL Xtreme 3", "JBL", "Party size — real mid-bass, mild de-box only.",
    btBands("xtreme3", { roll: [65, -1.8], box: [350, -1.5], harsh: [3200, -1.0], spark: [10000, 0.7] }), ["xtreme 3", "xtreme3"]),
  profile("bt-speaker", "jbl-go-3", "JBL Go 3", "JBL", "Palm-size — steep guard, strong honk tame.",
    btBands("go3", { roll: [190, -3.2], box: [650, -1.5], harsh: [4500, -1.6], spark: [8500, 1.0] }), ["go 3"]),
  profile("bt-speaker", "jbl-clip-4", "JBL Clip 4", "JBL", "Carabiner mini — similar to Go 3, slightly fuller.",
    btBands("clip4", { roll: [180, -3.0], box: [600, -1.4], harsh: [4200, -1.4], spark: [9000, 0.9] }), ["clip 4"]),
  profile("bt-speaker", "jbl-boombox-3", "JBL Boombox 3", "JBL", "Biggest JBL portable — gentle touch, real low end.",
    btBands("boombox3", { roll: [55, -1.5], box: [300, -1.2], harsh: [3000, -0.8], spark: [10000, 0.6] }), ["boombox"]),
  profile("bt-speaker", "ue-boom-3", "UE Boom 3", "Ultimate Ears", "360° cylinder — de-box + tame the mid resonance.",
    btBands("boom3", { roll: [90, -2.4], box: [500, -1.3], harsh: [3600, -1.3], edge: [7000, -0.6], spark: [10000, 0.7] }), ["boom 3"]),
  profile("bt-speaker", "ue-megaboom-3", "UE Megaboom 3", "Ultimate Ears", "Bigger Boom — lower guard, milder resonance.",
    btBands("megaboom3", { roll: [70, -2.0], box: [420, -1.2], harsh: [3400, -1.0], spark: [10000, 0.7] }), ["megaboom"]),
  profile("bt-speaker", "ue-wonderboom-3", "UE Wonderboom 3", "Ultimate Ears", "Compact ball — higher guard, stronger de-box.",
    btBands("wonderboom3", { roll: [140, -2.8], box: [550, -1.5], harsh: [4000, -1.5], spark: [9000, 0.9] }), ["wonderboom"]),
  profile("bt-speaker", "bose-soundlink-flex", "Bose SoundLink Flex", "Bose", "PositionIQ DSP — mild guard + polish.",
    btBands("slflex", { roll: [90, -2.2], box: [400, -1.0], harsh: [3500, -0.8], spark: [9500, 0.8] }), ["soundlink flex"]),
  profile("bt-speaker", "bose-soundlink-revolve-2", "Bose SoundLink Revolve+ II", "Bose", "360° with real body — light correction.",
    btBands("revolve2", { roll: [85, -2.1], box: [450, -1.1], harsh: [3300, -0.9], spark: [9500, 0.7] }), ["revolve"]),
  profile("bt-speaker", "bose-soundlink-micro", "Bose SoundLink Micro", "Bose", "Tiny — steep guard, open the small top end.",
    btBands("slmicro", { roll: [170, -3.0], box: [600, -1.4], harsh: [4000, -1.2], spark: [8500, 1.0] }), ["soundlink micro"]),
  profile("bt-speaker", "bose-soundlink-mini-2", "Bose SoundLink Mini II", "Bose", "Famously warm for its size — de-box, restore top end.",
    btBands("slmini2", { roll: [80, -1.2], box: [320, -1.6], harsh: [3400, -0.8], spark: [9500, 1.0] }), ["soundlink mini"]),
  profile("bt-speaker", "sonos-roam", "Sonos Roam", "Sonos", "Trueplay-tuned mini — moderate guard + de-box.",
    btBands("roam", { roll: [110, -2.4], box: [500, -1.2], harsh: [3800, -1.1], spark: [9500, 0.8] }), ["sonos roam"]),
  profile("bt-speaker", "sonos-move-2", "Sonos Move 2", "Sonos", "Big portable — near-bookshelf, gentle touch.",
    btBands("move2", { roll: [60, -1.4], box: [350, -1.1], harsh: [3200, -0.8], spark: [10000, 0.6] }), ["sonos move"]),
  profile("bt-speaker", "soundcore-motion-plus", "Anker Soundcore Motion+", "Soundcore", "Bright tweeter tuning — tame 4 kHz + 7.5 kHz.",
    btBands("motionplus", { roll: [85, -2.0], box: [450, -1.2], harsh: [4200, -1.5], edge: [7500, -0.8], spark: [10500, 0.5] }), ["motion+", "motion plus"]),
  profile("bt-speaker", "soundcore-motion-x600", "Anker Soundcore Motion X600", "Soundcore", "Spatial-audio box — de-box, mild resonance tame.",
    btBands("x600", { roll: [75, -1.8], box: [400, -1.3], harsh: [3600, -1.2], spark: [10000, 0.6] }), ["x600"]),
  profile("bt-speaker", "soundcore-flare-2", "Anker Soundcore Flare 2", "Soundcore", "Light-ring party can — firmer guard + de-box.",
    btBands("flare2", { roll: [120, -2.6], box: [520, -1.4], harsh: [4000, -1.4], spark: [9000, 0.8] }), ["flare 2", "flare2"]),
  profile("bt-speaker", "marshall-emberton-2", "Marshall Emberton II", "Marshall", "Rock voicing — mid-forward, tame 3.3 kHz.",
    btBands("emberton2", { roll: [100, -2.4], box: [480, -1.3], harsh: [3300, -1.2], edge: [6500, -0.7], spark: [9500, 0.7] }), ["emberton"]),
  profile("bt-speaker", "marshall-stockwell-2", "Marshall Stockwell II", "Marshall", "Mid-size Marshall — similar, slightly fuller.",
    btBands("stockwell2", { roll: [90, -2.2], box: [440, -1.2], harsh: [3400, -1.1], spark: [9500, 0.7] }), ["stockwell"]),
  profile("bt-speaker", "marshall-kilburn-2", "Marshall Kilburn II", "Marshall", "Biggest of the three — real body, gentle touch.",
    btBands("kilburn2", { roll: [70, -1.8], box: [380, -1.1], harsh: [3200, -1.0], spark: [10000, 0.6] }), ["kilburn"]),
  profile("bt-speaker", "sony-srs-xb43", "Sony SRS-XB43", "Sony", "EXTRA BASS DSP — strong de-box for the mid-bass bloom.",
    btBands("xb43", { roll: [60, -1.6], box: [320, -1.5], harsh: [3400, -1.0], spark: [10000, 0.7] }), ["srs-xb43", "xb43"]),
  profile("bt-speaker", "sony-srs-xg300", "Sony SRS-XG300", "Sony", "Retractable-handle party box — moderate correction.",
    btBands("xg300", { roll: [70, -1.8], box: [360, -1.3], harsh: [3500, -1.1], spark: [10000, 0.7] }), ["xg300"]),
  profile("bt-speaker", "sony-srs-xe300", "Sony SRS-XE300", "Sony", "Line-shape diffuser — mild honk around 3.7 kHz.",
    btBands("xe300", { roll: [95, -2.3], box: [450, -1.3], harsh: [3700, -1.2], spark: [9500, 0.8] }), ["xe300"]),
  profile("bt-speaker", "sony-srs-xb100", "Sony SRS-XB100", "Sony", "Palm-size — steep guard, open the top.",
    btBands("xb100", { roll: [170, -3.0], box: [600, -1.5], harsh: [4300, -1.5], spark: [8500, 1.0] }), ["xb100"]),
  profile("bt-speaker", "tribit-stormbox", "Tribit StormBox", "Tribit", "Value 360° can — firm guard + resonance tame.",
    btBands("stormbox", { roll: [100, -2.5], box: [500, -1.4], harsh: [3900, -1.4], spark: [9000, 0.8] }), ["stormbox"]),
  profile("bt-speaker", "bo-beosound-a1", "B&O Beosound A1 (2nd gen)", "Bang & Olufsen", "Refined puck — light guard, keep the polish.",
    btBands("beosounda1", { roll: [90, -2.0], box: [430, -1.0], harsh: [3500, -0.9], spark: [10000, 0.8] }), ["beosound a1"]),
  profile("bt-speaker", "hk-onyx-studio-8", "Harman Kardon Onyx Studio 8", "Harman Kardon", "Dome lifestyle speaker — de-box the warm tilt.",
    btBands("onyx8", { roll: [70, -1.7], box: [350, -1.3], harsh: [3300, -1.0], spark: [9500, 0.7] }), ["onyx studio"]),
  profile("bt-speaker", "generic-bt-speaker", "Generic Bluetooth Speaker", "Generic", "Safe average for any small BT can.",
    btBands("genbt", { roll: [120, -2.6], box: [500, -1.4], harsh: [3800, -1.3], spark: [9000, 0.8] })),
];

// ═════════════════════════════════════════════════════════════════════════
// LAPTOPS — voicing rationale
//
// Micro drivers firing from slots/undersides: nothing usable below
// ~150-300 Hz and a strong 1-3 kHz peak (the "laptop honk") where the tiny
// cones are most efficient. Correction is a high-pass-ish tilt:
//   · steep low-shelf cut at the physical rolloff (don't ask for bass),
//   · a SMALL body lift just above the rolloff where output still exists,
//   · cut the 1.5-3 kHz honk,
//   · polish the 5-6.5 kHz edge,
//   · high-shelf air to de-congest. MacBooks get milder numbers (their
//     speaker systems are genuinely better); budget machines get steeper.
// ═════════════════════════════════════════════════════════════════════════

function laptopBands(
  prefix: string,
  o: { roll: FG; body?: FG; honk: FG; edge?: FG; air?: FG },
): ParametricBand[] {
  const s: Spec[] = [[o.roll[0], o.roll[1], 0.9, "lowshelf", "Rolloff Guard"]];
  if (o.body) s.push([o.body[0], o.body[1], 1.2, "peaking", "Body Rescue"]);
  s.push([o.honk[0], o.honk[1], 1.4, "peaking", "Honk Tame"]);
  if (o.edge) s.push([o.edge[0], o.edge[1], 1.8, "peaking", "Edge Polish"]);
  if (o.air) s.push([o.air[0], o.air[1], 0.8, "highshelf", "Air"]);
  return mkb(prefix, s);
}

const LAPTOPS: HeadphoneProfile[] = [
  profile("laptop", "macbook-air-m2", "MacBook Air (M2)", "Apple", "Good for a laptop — mild guard + honk tame.",
    laptopBands("mba-m2", { roll: [120, -2.8], body: [300, 0.6], honk: [1800, -1.4], edge: [5200, -0.8], air: [10000, 0.8] }), ["macbook air"]),
  profile("laptop", "macbook-air-m3", "MacBook Air (M3)", "Apple", "Slightly refined M2 tuning.",
    laptopBands("mba-m3", { roll: [115, -2.7], body: [300, 0.6], honk: [1900, -1.3], edge: [5000, -0.7], air: [10000, 0.8] }), ["macbook air"]),
  profile("laptop", "macbook-pro-14", "MacBook Pro 14\"", "Apple", "Best-in-class laptop speakers — feather touch.",
    laptopBands("mbp14", { roll: [90, -2.2], body: [280, 0.4], honk: [1600, -1.0], edge: [5000, -0.6], air: [10500, 0.7] }), ["macbook pro"]),
  profile("laptop", "macbook-pro-16", "MacBook Pro 16\"", "Apple", "Six-speaker system — lightest correction here.",
    laptopBands("mbp16", { roll: [80, -2.0], body: [260, 0.4], honk: [1500, -0.9], edge: [4800, -0.5], air: [10500, 0.7] }), ["macbook pro"]),
  profile("laptop", "dell-xps-13", "Dell XPS 13", "Dell", "Thin chassis — steep guard, strong honk tame.",
    laptopBands("xps13", { roll: [200, -3.6], body: [380, 0.7], honk: [2300, -1.8], edge: [5500, -1.0], air: [9500, 0.9] }), ["xps 13"]),
  profile("laptop", "dell-xps-15", "Dell XPS 15", "Dell", "Larger chassis — better body than the 13.",
    laptopBands("xps15", { roll: [150, -3.0], body: [340, 0.6], honk: [2100, -1.5], edge: [5200, -0.8], air: [9500, 0.8] }), ["xps 15"]),
  profile("laptop", "thinkpad-x1-carbon", "Lenovo ThinkPad X1 Carbon", "Lenovo", "Business ultralight — thin, honky; correct firmly.",
    laptopBands("x1carbon", { roll: [220, -3.8], body: [400, 0.8], honk: [2500, -2.0], edge: [6000, -1.0], air: [9000, 0.9] }), ["x1 carbon", "thinkpad"]),
  profile("laptop", "lenovo-yoga-9i", "Lenovo Yoga 9i", "Lenovo", "Soundbar hinge — decent, mild correction.",
    laptopBands("yoga9i", { roll: [160, -3.0], body: [350, 0.6], honk: [2200, -1.4], edge: [5500, -0.8], air: [9500, 0.8] }), ["yoga"]),
  profile("laptop", "hp-spectre-x360", "HP Spectre x360", "HP", "B&O-branded quads — still thin below 170 Hz.",
    laptopBands("spectre", { roll: [170, -3.2], body: [360, 0.6], honk: [2400, -1.6], edge: [5800, -0.9], air: [9500, 0.8] }), ["spectre"]),
  profile("laptop", "hp-envy-16", "HP Envy 16", "HP", "Mid-range HP — firm guard + honk tame.",
    laptopBands("envy16", { roll: [180, -3.3], body: [380, 0.7], honk: [2300, -1.6], edge: [5600, -0.9], air: [9000, 0.8] }), ["envy"]),
  profile("laptop", "asus-zenbook-14", "ASUS ZenBook 14", "ASUS", "Thin-and-light — steep guard, tame 2.4 kHz.",
    laptopBands("zenbook14", { roll: [190, -3.5], body: [380, 0.7], honk: [2400, -1.7], edge: [5800, -1.0], air: [9000, 0.9] }), ["zenbook"]),
  profile("laptop", "rog-zephyrus-g14", "ASUS ROG Zephyrus G14", "ASUS", "Gaming with real woofers — milder correction.",
    laptopBands("g14", { roll: [140, -2.8], body: [320, 0.5], honk: [2000, -1.3], edge: [5200, -0.8], air: [10000, 0.8] }), ["zephyrus"]),
  profile("laptop", "surface-laptop-5", "Surface Laptop 5", "Microsoft", "Omnisonic under-keyboard — mild honk, thin low end.",
    laptopBands("surface5", { roll: [170, -3.1], body: [360, 0.6], honk: [2200, -1.5], edge: [5500, -0.8], air: [9500, 0.8] }), ["surface laptop"]),
  profile("laptop", "surface-pro-9", "Surface Pro 9", "Microsoft", "Tablet-thin — steeper guard than the Laptop.",
    laptopBands("surfacepro9", { roll: [200, -3.5], body: [400, 0.7], honk: [2500, -1.7], edge: [6000, -0.9], air: [9000, 0.9] }), ["surface pro"]),
  profile("laptop", "acer-swift-3", "Acer Swift 3", "Acer", "Budget ultrabook — strong honk, correct firmly.",
    laptopBands("swift3", { roll: [230, -3.9], body: [420, 0.8], honk: [2600, -2.0], edge: [6200, -1.1], air: [8500, 1.0] }), ["swift"]),
  profile("laptop", "razer-blade-15", "Razer Blade 15", "Razer", "Gaming flagship — decent up-firing pair.",
    laptopBands("blade15", { roll: [150, -2.9], body: [330, 0.5], honk: [2100, -1.4], edge: [5400, -0.8], air: [9800, 0.8] }), ["razer blade", "blade 15"]),
  profile("laptop", "lg-gram-17", "LG Gram 17", "LG", "Ultra-light chassis — thin sound, firm guard.",
    laptopBands("gram17", { roll: [210, -3.7], body: [400, 0.8], honk: [2500, -1.9], edge: [6000, -1.0], air: [9000, 0.9] }), ["lg gram"]),
  profile("laptop", "framework-13", "Framework Laptop 13", "Framework", "Modular 13\" — typical ultrabook voicing.",
    laptopBands("framework13", { roll: [200, -3.6], body: [390, 0.7], honk: [2400, -1.7], edge: [5800, -1.0], air: [9200, 0.9] }), ["framework"]),
  profile("laptop", "msi-stealth-16", "MSI Stealth 16", "MSI", "Gaming thin — moderate guard + honk tame.",
    laptopBands("stealth16", { roll: [160, -3.0], body: [340, 0.6], honk: [2200, -1.5], edge: [5600, -0.9], air: [9500, 0.8] }), ["stealth 16"]),
  profile("laptop", "galaxy-book4-pro", "Samsung Galaxy Book4 Pro", "Samsung", "AKG-tuned quads — mild honk remains.",
    laptopBands("book4pro", { roll: [180, -3.3], body: [370, 0.6], honk: [2300, -1.6], edge: [5700, -0.9], air: [9500, 0.8] }), ["galaxy book"]),
  profile("laptop", "dell-inspiron-15", "Dell Inspiron 15", "Dell", "Mainstream — down-firing, honky; correct firmly.",
    laptopBands("inspiron15", { roll: [240, -4.0], body: [430, 0.8], honk: [2700, -2.1], edge: [6300, -1.1], air: [8500, 0.9] }), ["inspiron"]),
  profile("laptop", "hp-pavilion-15", "HP Pavilion 15", "HP", "Mainstream HP — similar to Inspiron voicing.",
    laptopBands("pavilion15", { roll: [250, -4.1], body: [440, 0.8], honk: [2800, -2.1], edge: [6400, -1.1], air: [8500, 0.9] }), ["pavilion"]),
  profile("laptop", "generic-chromebook", "Chromebook (generic)", "Generic", "Small budget chassis — steepest guard here.",
    laptopBands("chromebook", { roll: [260, -4.2], body: [450, 0.8], honk: [2800, -2.2], edge: [6500, -1.2], air: [8500, 1.0] })),
  profile("laptop", "generic-budget-laptop", "Budget Laptop (generic)", "Generic", "Tiny down-firing drivers — max honk control.",
    laptopBands("budgetlaptop", { roll: [280, -4.4], body: [480, 0.9], honk: [3000, -2.4], edge: [6800, -1.3], air: [8000, 1.0] })),
  profile("laptop", "generic-gaming-laptop", "Gaming Laptop (generic)", "Generic", "Bigger chassis average — moderate correction.",
    laptopBands("gamelaptop", { roll: [170, -3.1], body: [350, 0.6], honk: [2200, -1.5], edge: [5600, -0.9], air: [9500, 0.8] })),
];

// ═════════════════════════════════════════════════════════════════════════
// DESKTOP / BOOKSHELF & SMART SPEAKERS — voicing rationale
//
// Smart speakers ship DSP that already boosts bass for "impressive demo"
// sound, so the fix is the opposite of a headphone: trim the pumped
// 100-200 Hz mid-bass, reduce enclosure bloom around 300-450 Hz, and lift
// 2.8-3.4 kHz clarity that the bass tilt masks. Bookshelf/monitor pairs
// (Edifier, Audioengine, KEF, PreSonus, JBL) are far closer to neutral —
// they get a small desk-boundary bass trim and a token clarity touch.
// Tiny desktop sets (Pebble, Z313) behave like BT minis: guard + de-box.
// ═════════════════════════════════════════════════════════════════════════

function speakerBands(
  prefix: string,
  o: { roll?: FG; bass?: FG; box?: FG; clarity?: FG; edge?: FG; air?: FG },
): ParametricBand[] {
  const s: Spec[] = [];
  if (o.roll) s.push([o.roll[0], o.roll[1], 0.8, "lowshelf", "Rolloff Guard"]);
  if (o.bass) s.push([o.bass[0], o.bass[1], 1.0, "peaking", "DSP Bass Trim"]);
  if (o.box) s.push([o.box[0], o.box[1], 1.2, "peaking", "De-Box"]);
  if (o.clarity) s.push([o.clarity[0], o.clarity[1], 1.2, "peaking", "Clarity"]);
  if (o.edge) s.push([o.edge[0], o.edge[1], 1.6, "peaking", "Edge Polish"]);
  if (o.air) s.push([o.air[0], o.air[1], 0.8, "highshelf", "Air"]);
  return mkb(prefix, s);
}

const SPEAKERS: HeadphoneProfile[] = [
  profile("speaker", "echo-dot-5", "Amazon Echo Dot (5th gen)", "Amazon", "Small ball, pumped bass — trim it, lift clarity.",
    speakerBands("echodot5", { roll: [90, -1.8], bass: [160, -1.4], box: [400, -1.0], clarity: [3000, 1.4], air: [9000, 0.8] }), ["echo dot"]),
  profile("speaker", "echo-4", "Amazon Echo (4th gen)", "Amazon", "Sphere with woofer — milder bass trim.",
    speakerBands("echo4", { bass: [130, -1.6], box: [350, -1.0], clarity: [3000, 1.2], air: [9500, 0.7] }), ["amazon echo"]),
  profile("speaker", "echo-studio", "Amazon Echo Studio", "Amazon", "3D audio DSP — trim low warmth, small clarity lift.",
    speakerBands("echostudio", { bass: [110, -1.4], box: [300, -0.8], clarity: [2800, 1.0], air: [10000, 0.6] }), ["echo studio"]),
  profile("speaker", "nest-mini", "Google Nest Mini", "Google", "Puck speaker — pumped mid-bass, honky mids.",
    speakerBands("nestmini", { roll: [110, -2.0], bass: [180, -1.5], box: [450, -1.2], clarity: [3200, 1.4], air: [8500, 0.9] }), ["nest mini"]),
  profile("speaker", "nest-audio", "Google Nest Audio", "Google", "Warm-tilted by design — trim + clarity.",
    speakerBands("nestaudio", { bass: [140, -1.5], box: [380, -1.0], clarity: [3000, 1.2], air: [9000, 0.7] }), ["nest audio"]),
  profile("speaker", "nest-hub-max", "Google Nest Hub Max", "Google", "Display + woofer — similar to Nest Audio.",
    speakerBands("nesthubmax", { bass: [150, -1.4], box: [400, -1.1], clarity: [3100, 1.3], air: [9000, 0.8] }), ["nest hub"]),
  profile("speaker", "homepod-2", "Apple HomePod (2nd gen)", "Apple", "Room-sensing DSP, bass-generous — gentle rebalance.",
    speakerBands("homepod2", { bass: [90, -1.6], box: [300, -0.9], clarity: [2800, 1.3], air: [10000, 0.8] }), ["homepod"]),
  profile("speaker", "homepod-mini", "Apple HomePod mini", "Apple", "Small sphere — guard + trim, bigger clarity lift.",
    speakerBands("homepodmini", { roll: [100, -1.9], bass: [170, -1.4], box: [420, -1.1], clarity: [3200, 1.3], air: [9000, 0.9] }), ["homepod mini"]),
  profile("speaker", "sonos-one", "Sonos One", "Sonos", "Trueplay-friendly — light trim + clarity.",
    speakerBands("sonosone", { bass: [130, -1.3], box: [350, -0.9], clarity: [3000, 1.1], air: [9500, 0.7] }), ["sonos one"]),
  profile("speaker", "sonos-era-100", "Sonos Era 100", "Sonos", "Stereo update of the One — slightly leaner correction.",
    speakerBands("era100", { bass: [120, -1.2], box: [330, -0.8], clarity: [3000, 1.0], air: [9500, 0.6] }), ["era 100"]),
  profile("speaker", "sonos-era-300", "Sonos Era 300", "Sonos", "Spatial flagship — near-neutral, token touches.",
    speakerBands("era300", { bass: [110, -1.1], box: [320, -0.8], clarity: [2900, 0.9], air: [10000, 0.6] }), ["era 300"]),
  profile("speaker", "sonos-five", "Sonos Five", "Sonos", "Biggest Sonos — closest to hi-fi, lightest touch.",
    speakerBands("sonosfive", { bass: [100, -1.2], box: [300, -0.7], clarity: [2800, 0.8], air: [10000, 0.5] }), ["sonos five"]),
  profile("speaker", "kef-lsx-2", "KEF LSX II", "KEF", "Coaxial hi-fi — nearly flat, cosmetic touches only.",
    speakerBands("lsx2", { bass: [110, -0.6], clarity: [3000, 0.5], air: [11000, 0.4] }), ["lsx"]),
  profile("speaker", "audioengine-a2plus", "Audioengine A2+", "Audioengine", "Desktop mini-monitor — guard below its 3\" woofer.",
    speakerBands("a2plus", { roll: [100, -1.6], box: [400, -0.8], clarity: [3200, 0.8], air: [10000, 0.6] }), ["audioengine a2"]),
  profile("speaker", "audioengine-a5plus", "Audioengine A5+", "Audioengine", "Bigger sibling — mild desk-bass trim.",
    speakerBands("a5plus", { bass: [120, -0.8], box: [350, -0.6], clarity: [3000, 0.6], air: [10500, 0.5] }), ["audioengine a5"]),
  profile("speaker", "edifier-r1280t", "Edifier R1280T", "Edifier", "Warm budget bookshelf — trim warmth, add clarity.",
    speakerBands("r1280t", { bass: [140, -1.0], box: [400, -1.0], clarity: [3200, 1.0], air: [9500, 0.8] }), ["r1280"]),
  profile("speaker", "edifier-r1700bt", "Edifier R1700BT", "Edifier", "Bigger warm bookshelf — similar voicing.",
    speakerBands("r1700bt", { bass: [130, -1.1], box: [380, -0.9], clarity: [3100, 0.9], air: [9500, 0.7] }), ["r1700"]),
  profile("speaker", "presonus-eris-35", "PreSonus Eris 3.5", "PreSonus", "Compact studio monitor — guard + honesty touches.",
    speakerBands("eris35", { roll: [110, -1.4], box: [420, -0.7], clarity: [3300, 0.6], air: [10000, 0.5] }), ["eris"]),
  profile("speaker", "jbl-104", "JBL 104", "JBL", "Coaxial desktop monitor — guard + mild de-box.",
    speakerBands("jbl104", { roll: [120, -1.5], box: [450, -0.9], clarity: [3200, 0.7], air: [9500, 0.6] }), ["jbl 104"]),
  profile("speaker", "klipsch-the-fives", "Klipsch The Fives", "Klipsch", "Horn tweeter — soften the 4.5 kHz bite.",
    speakerBands("thefives", { bass: [110, -0.9], box: [300, -0.6], edge: [4500, -1.0], air: [10000, 0.4] }), ["the fives"]),
  profile("speaker", "creative-pebble", "Creative Pebble", "Creative", "Tiny USB orbs — behave like a BT mini.",
    speakerBands("pebble", { roll: [150, -2.6], box: [500, -1.3], clarity: [3400, 1.2], edge: [5500, -0.8], air: [8500, 0.9] }), ["pebble"]),
  profile("speaker", "logitech-z313", "Logitech Z313", "Logitech", "2.1 with boomy little sub — trim boom, add clarity.",
    speakerBands("z313", { roll: [130, -2.2], bass: [180, -1.2], box: [450, -1.3], clarity: [3300, 1.2], air: [8500, 0.8] }), ["z313"]),
  profile("speaker", "logitech-z623", "Logitech Z623", "Logitech", "THX 2.1 — bigger boom, same medicine.",
    speakerBands("z623", { bass: [120, -1.8], box: [400, -1.2], clarity: [3200, 1.0], air: [9000, 0.7] }), ["z623"]),
  profile("speaker", "kanto-yu4", "Kanto YU4", "Kanto", "Powered bookshelf — light trim + clarity.",
    speakerBands("yu4", { bass: [120, -0.9], box: [350, -0.7], clarity: [3000, 0.7], air: [10000, 0.5] }), ["kanto"]),
  profile("speaker", "generic-pc-speakers", "Generic PC Speakers", "Generic", "Safe average for unknown desktop sets.",
    speakerBands("genpc", { roll: [160, -2.8], box: [500, -1.4], clarity: [3400, 1.3], edge: [5800, -0.9], air: [8500, 0.9] })),
];

// ═════════════════════════════════════════════════════════════════════════
// PHONES & TABLETS — voicing rationale
//
// Same physics as laptops but narrower: micro drivers in even smaller
// cavities, so the rolloff guard sits higher (~200-300 Hz) and the
// efficiency peak lands around 2-2.5 kHz. Flagship phones/tablets with
// stereo pairs get milder numbers; the generic profile assumes a single
// bottom-firing driver and corrects hardest.
// (Reuses the laptop template — the voicing model is identical.)
// ═════════════════════════════════════════════════════════════════════════

const PHONES_TABLETS: HeadphoneProfile[] = [
  profile("phone-tablet", "iphone-15", "iPhone 15 (speakers)", "Apple", "Stereo pair — decent for a phone, mild honk.",
    laptopBands("iphone15", { roll: [220, -3.6], body: [420, 0.5], honk: [2200, -1.3], edge: [5500, -0.8], air: [9500, 0.8] }), ["iphone"]),
  profile("phone-tablet", "iphone-16", "iPhone 16 (speakers)", "Apple", "Slightly improved pair — a touch milder.",
    laptopBands("iphone16", { roll: [210, -3.5], body: [410, 0.5], honk: [2100, -1.2], edge: [5400, -0.7], air: [9500, 0.8] }), ["iphone"]),
  profile("phone-tablet", "ipad-pro-13", "iPad Pro 12.9\"/13\"", "Apple", "Quad speakers — best mobile audio, light touch.",
    laptopBands("ipadpro", { roll: [160, -3.0], body: [360, 0.5], honk: [1900, -1.1], edge: [5200, -0.7], air: [10000, 0.7] }), ["ipad pro"]),
  profile("phone-tablet", "ipad-10", "iPad (10th gen)", "Apple", "Landscape stereo — moderate correction.",
    laptopBands("ipad10", { roll: [200, -3.4], body: [400, 0.6], honk: [2200, -1.4], edge: [5600, -0.8], air: [9500, 0.8] }), ["ipad"]),
  profile("phone-tablet", "galaxy-s24", "Samsung Galaxy S24", "Samsung", "Flagship stereo — steeper guard than iPhone.",
    laptopBands("s24", { roll: [240, -3.8], body: [440, 0.6], honk: [2400, -1.5], edge: [5800, -0.9], air: [9000, 0.9] }), ["galaxy s24"]),
  profile("phone-tablet", "galaxy-tab-s9", "Samsung Galaxy Tab S9", "Samsung", "AKG quad tablet — moderate correction.",
    laptopBands("tabs9", { roll: [180, -3.2], body: [380, 0.5], honk: [2100, -1.3], edge: [5500, -0.8], air: [9500, 0.8] }), ["galaxy tab"]),
  profile("phone-tablet", "pixel-9", "Google Pixel 9", "Google", "Stereo phone — firm guard, tame 2.5 kHz.",
    laptopBands("pixel9", { roll: [250, -3.9], body: [450, 0.6], honk: [2500, -1.6], edge: [6000, -0.9], air: [9000, 0.9] }), ["pixel 9"]),
  profile("phone-tablet", "oneplus-12", "OnePlus 12", "OnePlus", "Flagship stereo — similar to Galaxy voicing.",
    laptopBands("oneplus12", { roll: [240, -3.8], body: [440, 0.6], honk: [2400, -1.5], edge: [5800, -0.9], air: [9000, 0.8] }), ["oneplus"]),
  profile("phone-tablet", "generic-phone", "Generic Phone Speaker", "Generic", "Single bottom-firing driver — correct hardest.",
    laptopBands("genphone", { roll: [300, -4.4], body: [500, 0.7], honk: [2800, -2.0], edge: [6500, -1.1], air: [8500, 1.0] })),
];

// ═════════════════════════════════════════════════════════════════════════
// TVs & SOUNDBARS — voicing rationale
//
// TV speakers fire down/backwards through plastic: energy piles up in the
// 200-500 Hz "mud" region while consonants vanish. The classic fix is a
// mud cut plus a 2.8-3 kHz dialog lift and a little air. Soundbars are the
// same shape but milder — premium bars (Sonos/Bose) get token corrections,
// budget 2.1 bars also get a low-shelf trim for the boomy wireless sub.
// ═════════════════════════════════════════════════════════════════════════

function tvBands(
  prefix: string,
  o: { roll?: FG; mud: FG; dialog: FG; air?: FG },
): ParametricBand[] {
  const s: Spec[] = [];
  if (o.roll) s.push([o.roll[0], o.roll[1], 0.8, "lowshelf", "Low Trim"]);
  s.push([o.mud[0], o.mud[1], 1.0, "peaking", "De-Mud"]);
  s.push([o.dialog[0], o.dialog[1], 1.2, "peaking", "Dialog Lift"]);
  if (o.air) s.push([o.air[0], o.air[1], 0.8, "highshelf", "Air"]);
  return mkb(prefix, s);
}

const TV_SOUNDBARS: HeadphoneProfile[] = [
  profile("tv-soundbar", "samsung-tv", "Samsung TV (built-in)", "Samsung", "Down-firing TV pair — de-mud + dialog lift.",
    tvBands("samsungtv", { roll: [90, -1.6], mud: [320, -1.6], dialog: [2800, 1.6], air: [9000, 0.7] }), ["samsung tv"]),
  profile("tv-soundbar", "lg-tv", "LG TV (built-in)", "LG", "Similar voicing to Samsung — slightly less mud.",
    tvBands("lgtv", { roll: [90, -1.5], mud: [340, -1.5], dialog: [2900, 1.5], air: [9000, 0.7] }), ["lg tv"]),
  profile("tv-soundbar", "generic-tv", "Generic TV Speakers", "Generic", "Safe average for any built-in TV audio.",
    tvBands("gentv", { roll: [110, -2.0], mud: [350, -1.8], dialog: [3000, 1.8], air: [8500, 0.8] })),
  profile("tv-soundbar", "sonos-beam-2", "Sonos Beam (Gen 2)", "Sonos", "Well-tuned compact bar — token correction.",
    tvBands("beam2", { roll: [70, -0.8], mud: [280, -1.0], dialog: [2800, 1.0], air: [9500, 0.5] }), ["sonos beam"]),
  profile("tv-soundbar", "sonos-arc", "Sonos Arc", "Sonos", "Premium Atmos bar — lightest touch here.",
    tvBands("arc", { roll: [60, -0.6], mud: [260, -0.8], dialog: [2700, 0.8], air: [10000, 0.4] }), ["sonos arc"]),
  profile("tv-soundbar", "bose-soundbar-600", "Bose Smart Soundbar 600", "Bose", "Compact Atmos bar — mild de-mud + dialog.",
    tvBands("bose600", { roll: [70, -0.9], mud: [300, -1.0], dialog: [2800, 1.0], air: [9500, 0.5] }), ["bose smart soundbar", "soundbar 600"]),
  profile("tv-soundbar", "vizio-v21", "Vizio V-Series 2.1", "Vizio", "Budget 2.1 — trim the boomy sub, lift dialog.",
    tvBands("vizio21", { roll: [130, -1.4], mud: [340, -1.4], dialog: [2900, 1.4], air: [9000, 0.7] }), ["vizio"]),
  profile("tv-soundbar", "generic-soundbar-21", "Generic 2.1 Soundbar", "Generic", "Safe average for unknown bar + sub combos.",
    tvBands("genbar", { roll: [130, -1.5], mud: [350, -1.5], dialog: [3000, 1.5], air: [8800, 0.7] })),
];

// ═════════════════════════════════════════════════════════════════════════
// CAR AUDIO — voicing rationale
//
// Cabin gain inflates everything below ~100 Hz, door panels resonate in
// the low mids, and dash reflections put glare around 1 kHz. Road noise
// then masks presence/air at speed. Correction: low-shelf boom trim, small
// low-mid and 1 kHz cuts, then a presence + air lift to survive the noise
// floor. SUVs (bigger cabin, more boom) get the strongest numbers.
// ═════════════════════════════════════════════════════════════════════════

function carBands(
  prefix: string,
  o: { boom: FG; mud?: FG; glare?: FG; presence?: FG; air?: FG },
): ParametricBand[] {
  const s: Spec[] = [[o.boom[0], o.boom[1], 0.8, "lowshelf", "Boom Trim"]];
  if (o.mud) s.push([o.mud[0], o.mud[1], 1.1, "peaking", "De-Mud"]);
  if (o.glare) s.push([o.glare[0], o.glare[1], 1.4, "peaking", "Dash Glare"]);
  if (o.presence) s.push([o.presence[0], o.presence[1], 1.1, "peaking", "Presence"]);
  if (o.air) s.push([o.air[0], o.air[1], 0.8, "highshelf", "Air"]);
  return mkb(prefix, s);
}

const CAR: HeadphoneProfile[] = [
  profile("car", "car-sedan", "Car — Sedan (generic)", "Generic", "Average sedan cabin — trim boom, lift presence.",
    carBands("sedan", { boom: [70, -1.8], mud: [250, -0.8], glare: [1100, -0.8], presence: [3200, 1.0], air: [9000, 0.8] })),
  profile("car", "car-suv", "Car — SUV (generic)", "Generic", "Bigger cabin, more boom — strongest trim.",
    carBands("suv", { boom: [60, -2.2], mud: [280, -1.0], glare: [1000, -0.9], presence: [3300, 1.2], air: [9000, 0.9] })),
  profile("car", "car-truck", "Car — Pickup Truck (generic)", "Generic", "Cab behind the seats — boom + mud trim.",
    carBands("truck", { boom: [65, -2.0], mud: [260, -0.9], glare: [1050, -0.8], presence: [3200, 1.1], air: [8800, 0.8] })),
];

// ─────────────────────────────────────────────────────────────────────────
// Export — keyed by id, merged into HEADPHONES after the headphone entries
// so Companion Mode device-name matching still prefers headphones.
// ─────────────────────────────────────────────────────────────────────────

const ALL_DEVICES: HeadphoneProfile[] = [
  ...BT_SPEAKERS,
  ...LAPTOPS,
  ...SPEAKERS,
  ...PHONES_TABLETS,
  ...TV_SOUNDBARS,
  ...CAR,
];

export const DEVICE_PROFILES: Record<HeadphoneId, HeadphoneProfile> = Object.fromEntries(
  ALL_DEVICES.map((p) => [p.id, p]),
);
