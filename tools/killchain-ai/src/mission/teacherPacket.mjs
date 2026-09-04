/**
 * Teacher escalation: deterministic packet out, validated contract back.
 *
 * The point of this module is that the SENIOR model (Cursor/Opus today, a
 * remote NIM-class model later) is a swappable component, not an architectural
 * dependency. The foreman decides when to escalate, decides what evidence the
 * teacher is allowed to see, and validates the teacher's answer against the
 * repository before any of it reaches an execution phase.
 *
 * Teacher output is ADVISORY. `validateTeacherResponse` exists so that a
 * confident, fluent, wrong answer from a large model cannot enter EDITING.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { repoRoot } from "../paths.mjs";
import { readText } from "./store.mjs";
import { checkTsSyntax, formatDiagnostics, buildStructurePacket } from "./syntax.mjs";
import { checkIdentifiers, formatIdentifierPacket } from "./identifierGate.mjs";
import { scanStructure } from "./jsxStructure.mjs";

/** Hard ceiling so escalation never degenerates into "send the repo". */
export const PACKET_BUDGET = {
  totalChars: 120000,
  sourceWindowLines: 90,
  attemptChars: 6000,
  diffChars: 20000,
};

/** Invariants selected by which subsystem the mission actually touches. */
const INVARIANT_SETS = {
  audio: [
    "Only rewireFront() may mutate front routing gains.",
    "Only claimSource() may decide playback ownership.",
    "Only MISSION STATE may react to source changes.",
    "Live audio-tap nodes must be disconnected in finally blocks.",
    "Preserve the one-audible-source rule.",
    "Preserve the one-high-rate-FFT-pipeline design.",
  ],
  state: [
    "Store writes and matching AudioEngine calls must occur in the same synchronous action.",
    "Persistence failures must call reportStorageFailure.",
    "Intervals and requestAnimationFrame loops must be cleaned up.",
  ],
  ui: [
    "Presentation-only changes must not alter interaction behaviour or focus order.",
    "Intervals and requestAnimationFrame loops must be cleaned up.",
  ],
};

