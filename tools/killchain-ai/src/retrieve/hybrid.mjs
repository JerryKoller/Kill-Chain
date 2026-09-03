import { bm25Search, exactHits, extractQueryTerms, loadChunks, loadEmbeddings, tokenize } from "./index.mjs";
import { semanticSearch } from "./embeddings.mjs";
import {
  expandQueryTokens,
  isLifecycleCleanupQuery,
} from "./queryExpand.mjs";

export const SEARCH_MODES = {
  lexical: { embed: false, graph: false, inject: false, lifecycle: false, coverage: false },
  "lexical-graph": { embed: false, graph: true, inject: false, lifecycle: false, coverage: false },
  full: { embed: true, graph: true, inject: true, lifecycle: true, coverage: true },
};

const LIFECYCLE_NAME = /stop|clear|dispose|release|unmount|cancel|teardown|abort/i;
const LIFECYCLE_TEXT = /setInterval|setTimeout|requestAnimationFrame|clearTimeout|clearInterval|AbortController|\braf\b/i;

const TYPE_BOOST = {
  constitution: 6,
  invariant: 8,
  danger: 7,
  architecture: 5,
  ownership: 6,
  validation: 4,
  test: 4,
  relation: 3,
  async: 3,
  symbol: 2,
  subsystem: 1,
};

function mergeHits(lists) {
  const map = new Map();
  for (const list of lists) {
    for (const h of list) {
      const id = h.chunk.id;
      const prev = map.get(id);
      if (!prev) map.set(id, { ...h, via: [h.via] });
      else {
        prev.score += h.score;
        prev.via.push(h.via);
      }
    }
  }
  for (const h of map.values()) {
    h.score += TYPE_BOOST[h.chunk.type] || 0;
  }
  return [...map.values()].sort((a, b) => b.score - a.score);
}

function graphExpand(chunks, hits, query = "", limit = 12) {
  const q = query.toLowerCase();
  const bySymbol = new Map();
  const byPath = new Map();
  for (const c of chunks) {
    if (c.symbol) {
      if (!bySymbol.has(c.symbol)) bySymbol.set(c.symbol, []);
      bySymbol.get(c.symbol).push(c);
    }
    if (!byPath.has(c.path)) byPath.set(c.path, []);
    byPath.get(c.path).push(c);
  }
  const extra = [];
  const seen = new Set(hits.map((h) => h.chunk.id));
  const seed = hits.slice(0, 8);
  for (const h of seed) {
    const rel = h.chunk.relationships || {};
    for (const name of [...(rel.calls || []), ...(rel.calledBy || [])].slice(0, 8)) {
      for (const c of bySymbol.get(name) || []) {
        if (seen.has(c.id)) continue;
        seen.add(c.id);
        extra.push({ chunk: c, score: h.score * 0.35, via: "graph-call" });
      }
    }
    for (const p of [...(rel.imports || []), ...(rel.importedBy || [])].slice(0, 6)) {
      const files = (byPath.get(p) || []).filter((c) => c.type === "subsystem" || c.type === "symbol");
      for (const c of files.slice(0, 3)) {
        if (seen.has(c.id)) continue;
        seen.add(c.id);
        extra.push({ chunk: c, score: h.score * 0.25, via: "graph-import" });
      }
    }
    for (const t of rel.tests || []) {
      const [path, testName = ""] = t.split("#");
      if (testName && q && !testName.toLowerCase().includes(q.slice(0, 12)) && !q.split(/\s+/).some((w) => w.length > 3 && testName.toLowerCase().includes(w))) {
        continue;
      }
      for (const c of (byPath.get(path) || []).filter((x) => x.type === "test").slice(0, 5)) {
        if (seen.has(c.id)) continue;
        const label = `${c.title || ""} ${c.symbol || ""}`.toLowerCase();
        if (q && testName && !label.split(/\s+/).some((w) => q.includes(w) && w.length > 3) && !q.split(/\s+/).some((w) => w.length > 3 && label.includes(w))) {
          continue;
        }
        seen.add(c.id);
        extra.push({ chunk: c, score: h.score * 0.4, via: "graph-test" });
      }
    }
    if (extra.length >= limit) break;
  }
  return extra;
}

