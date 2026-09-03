import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { repoRoot, toolsRoot } from "./paths.mjs";

const require = createRequire(fileURLToPath(import.meta.url));

export function loadTypescript() {
  const tries = [
    join(toolsRoot, "node_modules", "typescript"),
    join(repoRoot, "node_modules", "typescript"),
  ];
  const errors = [];
  for (const p of tries) {
    try {
      return require(p);
    } catch (err) {
      errors.push(`${p}: ${err instanceof Error ? err.message : err}`);
    }
  }
  throw new Error(
    "typescript package not found. Install Kill Chain root deps (npm install) so tools/killchain-ai can parse the app.\n" +
      errors.join("\n"),
  );
}
