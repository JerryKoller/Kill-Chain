/**
 * Deterministic single-file scope check for invented identifiers.
 *
 * Why: `fire-drum-fill-preview-live` blocked after four repair cycles on
 *   SequencerPanel.tsx(486,15): TS2552 Cannot find name 'setActiveSectionId'
 *   SequencerPanel.tsx(487,20): TS2552 Cannot find name 'fireSequencerStore'
 * The fast syntax gate deliberately skips TS2552 (a single-buffer parse cannot
 * resolve imports), so this class of failure was only caught by the ~15s
 * project typecheck, and the repair prompt received the raw compiler text with
 * no information about what the file actually has in scope.
 *
 * This gate is intentionally CONSERVATIVE. It collects every name declared or
 * imported ANYWHERE in the file (ignoring block scoping) and only reports
 * references that match nothing at all. That cannot flag a correctly-scoped
 * identifier, so it is safe to run on every edited file, and it catches the
 * "model used the store name instead of the hook name" failure directly.
 */
import { loadTypescript } from "./syntax.mjs";

/** Globals available in the Electron renderer + Node tooling context. */
const GLOBALS = new Set([
  // ECMAScript
  "globalThis", "undefined", "NaN", "Infinity", "Object", "Array", "String", "Number", "Boolean",
  "Symbol", "BigInt", "Math", "JSON", "Date", "RegExp", "Error", "TypeError", "RangeError",
  "SyntaxError", "EvalError", "ReferenceError", "URIError", "AggregateError", "Function",
  "Promise", "Map", "Set", "WeakMap", "WeakSet", "WeakRef", "Proxy", "Reflect", "Intl",
  "ArrayBuffer", "SharedArrayBuffer", "DataView", "Int8Array", "Uint8Array", "Uint8ClampedArray",
  "Int16Array", "Uint16Array", "Int32Array", "Uint32Array", "Float32Array", "Float64Array",
  "BigInt64Array", "BigUint64Array", "parseInt", "parseFloat", "isNaN", "isFinite", "eval",
  "encodeURI", "encodeURIComponent", "decodeURI", "decodeURIComponent", "structuredClone",
  "queueMicrotask", "escape", "unescape", "arguments", "this", "super",
  // Timers / microtasks
  "setTimeout", "clearTimeout", "setInterval", "clearInterval", "setImmediate",
  "requestAnimationFrame", "cancelAnimationFrame", "requestIdleCallback", "cancelIdleCallback",
  // DOM / BOM
  "window", "document", "navigator", "location", "history", "screen", "console", "performance",
  "localStorage", "sessionStorage", "indexedDB", "caches", "crypto", "fetch", "Request",
  "Response", "Headers", "FormData", "URL", "URLSearchParams", "Blob", "File", "FileReader",
  "FileList", "Image", "Audio", "AudioContext", "OfflineAudioContext", "MediaRecorder",
  "MediaStream", "AbortController", "AbortSignal", "Event", "CustomEvent", "EventTarget",
  "MutationObserver", "ResizeObserver", "IntersectionObserver", "MessageChannel", "Worker",
  "WebSocket", "XMLHttpRequest", "DOMParser", "getComputedStyle", "matchMedia", "alert",
  "confirm", "prompt", "atob", "btoa", "devicePixelRatio", "innerWidth", "innerHeight",
  "HTMLElement", "HTMLDivElement", "HTMLInputElement", "HTMLCanvasElement", "HTMLAudioElement",
  "HTMLVideoElement", "HTMLButtonElement", "HTMLSelectElement", "HTMLTextAreaElement",
  "HTMLImageElement", "HTMLSpanElement", "HTMLAnchorElement", "HTMLFormElement", "SVGElement",
  "Element", "Node", "NodeList", "DocumentFragment", "CanvasRenderingContext2D", "Path2D",
  "KeyboardEvent", "MouseEvent", "PointerEvent", "WheelEvent", "TouchEvent", "DragEvent",
  "FocusEvent", "InputEvent", "ClipboardEvent", "PopStateEvent", "ErrorEvent",
  "AnalyserNode", "GainNode", "AudioNode", "AudioBuffer", "AudioBufferSourceNode",
  "MediaElementAudioSourceNode", "BiquadFilterNode", "DynamicsCompressorNode", "WaveShaperNode",
  "ConvolverNode", "DelayNode", "StereoPannerNode", "PannerNode", "ChannelSplitterNode",
  "ChannelMergerNode", "AudioWorkletNode", "AudioParam", "PeriodicWave", "OscillatorNode",
  // Node / bundler
  "process", "Buffer", "__dirname", "__filename", "require", "module", "exports", "global",
  "NodeJS", "AbortError", "TextEncoder", "TextDecoder", "import",
  // Ambient namespaces available without an import in this project's tsconfig.
  "React", "JSX", "CSS", "DOMException", "Notification", "ImageData", "OffscreenCanvas",
  "ResizeObserverEntry", "IntersectionObserverEntry", "GPUDevice", "WebGL2RenderingContext",
  "WebGLRenderingContext", "MediaQueryList", "PermissionStatus", "Gamepad",
]);

