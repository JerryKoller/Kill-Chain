import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { evalDir } from "../paths.mjs";
import { loadChunks } from "../retrieve/index.mjs";
import { hybridSearch } from "../retrieve/hybrid.mjs";
import { contextPack } from "../retrieve/pack.mjs";
import { EVAL_CASES } from "./cases.mjs";
import { ollamaChat, ollamaTags, SYSTEM_PROMPT } from "./ollama.mjs";
import { mean, recall, scoreResponse, filesIn } from "./score.mjs";

const TIMER_PROBE_QUERY = "Where are Mission State poll and settle timers cleared?";
const TIMER_PROBE_SYMBOL = "stopMissionState";

function knownPathSet(chunks) {
  const s = new Set();
  for (const c of chunks) {
    if (!c.path) continue;
    const p = String(c.path).replace(/\\/g, "/");
    s.add(p.toLowerCase());
    const i = p.toLowerCase().lastIndexOf("src/");
    if (i >= 0) s.add(p.toLowerCase().slice(i));
    const d = p.toLowerCase().lastIndexOf("docs/");
    if (d >= 0) s.add(p.toLowerCase().slice(d));
    const sc = p.toLowerCase().lastIndexOf("scripts/");
    if (sc >= 0) s.add(p.toLowerCase().slice(sc));
  }
  s.add("package.json");
  s.add("agents.md");
  return s;
}

function packProvenance(pack) {
  return (pack.chunks || []).map((c) => ({
    id: c.id,
    type: c.type,
    path: c.path,
    symbol: c.symbol,
    via: c.via,
    score: c.score,
    lineStart: c.lineStart,
    lineEnd: c.lineEnd,
  }));
}

function leakageInPack(c, markdown) {
  const hits = (c.leakage_phrases || []).filter((p) => markdown.includes(p));
  return hits;
}

function retrievalRecall(c, pack) {
  const md = pack.markdown || "";
  const foundFiles = filesIn(md).concat((pack.chunks || []).map((x) => x.path).filter(Boolean));
  const foundSymbols = (pack.chunks || []).map((x) => x.symbol).filter(Boolean).concat(
    (c.gold_symbols || []).filter((s) => md.includes(s)),
  );
  return {
    file_recall: recall(c.gold_files, foundFiles),
    symbol_recall: recall(c.gold_symbols, foundSymbols),
    invariant_recall: recall(c.gold_invariants, c.gold_invariants.filter((s) => md.toLowerCase().includes(String(s).toLowerCase()))),
  };
}

async function probeTimerRank(log) {
  const modes = ["lexical", "lexical-graph", "full"];
  const out = [];
  for (const mode of modes) {
    const res = await hybridSearch(TIMER_PROBE_QUERY, { k: 24, mode });
    const idx = res.hits.findIndex((h) =>
      h.chunk.symbol === TIMER_PROBE_SYMBOL || (h.chunk.id || "").includes("stopMissionState"),
    );
    const hit = idx >= 0 ? res.hits[idx] : null;
    out.push({
      mode,
      rank: idx >= 0 ? idx + 1 : null,
      score: hit?.score ?? null,
      via: hit?.via ?? null,
      id: hit?.chunk?.id ?? null,
      top5: res.hits.slice(0, 5).map((h) => ({
        id: h.chunk.id,
        symbol: h.chunk.symbol,
        type: h.chunk.type,
        score: h.score,
        via: h.via,
      })),
    });
    log(`  timer-probe [${mode}] stopMissionState rank=${idx >= 0 ? idx + 1 : "absent"}`);
  }
  return { query: TIMER_PROBE_QUERY, targetSymbol: TIMER_PROBE_SYMBOL, modes: out };
}

function userPromptStock(prompt) {
  return prompt;
}

function userPromptRag(prompt, packMarkdown) {
  return `${packMarkdown}\n\n---\n\nTask:\n${prompt}`;
}

function aggregate(rows, arm) {
  const pick = (fn) => mean(rows, (r) => fn(r[arm]?.score || {}));
  return {
    n: rows.length,
    factual_accuracy: pick((s) => s.factual_accuracy),
    file_recall: pick((s) => s.file_recall?.score),
    symbol_recall: pick((s) => s.symbol_recall?.score),
    invariant_compliance: pick((s) => s.invariant_compliance),
    hallucination_rate: pick((s) => s.hallucination_rate),
    unsafe_change_rate: pick((s) => s.unsafe_change_rate),
    correct_validation_selection: pick((s) => s.validation_selection?.score),
    minimal_fix_quality: pick((s) => s.minimal_fix_quality),
    overall: pick((s) => s.overall),
  };
}

