import { createRequire } from "node:module";
import { join } from "node:path";
import { repoRoot } from "../paths.mjs";

const require = createRequire(import.meta.url);

let tsCache = null;

export function loadTypescript() {
  if (tsCache) return tsCache;
  const candidates = [
    join(repoRoot, "node_modules", "typescript"),
    "typescript",
  ];
  let lastErr = null;
  for (const c of candidates) {
    try {
      tsCache = require(c);
      return tsCache;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error("typescript is not available");
}

const SEMANTIC_SKIP = new Set([
  2304, 2305, 2307, 2339, 2345, 2551, 2552, 2614, 2741, 7006, 7016, 7031, 7053,
]);

function isSyntaxLike(code) {
  if (SEMANTIC_SKIP.has(code)) return false;
  if (code >= 1000 && code < 2000) return true;
  if (code >= 1100 && code < 1800) return true;
  if (code >= 17000 && code < 18000) return true;
  if (code === 2657 || code === 17008 || code === 17014 || code === 1005 || code === 1003) return true;
  return false;
}

export function excerptAround(source, pos, radius = 6) {
  const text = String(source || "");
  const safePos = Math.max(0, Math.min(Number(pos) || 0, text.length));
  const lines = text.split(/\r?\n/);
  const before = text.slice(0, safePos);
  const line = before.split(/\r?\n/).length - 1;
  const start = Math.max(0, line - radius);
  const end = Math.min(lines.length, line + radius + 1);
  return {
    startLine: start + 1,
    endLine: end,
    text: lines.slice(start, end).map((l, i) => `${String(start + i + 1).padStart(4)}| ${l}`).join("\n"),
  };
}

function pushDiag(out, ts, fileName, source, d) {
  if (!d || d.category !== ts.DiagnosticCategory.Error) return;
  if (!isSyntaxLike(d.code)) return;
  const msg = ts.flattenDiagnosticMessageText(d.messageText, "\n");
  let line = 1;
  let column = 1;
  const start = typeof d.start === "number" ? d.start : 0;
  if (d.file && typeof d.start === "number") {
    const lc = d.file.getLineAndCharacterOfPosition(d.start);
    line = lc.line + 1;
    column = lc.character + 1;
  } else {
    const before = String(source || "").slice(0, start);
    line = before.split(/\r?\n/).length;
    column = (before.split(/\r?\n/).pop() || "").length + 1;
  }
  out.push({
    file: fileName,
    line,
    column,
    code: `TS${d.code}`,
    diagnostic: msg,
    excerpt: excerptAround(source, start).text,
  });
}

/**
 * Fast mechanical parse of one .ts/.tsx buffer. Does not typecheck the project
 * and ignores missing-module / missing-name diagnostics.
 */
export function checkTsSyntax(fileName, source) {
  const ts = loadTypescript();
  const rel = String(fileName || "file.tsx").replace(/\\/g, "/");
  const kind = rel.endsWith(".tsx") || rel.endsWith(".jsx")
    ? ts.ScriptKind.TSX
    : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(rel, String(source ?? ""), ts.ScriptTarget.Latest, true, kind);
  const diags = [];
  for (const d of sf.parseDiagnostics || []) {
    pushDiag(diags, ts, rel, source, d);
  }
  const transpiled = ts.transpileModule(String(source ?? ""), {
    compilerOptions: {
      target: ts.ScriptTarget.ESNext,
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.ESNext,
    },
    reportDiagnostics: true,
    fileName: rel,
  });
  for (const d of transpiled.diagnostics || []) {
    pushDiag(diags, ts, rel, source, d);
  }
  const seen = new Set();
  const unique = [];
  for (const d of diags) {
    const k = `${d.file}:${d.line}:${d.column}:${d.code}:${d.diagnostic}`;
    if (seen.has(k)) continue;
    seen.add(k);
    unique.push(d);
  }
  return { ok: unique.length === 0, diagnostics: unique, file: rel };
}

export function isTsLikePath(rel) {
  return /\.(tsx?|jsx?)$/i.test(String(rel || ""));
}

export function checkChangedTsSyntax(paths, io) {
  const files = [...new Set(paths || [])].filter(isTsLikePath);
  const diagnostics = [];
  const checked = [];
  for (const rel of files) {
    const buf = io?.read ? io.read(rel) : null;
    if (!buf) {
      diagnostics.push({
        file: rel,
        line: 1,
        column: 1,
        code: "MISSING",
        diagnostic: "changed file is missing after edit",
        excerpt: "",
      });
      continue;
    }
    const result = checkTsSyntax(rel, buf.toString("utf8"));
    checked.push(rel);
    diagnostics.push(...result.diagnostics);
  }
  return {
    ok: diagnostics.length === 0,
    files: checked,
    diagnostics,
  };
}

export function formatDiagnostics(diagnostics, limit = 12) {
  return (diagnostics || []).slice(0, limit).map((d) => (
    `${d.file}:${d.line}:${d.column} ${d.code} ${d.diagnostic}`
  )).join("\n");
}
