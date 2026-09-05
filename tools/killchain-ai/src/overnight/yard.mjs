import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { dataDir, repoRoot } from "../paths.mjs";
import { gitCapture, gitRun } from "../git.mjs";
import { gitPorcelain, isSidecarPath } from "../mission/gitops.mjs";
import { checkSingularity } from "../mission/singularityGuard.mjs";

export const NIGHT_ID = "singularity-night";
export const SINGULARITY_REL = "src/components/Visualizer/singularity.ts";
export const DIAGNOSTIC_SENTENCE = "SINGULARITY — WEBGL2 UNAVAILABLE, RUNNING FALLBACK CORE";
export const CP1_SHA = "d99ddd87a6e8164f8ffabb7f71fbe0804d1618608f75cb7c7076a583bbc517bf";
export const CP1_FILE = join(
  dataDir,
  "missions/singularity-visual-overhaul/checkpoints/01/files/src/components/Visualizer/singularity.ts",
);
export const PARKED = [
  "src/components/FireCommand/GatePanel.tsx",
  "src/components/FireCommand/MacroPanel.tsx",
  "src/components/FireCommand/ModuleEnableToggle.tsx",
];
export const AUDIO_PLAYGROUND = join(repoRoot, "..", "audio-playground");

export function nightDir() {
  const dir = join(dataDir, "overnight", NIGHT_ID);
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, "diary"), { recursive: true });
  mkdirSync(join(dir, "checkpoints"), { recursive: true });
  mkdirSync(join(dir, "evidence"), { recursive: true });
  mkdirSync(join(dir, "quarantine"), { recursive: true });
  mkdirSync(join(dir, "parked-start"), { recursive: true });
  return dir;
}

export function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

export function shaFile(abs) {
  return sha256(readFileSync(abs));
}

export function singularityAbs() {
  return join(repoRoot, SINGULARITY_REL);
}

export function readSingularity() {
  return readFileSync(singularityAbs());
}

export function writeSingularity(buf) {
  writeFileSync(singularityAbs(), buf);
}

export function fingerprintParked() {
  const out = {};
  for (const rel of PARKED) {
    const abs = join(repoRoot, rel);
    out[rel] = existsSync(abs) ? shaFile(abs) : null;
  }
  return out;
}

export function copyParkedSnapshot(destName) {
  const root = join(nightDir(), destName);
  mkdirSync(root, { recursive: true });
  const hashes = {};
  for (const rel of PARKED) {
    const abs = join(repoRoot, rel);
    const out = join(root, basename(rel));
    copyFileSync(abs, out);
    hashes[rel] = shaFile(abs);
  }
  writeFileSync(join(root, "hashes.json"), `${JSON.stringify(hashes, null, 2)}\n`);
  return hashes;
}

export function parkedUnchanged(startHashes) {
  const now = fingerprintParked();
  const changed = [];
  for (const rel of PARKED) {
    if (startHashes[rel] !== now[rel]) changed.push({ path: rel, from: startHashes[rel], to: now[rel] });
  }
  return { ok: changed.length === 0, changed, now };
}

export function restoreCheckpoint1() {
  if (!existsSync(CP1_FILE)) throw new Error(`CREATIVE CHECKPOINT 1 missing: ${CP1_FILE}`);
  const buf = readFileSync(CP1_FILE);
  if (sha256(buf) !== CP1_SHA) throw new Error("CREATIVE CHECKPOINT 1 bytes do not match recorded SHA-256");
  writeSingularity(buf);
  return CP1_SHA;
}

export function ensureCheckpoint1() {
  const current = shaFile(singularityAbs());
  if (current === CP1_SHA) return { restored: false, sha: current };
  restoreCheckpoint1();
  return { restored: true, sha: CP1_SHA };
}

