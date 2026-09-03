/**
 * Repair-harness drill against preserved fire-drum-fill-preview-live
 * broken JSX snapshots. Never touches production src/.
 * Local Qwen proposes the repair; this script only copies fixtures and
 * applies Qwen-delimited BEFORE/AFTER onto fixture copies.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, cpSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { dataDir, repoRoot } from "../paths.mjs";
import { checkTsSyntax, excerptAround, formatDiagnostics } from "../mission/syntax.mjs";
import { ollamaChat } from "./ollama.mjs";

const drillRoot = join(dataDir, "overnight", "repair-drill");
const SRC_DRUM = join(
  dataDir,
  "missions/fire-drum-fill-preview-live/attribution/009-repair/files/src/components/FireCommand/DrumMachine.tsx",
);
const SRC_SEQ = join(
  dataDir,
  "missions/fire-drum-fill-preview-live/attribution/012-repair/files/src/components/FireCommand/SequencerPanel.tsx",
);

function extractBeforeAfter(text) {
  const raw = String(text || "");
  const before = raw.match(/BEFORE:\s*\n+```(?:tsx|ts|jsx)?\n([\s\S]*?)```/i)
    || raw.match(/BEFORE:\s*\n+([\s\S]*?)\n+AFTER:/i);
  const after = raw.match(/AFTER:\s*\n+```(?:tsx|ts|jsx)?\n([\s\S]*?)```/i)
    || raw.match(/AFTER:\s*\n+```?\n?([\s\S]*?)(?:```|$)/i);
  return {
    before: before ? before[1].trim() : "",
    after: after ? after[1].trim() : "",
  };
}

function applyOnce(source, before, after) {
  if (!before || after == null || after === "") return { ok: false, reason: "missing-before-after" };
  const idx = source.indexOf(before);
  if (idx < 0) return { ok: false, reason: "before-not-found" };
  return { ok: true, source: source.slice(0, idx) + after + source.slice(idx + before.length) };
}

function syntaxReport(rel, source) {
  return checkTsSyntax(rel, source);
}

function windowsFor(source, diagnostics, n = 2) {
  return (diagnostics || []).slice(0, n).map((d) => {
    const pos = Math.max(0, source.split(/\n/).slice(0, d.line - 1).join("\n").length);
    const ex = excerptAround(source, pos, 8);
    return `${d.file}:${d.line}:${d.column} ${d.code} ${d.diagnostic}\n${ex.text}`;
  }).join("\n\n");
}

async function diagnose(model, rel, source, diagnostics) {
  const user = `You are repairing a TypeScript JSX syntax failure in an isolated fixture copy.
Do not redesign the feature. Do not invent new callbacks or store usage.
Output exactly:
HYPOTHESIS:
FAULT LOCATION:
MINIMAL REPAIR:
BEFORE:
\`\`\`tsx
<exact current source snippet to replace>
\`\`\`
AFTER:
\`\`\`tsx
<exact replacement snippet>
\`\`\`

FILE: ${rel}

DIAGNOSTICS:
${formatDiagnostics(diagnostics, 8)}

SOURCE WINDOWS:
${windowsFor(source, diagnostics, 3)}
`;
  const started = Date.now();
  const res = await ollamaChat({
    model,
    user,
    temperature: 0,
    numPredict: 1200,
    numCtx: 16384,
    timeoutMs: 180000,
  });
  return { ...res, durationMs: Date.now() - started, prompt: user };
}

async function drillFile(label, absSrc, rel, model = "qwen3.5:9b", maxAttempts = 2) {
  const destDir = join(drillRoot, "fixtures", label);
  mkdirSync(destDir, { recursive: true });
  const dest = join(destDir, rel.split("/").pop());
  cpSync(absSrc, dest);
  const original = readFileSync(dest, "utf8");
  let current = original;
  const gate0 = syntaxReport(rel, current);
  const attempts = [];
  for (let i = 1; i <= maxAttempts; i++) {
    const gate = syntaxReport(rel, current);
    if (gate.ok) break;
    const inv = await diagnose(model, rel, current, gate.diagnostics);
    const ba = extractBeforeAfter(inv.text);
    const applied = applyOnce(current, ba.before, ba.after);
    if (applied.ok) current = applied.source;
    writeFileSync(join(destDir, `attempt-${i}-${model.replace(/[^a-z0-9.]+/gi, "_")}.md`), inv.text || "", "utf8");
    if (applied.ok) writeFileSync(join(destDir, `attempt-${i}.tsx`), current, "utf8");
    const after = syntaxReport(rel, current);
    attempts.push({
      n: i,
      model,
      durationMs: inv.durationMs,
      evalCount: inv.evalCount,
      totalDurationNs: inv.totalDurationNs,
      applied: applied.ok,
      applyReason: applied.reason || null,
      diagnosticsBefore: gate.diagnostics.slice(0, 6),
      diagnosticsAfter: after.diagnostics.slice(0, 6),
      syntaxOkAfter: after.ok,
    });
    if (after.ok) break;
  }
  const finalGate = syntaxReport(rel, current);
  return {
    label,
    rel,
    source: absSrc,
    bytes: original.length,
    syntaxCaughtInitially: !gate0.ok,
    initialDiagnostics: gate0.diagnostics.slice(0, 8),
    attempts,
    finalSyntaxOk: finalGate.ok,
    finalDiagnostics: finalGate.diagnostics.slice(0, 8),
  };
}

async function plannerAB(rel, source, diagnostics) {
  const user = `Text-only repair advisor. No tools. Same broken excerpt and diagnostic.
Return HYPOTHESIS, FAULT LOCATION, MINIMAL REPAIR, then BEFORE/AFTER snippets.

FILE: ${rel}
DIAGNOSTICS:
${formatDiagnostics(diagnostics, 6)}
SOURCE WINDOWS:
${windowsFor(source, diagnostics, 2)}
`;
  const a = await ollamaChat({ model: "qwen3.5:9b", user, temperature: 0, numPredict: 900, timeoutMs: 180000 });
  const b = await ollamaChat({ model: "qwen2.5-coder:14b", user, temperature: 0, numPredict: 900, timeoutMs: 180000 });
  return {
    user,
    a: { model: "qwen3.5:9b", text: a.text, evalCount: a.evalCount, totalDurationNs: a.totalDurationNs },
    b: { model: "qwen2.5-coder:14b", text: b.text, evalCount: b.evalCount, totalDurationNs: b.totalDurationNs },
  };
}

export async function runRepairDrill({ log = console.log } = {}) {
  mkdirSync(drillRoot, { recursive: true });
  if (!existsSync(SRC_DRUM)) throw new Error(`missing drum snapshot ${SRC_DRUM}`);
  log("repair drill: DrumMachine 009-repair fixture");
  const drum = await drillFile("drum-009", SRC_DRUM, "src/components/FireCommand/DrumMachine.tsx");
  log(`  caught=${drum.syntaxCaughtInitially} finalOk=${drum.finalSyntaxOk} attempts=${drum.attempts.length}`);
  let seq = null;
  if (existsSync(SRC_SEQ)) {
    log("repair drill: SequencerPanel 012-repair fixture");
    seq = await drillFile("seq-012", SRC_SEQ, "src/components/FireCommand/SequencerPanel.tsx");
    log(`  caught=${seq.syntaxCaughtInitially} finalOk=${seq.finalSyntaxOk} attempts=${seq.attempts.length}`);
  }
  const fails = [drum, seq].filter(Boolean).filter((x) => !x.finalSyntaxOk).length;
  let ab = null;
  if (fails >= 1 && drum && !drum.finalSyntaxOk && (drum.attempts.length >= 2 || fails >= 2)) {
    log("9B failed drill; running 14B text-only A/B on DrumMachine excerpt");
    const src = readFileSync(join(drillRoot, "fixtures/drum-009", "DrumMachine.tsx"), "utf8");
    ab = await plannerAB("src/components/FireCommand/DrumMachine.tsx", src, drum.finalDiagnostics.length ? drum.finalDiagnostics : drum.initialDiagnostics);
    writeFileSync(join(drillRoot, "ab-14b.md"), `# 9B\n\n${ab.a.text}\n\n# 14B\n\n${ab.b.text}\n`, "utf8");
  }
  const report = {
    at: new Date().toISOString(),
    productionTouched: false,
    cursorRepairedFixture: false,
    drum,
    seq,
    ab,
  };
  writeFileSync(join(drillRoot, "REPORT.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  writeFileSync(join(drillRoot, "REPORT.md"), `# Repair drill

- productionTouched: false
- cursorRepairedFixture: false
- DrumMachine syntax caught: ${drum.syntaxCaughtInitially}
- DrumMachine 9B final syntax ok: ${drum.finalSyntaxOk}
- DrumMachine attempts: ${drum.attempts.length}
- SequencerPanel syntax caught: ${seq?.syntaxCaughtInitially ?? "(skipped)"}
- SequencerPanel 9B final syntax ok: ${seq?.finalSyntaxOk ?? "(skipped)"}
- 14B A/B: ${ab ? "yes" : "no"}
`, "utf8");
  return report;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  runRepairDrill().then((r) => {
    console.log(JSON.stringify({ ok: true, drum: r.drum.finalSyntaxOk, seq: r.seq?.finalSyntaxOk, ab: Boolean(r.ab) }, null, 2));
  }).catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