function classifySubsystem(paths) {
  const p = (paths || []).join(" ");
  if (/src\/audio\//.test(p)) return "audio";
  if (/src\/state\//.test(p)) return "state";
  return "ui";
}

function windowAround(source, line, span = PACKET_BUDGET.sourceWindowLines) {
  const lines = String(source || "").split(/\r?\n/);
  const start = Math.max(1, line - Math.floor(span / 3));
  const end = Math.min(lines.length, start + span);
  return lines
    .slice(start - 1, end)
    .map((l, i) => `${String(start + i).padStart(5)}| ${l}`)
    .join("\n");
}

function clip(s, n) {
  const t = String(s || "");
  return t.length <= n ? t : `${t.slice(0, n)}\n[truncated ${t.length - n} chars]`;
}

/**
 * Build the escalation packet for a mission directory.
 *
 * @param {object} args
 * @param {string} args.missionDir
 * @param {object} args.spec        normalized mission spec
 * @param {object} args.status      mission status
 * @param {object} [args.classification] output of classifyFailure
 * @param {string[]} [args.files]   files under repair
 * @param {(rel:string)=>string|null} [args.readRepo] source reader (for tests)
 */
export function buildTeacherPacket({ missionDir, spec, status, classification, files, readRepo } = {}) {
  const dir = missionDir;
  const read = readRepo || ((rel) => {
    const abs = join(repoRoot, rel);
    return existsSync(abs) ? readFileSync(abs, "utf8") : null;
  });

  const targets = (files && files.length ? files : (spec?.allowedPaths || [])).filter(Boolean);
  const subsystem = classifySubsystem(targets);

  let syntax = {};
  try { syntax = JSON.parse(readText(dir, "syntax-gate.json") || "{}"); } catch { syntax = {}; }
  let identGate = {};
  try { identGate = JSON.parse(readText(dir, "ident-gate.json") || "{}"); } catch { identGate = {}; }

  const sections = {};

  sections["TASK.md"] = `# TASK

id: ${spec?.id}
title: ${spec?.title}
level: ${spec?.level} (${spec?.levelInfo?.name || "?"})
subsystem: ${subsystem}

## GOAL
${spec?.goal || "(none)"}

## ACCEPTANCE
${(spec?.acceptance || []).map((a) => `- ${a}`).join("\n") || "- (none listed)"}

## EDITABLE PATHS
${(spec?.allowedPaths || []).map((p) => `- ${p}`).join("\n") || "- (none — read-only mission)"}

## FILES CURRENTLY UNDER REPAIR
${targets.map((p) => `- ${p}`).join("\n") || "- (none)"}
`;

  sections["MISSION.json"] = JSON.stringify({
    state: status?.state,
    phaseIndex: status?.phaseIndex,
    modelCalls: status?.modelCalls,
    syntaxFailures: status?.syntaxFailures,
    identFailures: status?.identFailures,
    repairRetries: status?.repairRetries,
    emptyEditStreak: status?.emptyEditStreak,
    transactionalRetries: status?.transactionalRetries,
    failureClassCounts: status?.failureClassCounts,
    lastFailureClass: status?.lastFailureClass,
    lastEscalation: status?.lastEscalation,
    unixViolations: status?.unixViolations,
    visibleTextMisses: status?.visibleTextMisses,
  }, null, 2);

  sections["INVARIANTS.md"] = `# INVARIANTS IN SCOPE (${subsystem})

${INVARIANT_SETS[subsystem].map((i) => `- ${i}`).join("\n")}

These are non-negotiable. A recommendation that violates one will be rejected by
the foreman regardless of how well it is argued.
`;

  sections["FAILURE.json"] = JSON.stringify(classification || { failureClass: "UNKNOWN" }, null, 2);

  sections["COMPILER.txt"] = clip(
    (syntax.diagnostics || []).length
      ? formatDiagnostics(syntax.diagnostics, 20)
      : (readText(dir, "validation.json") || "(no diagnostics on disk)"),
    12000,
  );

  // The deterministic analyses. A teacher that has these does not need the
  // whole file, which is what keeps the packet small.
  const structureBlocks = [];
  const scopeBlocks = [];
  for (const rel of targets) {
    const src = read(rel);
    if (!src) continue;
    if (/\.(tsx?|jsx?)$/i.test(rel)) {
      const scan = scanStructure(src, { jsx: /\.(tsx|jsx)$/i.test(rel) });
      if (!scan.ok) {
        const diags = checkTsSyntax(rel, src).diagnostics;
        structureBlocks.push(buildStructurePacket(rel, src, diags).markdown);
      }
      const ident = checkIdentifiers(rel, src);
      if (!ident.ok) scopeBlocks.push(ident);
    }
  }
  if (structureBlocks.length) sections["STRUCTURE.md"] = clip(structureBlocks.join("\n\n---\n\n"), 24000);
  if (scopeBlocks.length) sections["SCOPE.md"] = clip(formatIdentifierPacket(scopeBlocks), 8000);

  // Minimal source windows only, anchored on the real fault lines.
  const sourceWindows = [];
  for (const rel of targets) {
    const src = read(rel);
    if (!src) continue;
    const diags = /\.(tsx?|jsx?)$/i.test(rel) ? checkTsSyntax(rel, src).diagnostics : [];
    const scan = /\.(tsx?|jsx?)$/i.test(rel) ? scanStructure(src, { jsx: /\.(tsx|jsx)$/i.test(rel) }) : { firstDivergence: null };
    const line = scan.firstDivergence?.line || diags[0]?.line || 1;
    sourceWindows.push(`--- ${rel} (window around line ${line}) ---\n${windowAround(src, line)}`);
  }
  if (sourceWindows.length) sections["SOURCE_WINDOWS.txt"] = clip(sourceWindows.join("\n\n"), 30000);

  sections["PLAN.md"] = clip(readText(dir, "PLAN.md") || "(none)", 8000);
  sections["PROPOSAL.md"] = clip(readText(dir, "ORIGINAL_PROPOSAL.md") || readText(dir, "PROPOSAL.md") || "(none)", 8000);
  sections["CURRENT_DIFF.patch"] = clip(readText(dir, "CURRENT.diff") || "(none)", PACKET_BUDGET.diffChars);

  const attempts = [
    ["REPAIR_DIAGNOSIS.md", readText(dir, "REPAIR_DIAGNOSIS.md")],
    ["JOURNAL.md", readText(dir, "JOURNAL.md")],
  ].filter(([, v]) => v && v.trim());
  sections["STUDENT_ATTEMPTS.md"] = attempts.length
    ? attempts.map(([k, v]) => `## ${k}\n${clip(v, PACKET_BUDGET.attemptChars)}`).join("\n\n")
    : "(no recorded student attempts)";

  sections["QUESTIONS.md"] = questionsFor(classification, targets);

  const packet = { sections, subsystem, targets, failureClass: classification?.failureClass || "UNKNOWN" };
  packet.totalChars = Object.values(sections).reduce((s, v) => s + String(v).length, 0);
  packet.withinBudget = packet.totalChars <= PACKET_BUDGET.totalChars;
  return packet;
}

/** Failure-class-specific questions. A teacher answering prose gets prose back. */
function questionsFor(classification, targets) {
  const cls = classification?.failureClass || "UNKNOWN";
  const common = [
    "Which single edit is the minimum that satisfies the deterministic analyses above?",
    "What did the student assume that the repository does not support?",
    "Which acceptance criterion is still unproven after your recommended repair?",
  ];
  const specific = {
    MECHANICAL_SYNTAX: [
      "Is the correct repair to DELETE a surplus closer or to RESTORE a deleted opener? Cite the scanner counts.",
      "After your repair, what should surplus/unclosed/mismatched all equal?",
    ],
    INVENTED_SYMBOL: [
      "For each unresolved identifier, name the exact in-scope replacement or the exact import to add.",
      "Is the correct access pattern the hook or a direct store reference in this file?",
    ],
    APPLY_EMPTY: [
      "Is this a tooling failure or does the student believe no change is required?",
      "If no change is required, what evidence should make the foreman BLOCK instead of retry?",
    ],
    RETRIEVAL_INVENTED: [
      "Which real file holds the symbol the student attached to a non-existent path?",
    ],
    PRODUCT_AMBIGUITY: [
      "Is the mission premise actually false? If so, say BLOCK and why.",
    ],
  };
  return `# QUESTIONS FOR THE TEACHER

Failure class: ${cls}
Files: ${targets.join(", ") || "(none)"}

${[...(specific[cls] || []), ...common].map((q, i) => `${i + 1}. ${q}`).join("\n")}

Answer using the TEACHER RESPONSE CONTRACT exactly. Unstructured prose will be
rejected by the foreman and the escalation will count as failed.
`;
}

/** The response shape the foreman can machine-check. */
export const TEACHER_CONTRACT_FIELDS = [
  "DIAGNOSIS",
  "EVIDENCE",
  "ROOT_CAUSE",
  "FAILED_STUDENT_ASSUMPTION",
  "RECOMMENDED_REPAIR",
  "FILES",
  "SYMBOLS",
  "RISKS",
  "VALIDATION",
  "CONFIDENCE",
];

export function teacherContractTemplate() {
  return `TEACHER RESPONSE CONTRACT — emit these labels, each on its own line:

DIAGNOSIS: <one sentence: what is actually wrong>
EVIDENCE: <cite the deterministic analysis / diagnostic lines you relied on>
ROOT_CAUSE: <why it happened, not just what is broken>
FAILED_STUDENT_ASSUMPTION: <the belief the student held that the repo contradicts>
RECOMMENDED_REPAIR: <the minimum change, precise enough to apply without redesign>
FILES: <comma-separated repo-relative paths that must change>
SYMBOLS: <comma-separated symbols involved, or NONE>
RISKS: <what could regress>
VALIDATION: <the exact gates that must pass to consider this fixed>
CONFIDENCE: <HIGH|MEDIUM|LOW>

Optional:
EXACT_PATCH_GUIDANCE: <before/after for a single mechanical edit>

Your answer is ADVISORY. The foreman validates FILES and SYMBOLS against the
repository and will discard recommendations that reference things that do not
exist, or that touch paths outside the mission's editable set.`;
}

function field(raw, name) {
  const m = String(raw || "").match(new RegExp(`^\\s*(?:#{1,3}\\s*)?\\*{0,2}${name}\\*{0,2}\\s*:\\s*(.+)$`, "im"));
  return m ? m[1].trim() : "";
}

/**
 * Deterministically validate a teacher reply. This is the guard that keeps a
 * smarter model from bypassing the foreman: no matter how confident the
 * teacher is, unreal files, unreal symbols, and out-of-scope paths are
 * rejected here, before anything reaches an execution phase.
 */
export function validateTeacherResponse(text, { spec, readRepo } = {}) {
  const read = readRepo || ((rel) => {
    const abs = join(repoRoot, rel);
    return existsSync(abs) ? readFileSync(abs, "utf8") : null;
  });
  const parsed = {};
  for (const f of TEACHER_CONTRACT_FIELDS) parsed[f] = field(text, f);
  parsed.EXACT_PATCH_GUIDANCE = field(text, "EXACT_PATCH_GUIDANCE");

  const errors = [];
  const missing = TEACHER_CONTRACT_FIELDS.filter((f) => !parsed[f]);
  if (missing.length) errors.push(`missing-fields:${missing.join(",")}`);

  const confidence = parsed.CONFIDENCE.toUpperCase();
  if (confidence && !["HIGH", "MEDIUM", "LOW"].includes(confidence)) {
    errors.push(`bad-confidence:${parsed.CONFIDENCE}`);
  }

  const files = parsed.FILES
    ? parsed.FILES.split(",").map((s) => s.trim().replace(/^`|`$/g, "")).filter(Boolean).filter((s) => !/^none$/i.test(s))
    : [];
  const invented = files.filter((f) => read(f) === null);
  if (invented.length) errors.push(`invented-files:${invented.join(",")}`);

  const allowed = spec?.allowedPaths || [];
  const outOfScope = allowed.length
    ? files.filter((f) => !allowed.some((pat) => f === pat || f.startsWith(pat.replace(/\*+$/, ""))))
    : [];
  if (outOfScope.length) errors.push(`outside-allowed:${outOfScope.join(",")}`);

  const symbols = parsed.SYMBOLS
    ? parsed.SYMBOLS.split(",").map((s) => s.trim().replace(/^`|`$/g, "")).filter(Boolean).filter((s) => !/^none$/i.test(s))
    : [];
  const unresolvedSymbols = [];
  for (const sym of symbols) {
    const found = files.some((f) => {
      const src = read(f);
      return src ? new RegExp(`\\b${sym.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(src) : false;
    });
    if (!found && files.length) unresolvedSymbols.push(sym);
  }
  if (unresolvedSymbols.length) errors.push(`symbols-not-found:${unresolvedSymbols.join(",")}`);

  // A teacher that cites no evidence is guessing with authority.
  if (parsed.EVIDENCE && parsed.EVIDENCE.length < 20) errors.push("evidence-too-thin");

  return {
    ok: errors.length === 0,
    advisory: true,
    parsed,
    files,
    symbols,
    confidence: confidence || null,
    errors,
  };
}

/** Write the packet to disk for a human or a remote teacher to consume. */
export function writeTeacherPacket(destDir, packet) {
  mkdirSync(destDir, { recursive: true });
  for (const [name, body] of Object.entries(packet.sections)) {
    const abs = join(destDir, name);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, typeof body === "string" ? body : JSON.stringify(body, null, 2));
  }
  writeFileSync(join(destDir, "CONTRACT.md"), teacherContractTemplate());
  writeFileSync(join(destDir, "MANIFEST.json"), JSON.stringify({
    failureClass: packet.failureClass,
    subsystem: packet.subsystem,
    targets: packet.targets,
    totalChars: packet.totalChars,
    withinBudget: packet.withinBudget,
    sections: Object.keys(packet.sections),
  }, null, 2));
  return destDir;
}