const JSX_INTRINSIC = /^[a-z]/;

function isDeclarationName(ts, node) {
  const p = node.parent;
  if (!p) return false;
  switch (p.kind) {
    case ts.SyntaxKind.VariableDeclaration:
    case ts.SyntaxKind.Parameter:
    case ts.SyntaxKind.FunctionDeclaration:
    case ts.SyntaxKind.FunctionExpression:
    case ts.SyntaxKind.ArrowFunction:
    case ts.SyntaxKind.ClassDeclaration:
    case ts.SyntaxKind.ClassExpression:
    case ts.SyntaxKind.InterfaceDeclaration:
    case ts.SyntaxKind.TypeAliasDeclaration:
    case ts.SyntaxKind.EnumDeclaration:
    case ts.SyntaxKind.EnumMember:
    case ts.SyntaxKind.ModuleDeclaration:
    case ts.SyntaxKind.MethodDeclaration:
    case ts.SyntaxKind.MethodSignature:
    case ts.SyntaxKind.PropertyDeclaration:
    case ts.SyntaxKind.PropertySignature:
    case ts.SyntaxKind.GetAccessor:
    case ts.SyntaxKind.SetAccessor:
    case ts.SyntaxKind.TypeParameter:
    case ts.SyntaxKind.BindingElement:
    case ts.SyntaxKind.ImportSpecifier:
    case ts.SyntaxKind.ExportSpecifier:
    case ts.SyntaxKind.ImportClause:
    case ts.SyntaxKind.NamespaceImport:
    case ts.SyntaxKind.LabeledStatement:
      return p.name === node || p.propertyName === node;
    default:
      return false;
  }
}

/** Collect every name bound anywhere in the file, ignoring block scoping. */
function collectDeclared(ts, sf) {
  const declared = new Set();
  const addBinding = (name) => {
    if (!name) return;
    if (ts.isIdentifier(name)) { declared.add(name.text); return; }
    if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
      for (const el of name.elements) {
        if (ts.isBindingElement(el)) addBinding(el.name);
      }
    }
  };
  const visit = (node) => {
    if (ts.isImportDeclaration(node) && node.importClause) {
      const c = node.importClause;
      if (c.name) declared.add(c.name.text);
      if (c.namedBindings) {
        if (ts.isNamespaceImport(c.namedBindings)) declared.add(c.namedBindings.name.text);
        else for (const s of c.namedBindings.elements) declared.add(s.name.text);
      }
    }
    if (ts.isImportEqualsDeclaration(node) && node.name) declared.add(node.name.text);
    if (ts.isVariableDeclaration(node)) addBinding(node.name);
    if (ts.isParameter(node)) addBinding(node.name);
    if (ts.isBindingElement(node)) addBinding(node.name);
    if (
      (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isFunctionExpression(node)
        || ts.isClassExpression(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)
        || ts.isEnumDeclaration(node) || ts.isModuleDeclaration(node))
      && node.name && ts.isIdentifier(node.name)
    ) {
      declared.add(node.name.text);
    }
    if (ts.isTypeParameterDeclaration(node) && node.name) declared.add(node.name.text);
    if (ts.isCatchClause(node) && node.variableDeclaration) addBinding(node.variableDeclaration.name);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return declared;
}

