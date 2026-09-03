import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { corpusDir, findAgentsMd, repoRel } from "../paths.mjs";
import { gitCapture } from "../git.mjs";
import { collectScanFiles } from "./walk.mjs";
import { parseTypeScriptProject } from "./parseTs.mjs";
import { parseMarkdownFile } from "./parseMd.mjs";
import { parseScriptFile, parsePackageJson } from "./parseScripts.mjs";
import { buildInvariantChunks, mdChunk } from "./invariants.mjs";
import { buildGraph, relSet, testList } from "./graph.mjs";
import {
  STORE_ENGINE_PAIRS,
  isDangerPath,
  subsystemFor,
} from "./subsystems.mjs";

function emptyRel() {
  return { imports: [], importedBy: [], calls: [], calledBy: [], tests: [] };
}

function writeJsonl(path, rows) {
  writeFileSync(path, rows.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
}

export async function buildCorpus({ embed = false, log = console.log } = {}) {
  const git = gitCapture();
  if (!git.commit) throw new Error("Unable to read git commit hash from the Kill Chain repo.");
  mkdirSync(corpusDir, { recursive: true });

  const agents = findAgentsMd();
  log(`AGENTS.md: ${agents ? `${agents.abs} (${agents.source})` : "MISSING"}`);
  log(`Git commit: ${git.commit}${git.dirty ? " (dirty worktree)" : ""}`);

  log("Parsing TypeScript…");
  const tsProj = parseTypeScriptProject();
  log(`  ${tsProj.files.length} files, ${tsProj.symbols.length} symbols, ${tsProj.callEdges.length} call edges`);

  const scan = collectScanFiles();
  const scriptFiles = scan.code
    .filter((f) => f.rel.startsWith("scripts/"))
    .map((f) => parseScriptFile(f.abs, f.rel));

  const graph = buildGraph({
    files: tsProj.files,
    symbols: tsProj.symbols,
    importEdges: tsProj.importEdges,
    callEdges: tsProj.callEdges,
    scriptFiles,
  });

  const archFile = scan.md.find((f) => f.rel === "docs/audio-state-machine.md");
  const perfFile = scan.md.find((f) => f.rel === "docs/performance.md");
  const archMd = archFile
    ? { ...parseMarkdownFile(archFile.abs, archFile.rel), path: archFile.rel }
    : null;
  const perfMd = perfFile
    ? { ...parseMarkdownFile(perfFile.abs, perfFile.rel), path: perfFile.rel }
    : null;
  if (archMd) archMd.sections.forEach((s) => { s.path = archFile.rel; });
  if (perfMd) perfMd.sections.forEach((s) => { s.path = perfFile.rel; });

  const inv = buildInvariantChunks(git.commit, archMd, perfMd);
  const chunks = [...inv.chunks];

  if (archMd) {
    for (const sec of archMd.sections) {
      chunks.push(mdChunk("architecture", "architecture", sec, git.commit, ["audio-state-machine"]));
    }
  }

  for (const md of scan.md) {
    if (md.rel === "docs/audio-state-machine.md" || md.rel === "docs/performance.md") continue;
    const parsed = parseMarkdownFile(md.abs, md.rel);
    for (const sec of parsed.sections) {
      chunks.push(mdChunk("architecture", subsystemFor(md.rel), { ...sec, path: md.rel }, git.commit));
    }
  }

  for (const f of tsProj.files) {
    const tests = testList(graph.testsForFile, f.path);
    chunks.push({
      id: `subsystem-file:${f.path}`,
      type: "subsystem",
      subsystem: f.subsystem,
      path: f.path,
      symbol: null,
      kind: "file",
      lineStart: 1,
      lineEnd: f.lineCount,
      title: `${f.subsystem} — ${f.path}`,
      text: [
        `File: ${f.path}`,
        `Subsystem: ${f.subsystem}`,
        `Danger (approval-gated DSP/product surface): ${f.danger}`,
        `Exports: ${f.exports.slice(0, 40).join(", ") || "(none extracted)"}`,
        `Imports: ${f.imports.map((i) => i.resolved || i.spec).slice(0, 30).join(", ")}`,
        f.header ? `\nHeader:\n${f.header}` : "",
        `\nProvenance: ${f.path} lines 1–${f.lineCount} @ ${git.commit}`,
      ].join("\n"),
      relationships: {
        imports: relSet(graph.imports, f.path),
        importedBy: relSet(graph.importedBy, f.path),
        calls: [],
        calledBy: [],
        tests,
      },
      gitCommit: git.commit,
      sources: [{ path: f.path, lineStart: 1, lineEnd: Math.min(40, f.lineCount) }],
      danger: f.danger,
      tags: [f.subsystem, "file"],
    });
  }

  for (const s of tsProj.symbols) {
    const calls = relSet(graph.callees, s.symbol);
    const calledBy = relSet(graph.callers, s.symbol);
    const tests = [
      ...testList(graph.testsForSymbol, s.symbol),
      ...testList(graph.testsForFile, s.path),
    ];
    chunks.push({
      id: `symbol:${s.path}:${s.symbol}:${s.lineStart}`,
      type: "symbol",
      subsystem: s.subsystem,
      path: s.path,
      symbol: s.symbol,
      kind: s.kind,
      lineStart: s.lineStart,
      lineEnd: s.lineEnd,
      title: `${s.kind} ${s.symbol} — ${s.path}:${s.lineStart}`,
      text: [
        `${s.exported ? "export " : ""}${s.kind} ${s.symbol}`,
        `File: ${s.path}:${s.lineStart}-${s.lineEnd}`,
        s.jsDoc ? `Docs:\n${s.jsDoc}` : "",
        "",
        s.text,
      ].join("\n"),
      relationships: {
        imports: s.fileImports || [],
        importedBy: relSet(graph.importedBy, s.path),
        calls,
        calledBy,
        tests: [...new Set(tests)],
      },
      gitCommit: git.commit,
      sources: [{ path: s.path, lineStart: s.lineStart, lineEnd: s.lineEnd }],
      danger: s.danger || isDangerPath(s.path),
      tags: [s.kind, s.symbol, s.subsystem],
    });
  }

  for (const pair of STORE_ENGINE_PAIRS) {
    chunks.push({
      id: `relation:store-engine:${pair.store}`,
      type: "relation",
      subsystem: "audio-state",
      path: pair.store,
      symbol: null,
      kind: "relation",
      lineStart: 1,
      lineEnd: 1,
      title: `Store ↔ engine — ${pair.store} / ${pair.engine}`,
      text: `State ownership pair (layout + known sync invariant):\nStore: ${pair.store}\nEngine: ${pair.engine}\nNotes: ${pair.note}\nInvariant: store writes and matching AudioEngine calls must occur in the same synchronous action (AGENTS.md).`,
      relationships: {
        imports: [pair.engine],
        importedBy: [],
        calls: [],
        calledBy: [],
        tests: ["scripts/smoke-page.js"],
      },
      gitCommit: git.commit,
      sources: [
        { path: pair.store, lineStart: 1, lineEnd: 1 },
        { path: pair.engine, lineStart: 1, lineEnd: 1 },
        { path: agents?.rel || "AGENTS.md", lineStart: 85, lineEnd: 86 },
      ],
      danger: false,
      tags: ["ownership", "store-engine"],
    });
  }

  chunks.push({
    id: "ownership:claimSource-callers",
    type: "ownership",
    subsystem: "ownership",
    path: "src/lib/sourceArbiter.ts",
    symbol: "claimSource",
    kind: "relation",
    lineStart: 75,
    lineEnd: 93,
    title: "Playback ownership — claimSource callers",
    text: [
      "claimSource is the single playback-ownership API (AGENTS.md invariant 2).",
      "Callers found in this corpus build:",
      ...relSet(graph.callers, "claimSource").map((c) => `- ${c}`),
      "File-level imports of sourceArbiter:",
      ...relSet(graph.importedBy, "src/lib/sourceArbiter.ts").map((c) => `- ${c}`),
    ].join("\n"),
    relationships: {
      imports: [],
      importedBy: relSet(graph.importedBy, "src/lib/sourceArbiter.ts"),
      calls: relSet(graph.callees, "claimSource"),
      calledBy: relSet(graph.callers, "claimSource"),
      tests: testList(graph.testsForSymbol, "claimSource"),
    },
    gitCommit: git.commit,
    sources: [{ path: "src/lib/sourceArbiter.ts", lineStart: 75, lineEnd: 93 }],
    danger: true,
    tags: ["claimSource", "ownership"],
  });

  chunks.push({
    id: "async:mission-settle",
    type: "async",
    subsystem: "mission-state",
    path: "src/state/missionStateStore.ts",
    symbol: "pollOnce",
    kind: "async",
    lineStart: 153,
    lineEnd: 344,
    title: "Mission State async settle / abort",
    text: "One 1.5s poll, one 2.5s settle window, one AbortController per pipeline run. Source change resets the timer and aborts the in-flight run. stopMissionState clears poll, settle, abort, and manual-watch subscriptions. Provenance: src/state/missionStateStore.ts and docs/audio-state-machine.md §4.",
    relationships: {
      imports: ["src/state/missionLogStore.ts", "src/lib/tractorAutoLock.ts"],
      importedBy: [],
      calls: ["runPipeline", "noteManualOverride", "stopMissionState"],
      calledBy: ["initMissionState"],
      tests: ["scripts/smoke-page.js"],
    },
    gitCommit: git.commit,
    sources: [
      { path: "src/state/missionStateStore.ts", lineStart: 153, lineEnd: 344 },
      { path: "docs/audio-state-machine.md", lineStart: 76, lineEnd: 107 },
    ],
    danger: true,
    tags: ["async", "AbortController", "settle"],
  });

  for (const script of scriptFiles) {
    if (script.tests.length) {
      for (const t of script.tests) {
        chunks.push({
          id: `test:${script.path}:${t.lineStart}`,
          type: "test",
          subsystem: "validation",
          path: script.path,
          symbol: t.name,
          kind: "test",
          lineStart: t.lineStart,
          lineEnd: t.lineEnd,
          title: `Test — ${t.name}`,
          text: `${t.name}\nFile: ${script.path}:${t.lineStart}\n${script.header || ""}`,
          relationships: emptyRel(),
          gitCommit: git.commit,
          sources: [{ path: script.path, lineStart: t.lineStart, lineEnd: t.lineEnd }],
          danger: false,
          tags: ["test", t.name],
        });
      }
    } else {
      chunks.push({
        id: `test-file:${script.path}`,
        type: "test",
        subsystem: "validation",
        path: script.path,
        symbol: null,
        kind: "file",
        lineStart: 1,
        lineEnd: script.lineCount,
        title: `Script — ${script.path}`,
        text: `${script.path}\n${script.header || script.textHead || ""}`,
        relationships: emptyRel(),
        gitCommit: git.commit,
        sources: [{ path: script.path, lineStart: 1, lineEnd: Math.min(80, script.lineCount) }],
        danger: false,
        tags: ["test", script.basename],
      });
    }
    for (const fn of script.functions) {
      chunks.push({
        id: `symbol:${script.path}:${fn.name}:${fn.lineStart}`,
        type: "symbol",
        subsystem: "validation",
        path: script.path,
        symbol: fn.name,
        kind: "function",
        lineStart: fn.lineStart,
        lineEnd: fn.lineEnd,
        title: `function ${fn.name} — ${script.path}`,
        text: fn.text,
        relationships: emptyRel(),
        gitCommit: git.commit,
        sources: [{ path: script.path, lineStart: fn.lineStart, lineEnd: fn.lineEnd }],
        danger: false,
        tags: ["script", fn.name],
      });
    }
  }

  const pkg = scan.other.find((f) => f.rel === "package.json");
  if (pkg) {
    const parsed = parsePackageJson(pkg.abs, pkg.rel);
    chunks.push({
      id: "validation:package-scripts",
      type: "validation",
      subsystem: "validation",
      path: "package.json",
      symbol: null,
      kind: "file",
      lineStart: 1,
      lineEnd: 1,
      title: "npm scripts (package.json)",
      text: Object.entries(parsed.scripts).map(([k, v]) => `${k}: ${v}`).join("\n"),
      relationships: emptyRel(),
      gitCommit: git.commit,
      sources: [{ path: "package.json", lineStart: 1, lineEnd: 1 }],
      danger: false,
      tags: ["npm", "validation"],
    });
  }

  const byType = {};
  for (const c of chunks) byType[c.type] = (byType[c.type] || 0) + 1;

  const manifest = {
    gitCommit: git.commit,
    gitShort: git.short,
    gitBranch: git.branch,
    gitDirty: git.dirty,
    builtAt: new Date().toISOString(),
    agentsMd: agents,
    chunkCount: chunks.length,
    byType,
    fileCount: tsProj.files.length,
    symbolCount: tsProj.symbols.length,
  };

  writeJsonl(join(corpusDir, "chunks.jsonl"), chunks);
  writeFileSync(join(corpusDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
  writeFileSync(
    join(corpusDir, "graph.json"),
    JSON.stringify({
      gitCommit: git.commit,
      importEdges: tsProj.importEdges,
      callEdges: tsProj.callEdges.slice(0, 50000),
    }),
    "utf8",
  );
  writeFileSync(
    join(corpusDir, "SUMMARY.md"),
    [
      `# Kill Chain corpus`,
      ``,
      `Git commit: \`${git.commit}\``,
      `Built: ${manifest.builtAt}`,
      `AGENTS.md: ${agents.abs} (${agents.source})`,
      `Chunks: ${chunks.length}`,
      ``,
      Object.entries(byType).map(([k, v]) => `- ${k}: ${v}`).join("\n"),
      ``,
      `This summary is an index, not a source of architectural facts. Cite chunks.jsonl provenance fields.`,
    ].join("\n"),
    "utf8",
  );

  log(`Wrote ${chunks.length} chunks → ${corpusDir}`);
  if (embed) {
    const { embedCorpus } = await import("../retrieve/embeddings.mjs");
    await embedCorpus(chunks, { log });
  }
  return { manifest, chunks, git, agents };
}
