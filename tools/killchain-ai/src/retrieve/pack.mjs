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

function estimateTokens(text) {
  return Math.ceil(String(text).length / 4);
}

function formatHit(h) {
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
    (c.text || "").slice(0, 2400),
  ].filter(Boolean).join("\n");
}

export async function contextPack(task, { budget = 8000, k = 28, mode = "full" } = {}) {
  const result = await hybridSearch(task, { k, mode });
  const ranked = [...result.hits].sort((a, b) => {
    const ai = ORDER.indexOf(a.chunk.type);
    const bi = ORDER.indexOf(b.chunk.type);
    const ao = ai === -1 ? 99 : ai;
    const bo = bi === -1 ? 99 : bi;
    if (ao !== bo) return ao - bo;
    return b.score - a.score;
  });
  const used = new Set();
  const selected = [];
  let tokens = 0;
  const header = [
    "# Kill Chain context pack",
    `task: ${task}`,
    `corpus git: ${result.manifest?.gitCommit || "unknown"}`,
    `retrieval: ${mode}`,
    `budget: ${budget} tokens (approx)`,
    "",
    "Facts below are excerpts with provenance. Do not treat unsourced claims as architecture.",
    "Follow AGENTS.md. Do not autonomously change DSP, Mission State priority, claimSource, or rewireFront.",
    "",
  ].join("\n");
  tokens += estimateTokens(header);

  const must = result.hits.filter((h) =>
    ["invariant", "symbol", "ownership", "danger"].includes(h.chunk.type),
  ).slice(0, 6);
  const rest = ranked.filter((h) => !must.some((m) => m.chunk.id === h.chunk.id));
  const queue = [...must, ...rest];

  for (const h of queue) {
    if (used.has(h.chunk.id)) continue;
    const block = formatHit(h);
    const t = estimateTokens(block);
    if (tokens + t > budget && selected.length >= 6) continue;
    used.add(h.chunk.id);
    selected.push(h);
    tokens += t;
  }

  const markdown = header + selected.map(formatHit).join("\n\n---\n\n");
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
