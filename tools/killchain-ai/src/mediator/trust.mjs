/**
 * Trust boundary.
 *
 * MODEL OUTPUT IS NOT EVIDENCE.
 *
 * Supervisor models interpret evidence. They do not create it by asserting
 * something. This module is the only place allowed to mint evidence refs, and
 * it will refuse to mint one for model prose.
 *
 * A second, subtler rule is enforced here too: a trusted *path* is not evidence
 * for arbitrary claims about the *contents* of that path. An evidence item
 * therefore declares what it can ground — existence, or existence + content.
 */
import { createHash } from "node:crypto";

/** Kinds that may become trusted evidence, and what each is allowed to ground. */
export const EVIDENCE_KINDS = {
  FILE_BYTES: { grounds: ["existence", "content"], label: "file bytes" },
  FILE_PATH: { grounds: ["existence"], label: "file path" },
  GIT_OUTPUT: { grounds: ["existence", "content"], label: "git output" },
  COMPILER_OUTPUT: { grounds: ["existence", "content"], label: "compiler output" },
  TEST_OUTPUT: { grounds: ["existence", "content"], label: "test output" },
  HASH: { grounds: ["existence", "content"], label: "content hash" },
  CHECKPOINT_BYTES: { grounds: ["existence", "content"], label: "checkpoint bytes" },
  RUNNER_EVIDENCE: { grounds: ["existence", "content"], label: "runner-generated evidence" },
  CONTEXT_PACK: { grounds: ["existence", "content"], label: "validated context pack" },
  DIAGNOSTIC_FINGERPRINT: { grounds: ["existence", "content"], label: "diagnostic fingerprint" },
  TOOL_OUTPUT: { grounds: ["existence", "content"], label: "captured tool output" },
  HUMAN_BRIEF: { grounds: ["existence", "content"], label: "human brief" },
};

/**
 * Explicitly untrusted. Present so callers can name the thing they are holding
 * and get a loud error instead of quietly laundering it into the pack.
 */
export const UNTRUSTED_KINDS = new Set([
  "MODEL_PROSE",
  "MODEL_PLAN",
  "MODEL_CRITIC",
  "SUPERVISOR_OUTPUT",
  "WORKER_CLAIM",
  "ASSERTION",
]);

export function sha256(text) {
  return createHash("sha256").update(String(text ?? ""), "utf8").digest("hex");
}

export function createEvidencePack({ missionId = null, note = "" } = {}) {
  return { missionId, note, items: [], byRef: new Map(), rejected: [] };
}

/**
 * Mint a trusted evidence ref. Throws for untrusted or unknown kinds — a
 * supervisor must never be able to widen its own evidence base.
 */
export function addEvidence(pack, { kind, label, content, source = null }) {
  const k = String(kind || "").toUpperCase();
  if (UNTRUSTED_KINDS.has(k)) {
    pack.rejected.push({ kind: k, label, reason: "model output is not evidence" });
    throw new Error(`untrusted evidence kind rejected: ${k}`);
  }
  const spec = EVIDENCE_KINDS[k];
  if (!spec) {
    pack.rejected.push({ kind: k, label, reason: "unknown evidence kind" });
    throw new Error(`unknown evidence kind: ${k}`);
  }
  const text = typeof content === "string" ? content : String(content ?? "");
  const ref = `E${pack.items.length + 1}`;
  const item = {
    ref,
    kind: k,
    label: String(label || spec.label),
    source: source ? String(source) : null,
    grounds: spec.grounds,
    content: text,
    sha256: sha256(text),
    bytes: Buffer.byteLength(text, "utf8"),
  };
  pack.items.push(item);
  pack.byRef.set(ref, item);
  return ref;
}

export function getEvidence(pack, ref) {
  return pack?.byRef?.get(String(ref || "").trim()) || null;
}

/** Every cited ref must exist in this pack. Unknown refs are a trust failure. */
export function resolveRefs(pack, refs) {
  const list = Array.isArray(refs) ? refs : [];
  const missing = [];
  const resolved = [];
  for (const raw of list) {
    const item = getEvidence(pack, raw);
    if (item) resolved.push(item);
    else missing.push(String(raw));
  }
  return { ok: missing.length === 0, resolved, missing };
}

const IDENT_RE = /[A-Za-z_$][A-Za-z0-9_$]{2,}/g;
const PATH_RE = /(?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+\.[A-Za-z0-9]+/g;

/**
 * Does `ref` actually support `claim`?
 *
 * Content-grounding items must literally contain the identifiers and paths the
 * claim leans on. Existence-only items (a bare path) can never ground a content
 * claim, which is the "trusted path is not trusted contents" rule.
 */
export function groundsClaim(pack, ref, claim, { mode = "content" } = {}) {
  const item = getEvidence(pack, ref);
  if (!item) return { ok: false, reason: `unknown-evidence-ref:${ref}` };
  if (!item.grounds.includes(mode)) {
    return { ok: false, reason: `evidence-kind-cannot-ground-${mode}:${item.kind}` };
  }
  if (mode === "existence") return { ok: true, reason: null };

  const text = String(claim || "");
  const haystack = item.content;
  const paths = [...new Set(text.match(PATH_RE) || [])];
  const unsupportedPaths = paths.filter((p) => !haystack.includes(p));
  if (unsupportedPaths.length) {
    return { ok: false, reason: `unsupported-paths:${unsupportedPaths.join(",")}` };
  }
  const idents = [...new Set(text.match(IDENT_RE) || [])].filter((w) => !STOPWORDS.has(w.toLowerCase()));
  const unsupported = idents.filter((w) => !haystack.includes(w));
  // A claim is prose, not a transcript; require the bulk of its concrete
  // vocabulary to appear rather than demanding a perfect match.
  if (idents.length && unsupported.length / idents.length > 0.5) {
    return { ok: false, reason: `unsupported-claim:${unsupported.slice(0, 6).join(",")}` };
  }
  return { ok: true, reason: null };
}

const STOPWORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "into", "then", "than",
  "was", "were", "has", "have", "had", "not", "but", "are", "its", "it's",
  "should", "would", "could", "will", "can", "may", "must", "does", "did",
  "because", "which", "when", "while", "after", "before", "still", "same",
  "file", "files", "line", "lines", "code", "error", "errors", "change",
  "changes", "changed", "fix", "fixed", "test", "tests", "build", "the",
]);

/** Render the pack for a prompt. Refs are stable and quotable. */
export function renderEvidencePack(pack, { maxItemChars = 6000 } = {}) {
  if (!pack?.items?.length) return "(no trusted evidence supplied)";
  const parts = [];
  for (const item of pack.items) {
    const body = item.content.length > maxItemChars
      ? `${item.content.slice(0, maxItemChars)}\n… [truncated ${item.content.length - maxItemChars} chars]`
      : item.content;
    parts.push(
      [
        `[${item.ref}] kind=${item.kind} grounds=${item.grounds.join("+")}`,
        `label: ${item.label}`,
        item.source ? `source: ${item.source}` : null,
        `sha256: ${item.sha256.slice(0, 16)}…`,
        "---",
        body,
      ].filter(Boolean).join("\n"),
    );
  }
  return parts.join("\n\n════\n\n");
}

export function packSummary(pack) {
  return (pack?.items || []).map((i) => ({
    ref: i.ref,
    kind: i.kind,
    label: i.label,
    grounds: i.grounds,
    sha256: i.sha256,
    bytes: i.bytes,
  }));
}
