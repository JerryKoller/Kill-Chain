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

export function scanTimerPairing({ root = repoRoot } = {}) {
  const files = existsSync(join(root, "src")) ? walk(join(root, "src")) : [];
  const gaps = [];
  for (const abs of files) {
    const text = readFileSync(abs, "utf8");
    const sets = [...text.matchAll(/\bsetInterval\s*\(/g)].length;
    const rAF = [...text.matchAll(/\brequestAnimationFrame\s*\(/g)].length;
    const clears = [...text.matchAll(/\bclearInterval\s*\(/g)].length;
    const cancelRAF = [...text.matchAll(/\bcancelAnimationFrame\s*\(/g)].length;
    if ((sets && !clears) || (rAF && !cancelRAF)) {
      gaps.push({
        path: rel(abs),
        setInterval: sets,
        clearInterval: clears,
        requestAnimationFrame: rAF,
        cancelAnimationFrame: cancelRAF,
      });
    }
  }
  return { gaps, count: gaps.length };
}

export function scanTapConnects({ root = repoRoot } = {}) {
  const files = existsSync(join(root, "src")) ? walk(join(root, "src")) : [];
  const connects = [];
  for (const abs of files) {
    const text = readFileSync(abs, "utf8");
    if (!text.includes("preTap.connect") && !text.includes("destinationTap.connect")) continue;
    const path = rel(abs);
    const hasFinally = /\bfinally\s*\{/.test(text);
    const disconnects = [...text.matchAll(/\.disconnect\s*\(/g)].length;
    for (const h of [...lineHits(text, /\bpreTap\.connect\s*\(/), ...lineHits(text, /\bdestinationTap\.connect\s*\(/)]) {
      connects.push({ ...h, path, hasFinally, disconnectsInFile: disconnects });
    }
  }
  return { connects, count: connects.length };
}

export function scanStoreEngineCoupling({ root = repoRoot } = {}) {
  const dir = join(root, "src", "state");
  const names = existsSync(dir) ? readdirSync(dir).filter((n) => /\.(ts|tsx)$/.test(n)) : [];
  const hits = [];
  for (const name of names) {
    const abs = join(dir, name);
    const text = readFileSync(abs, "utf8");
    const engine = /from\s+["']@\/audio\/AudioEngine["']/.test(text) || /from\s+["'][^"']*\/audio\/AudioEngine["']/.test(text);
    const getEngine = /\bgetEngine\s*\(/.test(text);
    const activeFire = /\bactiveFireEngine\s*\(/.test(text);
    if (!engine && !getEngine && !activeFire) continue;
    hits.push({
      path: rel(abs),
      importsAudioEngine: engine,
      getEngineCalls: [...text.matchAll(/\bgetEngine\s*\(/g)].length,
      activeFireEngineCalls: [...text.matchAll(/\bactiveFireEngine\s*\(/g)].length,
      getEngineLines: lineHits(text, /\bgetEngine\s*\(/),
    });
  }
  const presentationOnly = names
    .map((name) => rel(join(dir, name)))
    .filter((path) => !hits.some((h) => h.path === path));
  return { hits, count: hits.length, presentationOnly };
}

/**
 * Stores that do not import AudioEngine but still drive DSP through audioStore
 * (previewParams / replaceParams / setBypass / dynamic import). These are NOT
 * presentation-only. Presence is not a defect.
 */
export function scanAudioStoreBridges({ root = repoRoot } = {}) {
  const dir = join(root, "src", "state");
  const names = existsSync(dir) ? readdirSync(dir).filter((n) => /\.(ts|tsx)$/.test(n)) : [];
  const hits = [];
  for (const name of names) {
    if (name === "audioStore.ts") continue;
    const abs = join(dir, name);
    const text = readFileSync(abs, "utf8");
    const staticImport = /from\s+["']@\/state\/audioStore["']/.test(text)
      || /from\s+["'][^"']*\/audioStore["']/.test(text);
    const dynamicImport = /import\s*\(\s*["']@\/state\/audioStore["']\s*\)/.test(text);
    const previewParams = [...text.matchAll(/\bpreviewParams\s*\(/g)].length;
    const replaceParams = [...text.matchAll(/\breplaceParams\s*\(/g)].length;
    const setBypass = [...text.matchAll(/\bsetBypass\s*\(/g)].length;
    const setOutputGain = [...text.matchAll(/\bsetOutputGain(?:Db)?\s*\(/g)].length;
    const useAudioStore = [...text.matchAll(/\buseAudioStore\b/g)].length;
    if (!staticImport && !dynamicImport && previewParams === 0 && replaceParams === 0 && useAudioStore === 0) {
      continue;
    }
    hits.push({
      path: rel(abs),
      staticImport,
      dynamicImport,
      useAudioStore,
      previewParams,
      replaceParams,
      setBypass,
      setOutputGain,
      highRateTick: /\bsetInterval\s*\(/.test(text) && previewParams > 0,
    });
  }
  return { hits, count: hits.length };
}

export function scanAutoFlatten({ root = repoRoot } = {}) {
  const files = existsSync(join(root, "src")) ? walk(join(root, "src")) : [];
  const callers = [];
  let definition = null;
  for (const abs of files) {
    const text = readFileSync(abs, "utf8");
    if (!text.includes("autoFlatten")) continue;
    const path = rel(abs);
    const def = lineHits(text, /export async function autoFlatten\b/);
    if (def.length) definition = { path, ...def[0] };
    for (const h of lineHits(text, /\bautoFlatten\s*\(/)) {
      if (/export async function autoFlatten/.test(h.text)) continue;
      if (/^(\*|\/\/)/.test(h.text)) continue;
      callers.push({ path, ...h });
    }
  }
  return { definition, callers, count: callers.length };
}

export function scanAutoLockScan({ root = repoRoot } = {}) {
  const files = existsSync(join(root, "src")) ? walk(join(root, "src")) : [];
  const callers = [];
  let definition = null;
  for (const abs of files) {
    const text = readFileSync(abs, "utf8");
    if (!text.includes("autoLockScan")) continue;
    const path = rel(abs);
    const def = lineHits(text, /export async function autoLockScan\b/);
    if (def.length) definition = { path, ...def[0] };
    for (const h of lineHits(text, /\bautoLockScan\s*\(/)) {
      if (/export async function autoLockScan/.test(h.text)) continue;
      if (/^(\*|\/\/)/.test(h.text)) continue;
      callers.push({ path, ...h });
    }
  }
  return { definition, callers, count: callers.length };
}

export function scanAnalysers({ root = repoRoot } = {}) {
  const files = existsSync(join(root, "src")) ? walk(join(root, "src")) : [];
  const hits = [];
  for (const abs of files) {
    const text = readFileSync(abs, "utf8");
    if (!/createAnalyser|AnalyserNode/.test(text)) continue;
    hits.push({
      path: rel(abs),
      createAnalyser: [...text.matchAll(/\bcreateAnalyser\s*\(/g)].length,
      AnalyserNode: [...text.matchAll(/\bAnalyserNode\b/g)].length,
    });
  }
  return { hits, count: hits.length };
}

export function writeOvernightScan() {
  const claim = scanClaimSource();
  const rewire = scanRewireFront();
  const persist = scanPersistenceReports();
  const timers = scanTimerPairing();
  const taps = scanTapConnects();
  const analysers = scanAnalysers();
  const autoFlatten = scanAutoFlatten();
  const autoLockScan = scanAutoLockScan();
  const storeEngine = scanStoreEngineCoupling();
  const bridges = scanAudioStoreBridges();
  const bridgePaths = new Set(bridges.hits.map((h) => h.path));
  const presentationOnly = storeEngine.presentationOnly.filter((path) => !bridgePaths.has(path));
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
    timerPairingGaps: timers.gaps,
    tapConnects: taps.connects,
    analysers: analysers.hits,
    autoFlatten,
    autoLockScan,
    storeEngineCoupling: storeEngine.hits,
    audioStoreBridges: bridges.hits,
    presentationOnlyStores: presentationOnly,
    notes: [
      "Read-only scan. Production audio was not modified.",
      "Persistence gaps are same-file heuristics, not proof that a caller lacks reportStorageFailure via import.",
      "Timer gaps are same-file setInterval/rAF vs clear/cancel heuristics.",
      "storeEngineCoupling lists src/state files that import or call AudioEngine/getEngine/activeFireEngine. Presence is not a defect.",
      "audioStoreBridges lists stores that drive DSP through audioStore without importing AudioEngine. They are not presentation-only.",
      "presentationOnlyStores excludes both engine-coupled stores and audioStore bridges. Still a heuristic, not Level 2B permission.",
      "autoFlatten lists the DSP helper definition and call sites. Presence of a missionStateStore caller is expected; extra callers would be a dual-orchestrator risk.",
      "autoLockScan is the Tractor fresh-scan helper. Extra callers besides missionStateStore would also be a dual-orchestrator risk.",
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
