/**
 * Deterministic TSX/JSX structural analysis.
 *
 * Why this exists: `syntax.mjs` reports TypeScript's *symptom* (e.g. TS1381
 * "Unexpected token" at the first parser divergence, plus TS17008 on some far
 * earlier opening tag). Local models then have to re-derive delimiter balance
 * by eye across hundreds of lines, and both qwen3.5:9b and
 * nemotron-3.5-lightning:30b-a3b failed the archived DrumMachine repair doing
 * exactly that.
 *
 * This module does the counting mechanically and hands the model facts:
 *   - which closer closes nothing (surplus)
 *   - which opener is never closed (missing)
 *   - which closing tag does not match the innermost open tag (mismatch)
 *   - the exact open-frame stack at the divergence point
 *   - the closer sequence the parser expected there
 *   - a minimal window bounded by syntactically stable lines
 *
 * It is a scanner, not a type checker. It never mutates source.
 */

const CLOSER_FOR = { "(": ")", "{": "}", "[": "]", "`": "`" };
const OPENER_FOR = { ")": "(", "}": "{", "]": "[" };

/** Chars after which a `<` begins JSX rather than a comparison/generic. */
const JSX_PRECEDING = new Set([
  "(", "{", "[", ",", "=", ">", "&", "|", "?", ":", ";", "!", "+", "\n", "",
]);

const JSX_PRECEDING_WORDS = new Set(["return", "case", "default", "=>", "&&", "||", "??"]);

function isIdentChar(ch) {
  return /[A-Za-z0-9_$]/.test(ch || "");
}

function lineStarts(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") starts.push(i + 1);
  }
  return starts;
}

function posToLineCol(starts, pos) {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= pos) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo + 1, column: pos - starts[lo] + 1 };
}

/**
 * True when `<` starts a JSX element rather than a comparison or a generic type
 * argument list. Decided from the last significant token recorded by the
 * forward scan, so comments and strings before the `<` cannot confuse it.
 */
function looksLikeJsxStart(text, i, lastSigChar, lastIdent) {
  const next = text[i + 1];
  if (!next) return false;
  if (next !== "/" && next !== ">" && !/[A-Za-z_$]/.test(next)) return false;
  if (lastSigChar === null) return true;
  if (JSX_PRECEDING.has(lastSigChar)) return true;
  if (isIdentChar(lastSigChar)) return JSX_PRECEDING_WORDS.has(lastIdent || "");
  return false;
}

function readTagName(text, i) {
  let j = i;
  while (j < text.length && /[A-Za-z0-9_$.:-]/.test(text[j])) j++;
  return { name: text.slice(i, j), end: j };
}

/** Chars/words after which a `/` starts a regex literal rather than division. */
const REGEX_PRECEDING = new Set([
  "(", ",", "=", ":", "[", "!", "&", "|", "?", "{", "}", ";", "+", "-", "*", "%", "^", "~", "<", ">",
]);
const REGEX_PRECEDING_WORDS = new Set([
  "return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "case", "do", "else", "yield", "await",
]);

function startsRegex(lastSigChar, lastIdent) {
  if (lastSigChar === null) return true;
  if (REGEX_PRECEDING.has(lastSigChar)) return true;
  if (isIdentChar(lastSigChar)) return REGEX_PRECEDING_WORDS.has(lastIdent || "");
  return false;
}

/** Consume a regex literal starting at `/`. Returns the index after the flags. */
function skipRegex(text, i) {
  let j = i + 1;
  let inClass = false;
  while (j < text.length) {
    const c = text[j];
    if (c === "\\") { j += 2; continue; }
    if (c === "\n") return null; // Unterminated: not a regex after all.
    if (inClass) {
      if (c === "]") inClass = false;
      j++;
      continue;
    }
    if (c === "[") { inClass = true; j++; continue; }
    if (c === "/") {
      j++;
      while (j < text.length && /[a-z]/.test(text[j])) j++;
      return j;
    }
    j++;
  }
  return null;
}

/**
 * Distinguish a JSX opening tag from a generic type-parameter list such as
 * `<K extends keyof T>` or `<T,>`, both of which legally follow `:` or `=`.
 */
function tagNameIsGeneric(text, name, afterName) {
  if (!name) return false;
  let j = afterName;
  while (j < text.length && /\s/.test(text[j])) j++;
  const next = text[j];
  if (next === "," ) return true;
  const word = /^[A-Za-z_$]+/.exec(text.slice(j, j + 12));
  if (word && (word[0] === "extends" || word[0] === "in" || word[0] === "keyof")) return true;
  return false;
}

