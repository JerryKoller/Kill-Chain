import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir, repoRoot } from "../paths.mjs";

function relFire(name) {
  return `src/components/FireCommand/${name}`;
}

function parseRelativeImports(text) {
  const out = [];
  const re = /from\s+["'](\.\/[^"']+)["']/g;
  let m;
  while ((m = re.exec(String(text || "")))) {
    let spec = m[1].replace(/\\/g, "/");
    if (!/\.(tsx?|mjs|js)$/.test(spec)) spec = `${spec}.tsx`;
    const base = spec.replace(/^\.\//, "");
    out.push(base);
  }
  return [...new Set(out)];
}

function innerFunctions(text) {
  const names = [];
  const re = /^function ([A-Z][A-Za-z0-9]+)\s*\(/gm;
  let m;
  while ((m = re.exec(String(text || "")))) names.push(m[1]);
  return names;
}

export function scanFireCommandPanels({ root = repoRoot } = {}) {
  const dir = join(root, "src", "components", "FireCommand");
  const names = existsSync(dir)
    ? readdirSync(dir).filter((n) => /\.(tsx|ts)$/.test(n)).sort()
    : [];
  const files = [];
  for (const name of names) {
    const abs = join(dir, name);
    const text = readFileSync(abs, "utf8");
    const imports = parseRelativeImports(text)
      .map((n) => (names.includes(n) ? n : n.replace(/\.tsx$/, ".ts")))
      .filter((n) => names.includes(n))
      .map((n) => relFire(n));
    files.push({
      path: relFire(name),
      name,
      lines: text.split(/\r?\n/).length,
      bytes: Buffer.byteLength(text),
      imports,
    });
  }
  const view = files.find((f) => f.name === "FireCommandView.tsx");
  const viewText = view ? readFileSync(join(dir, "FireCommandView.tsx"), "utf8") : "";
  const inner = innerFunctions(viewText);
  const fileSet = new Set(names);
  const innerPanelsMissingFile = inner.filter((n) => /Panel$/.test(n) && !fileSet.has(`${n}.tsx`) && !fileSet.has(`${n}.ts`));
  const extractedPanelHelpers = files.filter((f) => /Panel\.(tsx|ts)$/.test(f.name)).map((f) => f.name);
  const innerPanelFunctions = inner.filter((n) => /Panel$/.test(n));
  const helperNamesShadowingInner = extractedPanelHelpers
    .map((n) => n.replace(/\.(tsx|ts)$/, ""))
    .filter((n) => inner.includes(n));
  const panelVizPairs = files
    .filter((f) => /Panel\.(tsx|ts)$/.test(f.name))
    .map((f) => ({
      helper: f.path,
      viz: f.imports.filter((p) => /StageViz|Meter/.test(p)),
    }))
    .filter((p) => p.viz.length);
  return {
    count: files.length,
    files,
    fireCommandViewInnerFunctions: inner,
    innerPanelsWithoutSiblingFile: innerPanelsMissingFile,
    extractedPanelHelpers,
    innerPanelFunctions,
    helperNamesShadowingInner,
    panelVizPairs,
    notes: [
      "Read-only inventory. Production UI was not modified.",
      "Inner *Panel functions live in FireCommandView.tsx; they are not separate files. Do not invent DrivePanel.tsx.",
      "Sibling *Panel.tsx files are often HELPERS used by the inner function of the same name. Editing WidthPanel.tsx is not the same as editing the inner WidthPanel() in FireCommandView.",
    ],
  };
}

export function writeFireCommandMap() {
  const report = { at: new Date().toISOString(), ...scanFireCommandPanels() };
  const dir = join(dataDir, "overnight");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "FIRE_COMMAND_MAP.json"), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

const isMain = process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("scanFireCommand.mjs");
if (isMain) {
  console.log(JSON.stringify(writeFireCommandMap(), null, 2));
}