function byCategory(rows, arm) {
  const map = new Map();
  for (const r of rows) {
    const cat = r.category;
    if (!map.has(cat)) map.set(cat, []);
    map.get(cat).push(r);
  }
  const out = {};
  for (const [cat, list] of map) {
    out[cat] = {
      n: list.length,
      stock: mean(list, (r) => r.stock.score.overall),
      rag: mean(list, (r) => r.rag.score.overall),
      delta: null,
    };
    if (out[cat].stock != null && out[cat].rag != null) {
      out[cat].delta = Number((out[cat].rag - out[cat].stock).toFixed(4));
    }
  }
  return out;
}

function examples(rows, pred, limit = 3) {
  return rows.filter(pred).slice(0, limit).map((r) => ({
    id: r.id,
    category: r.category,
    prompt: r.prompt,
    stock_overall: r.stock.score.overall,
    rag_overall: r.rag.score.overall,
    delta: Number((r.rag.score.overall - r.stock.score.overall).toFixed(4)),
    stock_failure: r.stock.score.failure_class,
    rag_failure: r.rag.score.failure_class,
    stock_preview: (r.stock.response || "").slice(0, 400),
    rag_preview: (r.rag.response || "").slice(0, 400),
  }));
}

function recommendFineTune(stock, rag, rows) {
  const delta = (rag.overall ?? 0) - (stock.overall ?? 0);
  const remaining = [];
  const ragFails = rows.filter((r) => (r.rag.score.overall ?? 0) < 0.7);
  const classes = {};
  for (const r of ragFails) {
    const k = r.rag.score.failure_class || "other";
    classes[k] = (classes[k] || 0) + 1;
  }
  if ((rag.hallucination_rate ?? 0) > 0.15) remaining.push("still cites non-existent files/symbols even with retrieved context");
  if ((rag.unsafe_change_rate ?? 0) > 0.15) remaining.push("still implements DSP/routing changes that AGENTS.md forbids");
  if (rows.filter((r) => r.category === "minimal-diff" && (r.rag.score.minimal_fix_quality ?? 1) < 0.7).length) {
    remaining.push("over-scoped patches when a one-catch persist fix is enough");
  }
  if (rows.filter((r) => r.kind === "debug" && (r.rag.score.overall ?? 0) < 0.65).length >= 2) {
    remaining.push("debug protocol: competing hypothesis, disproof, and smallest fix after context is present");
  }
  if (rows.filter((r) => r.rag.score.claimed_tests_passed).length) {
    remaining.push("must not claim typecheck/smoke passed without running them");
  }
  const retrievalStillWeak = rows.filter((r) =>
    (r.retrieval_full?.symbol_recall?.score ?? 1) < 0.5 || (r.retrieval_full?.file_recall?.score ?? 1) < 0.5,
  );
  if (retrievalStillWeak.length) {
    remaining.push("retrieval misses (fine-tune will not fix missing files/symbols in the pack)");
  }

  const ragHelpsEnough = delta >= 0.12 && (rag.overall ?? 0) >= 0.8;
  const residualBehavior = remaining.filter((x) => !x.startsWith("retrieval misses"));
  let recommend = false;
  let rationale = "";
  if ((rag.unsafe_change_rate ?? 0) > 0.1 || (rag.hallucination_rate ?? 0) > 0.15) {
    recommend = true;
    rationale = "RAG still leaves unsafe-change or hallucination rates high enough that protocol SFT could help.";
  } else if (ragHelpsEnough && residualBehavior.length <= 2) {
    recommend = false;
    rationale = "Retrieval already supplies Kill Chain identity, invariants, and most refusals. Remaining misses are mostly novel debug under incomplete excerpts or planted-cause traps — optional later SFT, not a prerequisite.";
  } else if (!ragHelpsEnough && (stock.overall ?? 0) < 0.55) {
    recommend = true;
    rationale = "RAG does not close the gap. A small SFT pass on protocol traces (investigate → files → competing hypothesis → smallest fix → validation) may help if retrieval is already returning the right chunks.";
  } else if (residualBehavior.length) {
    recommend = false;
    rationale = "RAG is the main win. Residual behavioral misses exist but are too few to justify training before another retrieval/packing pass.";
  } else {
    recommend = false;
    rationale = "Gains from RAG are sufficient; do not fine-tune until a new behavioral gap is measured.";
  }
  return { recommend, rationale, remaining_weaknesses: remaining, rag_minus_stock: Number(delta.toFixed(4)), rag_fail_classes: classes };
}

