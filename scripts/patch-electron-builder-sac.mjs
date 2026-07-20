// patch-electron-builder-sac.mjs
// -----------------------------------------------------------------
//  Windows Smart App Control (SAC) blocks executing the unsigned
//  "uninstaller generator" stub that electron-builder compiles and
//  spawns during the NSIS target build ("spawn UNKNOWN", CodeIntegrity
//  event 3033/3077). electron-builder already ships a pure-JS
//  alternative — UninstallerReader — which extracts the uninstaller
//  from the stub binary without executing it (it uses this path on
//  macOS Catalina+ for the same "can't run the stub" reason).
//
//  This script patches node_modules/app-builder-lib to try
//  UninstallerReader first on Windows and only fall back to executing
//  the stub. It is idempotent and re-applied by `npm run dist`, so a
//  fresh `npm install` can't silently break the installer build.
// -----------------------------------------------------------------

import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const MARKER = "[kill-chain sac patch]";
const TARGET =
  'await (0, wine_1.execWine)(installerPath, null, [], { env: { __COMPAT_LAYER: "RunAsInvoker" } });';
const REPLACEMENT = `// ${MARKER} Smart App Control blocks spawning the freshly
            // compiled unsigned uninstaller stub. Extract the uninstaller from
            // the stub binary instead (same technique electron-builder uses on
            // macOS Catalina+), and only execute the stub as a fallback.
            try {
                await nsisUtil_1.UninstallerReader.exec(installerPath, uninstallerPath);
            }
            catch (error) {
                builder_util_1.log.warn(\`uninstaller extraction failed (\${error.message}); executing the stub instead\`);
                await (0, wine_1.execWine)(installerPath, null, [], { env: { __COMPAT_LAYER: "RunAsInvoker" } });
            }`;

let targetFile;
try {
  targetFile = require.resolve("app-builder-lib/out/targets/nsis/NsisTarget.js");
} catch {
  console.error("patch-electron-builder-sac: app-builder-lib not found — run npm install first.");
  process.exit(1);
}

const source = readFileSync(targetFile, "utf8");

if (source.includes(MARKER)) {
  console.log("  patch-electron-builder-sac: already patched, nothing to do");
  process.exit(0);
}

if (!source.includes(TARGET)) {
  console.error(
    "patch-electron-builder-sac: expected code not found in NsisTarget.js.\n" +
      "electron-builder was probably upgraded and the internals changed —\n" +
      "re-check whether the NSIS build still fails with 'spawn UNKNOWN' under\n" +
      "Smart App Control, and update this patch if so."
  );
  process.exit(1);
}

writeFileSync(targetFile, source.replace(TARGET, REPLACEMENT));
console.log(`  patch-electron-builder-sac: patched ${targetFile}`);
