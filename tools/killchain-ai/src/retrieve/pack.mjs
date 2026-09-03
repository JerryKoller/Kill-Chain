import { extractQueryTerms, loadChunks, tokenize } from "./index.mjs";
import { hybridSearch } from "./hybrid.mjs";

const ORDER = [
  "constitution",
  "invariant",
  "danger",
  "ownership",
  "architecture",
  "async",
  "relation",
  "symbol",
  "test",
  "validation",
  "subsystem",
];

/** Generic helpers that flood packs when many stores share the same name. */
const CROWD_NAMES = new Set(["persist", "load", "save", "init", "handler"]);
const WEAK_ANCHOR = new Set([
  ...CROWD_NAMES,
  "toast", "audio", "store", "state", "error", "fail", "failure",
  "helper", "function", "mapping", "silent", "throw", "localstorage",
]);
const EXCERPT = 2400;

function estimateTokens(text) {
  return Math.ceil(String(text).length / 4);
}

function shortName(sym) {
  return String(sym || "").split(".").pop().toLowerCase();
}

function fileBase(path) {
  return String(path || "").replace(/\\/g, "/").split("/").pop().replace(/\.(ts|tsx|js|mjs)$/i, "").toLowerCase();
}

/** Prefer the slice of a long symbol body that actually mentions the query. */
function excerptText(text, query) {
  const src = String(text || "");
  if (src.length <= EXCERPT) return src;
  const toks = tokenize(query).filter((t) => t.length >= 4);
  if (!toks.length) return src.slice(0, EXCERPT);
  const lower = src.toLowerCase();
  let best = -1;
  let bestAt = 0;
  const step = 280;
  for (let i = 0; i < src.length; i += step) {
    const win = lower.slice(i, i + EXCERPT);
    let s = 0;
    for (const t of toks) {
      if (!win.includes(t)) continue;
      s += t.length >= 8 ? 3 : 1;
      if (win.includes(`${t}(`) || win.includes(`case "${t}"`) || win.includes(`"${t}"`)) s += 5;
    }
    if (s > best) {
      best = s;
      bestAt = i;
    }
    if (i + EXCERPT >= src.length) break;
  }
  if (best <= 0) return src.slice(0, EXCERPT);
  const out = src.slice(bestAt, bestAt + EXCERPT);
  return `${bestAt > 0 ? "/* … earlier in symbol */\n" : ""}${out}${bestAt + EXCERPT < src.length ? "\n/* … later in symbol */" : ""}`;
}

function formatHit(h, query) {
  const c = h.chunk;
  const loc = c.path + (c.lineStart ? `:${c.lineStart}-${c.lineEnd || c.lineStart}` : "");
  const rel = c.relationships || {};
  const calls = (rel.calls || []).slice(0, 8).join(", ");
  const calledBy = (rel.calledBy || []).slice(0, 8).join(", ");
  const tests = (rel.tests || []).slice(0, 6).join(", ");
  return [
    `### [${c.type}] ${c.title}`,
    `path: ${loc}`,
    c.symbol ? `symbol: ${c.symbol}` : null,
    `subsystem: ${c.subsystem}`,
    `git: ${c.gitCommit}`,
    `via: ${(h.via || []).join?.(", ") || h.via}`,
    calls ? `callees: ${calls}` : null,
    calledBy ? `callers: ${calledBy}` : null,
    tests ? `tests: ${tests}` : null,
    `sources: ${(c.sources || []).map((s) => `${s.path}:${s.lineStart || "?"}-${s.lineEnd || "?"}`).join("; ")}`,
    "",
    excerptText(c.text || "", query),
  ].filter(Boolean).join("\n");
}

function typeRank(type) {
  const i = ORDER.indexOf(type);
  return i === -1 ? 99 : i;
}

function anchorPaths(task, hits) {
  const { symbols, paths } = extractQueryTerms(task);
  const q = String(task).toLowerCase();
  const qToks = tokenize(task).filter((t) => t.length >= 5 && !WEAK_ANCHOR.has(t));
  const out = new Set(paths);
  const want = new Set(
    symbols.map((s) => s.toLowerCase()).filter((s) => s.length >= 5 && !WEAK_ANCHOR.has(s)),
  );
  for (const p of paths) {
    const b = fileBase(p);
    if (b) want.add(b);
  }
  for (const h of hits) {
    const c = h.chunk;
    const base = fileBase(c.path);
    if (base && (q.includes(base) || want.has(base))) out.add(c.path);
    if (base && qToks.some((t) => base.includes(t))) out.add(c.path);
    const sl = (c.symbol || "").toLowerCase();
    if (sl && [...want].some((s) => sl === s || sl.endsWith("." + s) || sl === "use" + s)) {
      out.add(c.path);
    }
    const via = Array.isArray(h.via) ? h.via.join(",") : String(h.via || "");
    if (via.includes("exact-symbol") || via.includes("exact-path")) out.add(c.path);
  }
  return out;
}

