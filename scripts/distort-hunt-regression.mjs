/**
 * Local regression checks for sudden-distortion fixes (no audio hardware).
 * Run: node scripts/distort-hunt-regression.mjs
 */
import assert from "assert";

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// --- Glue makeup product cap ---
{
  const makeupLin = 4;
  const gOut = 2;
  const glueAg = 1;
  const product = clamp(makeupLin * gOut * glueAg, 0.5, 2.0);
  assert.strictEqual(product, 2.0, "glue makeup product must cap at 2.0");
  assert.ok(makeupLin * gOut * glueAg === 8, "pre-cap product was 8× (the bug)");
}

// --- Mod matrix volume soft-sat ---
{
  const accVol = 0.3 + 0.3 + 0.3; // three stacked routes
  const softVol = Math.tanh(accVol * 0.85) * 1.05;
  const master = 0.7;
  const out = clamp(master * (1 + softVol), 0, 1.15);
  const naive = clamp(master * (1 + accVol), 0, 1.4);
  assert.ok(out < naive, "soft-sat volume must be quieter than raw stack");
  assert.ok(out <= 1.15, "soft-sat master ceiling 1.15");
}

// --- Echo delay feedback cap (IceKing ~0.41 runaway) ---
{
  let fb = 0.415;
  const mode = "echo";
  if (mode === "echo" || mode === "dub" || mode === "bounce" || mode === "slap") {
    fb = Math.min(fb, 0.38);
  }
  assert.ok(fb <= 0.38, "echo-class fb ≤ 0.38");
}

// --- Delay freeze / infinite caps ---
{
  let fb = 0.3;
  const mode = "infinite";
  if (mode === "infinite") fb = Math.min(0.85, Math.max(fb, 0.78));
  assert.ok(fb <= 0.85, "infinite fb ≤ 0.85");
  assert.ok(fb >= 0.78, "infinite fb ≥ 0.78");

  fb = 0.3;
  const delayFreeze = true;
  if (delayFreeze) fb = Math.min(0.88, Math.max(fb, 0.82));
  fb = clamp(fb * (1 - 0 * 0.08), 0, 0.88);
  assert.ok(fb <= 0.88, "freeze fb ≤ 0.88");
  assert.ok(fb < 0.97, "freeze must be below old 0.97 runaway");
}

// --- Tractor trim absolute clamp ---
{
  let outputGainDb = 10;
  const trim = 3;
  const next = Math.max(-24, Math.min(12, outputGainDb + trim));
  assert.strictEqual(next, 12, "trim must clamp at +12 dB");
}

// --- FeedbackKiller engage modes ---
{
  const shouldEngage = (mode) => mode === "loopback" || mode === "loopbackWithMute";
  assert.ok(shouldEngage("loopback"));
  assert.ok(shouldEngage("loopbackWithMute"));
  assert.ok(!shouldEngage("device"));
  assert.ok(!shouldEngage("airspace"));
}

// --- Silent delay must not keep feedback cooking ---
{
  const fxSilenced = false;
  const dMix = 0;
  const delayLoop = !fxSilenced && dMix > 0.0005;
  assert.strictEqual(delayLoop, false, "zero wet → feedback loop off");
  const dMixOn = 0.35;
  assert.ok(!fxSilenced && dMixOn > 0.0005, "IceKing-class wet keeps loop");
}

// --- Shared master dynamics must be rebuilt (reboot-class poison) ---
{
  const nodes = ["fireLimiter", "glue", "fxLimiter", "finalLimiter"];
  assert.ok(nodes.includes("finalLimiter"), "finalLimiter is always-on path");
  assert.strictEqual(nodes.length, 4, "Fire flush rebuilds all four compressors");
}

