import { existsSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "../paths.mjs";
import { matchPath, pathForbidden } from "./schema.mjs";
import { isKillchainMcpTool } from "./unix.mjs";
import { scanFireCommandPanels } from "../ui/scanFireCommand.mjs";

const PRAISE_RE = /\b(looks good|comprehensive plan|all criteria met|well done|excellent work|great job|\blgtm\b|nothing to criticize|no issues found|perfect plan|solid plan)\b/i;

export function parseCritic(text) {
  const raw = String(text || "").trim();
  const m = raw.match(/VERDICT:\s*\**\s*`*(PASS|FAIL|BLOCK|READY|NOT_READY)`*/i)
    || raw.match(/#{1,3}\s*VERDICT\s*\n+\s*\**\s*`*(PASS|FAIL|BLOCK|READY|NOT_READY)`*/i)
    || raw.match(/\*\*VERDICT:\*\*\s*`*(PASS|FAIL|BLOCK|READY|NOT_READY)`*/i)
    // `## VERDICT READY` / `VERDICT - READY`: label and value on one line with
    // no colon. Archived `cover-store-readonly-overnight` lost a fully
    // grounded review to this alone.
    || raw.match(/^#{0,3}\s*\**\s*VERDICT\**\s*[-—]?\s+\**\s*`*(PASS|FAIL|BLOCK|READY|NOT_READY)`*/im);
  const verdict = m ? m[1].toUpperCase() : null;
  const findings = [];
  for (const line of raw.split(/\r?\n/)) {
    const b = line.match(/^\s*[-*]\s+(.+)/);
    if (b) findings.push(b[1].trim());
  }
  return {
    verdict: verdict || "FAIL",
    missingVerdict: !verdict,
    findings,
    inspected: field(raw, "INSPECTED"),
    risk: field(raw, "RISK"),
    evidence: field(raw, "EVIDENCE"),
    raw,
  };
}

/**
 * Mechanical near-miss only. Copies a verdict token that is already present
 * in a non-contract form (JSON key, etc.). Never infers PASS from praise.
 */
export function tryLocalVerdictNormalize(text) {
  const raw = String(text || "");
  const parsed = parseCritic(raw);
  if (!parsed.missingVerdict) {
    return { text: raw, repaired: false, verdict: parsed.verdict };
  }
  const json = raw.match(/["']verdict["']\s*:\s*["'](PASS|FAIL|BLOCK|READY|NOT_READY)["']/i);
  if (json) {
    const v = json[1].toUpperCase();
    return { text: `${raw.trim()}\nVERDICT: ${v}`, repaired: true, verdict: v };
  }
  return { text: raw, repaired: false, verdict: null };
}

/**
 * Format-repair models often emit only `VERDICT: PASS` and drop the review.
 * Never let a stamp-only reply replace a longer prior critic.
 */
export function mergeCriticRepair(prior, next) {
  const p = String(prior || "").trim();
  const n = String(next || "").trim();
  if (!n) return p;
  if (!p) return n;
  const lineCount = n.split(/\r?\n/).filter((l) => l.trim()).length;
  const stampOnly = n.length < 800 && lineCount <= 12
    && /VERDICT:\s*(PASS|FAIL|BLOCK|READY|NOT_READY)/i.test(n)
    && parseMentionedPaths(n).length === 0;
  if (stampOnly) return `${p}\n\n${n}`;
  return n;
}

function field(raw, name) {
  const same = String(raw).match(new RegExp(`^(?:#{1,3}\\s*)?${name}:\\s*(.+)$`, "im"));
  if (same && !/^#{1,3}/.test(same[0])) return same[1].trim();
  if (same && same[1] && !/^\s*$/.test(same[1]) && !/^#{1,3}/.test(same[1])) return same[1].trim();
  const heading = String(raw).match(new RegExp(`^#{1,3}\\s*${name}\\s*$\\r?\\n+([\\s\\S]*?)(?=\\r?\\n#{1,3}\\s|\\nVERDICT:|$)`, "im"));
  if (heading) return heading[1].trim().slice(0, 1200);
  return "";
}

export function parseMentionedPaths(text) {
  const set = new Set();
  const re = /(?:^|[`'"*\s(\[])((?:src|electron|scripts)\/[A-Za-z0-9_./-]+\.(?:tsx|mjs|ts|js|css|json))/gm;
  let m;
  while ((m = re.exec(String(text || "")))) {
    set.add(m[1].replace(/\\/g, "/"));
  }
  const loose = /(?:^|[`'"\s(\[])((?:FireCommand\/)?[A-Za-z][A-Za-z0-9_-]*\.tsx)\b/gm;
  while ((m = loose.exec(String(text || "")))) {
    const raw = m[1].replace(/\\/g, "/");
    const rel = raw.startsWith("src/") ? raw : (raw.startsWith("FireCommand/") ? `src/components/${raw}` : `src/components/FireCommand/${raw}`);
    if (repoFileExists(rel)) set.add(rel);
  }
  return [...set];
}

export function inListed(rel, patterns) {
  return (patterns || []).some((pat) => matchPath(rel, pat));
}

export function contextAround(text, needle, pad = 320) {
  const src = String(text || "");
  const i = src.indexOf(needle);
  if (i < 0) return "";
  return src.slice(Math.max(0, i - pad), i + needle.length + pad);
}

const EDIT_CTX = /\b(edit candidate|intended modification|expected to change|would change|proposed edit|proposed change|proposed after|modification:|after —|later edit|\bchange\b|\bmodify\b|\bedit\b)\b/i;

export function classifyReferencedPaths(text) {
  const paths = parseMentionedPaths(text);
  const inspect = [];
  const edit = [];
  const created = [];
  for (const p of paths) {
    const ctx = contextAround(text, p);
    const isNew = /\bNEW FILE\b/i.test(ctx);
    if (isNew) created.push(p);
    else if (/\binspect[- ]only\b/i.test(ctx)) inspect.push(p);
    else if (EDIT_CTX.test(ctx)) edit.push(p);
    else inspect.push(p);
  }
  return { paths, inspect, edit, created };
}

export function repoFileExists(rel) {
  const p = String(rel || "").replace(/\\/g, "/");
  if (!p || p.includes("..") || /^[a-zA-Z]:/.test(p) || p.startsWith("/")) return false;
  return existsSync(join(repoRoot, p));
}

export function checkReferencedFilesExist(text) {
  const { paths, created } = classifyReferencedPaths(text);
  const missing = [];
  for (const p of paths) {
    if (created.includes(p)) continue;
    if (!repoFileExists(p)) missing.push(p);
  }
  return { ok: missing.length === 0, missing, created, paths };
}

/**
 * Inner FireCommandView *Panel functions are not sibling files.
 * Treat DrivePanel.tsx as invented when cited as a real path/edit/inspect target,
 * not when the text merely forbids inventing it.
 */
export function findInventedInnerPanelFiles(text, innerWithoutFile = null) {
  const names = innerWithoutFile || (scanFireCommandPanels().innerPanelsWithoutSiblingFile || []);
  const src = String(text || "");
  const found = [];
  for (const name of names) {
    const full = new RegExp(`src/components/FireCommand/${name}\\.tsx\\b`);
    const cited = new RegExp(
      `(?:INSPECTED|FILE|edit candidate|intended modification|NEW FILE|change|modify|edit)\\b[^\\n]{0,120}${name}\\.tsx\\b`,
      "i",
    );
    const tickPath = new RegExp("`(?:src/components/FireCommand/)?" + name + "\\.tsx`");
    if (full.test(src) || cited.test(src) || tickPath.test(src)) {
      found.push(`src/components/FireCommand/${name}.tsx`);
    }
  }
  return [...new Set(found)];
}

/** Vue SFCs are never valid in this React/TSX app. */
export function findWrongStackPaths(text) {
  const set = new Set();
  const re = /(?:^|[`'"\s(\[])((?:src\/)?[A-Za-z0-9_./-]+\.vue)\b/g;
  let m;
  while ((m = re.exec(String(text || "")))) set.add(m[1].replace(/\\/g, "/"));
  return [...set];
}

/** Existing repo files must not be labeled NEW FILE. */
export function existingMarkedNew(text) {
  const { created } = classifyReferencedPaths(text);
  return created.filter((p) => repoFileExists(p));
}

export function checkEditTargetsAllowed(text, spec) {
  const { edit, created } = classifyReferencedPaths(text);
  const problems = [];
  const futureCandidates = (spec.level || 0) === 0 || spec.dryRun;
  for (const p of [...edit, ...created]) {
    if (pathForbidden(p, spec) && !inListed(p, spec.readOnlyPaths)) {
      problems.push({ path: p, reason: "forbidden" });
      continue;
    }
    const allowed = inListed(p, spec.allowedPaths);
    if (allowed) continue;
    if (futureCandidates && repoFileExists(p) && inListed(p, spec.readOnlyPaths)) continue;
    problems.push({ path: p, reason: "outside-allowed" });
  }
  return { ok: problems.length === 0, problems, edit, created };
}

/**
 * Proposal may mention read-only files. Edit targets must be allowed.
 * Kept for callers; prefer checkEditTargetsAllowed for the gate.
 */
export function proposalScopeCheck(text, spec, { dryRun = false } = {}) {
  const scoped = checkEditTargetsAllowed(text, spec);
  if (!dryRun && spec.levelInfo?.edits) return {
    paths: parseMentionedPaths(text),
    problems: scoped.problems,
  };
  const paths = parseMentionedPaths(text);
  const problems = [];
  for (const p of paths) {
    if (pathForbidden(p, spec) && !inListed(p, spec.readOnlyPaths) && EDIT_CTX.test(contextAround(text, p))) {
      problems.push({ path: p, reason: "forbidden" });
    }
  }
  return { paths, problems: [...problems, ...scoped.problems.filter((p) => p.reason === "outside-allowed" || p.reason === "forbidden")] };
}

export function criticEvidenceOk(parsed) {
  if (parsed.missingVerdict) return { ok: false, reason: "missing-verdict" };
  if (parsed.verdict === "FAIL" || parsed.verdict === "BLOCK" || parsed.verdict === "NOT_READY") {
    return { ok: true, reason: "negative-verdict" };
  }
  if (parsed.verdict !== "PASS" && parsed.verdict !== "READY") {
    return { ok: false, reason: "missing-verdict" };
  }
  const raw = parsed.raw || "";
  const paths = parseMentionedPaths(raw);
  const hasInspected = (parsed.inspected || "").length >= 8 || paths.length >= 1;
  const hasRisk = (parsed.risk || "").length >= 12 || /\b(risk|regression|could break|could fail|invariant|coupling|unchanged click|focus ring|persist|scope creep)\b/i.test(raw);
  const hasEvidence = (parsed.evidence || "").length >= 12 || /\b(inspect(?:ed)?|checked|because|evidence|line \d+|read `)/i.test(raw);
  if (!hasInspected) return { ok: false, reason: "no-inspected-files" };
  if (!hasRisk) return { ok: false, reason: "no-risk" };
  if (!hasEvidence) return { ok: false, reason: "no-evidence" };
  if (PRAISE_RE.test(raw) && !/\b(risk|regression|could break|could fail)\b/i.test(raw)) {
    return { ok: false, reason: "praise-only" };
  }
  return { ok: true, reason: "grounded" };
}

function isCriticInspectTool(name) {
  const n = String(name || "").toLowerCase();
  if (isKillchainMcpTool(name) || n === "read" || n === "glob") return true;
  // OpenCode file inspect often lands on bash/grep even when unix discipline flags it.
  return n === "bash" || n === "grep";
}

export function criticToolsOk(toolNames, spec) {
  const names = toolNames || [];
  const used = names.some((n) => isCriticInspectTool(n));
  const requireTools = (spec?.level || 0) >= 1;
  return { ok: !requireTools || used, used, requireTools, names };
}

/**
 * Tool count is telemetry; evidence quality is the requirement.
 *
 * A critic handed the real diff, source excerpts and validation output in its
 * prompt has authoritative evidence already. Forcing it to re-read those files
 * only to satisfy a counter produced expensive retries and at least one
 * archived false BLOCK (`critic-no-tools`).
 *
 * A critic is grounded when EITHER it inspected the repo itself, OR every path
 * it cites is corroborated verbatim by the authoritative evidence it was given.
 * Citing a path that appears nowhere — neither read nor supplied — is still
 * ungrounded, which is the case the original rule was really protecting against.
 *
 * Grounding deliberately does NOT reject on content. A corroborated path means
 * the critic was looking at a real file; inventing *facts* about a real file is
 * caught downstream by checkReferencedFilesExist, findInventedInnerPanelFiles
 * and checkInventedSymbolsAsync. Gating here on identifier overlap rejected
 * ordinary prose — "plan confirms glow uses spring physics with 300ms duration"
 * reads as seven unsupported identifiers — so those identifiers are reported as
 * telemetry (`unsupportedIdentifiers`) and do not affect the verdict.
 */
export function criticGroundingOk({ criticText = "", tools = [], spec, suppliedEvidence = "" } = {}) {
  const toolsGate = criticToolsOk(tools, spec);
  if (!toolsGate.requireTools || toolsGate.used) {
    return { ok: true, via: toolsGate.used ? "tools" : "not-required", toolsGate, corroborated: [], uncorroborated: [] };
  }

  const supplied = String(suppliedEvidence || "");
  const cited = parseMentionedPaths(criticText);

  // Also parse the critic's structured fields to check evidence content
  const parsedCritic = parseCritic(criticText);
  const evidenceText = String(parsedCritic.evidence || "");

  if (!supplied.trim() || !cited.length) {
    return { ok: false, via: "none", reason: "critic-no-tools", toolsGate, corroborated: [], uncorroborated: cited };
  }

  const corroborated = cited.filter((p) => supplied.includes(p));
  const uncorroborated = cited.filter((p) => !supplied.includes(p));

  // Path grounding: every cited path must be in supplied evidence
  const ok = corroborated.length >= 1 && uncorroborated.length === 0;

  // Telemetry only — see the note above. Reported so a future gate (or the
  // Mediator) can reason about claim support without this function rejecting on it.
  const evidenceIdentifiers = extractEvidenceIdentifiers(evidenceText);
  const unsupportedIdentifiers = evidenceIdentifiers.filter((id) => !supplied.includes(id));

  return {
    ok,
    via: ok ? "supplied-evidence" : "none",
    reason: ok ? null : "critic-no-tools",
    toolsGate,
    corroborated,
    uncorroborated,
    unsupportedIdentifiers,
  };
}

/**
 * Extract substantive identifiers from critic evidence text that should be
 * verifiable against trusted supplied evidence.
 * Includes: GLSL/TypeScript identifiers, diagnostic symbols, uniform names,
 * function names, variable names (3+ chars to avoid noise).
 */
function extractEvidenceIdentifiers(text) {
  const raw = String(text || "");
  if (!raw.trim()) return [];

  const ids = new Set();

  // GLSL/TS identifiers: camelCase, snake_case, PascalCase (3+ chars)
  const idRe = /\b(?:[a-z]+[A-Z][a-zA-Z0-9]*|[A-Z][a-zA-Z0-9]*|[a-z_][a-z0-9_]{2,})\b/g;
  let m;
  while ((m = idRe.exec(raw))) {
    const id = m[0];
    // Filter out common English words and very short tokens
    if (id.length >= 3 && !COMMON_WORDS.has(id.toLowerCase())) {
      ids.add(id);
    }
  }

  // Also catch specific patterns: uniform names (uCamelCase), diagnostic terms
  const uniformRe = /\b(u[A-Z][a-zA-Z0-9]*)\b/g;
  while ((m = uniformRe.exec(raw))) {
    ids.add(m[1]);
  }

  // Diagnostic/error identifiers: quoted or bare identifiers from compiler logs
  const quotedRe = /['"`]([a-zA-Z_][a-zA-Z0-9_]{2,})['"`]/g;
  while ((m = quotedRe.exec(raw))) {
    ids.add(m[1]);
  }

  return [...ids];
}

const COMMON_WORDS = new Set([
  "the", "and", "for", "are", "but", "not", "you", "all", "can", "had", "her", "was", "one", "our", "out", "day", "get", "has", "him", "his", "how", "its", "may", "new", "now", "old", "see", "two", "who", "boy", "did", "its", "let", "put", "say", "she", "too", "use", "very", "want", "when", "will", "with", "have", "this", "that", "they", "from", "just", "like", "make", "more", "some", "time", "very", "what", "work", "into", "your", "over", "also", "back", "after", "than", "then", "them", "these", "only", "most", "such", "because", "through", "before", "during", "without", "between", "should", "would", "could", "about", "other", "there", "where", "which", "while", "their", "being", "under", "might", "still", "those", "found", "great", "right", "small", "large", "never", "every", "under", "above", "below", "within", "beyond", "inside", "outside", "around", "through", "across", "against", "among", "toward", "behind", "beneath", "beside", "beyond", "except", "despite", "unless", "until", "since", "though", "although", "whether", "whichever", "whenever", "wherever", "whoever", "however", "whatever", "whichever",
  "inspected", "risk", "evidence", "verdict", "pass", "fail", "block", "ready", "missing", "file", "path", "source", "code", "function", "variable", "constant", "uniform", "shader", "compile", "error", "warning", "line", "column", "message", "diagnostic", "identifier", "undeclared", "syntax", "semantic", "type", "mismatch", "assignment", "expression", "statement", "declaration", "definition", "reference", "scope", "context", "module", "import", "export", "default", "named", "namespace", "interface", "type", "alias", "generic", "constraint", "extends", "implements", "abstract", "final", "static", "public", "private", "protected", "readonly", "optional", "required", "nullable", "undefined", "null", "void", "never", "unknown", "any", "object", "array", "string", "number", "boolean", "symbol", "bigint", "promise", "async", "await", "yield", "generator", "iterator", "observable", "subject", "subscription", "operator", "pipe", "map", "filter", "reduce", "merge", "concat", "switch", "case", "default", "break", "continue", "return", "throw", "try", "catch", "finally", "with", "debugger", "function", "var", "let", "const", "export", "import", "from", "as", "default", "namespace", "module", "declare", "global", "typeof", "keyof", "infer", "extends", "never", "any", "unknown", "void", "null", "undefined", "true", "false", "this", "super", "new", "delete", "typeof", "instanceof", "in", "of", "for", "while", "do", "if", "else", "switch", "case", "default", "break", "continue", "return", "throw", "try", "catch", "finally", "with", "debugger"
]);

export function unionToolNames(...lists) {
  const out = [];
  const seen = new Set();
  for (const list of lists) {
    for (const n of list || []) {
      const key = String(n || "");
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(n);
    }
  }
  return out;
}

export async function checkInventedSymbolsAsync(text) {
  const re = /Symbol\/component:\s*[`*]*(?:export )?(?:function |const )?([A-Za-z_][A-Za-z0-9_]{3,})/gi;
  const names = new Set();
  let m;
  while ((m = re.exec(String(text || "")))) names.add(m[1]);
  const invented = [];
  for (const name of names) {
    if (repoFileExists(`src/components/FireCommand/${name}.tsx`)) continue;
    if (repoFileExists(`src/components/FireCommand/${name}.ts`)) continue;
    if (repoFileExists(`src/hooks/${name}.ts`)) continue;
    try {
      const { symbolLookup } = await import("../retrieve/hybrid.mjs");
      const r = symbolLookup(name);
      if ((r.hits || []).length) continue;
    } catch {
      continue;
    }
    invented.push(name);
  }
  return { ok: invented.length === 0, invented };
}

export function quarantineFitsDest(fromPath, destName) {
  const base = String(fromPath || "").split(/[/\\]/).pop().toLowerCase();
  const dest = String(destName || "").toLowerCase();
  if (dest.startsWith("plan")) return /plan/.test(base) && !/proposal/.test(base);
  if (dest.startsWith("proposal")) return /proposal/.test(base);
  return true;
}

export function checkProposalConcrete(text) {
  const raw = String(text || "");
  const errors = [];
  if (raw.trim().length < 400) errors.push("proposal-too-thin");
  const options = new Set((raw.match(/\bOption [A-D]\b/g) || []).map((s) => s.toUpperCase()));
  const asksHuman = /\b(which (?:visual |option |enhancement )?do you prefer|which option|await(?:s|ing)? human|human review required|before any code edits|choose (?:one|among)|human review of visual strategy|would you like me to|please clarify how you'd like to proceed)\b/i.test(raw);
  if (options.size >= 2) errors.push("option-menu");
  if (options.size >= 2 && asksHuman) errors.push("unresolved-design");
  if (asksHuman && /\bOption [A-D]\b/i.test(raw)) errors.push("unresolved-design");
  if (/\bwould you like me to\b/i.test(raw) || /\bplease clarify how you'd like to proceed\b/i.test(raw)) errors.push("asks-operator");
  return { ok: errors.length === 0, errors: [...new Set(errors)] };
}

export function evaluateArtifactGate(text, spec) {
  const files = checkReferencedFilesExist(text);
  const scope = checkEditTargetsAllowed(text, spec);
  const vue = findWrongStackPaths(text);
  const markedNew = existingMarkedNew(text);
  const innerPanels = findInventedInnerPanelFiles(text);
  const errors = [];
  if (!files.ok) errors.push(`invented-files:${files.missing.join(",")}`);
  if (!scope.ok) errors.push(`outside-allowed:${scope.problems.map((p) => p.path).join(",")}`);
  if (vue.length) errors.push(`wrong-stack:.vue:${vue.join(",")}`);
  if (markedNew.length) errors.push(`existing-marked-new:${markedNew.join(",")}`);
  if (innerPanels.length) errors.push(`invented-inner-panel:${innerPanels.join(",")}`);
  return { ok: errors.length === 0, errors, files, scope, vue, markedNew, innerPanels };
}

export function evaluateCriticGate({ criticText, planText = "", proposalText = "", spec, tools = [], phase = "", suppliedEvidence = "" } = {}) {
  const parsed = parseCritic(criticText);
  const artifacts = evaluateArtifactGate(proposalText || planText || criticText, spec);
  const planFiles = checkReferencedFilesExist(planText || "");
  const evidence = criticEvidenceOk(parsed);
  const toolsGate = criticToolsOk(tools, spec);
  const named = parseMentionedPaths(criticText || "");
  const finalDiffInPrompt = String(phase) === "final" && evidence.ok && named.length >= 1;
  // Authoritative evidence handed to the critic counts as grounding even when
  // it made zero tool calls. Only an explicit bundle qualifies: a plan that
  // merely *names* a file proves nothing about that file's contents, so
  // planText/proposalText are deliberately NOT treated as evidence here.
  const grounding = criticGroundingOk({ criticText, tools, spec, suppliedEvidence });

  const rawErrors = [];
  if (parsed.missingVerdict) rawErrors.push("missing-verdict");
  if (parsed.verdict === "PASS" || parsed.verdict === "READY") {
    if (!evidence.ok) rawErrors.push(evidence.reason);
    if (!grounding.ok && !finalDiffInPrompt) rawErrors.push("critic-no-tools");
  }
  if (!planFiles.ok) rawErrors.push(`invented-files:${planFiles.missing.join(",")}`);
  const criticFiles = checkReferencedFilesExist(criticText || "");
  if (!criticFiles.ok) rawErrors.push(`invented-files:${criticFiles.missing.join(",")}`);
  if (proposalText && !artifacts.ok) rawErrors.push(...artifacts.errors);
  const vueAll = findWrongStackPaths([planText, proposalText, criticText].join("\n"));
  if (vueAll.length) rawErrors.push(`wrong-stack:.vue:${vueAll.join(",")}`);
  const markedNewAll = existingMarkedNew([planText, proposalText, criticText].join("\n"));
  if (markedNewAll.length) rawErrors.push(`existing-marked-new:${markedNewAll.join(",")}`);
  const innerAll = findInventedInnerPanelFiles([planText, proposalText, criticText].join("\n"));
  if (innerAll.length) rawErrors.push(`invented-inner-panel:${innerAll.join(",")}`);

  const errors = [...new Set(rawErrors)];
  const pass = (parsed.verdict === "PASS" || parsed.verdict === "READY") && errors.length === 0;
  return {
    ok: errors.length === 0 && (parsed.verdict === "PASS" || parsed.verdict === "READY" || parsed.verdict === "FAIL" || parsed.verdict === "BLOCK"),
    pass,
    modelVerdict: parsed.verdict,
    missingVerdict: parsed.missingVerdict,
    errors,
    parsed,
    artifacts,
    planFiles,
    evidence,
    grounding,
    toolsGate: {
      ...toolsGate,
      waived: Boolean((finalDiffInPrompt || grounding.ok) && !toolsGate.ok),
      groundedVia: grounding.via,
    },
  };
}
