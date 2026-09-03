import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { repoRoot, dataDir } from "../paths.mjs";
import { scanPersistenceReports } from "./scanPersistence.mjs";

function walk(dir, out = []) {
  let ents;
  try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const ent of ents) {
    if (ent.name === "node_modules" || ent.name === ".git" || ent.name === "dist") continue;
    const abs = join(dir, ent.name);
    if (ent.isDirectory()) walk(abs, out);
    else if (/\.(ts|tsx|mjs|js)$/.test(ent.name)) out.push(abs);
  }
  return out;
}

function rel(abs) {
  return abs.slice(repoRoot.length + 1).replace(/\\/g, "/");
}

function lineHits(text, re) {
  const hits = [];
  const lines = String(text).split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i])) hits.push({ line: i + 1, text: lines[i].trim().slice(0, 200) });
    re.lastIndex = 0;
  }
  return hits;
}

export function scanClaimSource({ root = repoRoot } = {}) {
  const files = existsSync(join(root, "src")) ? walk(join(root, "src")) : [];
  const callers = [];
  let definition = null;
  for (const abs of files) {
    const text = readFileSync(abs, "utf8");
    if (!text.includes("claimSource")) continue;
    const path = rel(abs);
    const def = lineHits(text, /export function claimSource\b/);
    if (def.length) definition = { path, ...def[0] };
    for (const h of lineHits(text, /\bclaimSource\s*\(/)) {
      if (/export function claimSource/.test(h.text)) continue;
      callers.push({ path, ...h });
    }
  }
  return { definition, callers, count: callers.length };
}

export function scanRewireFront({ root = repoRoot } = {}) {
  const files = existsSync(join(root, "src")) ? walk(join(root, "src")) : [];
  const mentions = [];
  for (const abs of files) {
    const text = readFileSync(abs, "utf8");
    if (!text.includes("rewireFront")) continue;
    const path = rel(abs);
    for (const h of lineHits(text, /\brewireFront\b/)) {
      mentions.push({ path, ...h });
    }
  }
  const outsideEngine = mentions.filter((m) => m.path !== "src/audio/AudioEngine.ts");
  const enginePath = join(root, "src/audio/AudioEngine.ts");
  const engineText = existsSync(enginePath) ? readFileSync(enginePath, "utf8") : "";
  const lines = engineText.split(/\r?\n/);
  const startLine = lines.findIndex((l) => /private rewireFront\s*\(/.test(l));
  let endLine = lines.length;
  if (startLine >= 0) {
    for (let i = startLine + 1; i < lines.length; i++) {
      if (/^  \/\*\*/.test(lines[i]) || /^  (private |public )/.test(lines[i]) || /^  [a-zA-Z][a-zA-Z0-9_]*\(/.test(lines[i])) {
        endLine = i;
        break;
      }
    }
  }
  const frontGainRe = /\b(bypassBus|fxInput|postFxGain|dimReturn|dimTapEq|dimTapRaw)\.gain\.setTargetAtTime\b/;
  const inMethod = [];
  const outsideMethod = [];
  for (let i = 0; i < lines.length; i++) {
    if (!frontGainRe.test(lines[i])) continue;
    frontGainRe.lastIndex = 0;
    const hit = { line: i + 1, text: lines[i].trim().slice(0, 200) };
    if (startLine >= 0 && i >= startLine && i < endLine) inMethod.push(hit);
    else outsideMethod.push(hit);
  }
  return {
    mentions,
    outsideEngine,
    engineMentions: mentions.filter((m) => m.path === "src/audio/AudioEngine.ts").length,
    methodRange: startLine >= 0 ? { startLine: startLine + 1, endLine } : null,
    frontGainAssignments: { inMethod: inMethod.length, outsideMethod: outsideMethod.length, outsideMethodHits: outsideMethod },
    ok: outsideEngine.length === 0 && outsideMethod.length === 0,
  };
}

export function writeOvernightScan() {
  const claim = scanClaimSource();
  const rewire = scanRewireFront();
  const persist = scanPersistenceReports();
  const report = {
    at: new Date().toISOString(),
    claimSource: claim,
    rewireFront: {
      ok: rewire.ok,
      outsideEngine: rewire.outsideEngine,
      engineMentions: rewire.engineMentions,
      frontGainAssignments: rewire.frontGainAssignments,
    },
    persistenceGaps: persist.hits,
    notes: [
      "Read-only scan. Production audio was not modified.",
      "Persistence gaps are same-file heuristics, not proof that a caller lacks reportStorageFailure via import.",
    ],
  };
  const dir = join(dataDir, "overnight");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "INVARIANT_SCAN.json"), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

const isMain = process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("scanInvariants.mjs");
if (isMain) {
  console.log(JSON.stringify(writeOvernightScan(), null, 2));
}
