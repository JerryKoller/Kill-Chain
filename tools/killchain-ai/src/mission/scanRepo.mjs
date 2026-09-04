/**
 * Diagnostic: run the structural scanner across the whole repo.
 *
 * Every file at HEAD should be structurally balanced, so any file reported here
 * is a scanner false positive. Used to keep `jsxStructure.mjs` honest before it
 * is allowed to advise a repair pass.
 *
 *   node tools/killchain-ai/src/mission/scanRepo.mjs [--verbose] [dir]
 */
import { readdirSync, statSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { repoRoot } from "../paths.mjs";
import { scanStructure } from "./jsxStructure.mjs";

const SKIP_DIR = /^(node_modules|dist|dist-electron|release|\.git|out|build|coverage)$/;

export function collectSources(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) {
      if (!SKIP_DIR.test(entry)) collectSources(p, out);
    } else if (/\.(tsx|ts|jsx|mjs)$/.test(entry) && !/\.d\.ts$/.test(entry)) {
      out.push(p);
    }
  }
  return out;
}

export function scanRepoFiles(dir) {
  const files = collectSources(dir);
  const offenders = [];
  for (const f of files) {
    let src;
    try { src = readFileSync(f, "utf8"); } catch { continue; }
    const jsx = /\.(tsx|jsx)$/.test(f);
    const scan = scanStructure(src, { jsx });
    if (!scan.ok) offenders.push({ file: relative(dir, f), scan, src });
  }
  return { total: files.length, offenders };
}

function main() {
  const args = process.argv.slice(2);
  const verbose = args.includes("--verbose");
  const target = args.find((a) => !a.startsWith("--")) || join(repoRoot, "src");
  const { total, offenders } = scanRepoFiles(target);
  for (const { file, scan, src } of offenders) {
    const lines = src.split(/\r?\n/);
    console.log(
      `FALSE POSITIVE? ${file}  surplus=${scan.surplusClosers.length} unclosed=${scan.unclosed.length} mismatch=${scan.tagMismatches.length}`,
    );
    if (verbose) {
      const pts = [
        ...scan.surplusClosers.slice(0, 3).map((x) => [`surplus ${JSON.stringify(x.text)}`, x.line]),
        ...scan.unclosed.slice(0, 3).map((x) => [`unclosed ${x.name || x.char}`, x.line]),
        ...scan.tagMismatches.slice(0, 3).map((x) => [`mismatch ${x.closer}`, x.line]),
      ];
      for (const [label, n] of pts) {
        console.log(`   -- ${label} @ line ${n}`);
        for (let i = Math.max(1, n - 3); i <= Math.min(lines.length, n + 2); i++) {
          console.log(`      ${String(i).padStart(5)} ${(lines[i - 1] || "").slice(0, 150)}`);
        }
      }
    }
  }
  const clean = total - offenders.length;
  console.log(`\nscanned ${total} files: ${clean} balanced, ${offenders.length} reported unbalanced (${((100 * clean) / (total || 1)).toFixed(2)}% clean)`);
}

if (process.argv[1] && process.argv[1].endsWith("scanRepo.mjs")) main();
