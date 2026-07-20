// finalize-electron-build.mjs
// -----------------------------------------------------------------
//  Runs at the tail end of `npm run build`. Drops a sibling
//  package.json into dist-electron/ that declares CommonJS so Node
//  doesn't misinterpret tsc's CommonJS-emitted .js files as ESM
//  (the root package.json sets "type": "module" for Vite).
//
//  Without this file, Electron's main process crashes on startup
//  with errors like:
//      ReferenceError: require is not defined in ES module scope
//  ...and the VBS launcher hides the crash, so no window appears.
// -----------------------------------------------------------------

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, "..", "dist-electron");

mkdirSync(outDir, { recursive: true });

const pkg = {
  // tsc compiled the electron sources with module: "CommonJS",
  // so the emitted .js files use require() / module.exports / __dirname.
  // Mark this subtree as CommonJS so Node honors that.
  type: "commonjs",
};

writeFileSync(resolve(outDir, "package.json"), JSON.stringify(pkg, null, 2) + "\n");

console.log("  finalize-electron-build: wrote dist-electron/package.json (type=commonjs)");