/**
 * Scan a TSX buffer and report delimiter/tag structure with recovery.
 *
 * Returns frames that were never closed, closers that matched nothing, closing
 * tags that did not match the innermost open element, a per-line depth ledger,
 * and the first structural divergence.
 */
export function scanStructure(source, { jsx = true } = {}) {
  const text = String(source ?? "");
  const starts = lineStarts(text);
  const totalLines = starts.length;

  const stack = [];
  const surplusClosers = [];
  const tagMismatches = [];
  const ledger = new Array(totalLines);
  for (let n = 0; n < totalLines; n++) {
    ledger[n] = { line: n + 1, paren: 0, brace: 0, bracket: 0, tag: 0, depth: 0, mode: "code", open: "" };
  }

  let mode = "code"; // code | tag | children | template
  let i = 0;
  // Last significant code token, used to disambiguate `<` (JSX vs comparison).
  let lastSigChar = null;
  let lastIdent = "";

  const depths = () => {
    let paren = 0;
    let brace = 0;
    let bracket = 0;
    let tag = 0;
    for (const f of stack) {
      if (f.kind === "paren") paren++;
      else if (f.kind === "brace") brace++;
      else if (f.kind === "bracket") bracket++;
      else if (f.kind === "tag") tag++;
    }
    return { paren, brace, bracket, tag };
  };

  const markLine = (pos) => {
    const { line } = posToLineCol(starts, pos);
    const d = depths();
    const row = ledger[line - 1];
    if (row) {
      row.paren = d.paren;
      row.brace = d.brace;
      row.bracket = d.bracket;
      row.tag = d.tag;
      row.depth = d.paren + d.brace + d.bracket + d.tag;
      row.mode = mode;
      row.open = stack.slice(-4).map((f) => (f.kind === "tag" ? `<${f.name || ""}>` : f.char)).join(" ");
    }
  };

  while (i < text.length) {
    const ch = text[i];

    if (ch === "\n") {
      markLine(i);
      i++;
      continue;
    }

    // Comments exist only in code/tag modes. In a template literal `//` is
    // ordinary text (e.g. `playground-audio:///load`), and in JSX children a
    // comment must be wrapped in `{/* */}`, which enters code mode first.
    if ((mode === "code" || mode === "tag") && ch === "/" && text[i + 1] === "/") {
      const nl = text.indexOf("\n", i);
      i = nl < 0 ? text.length : nl;
      continue;
    }
    if ((mode === "code" || mode === "tag") && ch === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end < 0 ? text.length : end + 2;
      continue;
    }

    // Single/double quoted strings cannot nest, so consume them inline.
    if ((mode === "code" || mode === "tag") && (ch === '"' || ch === "'")) {
      i++;
      while (i < text.length) {
        if (text[i] === "\\") { i += 2; continue; }
        if (text[i] === ch) { i++; break; }
        if (text[i] === "\n") break;
        i++;
      }
      lastSigChar = ch;
      lastIdent = "";
      continue;
    }

    // Template literals nest arbitrarily via `${}`, so they need a real frame.
    if ((mode === "code" || mode === "tag") && ch === "`") {
      stack.push({ kind: "template", char: "`", ...posToLineCol(starts, i), returnMode: mode });
      mode = "template";
      i++;
      continue;
    }

    if (mode === "template") {
      if (ch === "\\") { i += 2; continue; }
      if (ch === "`") {
        const top = stack[stack.length - 1];
        if (top && top.kind === "template") {
          stack.pop();
          mode = top.returnMode === "tag" ? "tag" : "code";
        } else {
          mode = "code";
        }
        lastSigChar = "`";
        lastIdent = "";
        i++;
        continue;
      }
      if (ch === "$" && text[i + 1] === "{") {
        stack.push({ kind: "brace", char: "{", ...posToLineCol(starts, i + 1), returnMode: "template" });
        mode = "code";
        i += 2;
        continue;
      }
      i++;
      continue;
    }

    if (mode === "children") {
      // A bare `}` or `>` in JSX children is never legal (TS1381/TS1382). A
      // legitimate expression-container `}` is consumed in code mode, so
      // reaching one here means it closes nothing.
      if (ch === "}" || ch === ">") {
        const top = [...stack].reverse().find((f) => f.kind === "tag");
        surplusClosers.push({
          ...posToLineCol(starts, i),
          text: ch,
          kind: "jsx-text-delimiter",
          closes: null,
          blockedBy: top ? { kind: "tag", name: top.name, line: top.line } : null,
        });
        i++;
        continue;
      }
      if (ch === "{") {
        stack.push({ kind: "brace", char: "{", ...posToLineCol(starts, i), returnMode: "children" });
        mode = "code";
        lastSigChar = "{";
        lastIdent = "";
        i++;
        continue;
      }
      if (ch === "<") {
        if (text[i + 1] === "/") {
          const { name, end } = readTagName(text, i + 2);
          const gt = text.indexOf(">", end);
          const at = posToLineCol(starts, i);
          const top = [...stack].reverse().find((f) => f.kind === "tag");
          if (!top) {
            surplusClosers.push({ ...at, text: `</${name}>`, kind: "tag", closes: null });
          } else if (top.name !== name) {
            tagMismatches.push({
              ...at,
              closer: `</${name}>`,
              expected: top.name ? `</${top.name}>` : "</>",
              openedAtLine: top.line,
              openedAtColumn: top.column,
            });
            // Recover: assume the author meant to close the innermost element.
            stack.splice(stack.lastIndexOf(top), 1);
          } else {
            stack.splice(stack.lastIndexOf(top), 1);
          }
          mode = stack[stack.length - 1]?.kind === "tag" ? "children" : "code";
          lastSigChar = ">";
          lastIdent = "";
          i = gt < 0 ? end : gt + 1;
          continue;
        }
        const { name, end } = readTagName(text, i + 1);
        stack.push({ kind: "tag", name, char: "<", ...posToLineCol(starts, i), returnMode: "children" });
        mode = "tag";
        i = end;
        continue;
      }
      i++;
      continue;
    }

    if (mode === "tag") {
      // `<FcSegStrip<GlueMode> ...>`: consume the explicit type-argument list so
      // its `>` does not look like the end of the opening tag.
      if (ch === "<") {
        let depth = 1;
        let j = i + 1;
        while (j < text.length && depth > 0 && text[j] !== "\n") {
          if (text[j] === "<") depth++;
          else if (text[j] === ">") depth--;
          j++;
        }
        i = depth === 0 ? j : i + 1;
        continue;
      }
      if (ch === "/" && text[i + 1] === ">") {
        const top = [...stack].reverse().find((f) => f.kind === "tag");
        if (top) stack.splice(stack.lastIndexOf(top), 1);
        const parent = stack[stack.length - 1];
        mode = parent && parent.kind === "tag" ? "children" : "code";
        lastSigChar = ">";
        lastIdent = "";
        i += 2;
        continue;
      }
      if (ch === ">") {
        mode = "children";
        i++;
        continue;
      }
      if (ch === "{") {
        stack.push({ kind: "brace", char: "{", ...posToLineCol(starts, i), returnMode: "tag" });
        mode = "code";
        lastSigChar = "{";
        lastIdent = "";
        i++;
        continue;
      }
      i++;
      continue;
    }

    // mode === "code"
    if (isIdentChar(ch)) {
      let j = i;
      while (j < text.length && isIdentChar(text[j])) j++;
      lastIdent = text.slice(i, j);
      lastSigChar = text[j - 1];
      i = j;
      continue;
    }

    // Regex literals contain quotes and brackets that must not be counted.
    if (ch === "/" && startsRegex(lastSigChar, lastIdent)) {
      const after = skipRegex(text, i);
      if (after !== null) {
        i = after;
        lastSigChar = "/";
        lastIdent = "";
        continue;
      }
    }

    if (jsx && ch === "<" && looksLikeJsxStart(text, i, lastSigChar, lastIdent)) {
      if (text[i + 1] === "/") {
        const { name, end } = readTagName(text, i + 2);
        const gt = text.indexOf(">", end);
        surplusClosers.push({
          ...posToLineCol(starts, i),
          text: `</${name}>`,
          kind: "tag",
          closes: null,
        });
        i = gt < 0 ? end : gt + 1;
        continue;
      }
      const { name, end } = readTagName(text, i + 1);
      if (tagNameIsGeneric(text, name, end)) {
        // `<K extends ...>` / `<T,>`: a type-parameter list, not an element.
        lastSigChar = "<";
        lastIdent = "";
        i++;
        continue;
      }
      stack.push({ kind: "tag", name, char: "<", ...posToLineCol(starts, i), returnMode: "code" });
      mode = "tag";
      i = end;
      continue;
    }

    if (ch === "(" || ch === "{" || ch === "[") {
      const kind = ch === "(" ? "paren" : ch === "{" ? "brace" : "bracket";
      stack.push({ kind, char: ch, ...posToLineCol(starts, i), returnMode: "code" });
      lastSigChar = ch;
      lastIdent = "";
      i++;
      continue;
    }

    if (ch === ")" || ch === "}" || ch === "]") {
      const wantOpener = OPENER_FOR[ch];
      const wantKind = wantOpener === "(" ? "paren" : wantOpener === "{" ? "brace" : "bracket";
      const top = stack[stack.length - 1];
      lastSigChar = ch;
      lastIdent = "";
      if (!top || top.kind !== wantKind) {
        const at = posToLineCol(starts, i);
        // A closer whose matching opener is not the innermost frame.
        const openIdx = [...stack].map((f) => f.kind).lastIndexOf(wantKind);
        if (openIdx < 0) {
          surplusClosers.push({ ...at, text: ch, kind: wantKind, closes: null });
        } else {
          surplusClosers.push({
            ...at,
            text: ch,
            kind: wantKind,
            closes: null,
            blockedBy: top ? { kind: top.kind, name: top.name, line: top.line } : null,
          });
        }
        i++;
        continue;
      }
      stack.pop();
      if (top.returnMode === "children") mode = "children";
      else if (top.returnMode === "tag") mode = "tag";
      else if (top.returnMode === "template") mode = "template";
      else mode = stack[stack.length - 1]?.kind === "tag" ? "children" : "code";
      i++;
      continue;
    }

    if (!/\s/.test(ch)) {
      lastSigChar = ch;
      lastIdent = "";
    }
    i++;
  }
  markLine(text.length ? text.length - 1 : 0);

  // Fill ledger gaps forward so every line has a depth.
  let carry = null;
  for (const row of ledger) {
    if (carry && row.depth === 0 && row.paren === 0 && row.brace === 0 && row.bracket === 0 && row.tag === 0) {
      Object.assign(row, { ...carry, line: row.line });
    } else {
      carry = { paren: row.paren, brace: row.brace, bracket: row.bracket, tag: row.tag, depth: row.depth, mode: row.mode, open: row.open };
    }
  }

  const unclosed = stack.map((f) => ({
    kind: f.kind,
    name: f.name || null,
    char: f.char,
    line: f.line,
    column: f.column,
    expectedCloser: f.kind === "tag" ? `</${f.name}>` : CLOSER_FOR[f.char],
  }));

  const divergenceCandidates = [
    ...surplusClosers.map((s) => ({ line: s.line, column: s.column, kind: "surplus-closer", detail: s })),
    ...tagMismatches.map((m) => ({ line: m.line, column: m.column, kind: "tag-mismatch", detail: m })),
  ].sort((a, b) => a.line - b.line || a.column - b.column);

  // Anything after the first divergence may be a cascade of it rather than an
  // independent fault. Label it so the model does not "fix" five phantom bugs.
  const firstLine = divergenceCandidates[0]?.line ?? Infinity;
  for (const s of surplusClosers) s.cascade = s.line > firstLine;
  for (const m of tagMismatches) m.cascade = m.line > firstLine;

  // Two adjacent mismatches whose closers are each other's expectation mean the
  // closers are transposed, or an opening tag between them was deleted.
  const swappedClosers = [];
  for (let n = 0; n + 1 < tagMismatches.length; n++) {
    const a = tagMismatches[n];
    const b = tagMismatches[n + 1];
    if (a.closer === b.expected && a.expected === b.closer) swappedClosers.push({ a, b });
  }

  return {
    swappedClosers,
    ok: surplusClosers.length === 0 && tagMismatches.length === 0 && stack.length === 0,
    totalLines,
    surplusClosers,
    tagMismatches,
    unclosed,
    ledger,
    firstDivergence: divergenceCandidates[0] || null,
    balanced: stack.length === 0,
  };
}

