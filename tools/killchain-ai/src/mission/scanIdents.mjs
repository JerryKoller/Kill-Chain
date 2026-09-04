/**
 * Diagnostic: run the identifier scope gate across the repo.
 *
 * HEAD typechecks clean, so every finding here is a false positive and must be
 * driven to zero before the gate is allowed to advise a repair pass.
 *
 *   node tools/killchain-ai/src/mission/scanIdents.mjs [--verbose] [dir]
 */
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { repoRoot } from "../paths.mjs";
import { collectSources } from "./scanRepo.mjs";
import { checkIdentifiers } from "./identifierGate.mjs";

function main() {
  const args = process.argv.slice(2);
  const verbose = args.includes("--verbose");
  const target = args.find((a) => !a.startsWith("--")) || join(repoRoot, "src");
  const files = collectSources(target);
  let bad = 0;
  let findings = 0;
  const nameCounts = new Map();
  for (const f of files) {
    let r;
    try { r = checkIdentifiers(f, readFileSync(f, "utf8")); } catch { continue; }
    if (r.ok) continue;
    bad++;
    findings += r.unresolved.length;
    for (const u of r.unresolved) nameCounts.set(u.name, (nameCounts.get(u.name) || 0) + 1);
    if (verbose) {
      console.log(`FALSE POSITIVE? ${relative(target, f)}`);
      for (const u of r.unresolved.slice(0, 8)) {
        console.log(`   ${u.name}  line ${u.line} x${u.count}  ~ ${u.candidates.join(", ")}`);
      }
    }
  }
  if (nameCounts.size) {
    console.log("\nmost frequent unresolved names:");
    for (const [n, c] of [...nameCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)) {
      console.log(`   ${String(c).padStart(4)}x  ${n}`);
    }
  }
  console.log(`\nscanned ${files.length} files: ${files.length - bad} clean, ${bad} with findings (${findings} total findings)`);
}

main();
