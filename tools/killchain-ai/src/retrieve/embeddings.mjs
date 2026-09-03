import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { indexDir } from "../paths.mjs";

const OLLAMA = process.env.OLLAMA_HOST || "http://127.0.0.1:11434";
const MODEL = process.env.KILLCHAIN_EMBED_MODEL || "nomic-embed-text";

async function embedOne(text) {
  const res = await fetch(`${OLLAMA}/api/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, prompt: text.slice(0, 4000) }),
  });
  if (!res.ok) throw new Error(`Ollama embeddings ${res.status}`);
  const json = await res.json();
  return json.embedding;
}

export async function embedCorpus(chunks, { log = console.log } = {}) {
  mkdirSync(indexDir, { recursive: true });
  const prefer = chunks.filter((c) =>
    ["constitution", "invariant", "architecture", "danger", "ownership", "validation"].includes(c.type),
  );
  log(`Embedding ${prefer.length} high-value chunks via ${MODEL} at ${OLLAMA} (optional)…`);
  const vectors = {};
  let ok = 0;
  try {
    for (const c of prefer) {
      vectors[c.id] = await embedOne(`${c.title}\n${c.text}`);
      ok++;
    }
  } catch (err) {
    log(`Embeddings unavailable (${err instanceof Error ? err.message : err}). Retrieval still works without them.`);
    return null;
  }
  const payload = { model: MODEL, count: ok, vectors };
  writeFileSync(join(indexDir, "embeddings.json"), JSON.stringify(payload), "utf8");
  log(`Wrote ${ok} embeddings`);
  return payload;
}

export function cosine(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

export async function semanticSearch(chunks, query, embedStore, k = 8) {
  if (!embedStore?.vectors) return [];
  let qv;
  try {
    qv = await embedOne(query);
  } catch {
    return [];
  }
  const scored = [];
  for (const c of chunks) {
    const v = embedStore.vectors[c.id];
    if (!v) continue;
    scored.push({ chunk: c, score: cosine(qv, v) * 20, via: "embed" });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}
