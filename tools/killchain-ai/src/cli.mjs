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

Mission runner (local Qwen / OpenCode; no app edits unless a mission allows them)
  mission create --template ui-feature --id <id>
  mission validate <file>
  mission run <file> [--dry-run] [--stop-after STATE] [--model ollama/qwen3.5:9b]
  mission resume <id> [--dry-run] [--model ...]
  mission status [id]
  mission resume <id> [--dry-run]
  mission report <id>
  mission test

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

  lightning-bench [--only all|smoke|jsx|empty|facts|ui]
  repair-bench [--attempts N] [--only baseline|assisted]
                              Fair Qwen vs Lightning OpenCode worker bench (fixtures only)

  ui capture-fire             Diagnostic Chrome: license, skip tour, Fire Command shot
  ui diagnose                 GPU on/off Vite screenshot probe
  ui fire-map                 Inventory Fire Command files vs inner FireCommandView panels
  ui metrics                  Assert saved Fire Command capture metrics (no Chrome unless --live)
  audio-lab scan              Static claimSource/rewireFront/persistence scan
  audio-lab                   Retrieval-grounded Qwen invariant notes (read-only)

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

  if (cmd === "mission") {
    const { missionMain } = await import("./mission/cli.mjs");
    await missionMain({ flags, pos, log: console.log });
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

  if (cmd === "ui") {
    const sub = pos[0] || "help";
    if (sub === "capture-fire") {
      const { captureFireCommand } = await import("./ui/screenshot.mjs");
      const r = await captureFireCommand({ url: flags.url || "http://127.0.0.1:5174/" });
      console.log(JSON.stringify({ ok: r.ok, dest: r.dest, bytes: r.bytes, stats: r.stats, opened: r.opened }, null, 2));
      if (!r.ok) process.exitCode = 1;
      return;
    }
    if (sub === "diagnose") {
      const { diagnoseViteScreenshot } = await import("./ui/screenshot.mjs");
      const r = await diagnoseViteScreenshot({ url: flags.url || "http://127.0.0.1:5174/" });
      console.log(JSON.stringify(r, null, 2));
      return;
    }
    if (sub === "fire-map") {
      const { writeFireCommandMap } = await import("./ui/scanFireCommand.mjs");
      const r = writeFireCommandMap();
      console.log(JSON.stringify({
        count: r.count,
        innerPanelsWithoutSiblingFile: r.innerPanelsWithoutSiblingFile,
        fireCommandViewLines: r.files.find((f) => f.name === "FireCommandView.tsx")?.lines,
      }, null, 2));
      return;
    }
    if (sub === "metrics") {
      const { screenshotDir } = await import("./ui/screenshot.mjs");
      const { captureMetricsToReport, defaultFireMetricAssertions, assertMetrics } = await import("./ui/metrics.mjs");
      const { join } = await import("node:path");
      const { existsSync, readFileSync, writeFileSync, mkdirSync } = await import("node:fs");
      const { dataDir } = await import("./paths.mjs");
      if (flags.live) {
        const { captureFireCommand } = await import("./ui/screenshot.mjs");
        await captureFireCommand({ url: flags.url || "http://127.0.0.1:5174/" });
      }
      const capPath = join(screenshotDir(), "fire-command-capture.json");
      if (!existsSync(capPath)) {
        console.log(JSON.stringify({ ok: false, error: "no fire-command-capture.json; run ui capture-fire or ui metrics --live" }));
        process.exitCode = 1;
        return;
      }
      const cap = JSON.parse(readFileSync(capPath, "utf8"));
      const width = cap.metrics?.viewport?.innerWidth || 1440;
      const report = captureMetricsToReport(cap.metrics, width);
      const asserted = assertMetrics(report, defaultFireMetricAssertions(width));
      const out = { ok: asserted.ok, failures: asserted.failures, href: cap.metrics?.href, dest: cap.dest, hasRhythm: cap.opened?.hasRhythm || false };
      mkdirSync(join(dataDir, "overnight"), { recursive: true });
      writeFileSync(join(dataDir, "overnight", "UI_METRICS.json"), `${JSON.stringify({ at: new Date().toISOString(), ...out, report }, null, 2)}\n`);
      console.log(JSON.stringify(out, null, 2));
      if (!asserted.ok) process.exitCode = 1;
      return;
    }
    throw new Error("ui capture-fire | ui diagnose | ui fire-map | ui metrics");
  }

  if (cmd === "audio-lab") {
    if (pos[0] === "scan") {
      const { writeOvernightScan } = await import("./audioLab/scanInvariants.mjs");
      console.log(JSON.stringify(writeOvernightScan(), null, 2));
      return;
    }
    const { runAudioLabQwen } = await import("./audioLab/runAudioLab.mjs");
    await runAudioLabQwen({ log: console.log });
    return;
  }

  if (cmd === "repair-drill") {
    const { runRepairDrill } = await import("./eval/repairDrill.mjs");
    await runRepairDrill({ log: console.log });
    return;
  }

  if (cmd === "overnight-metrics") {
    const { summarizeOvernightMissions } = await import("./eval/overnightMetrics.mjs");
    console.log(JSON.stringify(summarizeOvernightMissions(), null, 2));
    return;
  }

  if (cmd === "editing-evidence") {
    const { report } = await import("./eval/editingEvidence.mjs");
    report({ log: console.log });
    return;
  }

  if (cmd === "teacher-round") {
    const mod = await import("./eval/editCurriculum.mjs");
    const { DEFAULT_MISSION_MODEL } = await import("./mission/model.mjs");
    const level = Number(flags.level || 1);
    const tasks = mod.buildTasks().filter((t) => mod.TEACHER_LEVEL1[t.id]);
    const out = [];
    for (const t of tasks) {
      const r = await mod.runTeacherRound(t, { model: DEFAULT_MISSION_MODEL, timeoutMs: 240000, level });
      if (!r) continue;
      out.push(r);
      console.log(`${r.id.padEnd(24)} L${level} accepted=${r.accepted ? "PASS" : "fail"} valid=${r.mechanicallyValid ? "y" : "n"} diag=${r.diagnostics} empty=${r.emptyEdit} ${(r.ms / 1000).toFixed(0)}s`);
    }
    console.log(`\nteacher L${level}: ${out.filter((r) => r.accepted).length}/${out.length} rescued`);
    return;
  }

  if (cmd === "edit-curriculum") {
    const { runEditCurriculum } = await import("./eval/editCurriculum.mjs");
    const tiers = flags.tiers ? String(flags.tiers).split(",").map(Number) : null;
    const { summary } = await runEditCurriculum({
      tiers,
      hunks: Number(flags.hunks || 0),
      families: flags.families ? String(flags.families).split(",") : null,
      only: flags.only ? String(flags.only) : null,
      tutor: flags.tutor !== "false",
      assisted: flags.assisted !== "false",
      log: console.log,
    });
    console.log(`\n${JSON.stringify(summary, null, 2)}`);
    if (summary.productionDrift.length) process.exitCode = 1;
    return;
  }

  if (cmd === "critic-replay") {
    const { runCriticReplay } = await import("./eval/criticReplay.mjs");
    const { summary } = await runCriticReplay({ log: console.log });
    console.log(`\n${JSON.stringify(summary, null, 2)}`);
    return;
  }

  if (cmd === "repair-bench") {
    const { runRepairBench } = await import("./eval/repairBench.mjs");
    const attempts = Number(flags.attempts || 3);
    const rounds = Number(flags.rounds || 2);
    const arms = flags.only ? [String(flags.only)] : ["baseline", "assisted"];
    const report = await runRepairBench({ attempts, rounds, arms, log: console.log });
    console.log(JSON.stringify({
      at: report.at,
      model: report.model,
      summary: report.summary,
      productionDrift: report.productionDrift,
      reportMd: "tools/killchain-ai/data/overnight/repair-bench/REPORT.md",
    }, null, 2));
    if (report.productionDrift.length) process.exitCode = 1;
    return;
  }

  if (cmd === "lightning-bench") {
    const { runLightningBench } = await import("./eval/lightningBench.mjs");
    const only = String(flags.only || pos[0] || "all");
    const report = await runLightningBench({ log: console.log, only });
    console.log(JSON.stringify({
      at: report.at,
      only,
      productionTouched: report.productionTouched,
      smokeOk: report.smoke?.integrationOk ?? null,
      winner: report.scorecard?.winner ?? null,
      reportMd: "tools/killchain-ai/data/overnight/lightning-bench/REPORT.md",
    }, null, 2));
    if (report.productionTouched) process.exitCode = 1;
    return;
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