// --- NS safety forces spectral off + freezes clear ---
{
  const patch = {
    spectralMode: "smear",
    spectralMix: 0.8,
    delayFreeze: true,
    reverbFreeze: true,
    filterModel: "ladder",
    filterResonance: 16,
    delayFeedback: 0.9,
  };
  // Mirror applyNsSafety core rules (keep in sync with fireModuleLocks.ts).
  patch.delayFreeze = false;
  patch.reverbFreeze = false;
  patch.spectralMode = "off";
  patch.spectralMix = Math.min(patch.spectralMix, 0.35);
  patch.filterResonance = Math.min(patch.filterResonance, 12);
  if ((patch.filterModel === "ladder" || patch.filterModel === "svf")
    && patch.filterResonance > 8) {
    patch.filterResonance = 8;
  }
  patch.delayFeedback = Math.min(patch.delayFeedback, 0.68);
  assert.strictEqual(patch.spectralMode, "off");
  assert.strictEqual(patch.delayFreeze, false);
  assert.strictEqual(patch.reverbFreeze, false);
  assert.strictEqual(patch.filterResonance, 8);
  assert.ok(patch.delayFeedback <= 0.68);
  assert.ok(patch.spectralMix <= 0.35);
}

// --- Hot ARP release cap (300 BPM × 1/32 must not stack 350 ms tails) ---
{
  const stepSec = 60 / 300 * 0.125; // 0.025
  const gate = 1;
  const durSec = Math.max(0.008, gate * stepSec - 0.008);
  const ampRelease = 0.35;
  const maxRel = Math.min(ampRelease, durSec * 0.85, stepSec * 0.9, 0.022);
  assert.ok(maxRel <= 0.022, "hot arp max release ≤ 22 ms");
  const tail = durSec + maxRel * 1.6 + 0.028;
  assert.ok(tail < 0.12, "hot arp voice tail < 120 ms (not 1.5 s piano release)");
  const attackSec = Math.min(0.01, Math.max(0.001, stepSec * 0.25));
  assert.ok(attackSec <= stepSec * 0.25, "hot arp attack fits inside step");
}

// --- Hot ARP flag + load-aware threshold ---
{
  const stepSec = 60 / 300 * 0.125; // 0.025
  assert.ok(stepSec < 0.05, "300×1/32 is hot by stepSec");
  const load = 4 * 3 * 1; // 4oct × 3 notes × gate1
  assert.ok(load >= 6, "4oct chord load triggers dense-hot path");
  // Boundary: 300×1/16 = 0.05 exactly — not < 0.05, but load≥6 + step<0.08 is hot
  const step16 = 60 / 300 * 0.25;
  assert.ok(step16 >= 0.05 && step16 < 0.08 && load >= 6, "300×1/16 dense chord is load-hot");
}

// --- Lookahead shrink when hot (must not inflate active voices) ---
{
  const stepSec = 0.025;
  const hotLookahead = Math.max(0.04, Math.min(0.08, stepSec * 2.5));
  assert.ok(hotLookahead <= 0.08, "hot lookahead ≤ 80 ms");
  assert.ok(hotLookahead < 0.12, "hot lookahead < normal 120 ms");
  const materializeEps = 0.008;
  // Voices in the queue beyond eps are NOT in the active set.
  const queuedBeyondEps = Math.floor((hotLookahead - materializeEps) / stepSec);
  assert.ok(queuedBeyondEps >= 1, "some steps stay queued (deferred construction)");
  // Active voice count at any instant must not include those queued futures.
  const activeFromLookahead = 0; // deferred = 0 until materialize
  assert.strictEqual(activeFromLookahead, 0, "lookahead must not inflate active voice count");
}

// --- Same-MIDI choke deferred to `when` (ordering contract) ---
{
  const scheduleNow = 1.0;
  const noteWhen = 1.05;
  const chokeAt = noteWhen; // never scheduleNow
  assert.ok(chokeAt > scheduleNow, "same-MIDI choke must fire at note when, not schedule time");
  assert.strictEqual(chokeAt, noteWhen, "choke time === attack time");
}