function alwaysInject(chunks, query) {
  const q = query.toLowerCase();
  const qToks = tokenize(query).filter((t) => t.length >= 4);
  const out = [];
  for (const c of chunks) {
    if (c.type === "constitution" && /HARD INVARIANTS|PRIMARY OBJECTIVE|VALIDATION/i.test(c.title)) {
      out.push({ chunk: c, score: 15, via: "policy-inject" });
    }
    if (c.type === "invariant") {
      const blob = `${c.title || ""} ${c.text || ""} ${c.symbol || ""} ${(c.tags || []).join(" ")}`.toLowerCase();
      const overlap = qToks.filter((t) => blob.includes(t)).length;
      if (overlap >= 1) {
        out.push({ chunk: c, score: 16 + overlap * 4, via: "policy-inject" });
      }
    }
    if (c.type === "danger") {
      const blob = `${c.title || ""} ${c.text || ""}`.toLowerCase();
      if (/dsp|approval|limiter|compressor|eq |loudness|spatial/i.test(q) ||
          qToks.some((t) => t.length >= 5 && blob.includes(t))) {
        out.push({ chunk: c, score: 16, via: "policy-inject" });
      }
    }
  }
  return out;
}

function lifecycleHits(chunks, query) {
  if (!isLifecycleCleanupQuery(query)) return [];
  const out = [];
  for (const c of chunks) {
    if (c.type !== "symbol" && c.type !== "async") continue;
    const name = c.symbol || c.title || "";
    if (!LIFECYCLE_NAME.test(name)) continue;
    const blob = `${c.text || ""} ${c.title || ""}`;
    if (!LIFECYCLE_TEXT.test(blob)) continue;
    out.push({ chunk: c, score: 52, via: "lifecycle-pair" });
  }
  return out;
}

