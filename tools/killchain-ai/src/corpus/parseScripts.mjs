import { readFileSync } from "node:fs";
import { basename } from "node:path";

function headerComment(text) {
  const m = text.match(/^(\s*\/\*[\s\S]*?\*\/)/);
  if (m) return m[1].slice(0, 2500);
  const lines = [];
  for (const line of text.split(/\r?\n/).slice(0, 50)) {
    if (line.startsWith("//") || line.startsWith("#") || line.trim() === "") lines.push(line);
    else break;
  }
  return lines.join("\n").trim().slice(0, 1500) || null;
}

export function parseScriptFile(abs, rel) {
  const raw = readFileSync(abs, "utf8");
  const lines = raw.split(/\r?\n/);
  const tests = [];
  const fns = [];

  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].match(/\bt\(\s*["'`]([^"'`]+)["'`]/);
    if (t) {
      tests.push({
        name: t[1],
        lineStart: i + 1,
        lineEnd: i + 1,
        path: rel,
      });
    }
    const fn = lines[i].match(/^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_]+)/);
    if (fn) {
      fns.push({
        name: fn[1],
        lineStart: i + 1,
        path: rel,
      });
    }
  }

  // Close function ranges at next function or EOF (best-effort for .mjs tests).
  for (let i = 0; i < fns.length; i++) {
    fns[i].lineEnd = i + 1 < fns.length ? fns[i + 1].lineStart - 1 : lines.length;
    const slice = lines.slice(fns[i].lineStart - 1, fns[i].lineEnd).join("\n");
    fns[i].text = slice.slice(0, 5000);
  }

  return {
    path: rel,
    basename: basename(rel),
    header: headerComment(raw),
    tests,
    functions: fns,
    lineCount: lines.length,
    textHead: raw.slice(0, 2000),
  };
}

export function parsePackageJson(abs, rel) {
  const raw = readFileSync(abs, "utf8");
  const json = JSON.parse(raw);
  const scripts = json.scripts || {};
  return { path: rel, scripts, raw };
}