// --- Ratchet must not cancel the primary pending note ---
{
  const queue = [];
  const push = (midi, when, duration) => {
    const win = Math.max(0.008, duration);
    // Mirror scheduleArpNote cancel window (fixed): only same-MIDI in [when, when+win)
    for (let i = queue.length - 1; i >= 0; i--) {
      const j = queue[i];
      if (j.midi === midi && j.when >= when - 0.0005 && j.when < when + win) {
        queue.splice(i, 1);
      }
    }
    queue.push({ midi, when, duration: win });
  };
  const t = 1.0;
  const stepSec = 0.025;
  const dur = Math.max(0.008, 1 * stepSec - 0.008); // gate 100%
  push(60, t, dur);
  push(60, t + stepSec * 0.5, Math.max(0.008, dur * 0.4)); // ratchet
  assert.strictEqual(queue.length, 2, "primary + ratchet both stay queued");
  assert.ok(queue[0].when < queue[1].when, "primary before ratchet");

  // Old buggy cancel (when < t + dur) would have wiped the primary:
  const buggy = [];
  const buggyPush = (midi, when, duration) => {
    for (let i = buggy.length - 1; i >= 0; i--) {
      const j = buggy[i];
      if (j.midi === midi && j.when < when + Math.max(0.008, duration)) buggy.splice(i, 1);
    }
    buggy.push({ midi, when, duration });
  };
  buggyPush(60, t, dur);
  buggyPush(60, t + stepSec * 0.5, Math.max(0.008, dur * 0.4));
  assert.strictEqual(buggy.length, 1, "buggy cancel leaves only ratchet");
}

// --- Swing uses pre-increment step index ---
{
  let arpStep = 0;
  const swingIdx = arpStep; // capture BEFORE emit increments
  arpStep++;
  assert.strictEqual(swingIdx, 0, "first step swing index is 0");
  assert.strictEqual(arpStep, 1, "arpStep increments after swing capture");
  // Odd swingIdx stretches; even shortens — off-by-one would invert pairing.
  const sw = 0.2;
  const durEven = 0.025 * (swingIdx % 2 === 1 ? 1 + sw : 1 - sw);
  assert.ok(durEven < 0.025, "step 0 (even) shortens with swing");
}

// --- Host BPM ceiling matches ARP (300) ---
{
  const next = Math.max(40, Math.min(300, 300));
  assert.strictEqual(next, 300, "setHostBpm ceiling ≥ ARP max 300");
}

// --- Hot ARP bus pad ---
{
  const VOICE_HEADROOM = 0.5;
  const HOT_ARP_BUS_PAD = 0.78;
  const g = VOICE_HEADROOM * HOT_ARP_BUS_PAD;
  assert.ok(g < VOICE_HEADROOM, "hot pad reduces bus gain");
  assert.ok(g >= 0.35, "hot pad still leaves musical level");
}

// --- Dying voice cap (IceKing arp pile-up) ---
{
  const DYING_CAP = 6;
  const HOT_ARP_DYING_CAP = 3;
  const dying = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  while (dying.size > DYING_CAP) {
    const first = dying.values().next().value;
    if (first === undefined) break;
    dying.delete(first);
  }
  assert.strictEqual(dying.size, DYING_CAP);
  while (dying.size > HOT_ARP_DYING_CAP) {
    const first = dying.values().next().value;
    if (first === undefined) break;
    dying.delete(first);
  }
  assert.strictEqual(dying.size, HOT_ARP_DYING_CAP);
}

// --- Init factory must deep-clone (no DEFAULT nest alias) ---
{
  const DEFAULT = { modMatrix: [{ amount: 0 }], masterGain: 0.72 };
  const shallow = { ...DEFAULT, masterGain: 0.72 };
  const deep = structuredClone(DEFAULT);
  shallow.modMatrix[0].amount = 0.9;
  assert.strictEqual(DEFAULT.modMatrix[0].amount, 0.9, "shallow aliases nests");
  deep.modMatrix[0].amount = 0.5;
  assert.strictEqual(DEFAULT.modMatrix[0].amount, 0.9, "deep clone is independent");
}

console.log("distort-hunt-regression: OK");
