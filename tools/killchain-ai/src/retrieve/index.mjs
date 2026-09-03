import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { corpusDir, indexDir } from "../paths.mjs";
import {
  expandQueryTokens,
  isFunctionWord,
  querySymbolCandidates,
  wholeWordIn,
} from "./queryExpand.mjs";

export function loadChunks() {
  const p = join(corpusDir, "chunks.jsonl");
  if (!existsSync(p)) {
    throw new Error(`Corpus missing at ${p}. Run: node tools/killchain-ai/src/cli.mjs corpus`);
  }
  const chunks = readFileSync(p, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  let manifest = null;
  const mp = join(corpusDir, "manifest.json");
  if (existsSync(mp)) manifest = JSON.parse(readFileSync(mp, "utf8"));
  return { chunks, manifest };
}

export function loadEmbeddings() {
  const p = join(indexDir, "embeddings.json");
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8"));
}

const STOP = new Set(["the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "is", "be", "this", "that", "with", "from"]);

export function tokenize(text) {
  const original = String(text || "");
  const camelSplit = original
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
  const raw = camelSplit.toLowerCase();
  const out = [];
  for (const part of raw.split(/[^a-z0-9_./:-]+/)) {
    if (!part || part.length < 2 || STOP.has(part) || isFunctionWord(part)) continue;
    out.push(part);
  }
  return out;
}

export function extractQueryTerms(q) {
  const symbols = querySymbolCandidates(q);
  const paths = [];
  for (const m of String(q).matchAll(/\b([\w./-]+\.(?:ts|tsx|js|mjs|md))\b/g)) {
    paths.push(m[1].replace(/\\/g, "/"));
  }
  return { symbols, paths, tokens: tokenize(q) };
}

/** BM25 over in-memory chunks. Field-weighted. */
export function bm25Search(chunks, query, k = 20) {
  const qTokens = expandQueryTokens(tokenize(query));
  if (!qTokens.length) return [];
  const N = chunks.length;
  const df = new Map();
  const docs = chunks.map((c, i) => {
    const bag = new Map();
    const add = (text, w) => {
      for (const t of tokenize(text)) {
        bag.set(t, (bag.get(t) || 0) + w);
      }
    };
    add(c.symbol || "", 8);
    add(c.path || "", 6);
    add(c.title || "", 4);
    add((c.tags || []).join(" "), 3);
    add(c.type || "", 2);
    add(c.subsystem || "", 2);
    add((c.text || "").slice(0, 4000), 1);
    for (const t of bag.keys()) df.set(t, (df.get(t) || 0) + 1);
    return { i, bag, len: [...bag.values()].reduce((a, b) => a + b, 0) };
  });
  const avgLen = docs.reduce((a, d) => a + d.len, 0) / Math.max(1, N);
  const k1 = 1.2;
  const b = 0.75;
  const scored = [];
  for (const d of docs) {
    let score = 0;
    for (const t of qTokens) {
      const f = d.bag.get(t) || 0;
      if (!f) continue;
      const n = df.get(t) || 0;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      const denom = f + k1 * (1 - b + b * (d.len / avgLen));
      score += idf * ((f * (k1 + 1)) / denom);
    }
    if (score > 0) scored.push({ i: d.i, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k).map((s) => ({ chunk: chunks[s.i], score: s.score, via: "bm25" }));
}

export function exactHits(chunks, query) {
  const { symbols, paths } = extractQueryTerms(query);
  const q = query.toLowerCase();
  const hits = [];
  for (const c of chunks) {
    let score = 0;
    const reasons = [];
    const sym = c.symbol || "";
    const exact = symbols.some((s) => {
      const a = s.toLowerCase();
      const b = sym.toLowerCase();
      return b === a || b.endsWith("." + a);
    });
    if (exact && sym.length >= 4) {
      const matched = symbols.find((s) => {
        const a = s.toLowerCase();
        const b = sym.toLowerCase();
        return b === a || b.endsWith("." + a);
      });
      const n = matched?.length || sym.length;
      score += n >= 10 || /[a-z][A-Z]/.test(matched || "") ? 80 : n >= 6 ? 55 : 28;
      reasons.push("exact-symbol");
    }
    if (c.path && paths.some((p) => c.path.endsWith(p) || c.path.includes(p))) {
      score += 60;
      reasons.push("exact-path");
    }
    if (
      c.type === "symbol" &&
      sym.length >= 6 &&
      wholeWordIn(query, sym)
    ) {
      score += 40;
      reasons.push("symbol-substr");
    }
    if (c.path && q.includes(c.path.toLowerCase())) {
      score += 30;
      reasons.push("path-substr");
    }
    if (score) hits.push({ chunk: c, score, via: reasons.join("+") });
  }
  hits.sort((a, b) => b.score - a.score);
  return hits;
}
