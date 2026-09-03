import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { repoRoot, toPosix } from "../paths.mjs";
import { loadTypescript } from "../loadTs.mjs";
import { isDangerPath, subsystemFor } from "./subsystems.mjs";

const MAX_TEXT = 7000;
let ts;

function lineOf(sf, pos) {
  return sf.getLineAndCharacterOfPosition(pos).line + 1;
}

function nodeText(sf, node) {
  try {
    const start = node.getStart(sf, true);
    let text = sf.text.slice(start, node.end);
    let truncated = false;
    if (text.length > MAX_TEXT) {
      text = text.slice(0, MAX_TEXT) + "\n/* … truncated; see source for full body */";
      truncated = true;
    }
    return { text, truncated, startLine: lineOf(sf, start), endLine: lineOf(sf, node.end) };
  } catch {
    const start = node.pos;
    return { text: sf.text.slice(start, node.end).slice(0, MAX_TEXT), truncated: true, startLine: lineOf(sf, start), endLine: lineOf(sf, node.end) };
  }
}

function nameOf(node) {
  const n = node?.name;
  if (!n) return null;
  if (typeof n.text === "string") return n.text;
  if (typeof n.escapedText === "string") return String(n.escapedText);
  return null;
}

function isExported(node) {
  return Boolean(node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword));
}

function resolveSpec(fromRel, spec) {
  if (!spec) return null;
  if (spec.startsWith("@/")) {
    const rest = spec.slice(2);
    return rest.replace(/\.(ts|tsx|js|mjs)$/, "");
  }
  if (spec.startsWith(".")) {
    const base = toPosix(join(dirname(fromRel), spec));
    return base.replace(/\\/g, "/").replace(/\.(ts|tsx|js|mjs)$/, "");
  }
  return spec;
}

function looksLikeComponentOrFn(name, init) {
  if (!name || !init) return false;
  if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) return true;
  if (ts.isCallExpression(init)) {
    const expr = init.expression;
    const id = ts.isIdentifier(expr)
      ? expr.text
      : (expr && expr.name && typeof expr.name.text === "string" ? expr.name.text : "");
    return /^(memo|forwardRef|lazy)$/.test(id);
  }
  return false;
}

function callName(expr) {
  if (!expr) return null;
  if (ts.isIdentifier(expr) && typeof expr.text === "string") return expr.text;
  if (expr.name && typeof expr.name.text === "string") return expr.name.text;
  return null;
}

/**
 * Parse app TypeScript with the compiler API. Symbols are split by
 * function/class/method/component, not arbitrary token windows.
 */