function fileHelpers(chunks, paths, query) {
  const toks = tokenize(query).filter((t) => t.length >= 4);
  const extra = [];
  for (const path of paths) {
    const fileChunks = chunks.filter((c) => c.path === path && (c.type === "symbol" || c.type === "async"));
    const scored = fileChunks.map((c) => {
      const blob = `${c.symbol || ""} ${c.title || ""} ${c.text || ""}`.toLowerCase();
      let overlap = 0;
      for (const t of toks) {
        if (blob.includes(t)) overlap += t.length >= 8 ? 2 : 1;
      }
      return { chunk: c, score: 36 + overlap * 6, via: "file-helper", overlap };
    });
    scored.sort((a, b) => b.overlap - a.overlap || (a.chunk.lineStart || 0) - (b.chunk.lineStart || 0));
    extra.push(...scored.filter((h) => h.overlap > 0 || scored.length <= 4).slice(0, 8));
  }
  return extra;
}

function selectHits(queue, budget, headerTokens, anchors, query) {
  const used = new Set();
  const selected = [];
  const byShort = new Map();
  const byPath = new Map();
  let constitution = 0;
  let tokens = headerTokens;

  const tryAdd = (h, force) => {
    if (!h?.chunk || used.has(h.chunk.id)) return false;
    const block = formatHit(h, query);
    const t = estimateTokens(block);
    const short = shortName(h.chunk.symbol);
    const path = h.chunk.path;
    const anchored = anchors.has(path);
    if (!force) {
      if (tokens + t > budget && selected.length >= 6) return false;
      if (h.chunk.type === "constitution" && constitution >= 3) return false;
      if (CROWD_NAMES.has(short) && (byShort.get(short) || 0) >= (anchored ? 2 : 1)) return false;
      if ((byPath.get(path) || 0) >= (anchored ? 8 : 3)) return false;
    } else {
      if (h.chunk.type === "constitution" && constitution >= 3) return false;
      if (CROWD_NAMES.has(short) && (byShort.get(short) || 0) >= (anchored ? 2 : 1)) return false;
      if (anchored && (byPath.get(path) || 0) >= 8) return false;
      if (tokens + t > budget * 1.15 && selected.length >= 8) return false;
    }
    used.add(h.chunk.id);
    selected.push(h);
    tokens += t;
    byShort.set(short, (byShort.get(short) || 0) + 1);
    byPath.set(path, (byPath.get(path) || 0) + 1);
    if (h.chunk.type === "constitution") constitution += 1;
    return true;
  };

  const anchored = queue.filter((h) => anchors.has(h.chunk.path));
  const policy = queue.filter((h) => ["invariant", "ownership", "danger"].includes(h.chunk.type));
  const rest = queue.filter((h) => !anchors.has(h.chunk.path) && !["invariant", "ownership", "danger"].includes(h.chunk.type));

  for (const h of policy.slice(0, 8)) tryAdd(h, true);
  for (const h of anchored) tryAdd(h, true);
  rest.sort((a, b) => {
    const tr = typeRank(a.chunk.type) - typeRank(b.chunk.type);
    if (tr) return tr;
    return (b.score || 0) - (a.score || 0);
  });
  for (const h of rest) tryAdd(h, false);
  for (const h of queue) tryAdd(h, false);

  return { selected, used, tokens };
}

export async function contextPack(task, { budget = 8000, k = 28, mode = "full" } = {}) {
  budget = Math.min(32000, Math.max(2000, Number(budget) || 8000));
  const searchK = Math.max(k, 40);
  const result = await hybridSearch(task, { k: searchK, mode });
  const { chunks } = loadChunks();
  const anchors = anchorPaths(task, result.hits);
  if (/persist|localstorage|quota|storage.?fail/i.test(String(task))) {
    for (const c of chunks) {
      if (c.subsystem === "health" && c.path) anchors.add(c.path);
    }
  }
  const helpers = fileHelpers(chunks, anchors, task);
  const byId = new Map();
  for (const h of [...helpers, ...result.hits]) {
    const id = h.chunk.id;
    const prev = byId.get(id);
    if (!prev || (h.score || 0) > (prev.score || 0)) byId.set(id, h);
  }
  const queue = [...byId.values()].sort((a, b) => {
    const aa = anchors.has(a.chunk.path) ? 1 : 0;
    const ba = anchors.has(b.chunk.path) ? 1 : 0;
    if (aa !== ba) return ba - aa;
    return (b.score || 0) - (a.score || 0);
  });

  const header = [
    "# Kill Chain context pack",
    `task: ${task}`,
    `corpus git: ${result.manifest?.gitCommit || "unknown"}`,
    `retrieval: ${mode}`,
    `budget: ${budget} tokens (approx)`,
    "",
    "Facts below are excerpts with provenance. Do not treat unsourced claims as architecture.",
    "Follow AGENTS.md. Do not autonomously change DSP, Mission State priority, claimSource, or rewireFront.",
    "Write the investigation report as the user-visible final answer, not only as hidden reasoning.",
    "",
  ].join("\n");
  const headerTokens = estimateTokens(header);
  const { selected, tokens } = selectHits(queue, budget, headerTokens, anchors, task);

  const markdown = header + selected.map((h) => formatHit(h, task)).join("\n\n---\n\n");
  return {
    task,
    gitCommit: result.manifest?.gitCommit,
    tokenEstimate: tokens,
    chunkCount: selected.length,
    chunks: selected.map((h) => ({
      id: h.chunk.id,
      type: h.chunk.type,
      path: h.chunk.path,
      symbol: h.chunk.symbol,
      lineStart: h.chunk.lineStart,
      lineEnd: h.chunk.lineEnd,
      via: h.via,
      score: h.score,
    })),
    markdown,
    mode,
  };
}
