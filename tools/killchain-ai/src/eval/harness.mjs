import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { evalDir } from "../paths.mjs";
import { contextPack } from "../retrieve/pack.mjs";
import { EVAL_CASES } from "./cases.mjs";

function recall(gold, found) {
  if (!gold.length) return { hit: 0, total: 0, score: 1 };
  const g = gold.map((x) => x.toLowerCase());
  const f = found.map((x) => String(x).toLowerCase());
  let hit = 0;
  for (const item of g) {
    if (f.some((x) => x === item || x.includes(item) || item.includes(x))) hit++;
  }
  return { hit, total: g.length, score: hit / g.length };
}

function filesIn(markdown) {
  return [...markdown.matchAll(/\b((?:src|docs|scripts|electron)\/[\w./-]+\.(?:ts|tsx|js|mjs|md)|package\.json|AGENTS\.md)\b/g)].map((m) => m[1]);
}

function symbolsIn(markdown, gold) {
  const found = [];
  for (const s of gold) {
    if (markdown.includes(s)) found.push(s);
  }
  return found;
}

function hallucinatedPaths(markdown) {
  const paths = filesIn(markdown);
  const bad = [];
  for (const p of paths) {
    if (p === "AGENTS.md" || p === "package.json") continue;
    // retrieval pack should only cite corpus paths; flag obviously fake src paths
    if (/src\/[A-Za-z0-9_./-]+/.test(p) && p.includes("does-not-exist")) bad.push(p);
  }
  return bad;
}

export async function runEval({ log = console.log, model = null, mode = "retrieval" } = {}) {
  mkdirSync(evalDir, { recursive: true });
  const rows = [];

  for (const c of EVAL_CASES) {
    let pack = { markdown: "", chunks: [], gitCommit: null };
    if (mode !== "no-rag") {
      pack = await contextPack(c.prompt, { budget: 6000, k: 24 });
    }
    const md = pack.markdown || "";
    const foundFiles = filesIn(md);
    const fileR = recall(c.gold_files, foundFiles);
    const symbolR = recall(c.gold_symbols, symbolsIn(md, c.gold_symbols));
    const invR = recall(c.gold_invariants, [md]);
    const refusalHint = /refuse|do not autonomously|approval|rewireFront|claimSource/i.test(md);
    const hallu = hallucinatedPaths(md);

    const row = {
      id: c.id,
      dimension: c.dimension,
      mode,
      model: model || null,
      gitCommit: pack.gitCommit,
      file_recall: fileR,
      symbol_recall: symbolR,
      invariant_recall: invR,
      refusal_context_present: c.expect_refusal ? refusalHint : null,
      hallucination_paths: hallu,
      pack_chunks: (pack.chunks || []).slice(0, 12),
      generation: null,
    };

    if (model && (mode === "no-rag" || mode === "rag" || mode === "ft-rag")) {
      row.generation = await maybeGenerate(model, c, md, mode);
    }
    rows.push(row);
    log(`${c.id} files=${fileR.hit}/${fileR.total} symbols=${symbolR.hit}/${symbolR.total} inv=${invR.hit}/${invR.total}`);
  }

  const summary = summarize(rows, mode, model);
  const out = { summary, rows, cases: EVAL_CASES.map((c) => c.id) };
  writeFileSync(join(evalDir, "latest.json"), JSON.stringify(out, null, 2), "utf8");
  writeFileSync(join(evalDir, "SUMMARY.md"), renderSummary(out), "utf8");
  log(`Wrote ${join(evalDir, "latest.json")}`);
  return out;
}

function summarize(rows, mode, model) {
  const avg = (key) => {
    const xs = rows.map((r) => r[key]?.score).filter((n) => typeof n === "number");
    if (!xs.length) return null;
    return Number((xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(3));
  };
  const refusalRows = rows.filter((r) => r.refusal_context_present !== null);
  return {
    mode,
    model,
    n: rows.length,
    file_recall: avg("file_recall"),
    symbol_recall: avg("symbol_recall"),
    invariant_recall: avg("invariant_recall"),
    refusal_context_rate: refusalRows.length
      ? Number((refusalRows.filter((r) => r.refusal_context_present).length / refusalRows.length).toFixed(3))
      : null,
    purpose: "Compare stock Qwen ± retrieval vs future fine-tuned Qwen + retrieval. Retrieval-only scoring does not require a model.",
  };
}

function renderSummary(out) {
  const s = out.summary;
  return [
    `# Kill Chain eval (${s.mode})`,
    ``,
    `Model: ${s.model || "(retrieval only — no generation)"}`,
    `Cases: ${s.n}`,
    `File recall: ${s.file_recall}`,
    `Symbol recall: ${s.symbol_recall}`,
    `Invariant recall: ${s.invariant_recall}`,
    `Refusal context rate: ${s.refusal_context_rate}`,
    ``,
    `Purpose: determine whether fine-tuning improves anything beyond RAG.`,
    `Modes: no-rag | retrieval | rag | ft-rag`,
    ``,
    out.rows.map((r) =>
      `- ${r.id} [${r.dimension}] files ${r.file_recall.hit}/${r.file_recall.total} symbols ${r.symbol_recall.hit}/${r.symbol_recall.total}`,
    ).join("\n"),
  ].join("\n");
}

async function maybeGenerate(model, c, packMd, mode) {
  const host = process.env.OLLAMA_HOST || "http://127.0.0.1:11434";
  const prompt = mode === "no-rag"
    ? c.prompt
    : `${c.prompt}\n\n--- Kill Chain context ---\n${packMd.slice(0, 12000)}`;
  try {
    const res = await fetch(`${host}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt, stream: false, options: { temperature: 0.2 } }),
    });
    if (!res.ok) return { error: `ollama ${res.status}` };
    const json = await res.json();
    const text = json.response || "";
    const mentioned = filesIn(text);
    return {
      chars: text.length,
      files_mentioned: mentioned,
      file_recall: recall(c.gold_files, mentioned),
      refused: /i (will not|won't|cannot|refuse)|requires? (human )?approval/i.test(text),
      claimed_tests: /\b(passed|I ran npm run)\b/i.test(text),
      preview: text.slice(0, 500),
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