/**
 * Structure-only fingerprint. Two buffers with the same fingerprint have the
 * same element/delimiter skeleton, so a repair that changes it did more than
 * fix structure.
 */
export function structuralFingerprint(source, { jsx = true } = {}) {
  const s = scanStructure(source, { jsx });
  const tagCounts = new Map();
  const text = String(source ?? "");
  const re = /<\/?([A-Za-z][A-Za-z0-9_$.:-]*)/g;
  let m;
  while ((m = re.exec(text))) {
    tagCounts.set(m[1], (tagCounts.get(m[1]) || 0) + 1);
  }
  return {
    balanced: s.balanced,
    surplus: s.surplusClosers.length,
    mismatches: s.tagMismatches.length,
    unclosed: s.unclosed.length,
    tags: [...tagCounts.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([k, v]) => `${k}:${v}`).join(","),
  };
}

export function fingerprintDelta(before, after, { jsx = true } = {}) {
  const a = structuralFingerprint(before, { jsx });
  const b = structuralFingerprint(after, { jsx });
  const changedTags = a.tags !== b.tags;
  return {
    before: a,
    after: b,
    nowBalanced: b.balanced,
    fixedSurplus: a.surplus - b.surplus,
    fixedMismatches: a.mismatches - b.mismatches,
    fixedUnclosed: a.unclosed - b.unclosed,
    changedTagInventory: changedTags,
  };
}

