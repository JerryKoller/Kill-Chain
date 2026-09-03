import { existsSync, mkdirSync, readFileSync, writeFileSync, cpSync } from "node:fs";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { repoRoot } from "../paths.mjs";
import { sha256 } from "./attribution.mjs";
import { gitCapture } from "../git.mjs";

function write(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, "utf8");
}

export function exportReviewCandidate({
  destDir,
  missionId,
  files,
  io,
  baselineHashes = {},
  validation = null,
  report = "",
  spec = null,
  extra = {},
}) {
  mkdirSync(join(destDir, "files"), { recursive: true });
  const git = gitCapture();
  const changed = [];
  const finalHashes = {};
  for (const rel of files) {
    const buf = io.read(rel);
    if (!buf) continue;
    const dest = join(destDir, "files", rel);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, buf);
    const hash = sha256(buf);
    finalHashes[rel] = { sha256: hash, bytes: buf.length };
    changed.push(rel);
  }
  const manifest = {
    missionId,
    head: git.commit,
    branch: git.branch,
    at: new Date().toISOString(),
    files: changed,
    baselineHashes,
    finalHashes,
    ...extra,
  };
  write(join(destDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  write(join(destDir, "HEAD"), `${git.commit || ""}\n`);
  write(join(destDir, "validation.json"), `${JSON.stringify(validation || {}, null, 2)}\n`);
  write(join(destDir, "FINAL_REPORT.md"), report || `# ${missionId}\n`);
  write(join(destDir, "RESTORE.md"), `Restore these files from the mission baseline hashes in manifest.json (SHA-256 must match baselineHashes), or from the mission attribution/baseline snapshot.\nDo not git reset --hard.\n`);
  write(join(destDir, "REAPPLY.md"), `Copy files/ back over the listed paths, then verify SHA-256 against finalHashes in manifest.json.\nParked Gate/Macro/toggle files must not change.\n`);
  return { destDir, manifest };
}

export function fileSha256Abs(abs) {
  if (!existsSync(abs)) return null;
  const buf = readFileSync(abs);
  return { sha256: createHash("sha256").update(buf).digest("hex"), bytes: buf.length };
}

export function parkedUiHashes(root = repoRoot) {
  const files = [
    "src/components/FireCommand/GatePanel.tsx",
    "src/components/FireCommand/MacroPanel.tsx",
    "src/components/FireCommand/fireUiKit.tsx",
    "src/components/FireCommand/ModuleEnableToggle.tsx",
  ];
  const out = {};
  for (const rel of files) {
    out[rel] = fileSha256Abs(join(root, rel));
  }
  return out;
}
