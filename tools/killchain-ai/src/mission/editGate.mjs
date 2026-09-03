import { checkEditTargetsAllowed } from "./critic.mjs";
import { pathEditable } from "./schema.mjs";

/** Consecutive empty EDITING/REPAIRING applies before BLOCK. */
export const EMPTY_EDIT_BLOCK_AFTER = 3;

/**
 * Mutation-capable OpenCode/tool names. Do not require an exact vendor name;
 * Git/file delta remains authoritative.
 */
export function isMutationTool(name) {
  const n = String(name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!n) return false;
  if (n === "read" || n === "glob" || n === "grep" || n === "bash" || n === "ls") return false;
  if (n.includes("killchain") || n.includes("mcp") || n.startsWith("search") && !n.includes("replace")) {
    if (!n.includes("edit") && !n.includes("write") && !n.includes("patch") && !n.includes("replace")) return false;
  }
  return /edit|write|patch|replace|strreplace|searchreplace|applypatch|multiedit|updatefile|apply_edit|applyedit/.test(n)
    || /edit|write|patch|replace/.test(String(name || "").toLowerCase());
}

export function usedMutationTool(tools) {
  return (tools || []).some((t) => isMutationTool(typeof t === "string" ? t : (t?.tool || t?.name)));
}

export function expectedEditFiles(proposal, spec) {
  const scoped = checkEditTargetsAllowed(proposal || "", spec);
  const files = [...new Set([...(scoped.edit || []), ...(scoped.created || [])])]
    .filter((p) => pathEditable(p, spec, { dryRun: false }));
  return files;
}

export function shouldExpectEdit(proposal, spec, { dryRun = false } = {}) {
  if (dryRun || !spec?.levelInfo?.edits) return { expected: false, files: [] };
  const files = expectedEditFiles(proposal, spec);
  return { expected: files.length > 0, files };
}

export function phaseDeltaEmpty(enforced) {
  const allowed = enforced?.allowed || [];
  const dirty = enforced?.delta?.dirty || [];
  return allowed.length === 0 && dirty.length === 0;
}

/**
 * Classify an EDITING/REPAIRING apply that was expected to change files.
 * File delta is authoritative; tool names only refine EMPTY vs DESCRIBED_BUT_DID_NOT_APPLY.
 */
export function classifyEditOutcome({
  expected = false,
  expectedFiles = [],
  allowed = [],
  deltaDirty = [],
  tools = [],
  invokeOk = true,
} = {}) {
  if (!expected) {
    return { kind: "NO_EDIT_EXPECTED", empty: false, expectedFiles, allowed, mutation: usedMutationTool(tools) };
  }
  if (!invokeOk) {
    return { kind: "INVOKE_FAILED", empty: false, expectedFiles, allowed, mutation: usedMutationTool(tools) };
  }
  const dirty = [...new Set([...(allowed || []), ...(deltaDirty || [])])];
  if (dirty.length > 0) {
    return {
      kind: "EDITED",
      empty: false,
      expectedFiles,
      allowed: dirty,
      mutation: usedMutationTool(tools),
    };
  }
  const mutation = usedMutationTool(tools);
  if (!mutation) {
    return {
      kind: "DESCRIBED_BUT_DID_NOT_APPLY",
      empty: true,
      expectedFiles,
      allowed: [],
      mutation: false,
    };
  }
  return {
    kind: "EMPTY_EDIT",
    empty: true,
    expectedFiles,
    allowed: [],
    mutation: true,
  };
}

export function emptyEditPolicy(streakAfterThis) {
  const n = Number(streakAfterThis) || 0;
  if (n >= EMPTY_EDIT_BLOCK_AFTER) {
    return { action: "BLOCK", reason: "apply-discipline: EMPTY_EDIT", stronger: false };
  }
  if (n >= 2) return { action: "RETRY", stronger: true };
  return { action: "RETRY", stronger: false };
}
