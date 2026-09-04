/**
 * Fair Qwen vs Nemotron Lightning worker benchmark.
 * OpenCode sessions against fixture copies only. Never edits live src/.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, cpSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { dataDir, repoRoot } from "../paths.mjs";
import { gitShowHead, gitPorcelain, isAppPath } from "../mission/gitops.mjs";
import { sha256 } from "../mission/attribution.mjs";
import { checkTsSyntax, formatDiagnostics } from "../mission/syntax.mjs";
import { DISCIPLINE, clip } from "../mission/prompts.mjs";
import { runOpenCode, parseOpenCodeJsonl } from "../mission/opencode.mjs";
import { usedMutationTool } from "../mission/editGate.mjs";
import { DEFAULT_MISSION_MODEL, LIGHTNING_MODEL, normalizeModelId } from "../mission/model.mjs";
import { checkReferencedFilesExist, findInventedInnerPanelFiles } from "../mission/critic.mjs";

export const QWEN_MODEL = DEFAULT_MISSION_MODEL;
export const BENCH_MODELS = [QWEN_MODEL, LIGHTNING_MODEL];

const benchRoot = join(dataDir, "overnight", "lightning-bench");
const SRC_DRUM = join(
  dataDir,
  "missions/fire-drum-fill-preview-live/attribution/009-repair/files/src/components/FireCommand/DrumMachine.tsx",
);

const GUARD_PATHS = [
  "src/components/FireCommand/DrumMachine.tsx",
  "src/components/FireCommand/SequencerPanel.tsx",
  "src/components/FireCommand/PatternSelect.tsx",
  "src/components/FireCommand/ModuleEnableToggle.tsx",
  "src/components/FireCommand/fireUiKit.tsx",
  "src/components/FireCommand/GatePanel.tsx",
  "src/components/FireCommand/MacroPanel.tsx",
];

const IGNORE_APP = new Set(["tsconfig.tsbuildinfo"]);

const TOGGLE_PROPOSAL = `APPROVED PRESENTATION-ONLY PATCH (apply exactly, nothing else):

In ModuleEnableToggle disabled (asleep) inline styles, change:
  borderColor: "rgba(255,255,255,0.18)",
  color: "rgba(255,255,255,0.42)",
  background: "rgba(0,0,0,0.45)",
to:
  borderColor: "rgba(255,255,255,0.30)",
  color: "rgba(255,255,255,0.65)",
  background: "rgba(10,10,10,0.75)",

Do not change enabled styles, labels, store calls, or any other file.
This is the archived Level-1 contrast patch. APPLY IT. Do not re-plan.`;

function slug(model) {
  return normalizeModelId(model).replace(/[^a-z0-9.]+/gi, "_");
}

function hashFile(abs) {
  if (!existsSync(abs)) return null;
  return sha256(readFileSync(abs));
}

function snapshotProduction() {
  const files = {};
  const add = (rel) => {
    if (files[rel] || IGNORE_APP.has(rel)) return;
    const abs = join(repoRoot, rel);
    const buf = existsSync(abs) ? readFileSync(abs) : null;
    files[rel] = { sha256: buf ? sha256(buf) : null, bytes: buf ? buf.length : 0, buf };
  };
  for (const rel of GUARD_PATHS) add(rel);
  for (const row of gitPorcelain()) {
    if (IGNORE_APP.has(row.path) || !isAppPath(row.path)) continue;
    add(row.path);
  }
  return files;
}

function restoreProduction(snap) {
  const restored = [];
  for (const [rel, rec] of Object.entries(snap || {})) {
    const abs = join(repoRoot, rel);
    const now = hashFile(abs);
    if (now === rec.sha256) continue;
    if (rec.buf) {
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, rec.buf);
      restored.push({ rel, via: "start-bytes" });
    } else if (existsSync(abs)) {
      unlinkSync(abs);
      restored.push({ rel, via: "delete-new" });
    }
  }
  for (const row of gitPorcelain()) {
    if (IGNORE_APP.has(row.path) || !isAppPath(row.path)) continue;
    if (snap[row.path]) continue;
    const abs = join(repoRoot, row.path);
    if (row.untracked && existsSync(abs)) {
      unlinkSync(abs);
      restored.push({ rel: row.path, via: "delete-untracked" });
      continue;
    }
    const head = gitShowHead(row.path);
    if (head) {
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, head);
      restored.push({ rel: row.path, via: "HEAD" });
    }
  }
  return restored;
}

function productionDrifted(snap) {
  for (const [rel, rec] of Object.entries(snap || {})) {
    if (hashFile(join(repoRoot, rel)) !== rec.sha256) return true;
  }
  return false;
}

function nvidiaSnap() {
  try {
    const r = spawnSync("nvidia-smi", [
      "--query-gpu=memory.used,memory.total,utilization.gpu",
      "--format=csv,noheader,nounits",
    ], { encoding: "utf8", windowsHide: true, timeout: 8000 });
    if (r.status !== 0) return { ok: false, error: (r.stderr || r.stdout || "").slice(0, 200) };
    const [used, total, util] = String(r.stdout || "").trim().split(",").map((s) => Number(String(s).trim()));
    return { ok: true, vramUsedMb: used, vramTotalMb: total, gpuUtil: util };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
}

async function ollamaPs() {
  try {
    const res = await fetch("http://127.0.0.1:11434/api/ps");
    const json = await res.json();
    return (json.models || []).map((m) => ({
      name: m.name || m.model,
      size: m.size,
      vram: m.size_vram,
    }));
  } catch (err) {
    return { error: String(err.message || err) };
  }
}

function printedTools(text, tools) {
  if ((tools || []).length) return false;
  const raw = String(text || "");
  return /<tool_call>|<\/tool_call>|<\|tool_call\|>|invoke tool/i.test(raw)
    || (/\b(read|edit|write|killchain_search|killchain_symbol)\b/.test(raw) && /"arguments"|"parameters"/i.test(raw));
}

function invented(text) {
  const files = checkReferencedFilesExist(text || "");
  const inner = findInventedInnerPanelFiles(text || "");
  return {
    missingFiles: files.missing || [],
    innerPanels: inner,
    homeBand: /HomeBandContent\.tsx/.test(text || ""),
    toggleBase: /ModuleEnableToggleBase\.tsx/.test(text || ""),
  };
}

function tokensPerSec(outputTokens, durationMs) {
  if (!outputTokens || !durationMs) return null;
  return Number((outputTokens / (durationMs / 1000)).toFixed(2));
}

function slimRun(run) {
  const { gpuBefore, gpuAfter, ...rest } = run;
  return {
    ...rest,
    text: clip(run.text || "", 4000),
    gpuBefore,
    gpuAfter,
  };
}

function contrastApplied(text) {
  return String(text || "").includes("rgba(255,255,255,0.30)")
    && String(text || "").includes("rgba(255,255,255,0.65)")
    && String(text || "").includes("rgba(10,10,10,0.75)");
}

function contrastExact(before, after) {
  const expected = String(before)
    .replace("rgba(255,255,255,0.18)", "rgba(255,255,255,0.30)")
    .replace("rgba(255,255,255,0.42)", "rgba(255,255,255,0.65)")
    .replace("rgba(0,0,0,0.45)", "rgba(10,10,10,0.75)");
  return after === expected;
}

async function session({ model, title, prompt, relDir, timeoutMs = 12 * 60 * 1000, snap }) {
  mkdirSync(join(benchRoot, "sessions"), { recursive: true });
  const outPath = join(benchRoot, "sessions", `${relDir.replace(/[\\/]/g, "_")}.jsonl`);
  const gpuBefore = nvidiaSnap();
  const psBefore = await ollamaPs();
  const started = Date.now();
  let result;
  try {
    result = await runOpenCode({
      prompt,
      title,
      outPath,
      timeoutMs,
      cwd: repoRoot,
      model,
    });
  } catch (err) {
    const restores = snap ? restoreProduction(snap) : [];
    return slimRun({
      ok: false,
      error: String(err.message || err),
      durationMs: err.durationMs || Date.now() - started,
      model: normalizeModelId(model),
      tools: [],
      text: "",
      gpuBefore,
      gpuAfter: nvidiaSnap(),
      psBefore,
      psAfter: await ollamaPs(),
      restores,
    });
  }
  const parsed = result.parsed || parseOpenCodeJsonl("");
  const restores = snap ? restoreProduction(snap) : [];
  return slimRun({
    ok: result.exitCode === 0,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    model: normalizeModelId(model),
    tools: parsed.tools || [],
    firstTool: parsed.firstTool || null,
    mcpFirst: Boolean(parsed.mcpFirst),
    unix: parsed.unixViolations || [],
    text: result.text || "",
    textChars: (result.text || "").length,
    mutation: usedMutationTool(parsed.tools),
    printedNotExecuted: printedTools(result.text, parsed.tools),
    tokens: parsed.tokens || null,
    tokPerSec: tokensPerSec(parsed.tokens?.output, result.durationMs),
    gpuBefore,
    gpuAfter: nvidiaSnap(),
    psBefore,
    psAfter: await ollamaPs(),
    outPath,
    restores,
  });
}

function fixtureRel(model, name, file) {
  return `tools/killchain-ai/data/overnight/lightning-bench/work/${slug(model)}/${name}/${file}`;
}

function deltaBytes(before, after) {
  if (before == null || after == null) return null;
  return Buffer.byteLength(after, "utf8") - Buffer.byteLength(before, "utf8");
}

async function runSmoke(log, snap) {
  const destRel = "tools/killchain-ai/data/overnight/lightning-bench/sandbox/TOOL_FIXTURE.txt";
  const dest = join(repoRoot, destRel);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, "BENCH_FIXTURE_V1\n", "utf8");
  const before = readFileSync(dest, "utf8");
  const prompt = `${DISCIPLINE}

OPENCODE INTEGRATION SMOKE (fixture only).
1) FIRST tool must be a Kill Chain MCP tool (killchain search or symbol). Search for rewireFront.
2) Read this exact file: ${destRel}
3) Append one line exactly: LIGHTNING_TOOL_OK
   using edit/write on THAT FILE ONLY.
4) Do not modify anything under src/.
5) Visible final answer must include:
MCP: <tool name>
EDIT: ${destRel}
VERDICT: PASS
`;
  log("smoke: Lightning OpenCode tools");
  const run = await session({
    model: LIGHTNING_MODEL,
    title: "kc-bench-lightning-smoke",
    prompt,
    relDir: "smoke-lightning",
    snap,
  });
  const after = existsSync(dest) ? readFileSync(dest, "utf8") : "";
  const wrote = after.includes("LIGHTNING_TOOL_OK") && after !== before;
  return {
    model: LIGHTNING_MODEL,
    ...run,
    fixtureWrote: wrote,
    afterSample: after.slice(0, 160),
    toolsExecuted: (run.tools || []).length > 0,
    mcpUsed: (run.tools || []).some((t) => /killchain/i.test(t)),
    integrationOk: Boolean(run.tools?.length) && !run.printedNotExecuted && wrote,
  };
}

async function runJsx(model, log, snap, shared) {
  const rel = fixtureRel(model, "jsx", "DrumMachine.tsx");
  const abs = join(repoRoot, rel);
  mkdirSync(dirname(abs), { recursive: true });
  cpSync(shared.srcAbs, abs);
  const original = readFileSync(abs, "utf8");
  const attempts = [];
  let current = original;
  for (let i = 1; i <= 3; i++) {
    const gate = i === 1 ? shared.gate : checkTsSyntax("src/components/FireCommand/DrumMachine.tsx", current);
    if (gate.ok) break;
    const windows = i === 1
      ? shared.windows
      : (gate.diagnostics || []).slice(0, 3).map((d) => d.excerpt || "").join("\n\n");
    const prompt = `${DISCIPLINE}

JSX REPAIR ON FIXTURE COPY ONLY.
Broken bytes are the archived fire-drum-fill-preview-live 009-repair DrumMachine snapshot.
AUTHORIZED FILE (only this path):
${rel}

Do not edit src/components/FireCommand/DrumMachine.tsx (production).
Diagnose the exact structural JSX failure, then USE edit/write on the authorized fixture path.
Minimal repair. No redesign. No store/audio changes.

DIAGNOSTICS:
${i === 1 ? shared.diagText : formatDiagnostics(gate.diagnostics, 8)}

SOURCE WINDOWS:
${windows}

Attempt ${i} of 3. After editing, report FAULT LOCATION and what you changed.
`;
    log(`jsx ${model} attempt ${i}`);
    const run = await session({
      model,
      title: `kc-bench-jsx-${slug(model)}-${i}`,
      prompt,
      relDir: `jsx-${slug(model)}-${i}`,
      snap,
    });
    current = existsSync(abs) ? readFileSync(abs, "utf8") : current;
    const after = checkTsSyntax("src/components/FireCommand/DrumMachine.tsx", current);
    attempts.push({
      n: i,
      ...run,
      applied: current !== original,
      syntaxOkAfter: after.ok,
      diagnosticsAfter: after.diagnostics.slice(0, 6).map((d) => `${d.line}:${d.column} ${d.code} ${d.diagnostic}`),
      deltaBytes: deltaBytes(original, current),
    });
    if (after.ok) break;
  }
  const finalGate = checkTsSyntax("src/components/FireCommand/DrumMachine.tsx", current);
  writeFileSync(join(dirname(abs), "final.tsx"), current);
  return {
    model: normalizeModelId(model),
    fixture: rel,
    archivedSource: SRC_DRUM,
    syntaxCaughtInitially: !shared.gate.ok,
    initialDiagnostics: shared.gate.diagnostics.slice(0, 8).map((d) => `${d.line}:${d.column} ${d.code} ${d.diagnostic}`),
    attempts,
    retries: Math.max(0, attempts.length - 1),
    finalSyntaxOk: finalGate.ok,
    changedFromArchive: current !== original,
    invented: invented(attempts.map((a) => a.text).join("\n")),
  };
}

async function runEmpty(model, log, snap, headToggle) {
  const rel = fixtureRel(model, "empty", "ModuleEnableToggle.tsx");
  const abs = join(repoRoot, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, headToggle);
  const before = readFileSync(abs, "utf8");
  const prompt = `${DISCIPLINE}

EMPTY-EDIT REPLAY. EXECUTION PHASE.
THE PROPOSAL IS ALREADY APPROVED.
DO NOT EXPLAIN THE PATCH. DO NOT CREATE PLAN FILES.
USE THE EDIT/WRITE TOOL NOW on this fixture only:

${rel}

Do not edit src/components/FireCommand/ModuleEnableToggle.tsx (live/parked production).

${TOGGLE_PROPOSAL}

WHEN COMPLETE, REPORT THE PATH YOU ACTUALLY WROTE.
`;
  log(`empty-edit ${model}`);
  const run = await session({
    model,
    title: `kc-bench-empty-${slug(model)}`,
    prompt,
    relDir: `empty-${slug(model)}`,
    snap,
  });
  const after = existsSync(abs) ? readFileSync(abs, "utf8") : before;
  const changed = sha256(after) !== sha256(before);
  const syntax = checkTsSyntax("src/components/FireCommand/ModuleEnableToggle.tsx", after);
  const applied = contrastApplied(after);
  return {
    model: normalizeModelId(model),
    fixture: rel,
    ...run,
    zeroDelta: !changed,
    appliedContrast: applied,
    exactPatch: contrastExact(before, after),
    syntaxOk: syntax.ok,
    deltaBytes: deltaBytes(before, after),
    kind: changed
      ? (run.mutation ? "EDITED" : "CHANGED_WITHOUT_MUTATION_TOOL")
      : (run.mutation ? "EMPTY_EDIT" : "DESCRIBED_BUT_DID_NOT_APPLY"),
  };
}

async function runFacts(model, log, snap) {
  const prompt = `${DISCIPLINE}

READ-ONLY FACTUALITY. Do not edit any file.

Archived Qwen failure invented:
- src/components/FireCommand/HomeBandContent.tsx
- src/components/FireCommand/ModuleEnableToggleBase.tsx

Task: Using Kill Chain MCP first, map the REAL files that implement Fire Command home/band chrome and the Sleep/Wake module toggle.

Required visible fields:
INSPECTED: existing paths only
SYMBOLS: existing exported names only
CALLERS: real callers if you claim them
INVENTED: none — if unsure, say unknown
VERDICT: READY or NOT_READY

Do not recommend creating HomeBandContent.tsx or ModuleEnableToggleBase.tsx unless you first prove they already exist.
`;
  log(`facts ${model}`);
  const run = await session({
    model,
    title: `kc-bench-facts-${slug(model)}`,
    prompt,
    relDir: `facts-${slug(model)}`,
    snap,
  });
  const inv = invented(run.text);
  const mentionsRealToggle = /ModuleEnableToggle\.tsx/.test(run.text);
  const mentionsFake = inv.homeBand || inv.toggleBase
    || inv.missingFiles.some((p) => /HomeBandContent|ModuleEnableToggleBase/.test(p));
  return {
    ...run,
    invented: inv,
    mentionsRealToggle,
    mentionsFake,
    factual: mentionsRealToggle && !mentionsFake && inv.missingFiles.length === 0,
  };
}

async function runUi(model, log, snap, headToggle) {
  const rel = fixtureRel(model, "ui", "ModuleEnableToggle.tsx");
  const abs = join(repoRoot, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, headToggle);
  const before = readFileSync(abs, "utf8");
  const prompt = `${DISCIPLINE}

SUCCESSFUL LEVEL-1 UI REPLAY on a fixture copy. Do not touch live src/.

Investigate ${rel} (HEAD baseline of ModuleEnableToggle).
The asleep/disabled chip is too dim.
Apply the archived successful contrast patch to THAT FIXTURE ONLY:

${TOGGLE_PROPOSAL}

MCP first. Then edit the fixture. Then report:
INSPECTED, CHANGED PATHS, SYNTAX, VERDICT.
`;
  log(`ui ${model}`);
  const run = await session({
    model,
    title: `kc-bench-ui-${slug(model)}`,
    prompt,
    relDir: `ui-${slug(model)}`,
    snap,
  });
  const after = existsSync(abs) ? readFileSync(abs, "utf8") : before;
  const syntax = checkTsSyntax("src/components/FireCommand/ModuleEnableToggle.tsx", after);
  const applied = contrastApplied(after);
  return {
    ...run,
    fixture: rel,
    applied,
    exactPatch: contrastExact(before, after),
    syntaxOk: syntax.ok,
    deltaBytes: deltaBytes(before, after),
    unnecessaryLikely: applied && !contrastExact(before, after) && after !== before,
    invented: invented(run.text),
  };
}

function yn(v) {
  if (v === true) return "yes";
  if (v === false) return "no";
  return String(v ?? "n/a");
}

function collectSessions(row) {
  if (!row) return [];
  if (Array.isArray(row.attempts)) return row.attempts;
  return [row];
}

function rollup(model, report) {
  const rows = [
    ...(report.jsx?.[model]?.attempts || []),
    report.empty?.[model],
    report.facts?.[model],
    report.ui?.[model],
  ].filter(Boolean);
  const wall = rows.reduce((s, r) => s + (r.durationMs || 0), 0);
  const calls = rows.length;
  const tools = rows.reduce((s, r) => s + ((r.tools || []).length), 0);
  const mcpFirst = rows.filter((r) => r.mcpFirst).length;
  const unix = rows.reduce((s, r) => s + ((r.unix || []).length), 0);
  const printed = rows.filter((r) => r.printedNotExecuted).length;
  const mutation = rows.filter((r) => r.mutation).length;
  const vram = rows.map((r) => r.gpuAfter?.vramUsedMb).filter((n) => Number.isFinite(n));
  return {
    wallMs: wall,
    modelCalls: calls,
    toolCalls: tools,
    mcpFirstCount: mcpFirst,
    unixCount: unix,
    printedNotExecuted: printed,
    mutationSessions: mutation,
    vramPeakMb: vram.length ? Math.max(...vram) : null,
  };
}

function scorecard(report) {
  const models = BENCH_MODELS.map(normalizeModelId);
  const scores = {};
  for (const m of models) {
    const jsx = report.jsx?.[m] || {};
    const empty = report.empty?.[m] || {};
    const facts = report.facts?.[m] || {};
    const ui = report.ui?.[m] || {};
    const apply = (empty.appliedContrast ? 12 : 0) + (ui.applied ? 13 : 0);
    const mechanical = (empty.syntaxOk ? 8 : 0) + (ui.syntaxOk ? 6 : 0) + (jsx.finalSyntaxOk ? 6 : 0);
    const repair = jsx.finalSyntaxOk ? 20 : (jsx.changedFromArchive ? 6 : 0);
    const factual = facts.factual ? 15 : (facts.mentionsRealToggle && !facts.mentionsFake ? 8 : 0);
    const jsxPrinted = (jsx.attempts || []).some((a) => a.printedNotExecuted);
    const scope = (!empty.printedNotExecuted && !ui.printedNotExecuted && !jsxPrinted ? 6 : 0)
      + ((facts.invented?.missingFiles || []).length === 0 && !facts.mentionsFake ? 4 : 0);
    const tools = ((empty.mutation || ui.mutation || (jsx.attempts || []).some((a) => a.mutation)) ? 7 : 0);
    const validation = (empty.syntaxOk && empty.appliedContrast ? 2 : 0) + (ui.syntaxOk && ui.applied ? 1 : 0);
    scores[m] = {
      apply,
      mechanical,
      repair,
      factual,
      scope,
      tools,
      validation,
      total: apply + mechanical + repair + factual + scope + tools + validation,
    };
  }
  const q = scores[models[0]] || { total: 0 };
  const l = scores[models[1]] || { total: 0 };
  const margin = Math.abs((l.total || 0) - (q.total || 0));
  let winner = "tie";
  if ((l.total || 0) >= (q.total || 0) + 12) winner = models[1];
  else if ((q.total || 0) >= (l.total || 0) + 12) winner = models[0];
  else if ((l.total || 0) > (q.total || 0)) winner = `${models[1]} (narrow)`;
  else if ((q.total || 0) > (l.total || 0)) winner = `${models[0]} (narrow)`;
  return { scores, winner, margin, weights: {
    apply: 25, mechanical: 20, repair: 20, factual: 15, scope: 10, tools: 7, validation: 3,
  } };
}

function decide(report) {
  const q = QWEN_MODEL;
  const l = LIGHTNING_MODEL;
  const sc = report.scorecard || scorecard(report);
  const jsxQ = Boolean(report.jsx?.[q]?.finalSyntaxOk);
  const jsxL = Boolean(report.jsx?.[l]?.finalSyntaxOk);
  const emptyQ = Boolean(report.empty?.[q]?.appliedContrast);
  const emptyL = Boolean(report.empty?.[l]?.appliedContrast);
  const uiQ = Boolean(report.ui?.[q]?.applied);
  const uiL = Boolean(report.ui?.[l]?.applied);
  const factsQ = Boolean(report.facts?.[q]?.factual);
  const factsL = Boolean(report.facts?.[l]?.factual);
  const toolsL = Boolean(report.smoke?.integrationOk) && !report.smoke?.printedNotExecuted;
  const toolsQ = collectSessions(report.empty?.[q]).concat(collectSessions(report.ui?.[q]))
    .some((r) => r.mutation && !r.printedNotExecuted);
  const lightningMaterial = (sc.scores?.[l]?.total || 0) >= (sc.scores?.[q]?.total || 0) + 12
    && emptyL
    && (jsxL || (!jsxQ && (emptyL && uiL)))
    && toolsL;
  let outcome = "C";
  let replaceExecutor = false;
  let lightningPlanner = false;
  let qwenRole = "keep as primary executor";
  if (!toolsL && (report.smoke && report.smoke.printedNotExecuted || (report.smoke && !report.smoke.toolsExecuted))) {
    outcome = "D";
    lightningPlanner = true;
    qwenRole = "keep as executor; Lightning may critic/plan if reasoning is stronger";
  } else if (lightningMaterial) {
    outcome = "A";
    replaceExecutor = true;
    qwenRole = "keep as fallback / cheaper second opinion";
  } else if (emptyL && !emptyQ && toolsL && !jsxL && !jsxQ) {
    outcome = "B";
    qwenRole = "keep for tasks Lightning does not win; do not replace default yet";
  } else if ((sc.scores?.[l]?.total || 0) > (sc.scores?.[q]?.total || 0) && toolsL) {
    outcome = "B";
    qwenRole = "still the default executor until Lightning wins empty-edit + TSX repair";
  } else if ((sc.scores?.[q]?.total || 0) >= (sc.scores?.[l]?.total || 0)) {
    outcome = "C";
    qwenRole = "keep as primary executor";
  }
  const confidence = outcome === "A" && jsxL && emptyL && toolsL ? "high"
    : outcome === "C" && !emptyL && !jsxL ? "medium"
    : "low-medium";
  return {
    outcome,
    replaceExecutor,
    lightningPlanner,
    qwenRole,
    confidence,
    evidence: { jsxQ, jsxL, emptyQ, emptyL, uiQ, uiL, factsQ, factsL, toolsQ, toolsL },
  };
}

function mdReport(report) {
  const q = QWEN_MODEL;
  const l = LIGHTNING_MODEL;
  const sc = report.scorecard || scorecard(report);
  const d = decide({ ...report, scorecard: sc });
  const rq = rollup(q, report);
  const rl = rollup(l, report);
  const nextMission = d.replaceExecutor
    ? "Replay a small observed Fire Command Level-2 UI defect (screenshot + metrics) with Lightning as executor, Cursor as supervisor. Still fixtures-first if the defect is not already parked."
    : "Keep Qwen as executor. Next live mission: one observed Level-2 Fire Command presentation defect with screenshot+metrics, still no Level 2B / AudioEngine.";
  return `# Lightning vs Qwen worker benchmark

Generated: ${report.at}
Worktree: Kill-Chain-AI / ai/kill-chain-agent
Production touched: ${yn(report.productionTouched)}
Guard restores: ${JSON.stringify(report.guardRestores || [])}

## 1. Lightning OpenCode integration result

- tools executed: ${yn(report.smoke?.toolsExecuted)}
- fixture write succeeded: ${yn(report.smoke?.fixtureWrote)}
- printed-not-executed: ${yn(report.smoke?.printedNotExecuted)}
- MCP used: ${yn(report.smoke?.mcpUsed)} MCP-first: ${yn(report.smoke?.mcpFirst)}
- first tool: ${report.smoke?.firstTool || "(none)"}
- wall ms: ${report.smoke?.durationMs ?? "n/a"}
- tokens: ${JSON.stringify(report.smoke?.tokens || null)}
- integrationOk: **${yn(report.smoke?.integrationOk)}**
- error: ${report.smoke?.error || "(none)"}
- sample after: ${JSON.stringify(report.smoke?.afterSample || "")}

If tool calls were printed as text instead of executed, that is a major worker failure.

## 2. Model-selection implementation

- Default remains \`${q}\` in opencode.json and DEFAULT_MISSION_MODEL.
- Override: \`kc-ai mission run <file> --model ${l}\` (also \`mission resume --model\`).
- Spec field \`model\` is optional.
- OpenCode \`-m\` is passed by the runner whenever a model id is chosen.
- Lightning is registered under provider.ollama.models; Qwen was not removed.
- Context target: 65,536 on both models in opencode.json.

## 3. Benchmark fixtures used

- Broken JSX: archived lossless copy
  \`${SRC_DRUM}\`
  (fire-drum-fill-preview-live attribution/009-repair). Not synthetic.
- Empty-edit + UI replay: \`git show HEAD:src/components/FireCommand/ModuleEnableToggle.tsx\`
  written to fixture copies (live parked toggle is not the baseline).
- Factuality: archived invention from pilot-fire-ux-plan
  (HomeBandContent.tsx, ModuleEnableToggleBase.tsx). Read-only.
- Smoke fixture: tools/killchain-ai/data/overnight/lightning-bench/sandbox/TOOL_FIXTURE.txt

## 4. Exact fairness controls

- Same mission prompt per target except fixture path (required so models cannot clobber each other).
- Same archived bytes, compiler diagnostics, and source windows on JSX attempt 1.
- Same approved ModuleEnableToggle contrast patch for empty-edit and UI replay.
- Same retry budget: 3 JSX attempts max.
- Same tools: OpenCode --auto + Kill Chain MCP + edit/write.
- Same validation: checkTsSyntax / contrast string gates.
- Same 65,536 context target.
- Sequential: per target, Qwen then Lightning. No extra Lightning hints after Qwen fails.
- Neither model authorized to edit live \`src/\`. Production bytes snapshotted and restored after every session.

## 5. Qwen broken-JSX result

${JSON.stringify({
    finalSyntaxOk: report.jsx?.[q]?.finalSyntaxOk,
    changedFromArchive: report.jsx?.[q]?.changedFromArchive,
    retries: report.jsx?.[q]?.retries,
    attempts: (report.jsx?.[q]?.attempts || []).map((a) => ({
      n: a.n, mutation: a.mutation, syntaxOkAfter: a.syntaxOkAfter, durationMs: a.durationMs,
      tools: (a.tools || []).length, printedNotExecuted: a.printedNotExecuted, deltaBytes: a.deltaBytes,
    })),
  }, null, 2)}

## 6. Lightning broken-JSX result

${JSON.stringify({
    finalSyntaxOk: report.jsx?.[l]?.finalSyntaxOk,
    changedFromArchive: report.jsx?.[l]?.changedFromArchive,
    retries: report.jsx?.[l]?.retries,
    attempts: (report.jsx?.[l]?.attempts || []).map((a) => ({
      n: a.n, mutation: a.mutation, syntaxOkAfter: a.syntaxOkAfter, durationMs: a.durationMs,
      tools: (a.tools || []).length, printedNotExecuted: a.printedNotExecuted, deltaBytes: a.deltaBytes,
    })),
  }, null, 2)}

## 7. Qwen empty-edit result

${JSON.stringify({
    kind: report.empty?.[q]?.kind,
    appliedContrast: report.empty?.[q]?.appliedContrast,
    exactPatch: report.empty?.[q]?.exactPatch,
    zeroDelta: report.empty?.[q]?.zeroDelta,
    mutation: report.empty?.[q]?.mutation,
    syntaxOk: report.empty?.[q]?.syntaxOk,
    durationMs: report.empty?.[q]?.durationMs,
    tools: report.empty?.[q]?.tools,
  }, null, 2)}

## 8. Lightning empty-edit result

${JSON.stringify({
    kind: report.empty?.[l]?.kind,
    appliedContrast: report.empty?.[l]?.appliedContrast,
    exactPatch: report.empty?.[l]?.exactPatch,
    zeroDelta: report.empty?.[l]?.zeroDelta,
    mutation: report.empty?.[l]?.mutation,
    syntaxOk: report.empty?.[l]?.syntaxOk,
    durationMs: report.empty?.[l]?.durationMs,
    tools: report.empty?.[l]?.tools,
  }, null, 2)}

## 9. Qwen file/symbol factuality result

${JSON.stringify({
    factual: report.facts?.[q]?.factual,
    mentionsRealToggle: report.facts?.[q]?.mentionsRealToggle,
    mentionsFake: report.facts?.[q]?.mentionsFake,
    invented: report.facts?.[q]?.invented,
    mcpFirst: report.facts?.[q]?.mcpFirst,
    firstTool: report.facts?.[q]?.firstTool,
  }, null, 2)}

## 10. Lightning file/symbol factuality result

${JSON.stringify({
    factual: report.facts?.[l]?.factual,
    mentionsRealToggle: report.facts?.[l]?.mentionsRealToggle,
    mentionsFake: report.facts?.[l]?.mentionsFake,
    invented: report.facts?.[l]?.invented,
    mcpFirst: report.facts?.[l]?.mcpFirst,
    firstTool: report.facts?.[l]?.firstTool,
  }, null, 2)}

## 11. Qwen successful-UI replay result

${JSON.stringify({
    applied: report.ui?.[q]?.applied,
    exactPatch: report.ui?.[q]?.exactPatch,
    syntaxOk: report.ui?.[q]?.syntaxOk,
    deltaBytes: report.ui?.[q]?.deltaBytes,
    mutation: report.ui?.[q]?.mutation,
    durationMs: report.ui?.[q]?.durationMs,
    tools: (report.ui?.[q]?.tools || []).length,
  }, null, 2)}

## 12. Lightning successful-UI replay result

${JSON.stringify({
    applied: report.ui?.[l]?.applied,
    exactPatch: report.ui?.[l]?.exactPatch,
    syntaxOk: report.ui?.[l]?.syntaxOk,
    deltaBytes: report.ui?.[l]?.deltaBytes,
    mutation: report.ui?.[l]?.mutation,
    durationMs: report.ui?.[l]?.durationMs,
    tools: (report.ui?.[l]?.tools || []).length,
  }, null, 2)}

## 13. Tool-call reliability comparison

| | Qwen | Lightning |
|---|---|---|
| mutation sessions | ${rq.mutationSessions} | ${rl.mutationSessions} |
| printed-not-executed | ${rq.printedNotExecuted} | ${rl.printedNotExecuted} |
| smoke integrationOk | n/a (already proven in missions) | ${yn(report.smoke?.integrationOk)} |

## 14. MCP usage comparison

| | Qwen | Lightning |
|---|---|---|
| MCP-first sessions | ${rq.mcpFirstCount} | ${rl.mcpFirstCount} |
| facts first tool | ${report.facts?.[q]?.firstTool || "(none)"} | ${report.facts?.[l]?.firstTool || "(none)"} |

## 15. Unix-tool discipline comparison

| | Qwen | Lightning |
|---|---|---|
| unix flags | ${rq.unixCount} | ${rl.unixCount} |

## 16. Syntax-error comparison

| | Qwen | Lightning |
|---|---|---|
| JSX final syntax ok | ${yn(report.jsx?.[q]?.finalSyntaxOk)} | ${yn(report.jsx?.[l]?.finalSyntaxOk)} |
| empty-edit syntax ok | ${yn(report.empty?.[q]?.syntaxOk)} | ${yn(report.empty?.[l]?.syntaxOk)} |
| UI syntax ok | ${yn(report.ui?.[q]?.syntaxOk)} | ${yn(report.ui?.[l]?.syntaxOk)} |

## 17. Repair success comparison

| | Qwen | Lightning |
|---|---|---|
| JSX repaired | ${yn(report.jsx?.[q]?.finalSyntaxOk)} | ${yn(report.jsx?.[l]?.finalSyntaxOk)} |
| empty-edit contrast applied | ${yn(report.empty?.[q]?.appliedContrast)} | ${yn(report.empty?.[l]?.appliedContrast)} |
| UI contrast applied | ${yn(report.ui?.[q]?.applied)} | ${yn(report.ui?.[l]?.applied)} |

## 18. Scope comparison

Guard restores after sessions (should be empty if models stayed on fixtures):
${JSON.stringify(report.allRestores || report.guardRestores || [])}

Invented files/symbols: Qwen ${JSON.stringify(report.facts?.[q]?.invented || {})} / Lightning ${JSON.stringify(report.facts?.[l]?.invented || {})}

## 19. Wall-time comparison

| | Qwen | Lightning |
|---|---|---|
| suite wall ms | ${rq.wallMs} | ${rl.wallMs} |
| smoke wall ms | n/a | ${report.smoke?.durationMs ?? "n/a"} |

## 20. Model-call comparison

| | Qwen | Lightning |
|---|---|---|
| OpenCode sessions | ${rq.modelCalls} | ${rl.modelCalls} |
| tool calls | ${rq.toolCalls} | ${rl.toolCalls} |

## 21. VRAM/RAM observations

| | Qwen | Lightning |
|---|---|---|
| peak nvidia-smi used MiB | ${rq.vramPeakMb} | ${rl.vramPeakMb} |
| smoke after | | ${JSON.stringify(report.smoke?.gpuAfter || null)} |
| smoke ollama ps | | ${JSON.stringify(report.smoke?.psAfter || null)} |

Known Lightning local profile (user-measured, not re-benching PowerShell): ~14.6 GB VRAM, ~13.1 GB llama-server RAM, ~32.6 tok/s gen, ~93.9 tok/s prompt.

## 22. Weighted scorecard

Weights: apply 25, mechanical 20, repair 20, factual 15, scope 10, tools 7, validation 3.
Prose elegance is not scored.

${JSON.stringify(sc.scores, null, 2)}

Margin: ${sc.margin}

## 23. Winner

${sc.winner}

Outcome code: ${d.outcome}
- A = Lightning clearly wins → recommend migration
- B = Mixed → role specialization
- C = Qwen still better → keep Qwen
- D = Lightning reasoning/tools split → Lightning planner/critic, Qwen executor

## 24. Confidence in winner

${d.confidence}

## 25. Whether Lightning should replace Qwen as executor

**${d.replaceExecutor ? "YES, as default executor (keep Qwen installed)" : "NO, not on this evidence"}**

## 26. Whether Lightning should instead be planner/critic

**${d.lightningPlanner ? "YES — tools are the failure mode" : (d.outcome === "B" ? "Maybe, if empty-edit is the only win" : "Not as the primary conclusion")}**

## 27. Whether Qwen still has a role

${d.qwenRole}

## 28. Recommended next live mission using the winner

${nextMission}

Do not unlock Level 2B / Fire Command state / AudioEngine.

## 29. Whether NVIDIA NIM Ultra is worth wiring after this

Not yet. Cursor/Composer still has usage and is the supervisor. NIM Ultra is the later replacement for that supervision layer, not the next worker experiment. Wire it when Cursor usage is gone or when a stronger critic is required after a worker is chosen.

## 30. Whether fine-tuning remains unnecessary

Yes. This was a base-model evaluation. Do not train until a worker can actually apply mechanical patches; SFT will not fix printed-tool or empty-edit failures cheaply.

---

Raw JSON: tools/killchain-ai/data/overnight/lightning-bench/REPORT.json
`;
}

function persist(report) {
  report.scorecard = scorecard(report);
  report.decision = decide({ ...report, scorecard: report.scorecard });
  const jsonReady = JSON.parse(JSON.stringify(report, (k, v) => {
    if (k === "buf") return undefined;
    if (Buffer.isBuffer(v)) return undefined;
    return v;
  }));
  mkdirSync(benchRoot, { recursive: true });
  writeFileSync(join(benchRoot, "REPORT.json"), `${JSON.stringify(jsonReady, null, 2)}\n`);
  writeFileSync(join(benchRoot, "SCORECARD.json"), `${JSON.stringify(jsonReady.scorecard, null, 2)}\n`);
  writeFileSync(join(benchRoot, "REPORT.md"), mdReport(jsonReady));
}

export async function runLightningBench({ log = console.log, only = "all" } = {}) {
  mkdirSync(benchRoot, { recursive: true });
  if (!existsSync(SRC_DRUM)) throw new Error(`missing archived drum fixture ${SRC_DRUM}`);
  const snap = snapshotProduction();
  const headToggle = gitShowHead("src/components/FireCommand/ModuleEnableToggle.tsx");
  if (!headToggle) throw new Error("gitShowHead ModuleEnableToggle failed");
  const sharedJsx = {
    srcAbs: SRC_DRUM,
    gate: checkTsSyntax("src/components/FireCommand/DrumMachine.tsx", readFileSync(SRC_DRUM, "utf8")),
  };
  sharedJsx.diagText = formatDiagnostics(sharedJsx.gate.diagnostics, 8);
  sharedJsx.windows = (sharedJsx.gate.diagnostics || []).slice(0, 3).map((d) => d.excerpt || "").join("\n\n");
  mkdirSync(join(benchRoot, "fixtures"), { recursive: true });
  cpSync(SRC_DRUM, join(benchRoot, "fixtures", "DrumMachine.broken.tsx"));
  writeFileSync(join(benchRoot, "fixtures", "ModuleEnableToggle.HEAD.tsx"), headToggle);

  const report = {
    at: new Date().toISOString(),
    productionTouched: false,
    models: BENCH_MODELS,
    fairness: {
      contextTarget: 65536,
      retryBudgetJsx: 3,
      samePrompts: true,
      fixturesOnly: true,
      qwenThenLightningPerTarget: true,
      noLeakageHints: true,
    },
    allRestores: [],
  };

  const want = (name) => only === "all" || only === name;

  try {
    if (want("smoke") || only === "all") {
      report.smoke = await runSmoke(log, snap);
      report.allRestores.push(...(report.smoke.restores || []));
      persist(report);
    }
    report.jsx = report.jsx || {};
    report.empty = report.empty || {};
    report.facts = report.facts || {};
    report.ui = report.ui || {};

    const takeRestores = (row) => {
      const out = [...(row?.restores || [])];
      for (const a of row?.attempts || []) out.push(...(a.restores || []));
      return out;
    };
    const runTarget = async (key, fn) => {
      for (const model of BENCH_MODELS) {
        const id = normalizeModelId(model);
        log(`--- target ${key} / ${id} ---`);
        report[key][id] = await fn(model);
        report.allRestores.push(...takeRestores(report[key][id]));
        persist(report);
      }
    };

    if (want("jsx")) {
      await runTarget("jsx", (model) => runJsx(model, log, snap, sharedJsx));
    }
    if (want("empty")) {
      await runTarget("empty", (model) => runEmpty(model, log, snap, headToggle));
    }
    if (want("facts")) {
      await runTarget("facts", (model) => runFacts(model, log, snap));
    }
    if (want("ui")) {
      await runTarget("ui", (model) => runUi(model, log, snap, headToggle));
    }
  } finally {
    const endRestores = restoreProduction(snap);
    report.guardRestores = endRestores;
    report.allRestores = [...(report.allRestores || []), ...endRestores];
    report.productionTouched = productionDrifted(snap);
    report.scorecard = scorecard(report);
    report.decision = decide(report);
    persist(report);
  }
  return report;
}
