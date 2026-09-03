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
  const qToks = expandQueryTokens(tokenize(query)).filter((t) => t.length >= 4);
  const ownershipCue = /overlap|ownership|claim|playback|audible|double.?mount|strict.?mode|one.?audible/i.test(q);
  const out = [];
  for (const c of chunks) {
    if (c.type === "constitution" && /HARD INVARIANTS/i.test(c.title)) {
      out.push({ chunk: c, score: 15, via: "policy-inject" });
    } else if (c.type === "constitution") {
      const blob = `${c.title || ""} ${c.text || ""}`.toLowerCase();
      const overlap = qToks.filter((t) => blob.includes(t)).length;
      if (overlap >= 2 && /PRIMARY OBJECTIVE|VALIDATION|GIT SAFETY/i.test(c.title)) {
        out.push({ chunk: c, score: 11 + overlap, via: "policy-inject" });
      }
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
    if (c.type === "ownership") {
      const blob = `${c.title || ""} ${c.text || ""} ${(c.tags || []).join(" ")}`.toLowerCase();
      const overlap = qToks.filter((t) => blob.includes(t)).length;
      if (ownershipCue || overlap >= 1) {
        out.push({ chunk: c, score: 19 + overlap * 3, via: "policy-inject" });
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

export function resolveSymbolQuery(chunks, name) {
  const raw = String(name || "").trim();
  if (!raw) return [];
  const q = raw.toLowerCase().replace(/\\/g, "/");
  const qFile = q.replace(/\.(ts|tsx|js|mjs)$/, "");
  const qBase = qFile.split("/").pop();
  const scored = [];
  for (const c of chunks) {
    const sym = c.symbol || "";
    const sl = sym.toLowerCase();
    const path = String(c.path || "").replace(/\\/g, "/");
    const pl = path.toLowerCase();
    const base = pl.split("/").pop().replace(/\.(ts|tsx|js|mjs)$/, "");
    let score = 0;
    let why = "";
    if (sl && sl === q) {
      score = 100;
      why = "exact";
    } else if (sl && sl.endsWith("." + q)) {
      score = 92;
      why = "qualified";
    } else if (sl && sl === "use" + q) {
      score = 88;
      why = "use-prefix";
    } else if (q.startsWith("use") && sl && sl === q.slice(3)) {
      score = 86;
      why = "use-strip";
    } else if (base && (base === q || base === qBase)) {
      score = 82;
      why = "path-base";
    } else if (qBase.length >= 6 && (pl.endsWith("/" + qBase + ".ts") || pl.endsWith("/" + qBase + ".tsx") || pl.endsWith("/" + qBase + ".js"))) {
      score = 80;
      why = "path";
    } else if (c.type === "symbol" && q.length >= 8 && sl.endsWith(q)) {
      score = 70;
      why = "suffix";
    }
    if (score) scored.push({ chunk: c, score, via: why });
  }
  scored.sort((a, b) => b.score - a.score || (a.chunk.lineStart || 0) - (b.chunk.lineStart || 0));
  return scored;
}

export function symbolLookup(name) {
  const { chunks, manifest } = loadChunks();
  const hits = resolveSymbolQuery(chunks, name);
  return { manifest, hits };
}

export function callersOf(name) {
  const { chunks, manifest } = loadChunks();
  const resolved = resolveSymbolQuery(chunks, name);
  const names = new Set([name]);
  for (const h of resolved.slice(0, 8)) {
    if (h.chunk.symbol) {
      names.add(h.chunk.symbol);
      const short = h.chunk.symbol.split(".").pop();
      if (short) names.add(short);
    }
  }
  const hits = [];
  const seen = new Set();
  const callerNames = new Set();
  for (const c of chunks) {
    if (c.symbol && [...names].some((n) => c.symbol === n || c.symbol.endsWith("." + n))) {
      for (const x of c.relationships?.calledBy || []) callerNames.add(x);
    }
  }
  for (const c of chunks) {
    const isDef = c.type === "symbol" && c.symbol && [...names].some((n) => c.symbol === n || c.symbol.endsWith("." + n));
    if (isDef) {
      if (!seen.has(c.id)) {
        hits.push({ chunk: c, score: 50, via: "definition" });
        seen.add(c.id);
      }
      continue;
    }
    const lists = [...names].some((n) => (c.relationships?.calls || []).includes(n)) || callerNames.has(c.symbol);
    const textHit = c.type === "symbol" && [...names].some((n) => n && (c.text || "").includes(`${n}(`)) && !names.has(c.symbol);
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
  const resolved = resolveSymbolQuery(chunks, name);
  const def = resolved.find((h) => h.chunk.type === "symbol")?.chunk
    || chunks.find((c) => c.symbol === name && c.type === "symbol");
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
  const q = String(nameOrPath || "").toLowerCase();
  const resolved = resolveSymbolQuery(chunks, nameOrPath);
  const related = resolved.map((h) => h.chunk);
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
  const resolvedHint = resolved[0]?.chunk
    ? ` Resolved as ${resolved[0].chunk.symbol || resolved[0].chunk.path}.`
    : "";
  const notice = hits.length
    ? null
    : `No indexed test relationship found for "${nameOrPath}".${resolvedHint} This is a correct empty result when the corpus has no test/script coverage — not a tool failure. Do not invent tests.`;
  return { manifest, hits: hits.map((chunk) => ({ chunk, score: 30, via: "test" })), notice };
}

export function invariants(query = "") {
  const { chunks, manifest } = loadChunks();
  const types = new Set(["invariant", "constitution", "danger", "validation"]);
  let hits = chunks.filter((c) => types.has(c.type));
  if (query.trim()) {
    const qToks = tokenize(query).filter((t) => t.length >= 4);
    hits = hits
      .map((chunk) => {
        const blob = `${chunk.title || ""} ${chunk.text || ""} ${(chunk.tags || []).join(" ")}`.toLowerCase();
        const overlap = qToks.filter((t) => blob.includes(t)).length;
        return { chunk, overlap };
      })
      .filter(({ overlap }) => overlap >= 1)
      .sort((a, b) =>
        b.overlap - a.overlap ||
        (a.chunk.type === "invariant" ? 0 : 1) - (b.chunk.type === "invariant" ? 0 : 1)
      );
    const mapped = hits.map(({ chunk, overlap }) => ({
      chunk,
      score: 20 + overlap * 4,
      via: "invariant",
    }));
    return {
      manifest,
      hits: mapped,
      notice: mapped.length ? null : `No indexed invariant/policy chunks matched "${query}". Try a shorter architecture term (claimSource, Mission State, persist).`,
    };
  }
  hits.sort((a, b) => (a.type === "invariant" ? 0 : 1) - (b.type === "invariant" ? 0 : 1));
  return { manifest, hits: hits.map((chunk) => ({ chunk, score: 20, via: "invariant" })) };
}

export { extractQueryTerms };