/** Collect identifier references that must resolve to a binding. */
function collectReferences(ts, sf) {
  const refs = [];
  const visit = (node) => {
    if (ts.isIdentifier(node)) {
      const p = node.parent;
      const skip = !p
        || isDeclarationName(ts, node)
        // `x.foo` — `foo` is a property, not a binding.
        || (ts.isPropertyAccessExpression(p) && p.name === node)
        // `React.MouseEvent` in a type position is a QualifiedName; value
        // positions use PropertyAccessExpression, so skipping these is safe.
        || ts.isQualifiedName(p)
        // `{ foo: 1 }` — key. Shorthand `{ foo }` is a real reference.
        || (ts.isPropertyAssignment(p) && p.name === node)
        || (ts.isJsxAttribute(p) && p.name === node)
        // `[freq: number, gainDb: number]` — labelled tuple element names.
        || (ts.isNamedTupleMember && ts.isNamedTupleMember(p) && p.name === node)
        // Types are resolved across files far more loosely; skip them.
        || ts.isTypeReferenceNode(p)
        || ts.isTypeQueryNode(p)
        || ts.isImportTypeNode(p)
        || (ts.isExpressionWithTypeArguments(p) && p.expression === node)
        // Lowercase JSX tags are intrinsic HTML elements.
        || ((ts.isJsxOpeningElement(p) || ts.isJsxSelfClosingElement(p) || ts.isJsxClosingElement(p))
          && p.tagName === node && JSX_INTRINSIC.test(node.text))
        || ts.isMetaProperty(p);
      if (!skip) {
        const lc = sf.getLineAndCharacterOfPosition(node.getStart(sf));
        refs.push({ name: node.text, line: lc.line + 1, column: lc.character + 1 });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return refs;
}

function editDistance(a, b) {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

/** Best in-scope candidates for a name that resolved to nothing. */
export function suggestCandidates(name, declared, limit = 4) {
  const target = String(name || "");
  const lower = target.toLowerCase();
  const scored = [];
  for (const d of declared) {
    const dl = d.toLowerCase();
    let score = editDistance(lower, dl);
    // Prefer names that contain the target or vice versa (store vs useStore).
    if (dl.includes(lower) || lower.includes(dl)) score -= Math.min(6, Math.floor(target.length / 2));
    scored.push({ name: d, score });
  }
  scored.sort((a, b) => a.score - b.score || a.name.length - b.name.length);
  const max = Math.max(4, Math.ceil(target.length * 0.6));
  return scored.filter((s) => s.score <= max).slice(0, limit).map((s) => s.name);
}

/**
 * Report references in `source` that are bound nowhere in the file and are not
 * known globals.
 */
export function checkIdentifiers(fileName, source) {
  const ts = loadTypescript();
  const rel = String(fileName || "file.tsx").replace(/\\/g, "/");
  const kind = /\.(tsx|jsx)$/i.test(rel) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(rel, String(source ?? ""), ts.ScriptTarget.Latest, true, kind);
  const declared = collectDeclared(ts, sf);
  const refs = collectReferences(ts, sf);

  const unresolvedByName = new Map();
  for (const r of refs) {
    if (declared.has(r.name) || GLOBALS.has(r.name)) continue;
    if (!unresolvedByName.has(r.name)) {
      unresolvedByName.set(r.name, { name: r.name, line: r.line, column: r.column, count: 0 });
    }
    unresolvedByName.get(r.name).count += 1;
  }

  const unresolved = [...unresolvedByName.values()].map((u) => ({
    ...u,
    candidates: suggestCandidates(u.name, declared),
  }));
  unresolved.sort((a, b) => a.line - b.line);

  return { ok: unresolved.length === 0, file: rel, unresolved, declaredCount: declared.size, declared };
}

/** Run the gate over the files an edit phase changed. */
export function checkChangedIdentifiers(paths, io) {
  const files = [...new Set(paths || [])].filter((p) => /\.(tsx?|jsx?)$/i.test(String(p || "")));
  const results = [];
  for (const rel of files) {
    const buf = io?.read ? io.read(rel) : null;
    if (!buf) continue;
    try {
      const r = checkIdentifiers(rel, buf.toString("utf8"));
      if (!r.ok) results.push(r);
    } catch {
      // A parse failure is the syntax gate's job to report, not this gate's.
    }
  }
  return { ok: results.length === 0, results };
}

/** Model-facing markdown for the repair prompts. */
export function formatIdentifierPacket(results) {
  const list = Array.isArray(results) ? results : (results?.results || []);
  if (!list.length) return "";
  const blocks = list.map((r) => {
    const rows = r.unresolved.map((u) => (
      `- \`${u.name}\` (first used line ${u.line}, ${u.count}x) is DECLARED NOWHERE in this file and is not a global.\n`
      + `    in-scope names closest to it: ${u.candidates.length ? u.candidates.map((c) => `\`${c}\``).join(", ") : "(none similar)"}`
    ));
    return `FILE: ${r.file}\nThis file declares/imports ${r.declaredCount} names. The following do not resolve:\n${rows.join("\n")}`;
  });
  return `## DETERMINISTIC SCOPE ANALYSIS (computed from the file's own imports and declarations)

${blocks.join("\n\n")}

### HOW TO USE THIS
Every name above resolves to nothing in this file. Either import it, declare it,
or replace it with the correct in-scope name listed beside it.
A Zustand store is used through its hook: call the hook that is actually
imported rather than a bare store object that was never imported.
Do not introduce new identifiers to "fix" this; use what the file already has.
`;
}