function renderReport(doc) {
  const s = doc.aggregates.stock;
  const r = doc.aggregates.rag;
  const rec = doc.fine_tune;
  const catLines = Object.entries(doc.by_category).map(([k, v]) =>
    `- ${k}: stock ${v.stock} → RAG ${v.rag} (Δ ${v.delta >= 0 ? "+" : ""}${v.delta}) n=${v.n}`,
  );
  const helped = doc.examples.rag_helped.map((e) =>
    `- ${e.id} (Δ ${e.delta >= 0 ? "+" : ""}${e.delta}): ${e.prompt.slice(0, 140)}`,
  );
  const hurt = doc.examples.rag_hurt.map((e) =>
    `- ${e.id} (Δ ${e.delta}): ${e.prompt.slice(0, 140)}`,
  );
  const weak = (doc.retrieval_weaknesses || []).map((w) => `- ${w}`);
  return [
    "# Kill Chain Phase 2 — stock Qwen 3.5 9B vs Qwen + retrieval",
    "",
    `Model: ${doc.model}`,
    `Cases: ${doc.n}`,
    `Corpus git: ${doc.gitCommit || "unknown"}`,
    `Settings: temperature=${doc.settings.temperature} seed=${doc.settings.seed} think=false`,
    "",
    "## 1. Stock Qwen score",
    "",
    `- overall: **${s.overall}**`,
    `- factual accuracy: ${s.factual_accuracy}`,
    `- file recall: ${s.file_recall}`,
    `- symbol recall: ${s.symbol_recall}`,
    `- invariant compliance: ${s.invariant_compliance}`,
    `- hallucination rate: ${s.hallucination_rate}`,
    `- unsafe-change rate: ${s.unsafe_change_rate}`,
    `- validation selection: ${s.correct_validation_selection}`,
    `- minimal-fix quality: ${s.minimal_fix_quality}`,
    "",
    "## 2. Qwen + RAG score",
    "",
    `- overall: **${r.overall}**`,
    `- factual accuracy: ${r.factual_accuracy}`,
    `- file recall: ${r.file_recall}`,
    `- symbol recall: ${r.symbol_recall}`,
    `- invariant compliance: ${r.invariant_compliance}`,
    `- hallucination rate: ${r.hallucination_rate}`,
    `- unsafe-change rate: ${r.unsafe_change_rate}`,
    `- validation selection: ${r.correct_validation_selection}`,
    `- minimal-fix quality: ${r.minimal_fix_quality}`,
    "",
    "## 3. Improvement by category",
    "",
    ...catLines,
    "",
    "## 4. Hallucination comparison",
    "",
    `Stock hallucination rate ${s.hallucination_rate} vs RAG ${r.hallucination_rate}.`,
    "",
    "## 5. Examples where RAG dramatically helped",
    "",
    ...(helped.length ? helped : ["- (none with Δ ≥ 0.2)"]),
    "",
    "## 6. Examples where RAG hurt",
    "",
    ...(hurt.length ? hurt : ["- (none with Δ ≤ -0.08)"]),
    "",
    "## 7. Retrieval weaknesses",
    "",
    `Timer-cleanup probe query: "${doc.timer_probe.query}"`,
    ...doc.timer_probe.modes.map((m) =>
      `- ${m.mode}: ${doc.timer_probe.targetSymbol} rank ${m.rank ?? "absent"} (${(m.via || []).join?.(", ") || m.via || ""})`,
    ),
    "",
    "Ablations (generation overall is the 5 overlapping A/B cases):",
    ...Object.entries(doc.ablation || {}).map(([mode, a]) =>
      `- ${mode}: retrieval file=${a.file_recall} symbol=${a.symbol_recall} (n=${a.n_retrieval}); generation overall=${a.generation_overall} (n=${a.n_generation})`,
    ),
    "",
    ...weak,
    "",
    "## 8. Fine-tune recommendation",
    "",
    rec.recommend ? "**Yes, a later fine-tune is justified.**" : "**No fine-tune yet.**",
    "",
    rec.rationale,
    "",
    "## 9. If fine-tuning: remaining behavioral targets",
    "",
    rec.remaining_weaknesses.length
      ? rec.remaining_weaknesses.map((x) => `- ${x}`).join("\n")
      : "- None that a LoRA should target before retrieval is stronger.",
    "",
    "No training was run. No production Kill Chain files were modified. Results are under gitignored `tools/killchain-ai/data/eval/phase2/`.",
    "",
  ].join("\n");
}