function coverageHits(chunks, query, limit = 16) {
  const tokens = expandQueryTokens(tokenize(query)).filter((t) => t.length >= 4);
  if (tokens.length < 3) return [];
  const scored = [];
  for (const c of chunks) {
    const blob = `${c.symbol || ""} ${c.path || ""} ${c.title || ""} ${c.text || ""}`.toLowerCase();
    let n = 0;
    for (const t of tokens) {
      if (blob.includes(t)) n++;
    }
    if (n >= 3) scored.push({ chunk: c, score: n * 5, via: "term-coverage" });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

export async function hybridSearch(query, opts = {}) {
  const defaults = SEARCH_MODES[opts.mode] || SEARCH_MODES.full;
  const k = opts.k ?? 16;
  const embed = opts.embed ?? defaults.embed;
  const graph = opts.graph ?? defaults.graph;
  const inject = opts.inject ?? defaults.inject;
  const lifecycle = opts.lifecycle ?? defaults.lifecycle;
  const coverage = opts.coverage ?? defaults.coverage;
  const { chunks, manifest } = loadChunks();
  const exact = exactHits(chunks, query).slice(0, 24);
  const lexical = bm25Search(chunks, query, 24);
  let semantic = [];
  if (embed) {
    const store = loadEmbeddings();
    if (store) semantic = await semanticSearch(chunks, query, store, 8);
  }
  const lists = [exact, lexical, semantic];
  if (inject) lists.push(alwaysInject(chunks, query));
  if (lifecycle) lists.push(lifecycleHits(chunks, query));
  if (coverage) lists.push(coverageHits(chunks, query));
  const merged = mergeHits(lists);
  const expanded = graph ? graphExpand(chunks, merged, query) : [];
  const all = mergeHits([merged, expanded]);
  return { manifest, query, mode: opts.mode || "full", hits: all.slice(0, k) };
}

export function symbolLookup(name) {
  const { chunks, manifest } = loadChunks();
  const q = name.toLowerCase();
  const hits = chunks.filter((c) =>
    (c.symbol && c.symbol.toLowerCase() === q) ||
    (c.symbol && c.symbol.toLowerCase().endsWith("." + q)) ||
    (c.symbol && c.symbol.toLowerCase().includes(q) && c.type === "symbol"),
  );
  hits.sort((a, b) => {
    const ae = a.symbol.toLowerCase() === q ? 0 : 1;
    const be = b.symbol.toLowerCase() === q ? 0 : 1;
    if (ae !== be) return ae - be;
    return (a.lineStart || 0) - (b.lineStart || 0);
  });
  return { manifest, hits: hits.map((chunk) => ({ chunk, score: 100, via: "symbol" })) };
}

export function callersOf(name) {
  const { chunks, manifest } = loadChunks();
  const hits = [];
  const needle = `${name}(`;
  const seen = new Set();
  const callerNames = new Set();
  for (const c of chunks) {
    if (c.symbol === name || (c.symbol && c.symbol.endsWith("." + name))) {
      for (const x of c.relationships?.calledBy || []) callerNames.add(x);
    }
  }
  for (const c of chunks) {
    if ((c.symbol === name || (c.symbol && c.symbol.endsWith("." + name))) && c.type === "symbol") {
      if (!seen.has(c.id)) {
        hits.push({ chunk: c, score: 50, via: "definition" });
        seen.add(c.id);
      }
      continue;
    }
    const lists = (c.relationships?.calls || []).includes(name) || callerNames.has(c.symbol);
    const textHit = c.type === "symbol" && (c.text || "").includes(needle) && c.symbol !== name;
    if (lists || textHit) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      hits.push({ chunk: c, score: lists ? 40 : 35, via: lists ? "caller" : "caller-text" });
    }
  }
  return { manifest, hits };
}

export function calleesOf(name) {
  const { chunks, manifest } = loadChunks();
  const def = chunks.find((c) => c.symbol === name && c.type === "symbol");
  const names = new Set(def?.relationships?.calls || []);
  const hits = [];
  if (def) hits.push({ chunk: def, score: 50, via: "definition" });
  for (const c of chunks) {
    if (names.has(c.symbol) && c.type === "symbol") hits.push({ chunk: c, score: 40, via: "callee" });
  }
  return { manifest, hits };
}

export function testsFor(nameOrPath) {
  const { chunks, manifest } = loadChunks();
  const q = nameOrPath.toLowerCase();
  const related = chunks.filter((c) =>
    (c.symbol && c.symbol.toLowerCase() === q) ||
    (c.path && (c.path.toLowerCase() === q || c.path.toLowerCase().endsWith(q))),
  );
  const testPaths = new Set();
  for (const c of related) {
    for (const t of c.relationships?.tests || []) testPaths.add(t.split("#")[0]);
  }
  const hits = chunks.filter((c) => {
    if (c.type !== "test" && c.type !== "validation") return false;
    if (c.path && (testPaths.has(c.path) || c.path.toLowerCase().includes(q))) return true;
    if ((c.text || "").toLowerCase().includes(q) || (c.title || "").toLowerCase().includes(q)) return true;
    return false;
  });
  return { manifest, hits: hits.map((chunk) => ({ chunk, score: 30, via: "test" })) };
}

export function invariants(query = "") {
  const { chunks, manifest } = loadChunks();
  const types = new Set(["invariant", "constitution", "danger", "validation"]);
  let hits = chunks.filter((c) => types.has(c.type));
  if (query.trim()) {
    const q = query.toLowerCase();
    hits = hits.filter((c) =>
      (c.title || "").toLowerCase().includes(q) ||
      (c.text || "").toLowerCase().includes(q) ||
      (c.tags || []).join(" ").toLowerCase().includes(q),
    );
  }
  hits.sort((a, b) => (a.type === "invariant" ? 0 : 1) - (b.type === "invariant" ? 0 : 1));
  return { manifest, hits: hits.map((chunk) => ({ chunk, score: 20, via: "invariant" })) };
}

export { extractQueryTerms };
