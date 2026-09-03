import { readdirSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { IGNORE_DIR_NAMES, repoRel, repoRoot } from "../paths.mjs";

const CODE_EXT = new Set([".ts", ".tsx", ".js", ".mjs", ".mts", ".cjs"]);
const MD_EXT = new Set([".md"]);

export function walkFiles(absDir, acc = []) {
  let entries;
  try {
    entries = readdirSync(absDir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const ent of entries) {
    if (IGNORE_DIR_NAMES.has(ent.name)) continue;
    if (ent.name.startsWith(".") && ent.name !== ".gitignore") continue;
    const abs = join(absDir, ent.name);
    if (ent.isDirectory()) walkFiles(abs, acc);
    else if (ent.isFile()) acc.push(abs);
  }
  return acc;
}

export function collectScanFiles() {
  const files = [];
  for (const root of ["src", "electron", "scripts", "docs"]) {
    walkFiles(join(repoRoot, root), files);
  }
  const extras = ["README.md", "package.json", "tsconfig.json"];
  for (const rel of extras) {
    const abs = join(repoRoot, rel);
    try {
      if (statSync(abs).isFile()) files.push(abs);
    } catch { /* missing */ }
  }
  const seen = new Set();
  const code = [];
  const md = [];
  const other = [];
  for (const raw of files) {
    const abs = resolve(raw);
    const key = abs.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const rel = repoRel(abs);
    const ext = extname(abs).toLowerCase();
    if (rel.startsWith("tools/killchain-ai/")) continue;
    if (CODE_EXT.has(ext)) code.push({ abs, rel });
    else if (MD_EXT.has(ext)) md.push({ abs, rel });
    else if (rel === "package.json") other.push({ abs, rel, kind: "package" });
  }
  return { code, md, other };
}
