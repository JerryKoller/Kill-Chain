import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "../paths.mjs";

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

export function scanPersistenceReports({ root = repoRoot } = {}) {
  const src = join(root, "src");
  const files = existsSync(src) ? walk(src) : [];
  const hits = [];
  for (const abs of files) {
    const text = readFileSync(abs, "utf8");
    if (!text.includes("localStorage.setItem") && !text.includes("localStorage.getItem")) continue;
    const rel = abs.slice(root.length + 1).replace(/\\/g, "/");
    const sets = [...text.matchAll(/localStorage\.setItem/g)].length;
    const reports = [...text.matchAll(/reportStorageFailure/g)].length;
    if (sets && !reports) {
      hits.push({ path: rel, sets, reports, gap: "setItem without reportStorageFailure in this file" });
    }
  }
  return { ok: hits.length === 0, hits };
}

const isMain = process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("scanPersistence.mjs");
if (isMain) {
  const r = scanPersistenceReports();
  console.log(JSON.stringify(r, null, 2));
}