/**
 * Lines where the structure is shallow enough to cut a window without
 * splitting a construct. Used to bound the repair window.
 */
export function stableBoundaries(scan, { maxDepth = 3 } = {}) {
  return scan.ledger.filter((r) => r.depth <= maxDepth).map((r) => r.line);
}

function windowAround(source, scan, faultLine, { before = 14, after = 10 } = {}) {
  const lines = String(source ?? "").split(/\r?\n/);
  const boundaries = stableBoundaries(scan, { maxDepth: 4 });
  const lower = boundaries.filter((l) => l < faultLine).pop();
  const upper = boundaries.find((l) => l > faultLine);
  const start = Math.max(1, Math.min(lower ?? faultLine - before, faultLine - before));
  const end = Math.min(lines.length, Math.max(upper ?? faultLine + after, faultLine + after));
  const out = [];
  for (let n = start; n <= end; n++) {
    const row = scan.ledger[n - 1];
    const mark = n === faultLine ? ">>" : "  ";
    const d = row ? `p${row.paren} b${row.brace} t${row.tag}` : "";
    out.push(`${mark}${String(n).padStart(5)} | ${d.padEnd(12)} | ${lines[n - 1] ?? ""}`);
  }
  return { start, end, text: out.join("\n") };
}

function openStackAt(source, faultLine, jsx) {
  const lines = String(source ?? "").split(/\r?\n/);
  const head = lines.slice(0, Math.max(0, faultLine - 1)).join("\n");
  return scanStructure(head, { jsx }).unclosed;
}