export async function runPhase2({
  log = console.log,
  model = "qwen3.5:9b",
  limit = 0,
  ids = null,
  skipGenerate = false,
} = {}) {
  const { chunks, manifest } = loadChunks();
  const knownPaths = knownPathSet(chunks);
  const outDir = join(evalDir, "phase2");
  mkdirSync(outDir, { recursive: true });

  let cases = EVAL_CASES;
  if (ids?.length) cases = cases.filter((c) => ids.includes(c.id));
  if (limit > 0) cases = cases.slice(0, limit);

  log(`Phase 2 A/B  model=${model}  cases=${cases.length}  generate=${!skipGenerate}`);
  if (!skipGenerate) {
    const tags = await ollamaTags();
    const names = (tags.models || []).map((m) => m.name || m.model);
    if (!names.some((n) => n === model || n.startsWith(model))) {
      throw new Error(`Ollama does not list ${model}. Installed: ${names.join(", ")}`);
    }
  }

  log("Retrieval ranking probe (timer-cleanup wording)…");
  const timerProbe = await probeTimerRank(log);

  const rows = [];
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    log(`\n[${i + 1}/${cases.length}] ${c.id}`);
    const packFull = await contextPack(c.prompt, { budget: 7000, k: 24, mode: "full" });
    const leak = leakageInPack(c, packFull.markdown || "");
    if (leak.length) log(`  LEAKAGE in pack: ${leak.join(" | ")}`);

    const retrieval = {
      full: retrievalRecall(c, packFull),
    };
    const ablationPacks = {};
    if (c.ablate) {
      for (const mode of ["lexical", "lexical-graph"]) {
        const p = await contextPack(c.prompt, { budget: 7000, k: 24, mode });
        ablationPacks[mode] = {
          provenance: packProvenance(p),
          recall: retrievalRecall(c, p),
          chunk_ids: (p.chunks || []).map((x) => x.id),
        };
      }
    }

    const row = {
      id: c.id,
      category: c.category,
      dimension: c.dimension,
      kind: c.kind,
      novel: Boolean(c.novel),
      ablate: Boolean(c.ablate),
      prompt: c.prompt,
      expected_facts: c.expected_facts,
      scoring_rubric: c.scoring_rubric,
      gold_files: c.gold_files,
      gold_symbols: c.gold_symbols,
      gold_invariants: c.gold_invariants,
      retrieval_full: retrieval.full,
      retrieved_context: packProvenance(packFull),
      leakage_in_pack: leak,
      stock: { response: null, score: null, error: null },
      rag: { response: null, score: null, error: null, pack_tokens: packFull.tokenEstimate },
      ablation_retrieval: ablationPacks,
      ablation_generation: {},
    };

    if (!skipGenerate) {
      try {
        const stock = await ollamaChat({ model, system: SYSTEM_PROMPT, user: userPromptStock(c.prompt) });
        row.stock.response = stock.text;
        row.stock.meta = { endpoint: stock.endpoint, evalCount: stock.evalCount, ms: stock.totalDurationNs ? stock.totalDurationNs / 1e6 : null };
        row.stock.score = scoreResponse(c, stock.text, { knownPaths });
        log(`  STOCK overall=${row.stock.score.overall} fail=${row.stock.score.failure_class}`);
      } catch (err) {
        row.stock.error = err instanceof Error ? err.message : String(err);
        log(`  STOCK ERROR ${row.stock.error}`);
      }
      try {
        const rag = await ollamaChat({ model, system: SYSTEM_PROMPT, user: userPromptRag(c.prompt, packFull.markdown) });
        row.rag.response = rag.text;
        row.rag.meta = { endpoint: rag.endpoint, evalCount: rag.evalCount, ms: rag.totalDurationNs ? rag.totalDurationNs / 1e6 : null };
        row.rag.score = scoreResponse(c, rag.text, { knownPaths });
        log(`  RAG   overall=${row.rag.score.overall} fail=${row.rag.score.failure_class} chunks=${packFull.chunkCount}`);
      } catch (err) {
        row.rag.error = err instanceof Error ? err.message : String(err);
        log(`  RAG ERROR ${row.rag.error}`);
      }
      if (c.ablate && row.rag.response != null) {
        for (const mode of ["lexical", "lexical-graph"]) {
          try {
            const p = await contextPack(c.prompt, { budget: 7000, k: 24, mode });
            const gen = await ollamaChat({ model, system: SYSTEM_PROMPT, user: userPromptRag(c.prompt, p.markdown) });
            row.ablation_generation[mode] = {
              score: scoreResponse(c, gen.text, { knownPaths }),
              preview: gen.text.slice(0, 500),
              chunk_ids: (p.chunks || []).map((x) => x.id),
            };
            log(`  ABLATE ${mode} overall=${row.ablation_generation[mode].score.overall}`);
          } catch (err) {
            row.ablation_generation[mode] = { error: err instanceof Error ? err.message : String(err) };
          }
        }
      }
    }

    rows.push(row);
    writeFileSync(join(outDir, "ab.partial.json"), JSON.stringify({ rows }, null, 2), "utf8");
  }

  const scored = rows.filter((r) => r.stock.score && r.rag.score);
  const aggregates = {
    stock: aggregate(scored, "stock"),
    rag: aggregate(scored, "rag"),
  };
  const category = byCategory(scored, "rag");
  const helped = examples(
    scored.filter((r) => r.rag.score.overall - r.stock.score.overall >= 0.2)
      .sort((a, b) => (b.rag.score.overall - b.stock.score.overall) - (a.rag.score.overall - a.stock.score.overall)),
    () => true,
    4,
  );
  const hurt = examples(
    scored.filter((r) => r.rag.score.overall - r.stock.score.overall <= -0.08)
      .sort((a, b) => (a.rag.score.overall - a.stock.score.overall) - (b.rag.score.overall - b.stock.score.overall)),
    () => true,
    4,
  );

  const retrievalWeaknesses = [];
  for (const r of rows) {
    const fr = r.retrieval_full?.file_recall;
    const sr = r.retrieval_full?.symbol_recall;
    if ((fr?.score != null && fr.score < 0.5) || (sr?.score != null && sr.score < 0.5)) {
      retrievalWeaknesses.push(`${r.id}: pack file_recall=${fr?.score} symbol_recall=${sr?.score} missing files=${(fr?.missing || []).join(",")} symbols=${(sr?.missing || []).join(",")}`);
    }
  }
  const timerFull = timerProbe.modes.find((m) => m.mode === "full");
  if (!timerFull?.rank || timerFull.rank > 8) {
    retrievalWeaknesses.push(`timer-cleanup wording still ranks ${TIMER_PROBE_SYMBOL} at ${timerFull?.rank ?? "absent"} in full pack search`);
  }

  const fineTune = recommendFineTune(aggregates.stock, aggregates.rag, scored);

  const ablationSummary = {};
  for (const mode of ["lexical", "lexical-graph", "full"]) {
    const fileScores = [];
    const symbolScores = [];
    const genScores = [];
    for (const r of rows) {
      if (mode === "full") {
        if (r.retrieval_full?.file_recall?.score != null) fileScores.push(r.retrieval_full.file_recall.score);
        if (r.retrieval_full?.symbol_recall?.score != null) symbolScores.push(r.retrieval_full.symbol_recall.score);
        if (r.rag.score?.overall != null && r.ablate) genScores.push(r.rag.score.overall);
      } else if (r.ablation_retrieval[mode]) {
        const rec = r.ablation_retrieval[mode].recall;
        if (rec.file_recall?.score != null) fileScores.push(rec.file_recall.score);
        if (rec.symbol_recall?.score != null) symbolScores.push(rec.symbol_recall.score);
        if (r.ablation_generation[mode]?.score?.overall != null) genScores.push(r.ablation_generation[mode].score.overall);
      }
    }
    const avg = (xs) => xs.length ? Number((xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(4)) : null;
    ablationSummary[mode] = {
      n_retrieval: fileScores.length,
      file_recall: avg(fileScores),
      symbol_recall: avg(symbolScores),
      n_generation: genScores.length,
      generation_overall: avg(genScores),
    };
  }

  const doc = {
    phase: 2,
    model,
    n: scored.length,
    n_attempted: rows.length,
    gitCommit: manifest?.gitCommit,
    settings: { temperature: 0, seed: 7, think: false, num_ctx: 16384 },
    system_prompt: SYSTEM_PROMPT,
    timer_probe: timerProbe,
    aggregates,
    by_category: category,
    ablation: ablationSummary,
    examples: { rag_helped: helped, rag_hurt: hurt },
    retrieval_weaknesses: retrievalWeaknesses,
    fine_tune: fineTune,
    rows,
  };

  writeFileSync(join(outDir, "ab.json"), JSON.stringify(doc, null, 2), "utf8");
  writeFileSync(join(outDir, "ablations.json"), JSON.stringify({ timer_probe: timerProbe, ablation: ablationSummary, cases: rows.filter((r) => r.ablation_retrieval && Object.keys(r.ablation_retrieval).length) }, null, 2), "utf8");
  const report = renderReport(doc);
  writeFileSync(join(outDir, "REPORT.md"), report, "utf8");
  log(`\nWrote ${join(outDir, "REPORT.md")}`);
  log(`Stock overall ${aggregates.stock.overall}  RAG overall ${aggregates.rag.overall}`);
  return doc;
}

