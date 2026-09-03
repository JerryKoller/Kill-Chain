import { existsSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "../paths.mjs";
import { matchPath, pathForbidden } from "./schema.mjs";
import { isKillchainMcpTool } from "./unix.mjs";

const PRAISE_RE = /\b(looks good|comprehensive plan|all criteria met|well done|excellent work|great job|\blgtm\b|nothing to criticize|no issues found|perfect plan|solid plan)\b/i;

export function parseCritic(text) {
  const raw = String(text || "").trim();
  const m = raw.match(/VERDICT:\s*\**\s*`*(PASS|FAIL|BLOCK|READY|NOT_READY)`*/i)
    || raw.match(/#{1,3}\s*VERDICT\s*\n+\s*\**\s*`*(PASS|FAIL|BLOCK|READY|NOT_READY)`*/i)
    || raw.match(/\*\*VERDICT:\*\*\s*`*(PASS|FAIL|BLOCK|READY|NOT_READY)`*/i);
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
  const re = /(?:^|[`'"\s(\[])((?:src|electron|scripts)\/[A-Za-z0-9_./-]+\.(?:tsx|mjs|ts|js|css|json))/gm;
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
  const errors = [];
  if (!files.ok) errors.push(`invented-files:${files.missing.join(",")}`);
  if (!scope.ok) errors.push(`outside-allowed:${scope.problems.map((p) => p.path).join(",")}`);
  if (vue.length) errors.push(`wrong-stack:.vue:${vue.join(",")}`);
  if (markedNew.length) errors.push(`existing-marked-new:${markedNew.join(",")}`);
  return { ok: errors.length === 0, errors, files, scope, vue, markedNew };
}

export function evaluateCriticGate({ criticText, planText = "", proposalText = "", spec, tools = [], phase = "" } = {}) {
  const parsed = parseCritic(criticText);
  const artifacts = evaluateArtifactGate(proposalText || planText || criticText, spec);
  const planFiles = checkReferencedFilesExist(planText || "");
  const evidence = criticEvidenceOk(parsed);
  const toolsGate = criticToolsOk(tools, spec);
  const named = parseMentionedPaths(criticText || "");
  const finalDiffInPrompt = String(phase) === "final" && evidence.ok && named.length >= 1;

  const rawErrors = [];
  if (parsed.missingVerdict) rawErrors.push("missing-verdict");
  if (parsed.verdict === "PASS" || parsed.verdict === "READY") {
    if (!evidence.ok) rawErrors.push(evidence.reason);
    if (!toolsGate.ok && !finalDiffInPrompt) rawErrors.push("critic-no-tools");
  }
  if (!planFiles.ok) rawErrors.push(`invented-files:${planFiles.missing.join(",")}`);
  const criticFiles = checkReferencedFilesExist(criticText || "");
  if (!criticFiles.ok) rawErrors.push(`invented-files:${criticFiles.missing.join(",")}`);
  if (proposalText && !artifacts.ok) rawErrors.push(...artifacts.errors);
  const vueAll = findWrongStackPaths([planText, proposalText, criticText].join("\n"));
  if (vueAll.length) rawErrors.push(`wrong-stack:.vue:${vueAll.join(",")}`);
  const markedNewAll = existingMarkedNew([planText, proposalText, criticText].join("\n"));
  if (markedNewAll.length) rawErrors.push(`existing-marked-new:${markedNewAll.join(",")}`);

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
    toolsGate: { ...toolsGate, waived: Boolean(finalDiffInPrompt && !toolsGate.ok) },
  };
}
