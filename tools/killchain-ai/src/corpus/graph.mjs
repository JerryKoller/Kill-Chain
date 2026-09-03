import { TEST_FILE_HINTS } from "./subsystems.mjs";

function baseName(p) {
  return p.replace(/\.(tsx?|jsx?|mjs|mts)$/, "");
}

function fileKey(p) {
  return baseName(p).toLowerCase();
}

export function buildGraph({ files, symbols, importEdges, callEdges, scriptFiles }) {
  const importedBy = new Map();
  const imports = new Map();
  for (const e of importEdges) {
    const to = closestFile(e.to, files);
    const from = e.from;
    if (!imports.has(from)) imports.set(from, new Set());
    imports.get(from).add(to || e.to);
    const key = to || e.to;
    if (!importedBy.has(key)) importedBy.set(key, new Set());
    importedBy.get(key).add(from);
  }

  const callees = new Map();
  const callers = new Map();
  for (const e of callEdges) {
    if (!callees.has(e.from)) callees.set(e.from, new Set());
    callees.get(e.from).add(e.to);
    if (!callers.has(e.to)) callers.set(e.to, new Set());
    callers.get(e.to).add(e.from);
  }

  const testsForFile = new Map();
  const testsForSymbol = new Map();

  const addTest = (map, key, testPath, name) => {
    if (!key) return;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push({ path: testPath, name: name || null });
  };

  for (const hint of TEST_FILE_HINTS) {
    for (const cover of hint.covers) {
      addTest(testsForSymbol, cover, hint.path, null);
      const f = files.find((x) => x.path.includes(cover) || x.exports.includes(cover));
      if (f) addTest(testsForFile, f.path, hint.path, null);
    }
  }

  for (const script of scriptFiles) {
    for (const t of script.tests || []) {
      const blob = `${script.header || ""} ${t.name} ${script.textHead || ""}`;
      for (const f of files) {
        const stem = f.path.split("/").pop().replace(/\.(tsx?|jsx?)$/, "");
        if (blob.includes(stem) || t.name.toLowerCase().includes(stem.toLowerCase())) {
          addTest(testsForFile, f.path, script.path, t.name);
        }
      }
      for (const s of ["claimSource", "rewireFront", "setBypass", "Mission State", "Auto-Lock", "reportStorageFailure", "stopMissionState"]) {
        if (t.name.includes(s) || blob.includes(s)) addTest(testsForSymbol, s.replace(/\s+/g, ""), script.path, t.name);
      }
    }
  }

  return {
    importedBy,
    imports,
    callees,
    callers,
    testsForFile,
    testsForSymbol,
    fileKey,
  };
}

function closestFile(spec, files) {
  if (!spec) return spec;
  const exact = files.find((f) => baseName(f.path) === spec || f.path === spec || f.path === spec + ".ts" || f.path === spec + ".tsx");
  if (exact) return exact.path;
  const hit = files.find((f) => baseName(f.path).endsWith(spec) || spec.endsWith(baseName(f.path)));
  return hit ? hit.path : spec;
}

export function relSet(map, key) {
  const s = map.get(key);
  return s ? [...s] : [];
}

export function testList(map, key) {
  const s = map.get(key);
  if (!s) return [];
  const seen = new Set();
  const out = [];
  for (const t of s) {
    const k = `${t.path}::${t.name || ""}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t.path + (t.name ? `#${t.name}` : ""));
  }
  return out;
}