export function parseTypeScriptProject() {
  ts = loadTypescript();
  const configPath = ts.findConfigFile(repoRoot, ts.sys.fileExists, "tsconfig.json");
  if (!configPath) throw new Error("tsconfig.json not found in repo root");
  const read = ts.readConfigFile(configPath, ts.sys.readFile);
  if (read.error) {
    throw new Error(ts.flattenDiagnosticMessageText(read.error.messageText, "\n"));
  }
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, repoRoot);
  const electronGlob = ts.parseJsonConfigFileContent(
    { compilerOptions: { ...parsed.options, noEmit: true }, include: ["electron/**/*"] },
    ts.sys,
    repoRoot,
  );
  const rootNames = [...new Set([...parsed.fileNames, ...electronGlob.fileNames])];
  const program = ts.createProgram({
    rootNames,
    options: {
      ...parsed.options,
      noEmit: true,
      skipLibCheck: true,
      jsx: ts.JsxEmit.ReactJSX,
    },
  });

  const files = [];
  const importEdges = []; // { from, to }
  const callEdges = []; // { from, to, file }
  const symbols = [];

  for (const sf of program.getSourceFiles()) {
    if (sf.isDeclarationFile) continue;
    const abs = sf.fileName;
    const posix = toPosix(abs);
    const rootPosix = toPosix(repoRoot).replace(/\/$/, "");
    if (!posix.toLowerCase().startsWith(rootPosix.toLowerCase())) continue;
    const rel = posix.slice(rootPosix.length + 1);
    if (rel.startsWith("node_modules/") || rel.startsWith("dist/") || rel.startsWith("tools/")) continue;

    const fileImports = [];
    const fileExports = [];
    const localSymbols = [];

    const visit = (node, className, fnName) => {
      try {
        visitInner(node, className, fnName);
      } catch {
        ts.forEachChild(node, (ch) => visit(ch, className, fnName));
      }
    };

    const visitInner = (node, className, fnName) => {
      if (ts.isImportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const spec = node.moduleSpecifier.text;
        const resolved = resolveSpec(rel, spec);
        fileImports.push({ spec, resolved });
        if (resolved && (resolved.startsWith("src/") || resolved.startsWith("electron/"))) {
          importEdges.push({ from: rel, to: resolved });
        }
        return;
      }
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const arg = node.arguments[0];
        if (arg && ts.isStringLiteral(arg)) {
          const resolved = resolveSpec(rel, arg.text);
          fileImports.push({ spec: arg.text, resolved, dynamic: true });
          if (resolved && resolved.startsWith("src/")) importEdges.push({ from: rel, to: resolved });
        }
      }

      if (ts.isCallExpression(node)) {
        const callee = callName(node.expression);
        const owner = fnName || className || rel;
        if (callee) callEdges.push({ from: owner, to: callee, file: rel });
      }

      if (ts.isClassDeclaration(node) && nameOf(node)) {
        const n = nameOf(node);
        const { text, truncated, startLine, endLine } = nodeText(sf, node);
        localSymbols.push(makeSymbol({
          rel, name: n, kind: "class", exported: isExported(node),
          startLine, endLine, text, truncated, jsDoc: jsDocOf(sf, node),
        }));
        fileExports.push(n);
        ts.forEachChild(node, (ch) => visit(ch, n, fnName));
        return;
      }

      if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isConstructorDeclaration(node)) && (nameOf(node) || ts.isConstructorDeclaration(node))) {
        const n = ts.isConstructorDeclaration(node)
          ? `${className || fnName || "class"}.constructor`
          : ((className || fnName) ? `${className || fnName}.${nameOf(node)}` : nameOf(node));
        const { text, truncated, startLine, endLine } = nodeText(sf, node);
        localSymbols.push(makeSymbol({
          rel, name: n, kind: ts.isMethodDeclaration(node) || ts.isConstructorDeclaration(node) ? "method" : "function",
          exported: isExported(node) || Boolean(className),
          startLine, endLine, text, truncated, jsDoc: jsDocOf(sf, node),
        }));
        if (isExported(node) && nameOf(node)) fileExports.push(nameOf(node));
        ts.forEachChild(node, (ch) => visit(ch, className, n));
        return;
      }

      if (ts.isInterfaceDeclaration(node) && nameOf(node)) {
        const n = nameOf(node);
        const { text, truncated, startLine, endLine } = nodeText(sf, node);
        localSymbols.push(makeSymbol({
          rel, name: n, kind: "interface", exported: isExported(node),
          startLine, endLine, text, truncated, jsDoc: jsDocOf(sf, node),
        }));
        return;
      }

      if (ts.isTypeAliasDeclaration(node) && nameOf(node)) {
        const n = nameOf(node);
        const { text, truncated, startLine, endLine } = nodeText(sf, node);
        localSymbols.push(makeSymbol({
          rel, name: n, kind: "type", exported: isExported(node),
          startLine, endLine, text, truncated, jsDoc: jsDocOf(sf, node),
        }));
        return;
      }

      if (ts.isVariableStatement(node)) {
        for (const decl of node.declarationList.declarations) {
          const n = nameOf(decl);
          if (!n) continue;
          if (!looksLikeComponentOrFn(n, decl.initializer) && !isExported(node)) continue;
          if (!looksLikeComponentOrFn(n, decl.initializer) && isExported(node)) {
            const { text, truncated, startLine, endLine } = nodeText(sf, decl);
            localSymbols.push(makeSymbol({
              rel, name: n, kind: "const", exported: true,
              startLine, endLine, text, truncated, jsDoc: jsDocOf(sf, node),
            }));
            fileExports.push(n);
            if (decl.initializer) visit(decl.initializer, className, n);
            continue;
          }
          const { text, truncated, startLine, endLine } = nodeText(sf, decl);
          const kind = /^[A-Z]/.test(n) ? "component" : "function";
          localSymbols.push(makeSymbol({
            rel, name: n, kind,
            exported: isExported(node),
            startLine, endLine, text, truncated, jsDoc: jsDocOf(sf, node),
          }));
          if (isExported(node)) fileExports.push(n);
          if (decl.initializer) visit(decl.initializer, className, n);
        }
        return;
      }

      if (ts.isPropertyAssignment(node)) {
        const n = nameOf(node);
        const init = node.initializer;
        const isFn = init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init));
        if (n && isFn) {
          const qual = fnName || className;
          const full = qual ? `${qual}.${n}` : n;
          const { text, truncated, startLine, endLine } = nodeText(sf, init);
          localSymbols.push(makeSymbol({
            rel, name: full, kind: "method", exported: Boolean(qual),
            startLine, endLine, text, truncated, jsDoc: jsDocOf(sf, node),
          }));
          ts.forEachChild(node, (ch) => visit(ch, className, full));
          return;
        }
      }

      ts.forEachChild(node, (ch) => visit(ch, className, fnName));
    };

    try {
      visit(sf, null, null);
    } catch (err) {
      console.warn(`parse skip ${rel}: ${err instanceof Error ? err.message : err}`);
    }

    const header = fileHeader(sf.text);
    files.push({
      path: rel,
      subsystem: subsystemFor(rel),
      danger: isDangerPath(rel),
      imports: fileImports,
      exports: [...new Set(fileExports)],
      symbolCount: localSymbols.length,
      lineCount: sf.getLineAndCharacterOfPosition(sf.end).line + 1,
      header,
    });
    for (const s of localSymbols) {
      s.fileImports = fileImports.map((i) => i.resolved).filter(Boolean);
      symbols.push(s);
    }
  }

  return { files, symbols, importEdges, callEdges };
}