/**
 * Build the deterministic structural repair packet handed to the repair
 * diagnosis / apply passes. Markdown, model-facing, no hidden reasoning.
 */
export function jsxRepairPacket({ fileName, source, diagnostics = [], jsx } = {}) {
  const isJsx = typeof jsx === "boolean" ? jsx : /\.(tsx|jsx)$/i.test(String(fileName || ""));
  const scan = scanStructure(source, { jsx: isJsx });
  const first = scan.firstDivergence;
  const tsFirst = (diagnostics || [])
    .slice()
    .sort((a, b) => (a.line || 0) - (b.line || 0))[0] || null;
  const faultLine = first?.line || tsFirst?.line || 1;
  const stack = openStackAt(source, faultLine, isJsx);
  const win = windowAround(source, scan, faultLine);
  const lines = String(source ?? "").split(/\r?\n/);

  const surplusRows = scan.surplusClosers.map((s) => (
    `- line ${s.line}, col ${s.column}: \`${s.text}\` closes NOTHING${
      s.kind === "jsx-text-delimiter" ? " (bare delimiter sitting in JSX child text — always invalid)" : ""
    }${
      s.blockedBy ? ` — innermost open frame is ${s.blockedBy.kind}${s.blockedBy.name ? ` <${s.blockedBy.name}>` : ""} opened at line ${s.blockedBy.line}` : ""
    }${s.cascade ? "  [LIKELY CASCADE of the first divergence — do not treat as an independent bug]" : ""}\n      source: \`${(lines[s.line - 1] || "").trim()}\``
  ));

  const mismatchRows = scan.tagMismatches.map((m) => (
    `- line ${m.line}: found \`${m.closer}\` but the innermost open element is \`<${m.expected.replace(/^<\/|>$/g, "")}>\` opened at line ${m.openedAtLine} (parser expected \`${m.expected}\` here)${m.cascade ? "  [LIKELY CASCADE]" : ""}`
  ));

  const swapRows = (scan.swappedClosers || []).map(({ a, b }) => (
    `- lines ${a.line} and ${b.line}: \`${a.closer}\` and \`${b.closer}\` are TRANSPOSED with respect to the open element stack.\n`
    + `  Either swap those two closing tags, or an opening \`${a.closer.replace("</", "<")}\` that used to exist between line ${a.openedAtLine} and line ${a.line} was deleted and its closer was left behind.`
  ));

  const unclosedRows = scan.unclosed.map((u) => (
    `- ${u.kind}${u.name ? ` <${u.name}>` : ` \`${u.char}\``} opened at line ${u.line}, col ${u.column} is NEVER closed (needs \`${u.expectedCloser}\`)`
  ));

  const stackRows = stack.length
    ? stack.map((f, n) => (
      `${String(n + 1).padStart(2)}. ${f.kind}${f.name ? ` <${f.name}>` : ` \`${f.char}\``} opened line ${f.line} → expects \`${f.expectedCloser}\``
    ))
    : ["(nothing open — the divergence is at top level)"];

  const expectedSequence = stack.length
    ? stack.slice().reverse().map((f) => f.expectedCloser).join(" then ")
    : "(none)";

  const verdictLines = [];
  if (scan.surplusClosers.length && !scan.unclosed.length) {
    verdictLines.push(
      `MECHANICAL SHAPE: ${scan.surplusClosers.length} surplus closer(s), 0 unclosed openers. `
      + "The file has TOO MANY closers. The minimal repair DELETES surplus closers. Do not add new openers.",
    );
  } else if (scan.unclosed.length && !scan.surplusClosers.length) {
    verdictLines.push(
      `MECHANICAL SHAPE: ${scan.unclosed.length} unclosed opener(s), 0 surplus closers. `
      + "The file is MISSING closers. The minimal repair ADDS the expected closers. Do not delete code.",
    );
  } else if (scan.surplusClosers.length && scan.unclosed.length) {
    verdictLines.push(
      `MECHANICAL SHAPE: ${scan.surplusClosers.length} surplus closer(s) AND ${scan.unclosed.length} unclosed opener(s). `
      + "Most likely an opener line was deleted while its closer was left behind, or a closer was duplicated. "
      + "Fix ONLY the delimiter imbalance.",
    );
  } else if (scan.tagMismatches.length) {
    verdictLines.push(
      "MECHANICAL SHAPE: closing tags are out of order. Reorder/relabel closers to match the open element stack.",
    );
  } else {
    verdictLines.push("MECHANICAL SHAPE: scanner found no delimiter imbalance; the failure is likely semantic, not structural.");
  }

  return {
    scan,
    faultLine,
    window: win,
    markdown: `## DETERMINISTIC STRUCTURAL ANALYSIS (computed, not guessed)

FILE: ${fileName || "(unknown)"}
SCANNER VERDICT: ${scan.ok ? "structurally balanced" : "STRUCTURALLY UNBALANCED"}
FIRST STRUCTURAL DIVERGENCE: line ${faultLine}${first ? ` (${first.kind})` : " (from compiler diagnostic)"}
SOURCE AT LINE ${faultLine}: \`${(lines[faultLine - 1] || "").trim()}\`

START HERE. Fix the FIRST divergence only, then re-run the syntax gate. Later
entries below are frequently consequences of this one line.

${verdictLines.join("\n")}

### SURPLUS CLOSERS (close nothing — candidates for deletion)
${surplusRows.length ? surplusRows.join("\n") : "(none)"}

### UNCLOSED OPENERS (never closed — candidates for adding a closer)
${unclosedRows.length ? unclosedRows.join("\n") : "(none)"}

### OUT-OF-ORDER CLOSING TAGS
${mismatchRows.length ? mismatchRows.join("\n") : "(none)"}

### TRANSPOSED CLOSER PAIRS
${swapRows.length ? swapRows.join("\n") : "(none)"}

### OPEN FRAME STACK IMMEDIATELY BEFORE LINE ${faultLine}
${stackRows.join("\n")}

EXPECTED CLOSER SEQUENCE AT LINE ${faultLine}: ${expectedSequence}

### MINIMAL WINDOW (lines ${win.start}-${win.end}; p=paren depth, b=brace depth, t=JSX tag depth entering the line)
\`\`\`
${win.text}
\`\`\`

### HOW TO USE THIS
The depths above are computed by a scanner, not inferred. Do not re-count brackets by eye.
Apply the smallest delimiter-only edit that makes surplus=0 and unclosed=0.
Do not rename identifiers, do not add hooks, do not change props, do not reformat.
`,
  };
}