export function saveNamedCheckpoint(name, extra = {}) {
  const dir = join(nightDir(), "checkpoints", name);
  mkdirSync(dir, { recursive: true });
  const buf = readSingularity();
  writeFileSync(join(dir, "singularity.ts"), buf);
  const meta = {
    at: new Date().toISOString(),
    name,
    sha256: sha256(buf),
    bytes: buf.length,
    ...extra,
  };
  writeFileSync(join(dir, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`);
  return meta;
}

export function restoreNamedCheckpoint(name) {
  const file = join(nightDir(), "checkpoints", name, "singularity.ts");
  if (!existsSync(file)) throw new Error(`checkpoint missing: ${name}`);
  writeSingularity(readFileSync(file));
  return shaFile(singularityAbs());
}

export function guardNow() {
  const src = readSingularity().toString("utf8");
  const baseline = existsSync(CP1_FILE) ? readFileSync(CP1_FILE, "utf8") : src;
  return checkSingularity(src, { baseline });
}

export function diagnosticStillPresent() {
  return readSingularity().toString("utf8").includes(DIAGNOSTIC_SENTENCE);
}

export function quarantineSidecars() {
  const hits = gitPorcelain().filter((r) => isSidecarPath(r.path) && !String(r.path).startsWith("tools/killchain-ai/"));
  const moved = [];
  const qdir = join(nightDir(), "quarantine", new Date().toISOString().replace(/[:.]/g, "-"));
  for (const row of hits) {
    const abs = join(repoRoot, row.path);
    if (!existsSync(abs)) continue;
    mkdirSync(qdir, { recursive: true });
    const dest = join(qdir, basename(row.path));
    renameSync(abs, dest);
    moved.push({ from: row.path, to: dest });
  }
  return { hits: hits.map((h) => h.path), moved };
}

export function audioPlaygroundPorcelain() {
  try {
    return String(execFileSync("git", ["status", "--porcelain"], {
      cwd: AUDIO_PLAYGROUND,
      encoding: "utf8",
    }));
  } catch (e) {
    return `(unavailable: ${e.message})`;
  }
}

export function startingGit() {
  return {
    ...gitCapture(),
    porcelain: gitRun(["status", "--porcelain"], { allowFail: true }) || "",
    audioPlaygroundPorcelain: audioPlaygroundPorcelain(),
  };
}

export function copyIfExists(src, dest) {
  if (!existsSync(src)) return false;
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(src, dest);
  return true;
}

export function seedDiary() {
  const diary = join(nightDir(), "diary");
  const iterate = join(dataDir, "missions/singularity-iterate-1/diary");
  copyIfExists(join(iterate, "00-original-baseline.png"), join(diary, "00-original-baseline.png"));
  copyIfExists(join(iterate, "00-capture.json"), join(diary, "00-capture.json"));
  copyIfExists(join(iterate, "01-robo-puppy-first-valid.png"), join(diary, "01-robo-puppy-first-valid.png"));
  copyIfExists(join(iterate, "01-capture.json"), join(diary, "01-capture.json"));
  return readdirSync(diary);
}

export function appendDiary(entry) {
  const p = join(nightDir(), "diary", "DIARY.md");
  const prev = existsSync(p) ? readFileSync(p, "utf8") : "# Singularity overnight visual diary\n";
  writeFileSync(p, `${prev.trim()}\n\n${entry.trim()}\n`);
  return p;
}

export function readState() {
  const p = join(nightDir(), "state.json");
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; }
}

export function writeState(state) {
  writeFileSync(join(nightDir(), "state.json"), `${JSON.stringify(state, null, 2)}\n`);
}

export function logLine(state, msg) {
  const line = `${new Date().toISOString()}  ${msg}`;
  const p = join(nightDir(), "NIGHT.log");
  const prev = existsSync(p) ? readFileSync(p, "utf8") : "";
  writeFileSync(p, `${prev}${line}\n`);
  (state.events || (state.events = [])).push(line);
  writeState(state);
  return line;
}