function rebuildAggregates(doc, knownPaths) {
  const byId = new Map(EVAL_CASES.map((c) => [c.id, c]));
  for (const row of doc.rows) {
    const c = byId.get(row.id);
    if (!c) continue;
    if (row.stock?.response) row.stock.score = scoreResponse(c, row.stock.response, { knownPaths });
    if (row.rag?.response) row.rag.score = scoreResponse(c, row.rag.response, { knownPaths });
    for (const [mode, gen] of Object.entries(row.ablation_generation || {})) {
      if (gen?.preview && !gen.response && gen.score) {
        /* preview-only; leave unless we stored full text */
      }
      if (gen?.response) gen.score = scoreResponse(c, gen.response, { knownPaths });
    }
  }
  const scored = doc.rows.filter((r) => r.stock?.score && r.rag?.score);
  doc.aggregates = {
    stock: aggregate(scored, "stock"),
    rag: aggregate(scored, "rag"),
  };
  doc.by_category = byCategory(scored, "rag");
  doc.examples = {
    rag_helped: examples(
      scored.filter((r) => r.rag.score.overall - r.stock.score.overall >= 0.2)
        .sort((a, b) => (b.rag.score.overall - b.stock.score.overall) - (a.rag.score.overall - a.stock.score.overall)),
      () => true,
      4,
    ),
    rag_hurt: examples(
      scored.filter((r) => r.rag.score.overall - r.stock.score.overall <= -0.08)
        .sort((a, b) => (a.rag.score.overall - a.stock.score.overall) - (b.rag.score.overall - b.stock.score.overall)),
      () => true,
      4,
    ),
  };
  doc.fine_tune = recommendFineTune(doc.aggregates.stock, doc.aggregates.rag, scored);
  doc.n = scored.length;
  if (doc.ablation) {
    const fileScores = [];
    const symbolScores = [];
    const genScores = [];
    for (const r of doc.rows) {
      if (r.retrieval_full?.file_recall?.score != null) fileScores.push(r.retrieval_full.file_recall.score);
      if (r.retrieval_full?.symbol_recall?.score != null) symbolScores.push(r.retrieval_full.symbol_recall.score);
      if (r.ablate && r.rag.score?.overall != null) genScores.push(r.rag.score.overall);
    }
    const avg = (xs) => xs.length ? Number((xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(4)) : null;
    if (doc.ablation.full) {
      doc.ablation.full.generation_overall = avg(genScores);
      doc.ablation.full.n_generation = genScores.length;
    }
  }
  return doc;
}

export async function rescorePhase2({ log = console.log } = {}) {
  const { readFileSync } = await import("node:fs");
  const { chunks } = loadChunks();
  const knownPaths = knownPathSet(chunks);
  const outDir = join(evalDir, "phase2");
  const p = join(outDir, "ab.json");
  const doc = JSON.parse(readFileSync(p, "utf8"));
  rebuildAggregates(doc, knownPaths);
  writeFileSync(p, JSON.stringify(doc, null, 2), "utf8");
  writeFileSync(join(outDir, "REPORT.md"), renderReport(doc), "utf8");
  log(`Re-scored ${doc.n} cases. Stock ${doc.aggregates.stock.overall}  RAG ${doc.aggregates.rag.overall}`);
  log(`Wrote ${join(outDir, "REPORT.md")}`);
  return doc;
}