function jsDocOf(sf, node) {
  try {
    const docs = node.jsDoc;
    if (!docs || !docs.length) return null;
    return docs.map((d) => (d && d.getText ? d.getText(sf) : "")).filter(Boolean).join("\n") || null;
  } catch {
    return null;
  }
}

function fileHeader(text) {
  const m = text.match(/^(\s*\/\*\*[\s\S]*?\*\/)/);
  if (m) return m[1].slice(0, 2500);
  const lines = text.split(/\r?\n/).slice(0, 40).filter((l) => l.trim().startsWith("//"));
  return lines.length ? lines.join("\n").slice(0, 1500) : null;
}

function makeSymbol(s) {
  return {
    path: s.rel,
    symbol: s.name,
    kind: s.kind,
    exported: s.exported,
    lineStart: s.startLine,
    lineEnd: s.endLine,
    truncated: s.truncated,
    text: s.text,
    jsDoc: s.jsDoc,
    subsystem: subsystemFor(s.rel),
    danger: isDangerPath(s.rel),
  };
}

export function readSourceSnippet(rel, lineStart, lineEnd) {
  try {
    const abs = join(repoRoot, rel);
    const lines = readFileSync(abs, "utf8").split(/\r?\n/);
    const a = Math.max(1, lineStart) - 1;
    const b = Math.min(lines.length, lineEnd);
    return lines.slice(a, b).join("\n");
  } catch {
    return null;
  }
}
