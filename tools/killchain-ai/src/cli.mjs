#!/usr/bin/env node
/**
 * Kill Chain AI CLI (Windows-native Node). Isolated from the Electron app.
 *
 *   node tools/killchain-ai/src/cli.mjs <command>
 *   tools\killchain-ai\kc-ai.cmd <command>
 *   powershell -File tools\killchain-ai\kc-ai.ps1 <command>
 */
import { findAgentsMd, repoRoot, toolsRoot } from "./paths.mjs";
import { gitCapture } from "./git.mjs";

function parseArgs(argv) {
  const flags = {};
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") {
      pos.push(...argv.slice(i + 1));
      break;
    }
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) flags[key] = true;
      else {
        flags[key] = next;
        i++;
      }
    } else pos.push(a);
  }
  return { flags, pos };
}

function help() {
  console.log(`Kill Chain AI tooling — isolated under tools/killchain-ai

Usage:
  node tools/killchain-ai/src/cli.mjs <command> [args]
  .\\tools\\killchain-ai\\kc-ai.cmd <command> [args]

Corpus
  corpus [--embed]          Scan repo + AGENTS.md, write data/corpus

Retrieval (works without embeddings)
  search <query> [--k 12] [--mode full|lexical|lexical-graph]
  symbol <name>
  callers <name>
  callees <name>
  tests-for <name-or-path>
  invariants [query]
  context-pack <task> [--budget 8000] [--mode full|lexical|lexical-graph]
  mcp                       OpenCode MCP stdio server

SFT
  sft generate
  sft validate [--self-test]

Eval (holdout; no training)
  eval [--mode retrieval|no-rag|rag|ft-rag] [--model qwen3.5:9b]
  eval --ab [--model qwen3.5:9b] [--limit N] [--ids id1,id2]
  eval --ab --skip-generate   Retrieval ranking + packs only (no Ollama)

  status                    Paths, git, AGENTS.md

Does not train, download Unsloth, or modify the Kill Chain app.
`);
}

function printHits(res, k = 8) {
  const hits = (res.hits || []).slice(0, k);
  if (res.manifest?.gitCommit) console.log(`corpus git ${res.manifest.gitCommit}`);
  if (!hits.length && res.notice) console.log(res.notice);
  for (const h of hits) {
    const c = h.chunk;
    const loc = `${c.path}${c.lineStart ? `:${c.lineStart}-${c.lineEnd || c.lineStart}` : ""}`;
    console.log(`\n[${c.type}] ${c.symbol || ""}  ${loc}  (${h.via} ${typeof h.score === "number" ? h.score.toFixed(2) : ""})`);
    console.log((c.title || "").slice(0, 200));
    console.log((c.text || "").slice(0, 500).replace(/\s+/g, " "));
  }
  console.log(`\n${hits.length} hits`);
}

async function main() {
  const argv = process.argv.slice(2);
  if (!argv.length || argv[0] === "help" || argv[0] === "-h" || argv[0] === "--help") {
    help();
    return;
  }
  const cmd = argv[0];
  const { flags, pos } = parseArgs(argv.slice(1));
  const k = Number(flags.k || 12);

  if (cmd === "status") {
    const git = gitCapture();
    const agents = findAgentsMd();
    console.log(JSON.stringify({ repoRoot, toolsRoot, git, agents }, null, 2));
    return;
  }

  if (cmd === "corpus") {
    const { buildCorpus } = await import("./corpus/build.mjs");
    await buildCorpus({ embed: Boolean(flags.embed), log: console.log });
    return;
  }

  if (cmd === "mcp") {
    const { startMcpStdio } = await import("./retrieve/mcp.mjs");
    startMcpStdio();
    return;
  }

  if (cmd === "search") {
    const q = pos.join(" ").trim();
    if (!q) throw new Error("search requires a query");
    const { hybridSearch } = await import("./retrieve/hybrid.mjs");
    const searchOpts = { k, mode: flags.mode || "full" };
    if ("embed" in flags) searchOpts.embed = flags.embed !== "false";
    printHits(await hybridSearch(q, searchOpts), k);
    return;
  }

  if (cmd === "symbol") {
    const { symbolLookup } = await import("./retrieve/hybrid.mjs");
    printHits(symbolLookup(pos[0] || ""), k);
    return;
  }
  if (cmd === "callers") {
    const { callersOf } = await import("./retrieve/hybrid.mjs");
    printHits(callersOf(pos[0] || ""), 20);
    return;
  }
  if (cmd === "callees") {
    const { calleesOf } = await import("./retrieve/hybrid.mjs");
    printHits(calleesOf(pos[0] || ""), 20);
    return;
  }
  if (cmd === "tests-for") {
    const { testsFor } = await import("./retrieve/hybrid.mjs");
    printHits(testsFor(pos[0] || ""), 20);
    return;
  }
  if (cmd === "invariants") {
    const { invariants } = await import("./retrieve/hybrid.mjs");
    printHits(invariants(pos.join(" ")), 20);
    return;
  }
  if (cmd === "context-pack") {
    const task = pos.join(" ").trim();
    if (!task) throw new Error("context-pack requires a task string");
    const { contextPack } = await import("./retrieve/pack.mjs");
    const pack = await contextPack(task, { budget: Number(flags.budget || 8000), mode: flags.mode || "full" });
    console.log(pack.markdown);
    console.error(`# pack chunks=${pack.chunkCount} tokens~${pack.tokenEstimate} git=${pack.gitCommit}`);
    return;
  }

  if (cmd === "sft") {
    const sub = pos[0] || "generate";
    if (sub === "generate") {
      const { generateSft } = await import("./sft/generate.mjs");
      generateSft({ log: console.log });
      return;
    }
    if (sub === "validate") {
      const { validateRecords, badFixtures } = await import("./sft/validate.mjs");
      const { seedRecords } = await import("./sft/seeds.mjs");
      if (flags["self-test"]) {
        const bad = validateRecords(badFixtures());
        console.log("self-test bad fixtures (expect failures):", JSON.stringify(bad, null, 2));
        if (bad.failed !== bad.total) {
          throw new Error("self-test: expected all bad fixtures to fail");
        }
      }
      const good = validateRecords(seedRecords());
      console.log(`seeds: ${good.passed}/${good.total} passed`);
      for (const r of good.results) {
        if (!r.ok) console.log(" FAIL", r.id, r.errors);
        else if (r.warnings?.length) console.log(" WARN", r.id, r.warnings);
      }
      if (good.failed) process.exitCode = 1;
      return;
    }
    throw new Error("sft generate | sft validate [--self-test]");
  }

  if (cmd === "eval") {
    if (flags.ab) {
      const { runPhase2, rescorePhase2 } = await import("./eval/ab.mjs");
      if (flags.rescore) {
        await rescorePhase2({ log: console.log });
        return;
      }
      const ids = flags.ids ? String(flags.ids).split(",").map((s) => s.trim()).filter(Boolean) : null;
      await runPhase2({
        log: console.log,
        model: flags.model || "qwen3.5:9b",
        limit: Number(flags.limit || 0),
        ids,
        skipGenerate: Boolean(flags["skip-generate"]),
      });
      return;
    }
    const { runEval } = await import("./eval/harness.mjs");
    await runEval({
      log: console.log,
      mode: flags.mode || "retrieval",
      model: flags.model || null,
    });
    return;
  }

  help();
  throw new Error(`unknown command: ${cmd}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
