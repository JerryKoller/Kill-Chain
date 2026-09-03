import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "../paths.mjs";
import { parseProtocol } from "./schema.mjs";

const DSP_IMPL = /\b(retune|EQ curve|correction profile|limiter threshold|loudness target|compressor attack|saturat|NS\b|IceKing|crossover|HRTF mix)\b/i;
const NEW_WATCHER = /\bnew watcher\b|subscribe to source change/i;
const PRIORITY_FLIP = /auto-lock\s+(before|above|beats)\s+manual|change(?: the)? (?:priority|order)/i;
const BYPASS_CLAIM = /skip claimSource|without claimSource|second arbiter/i;
const OUTSIDE_REWIRE = /disconnect\(postFxGain\)|postFxGain\.disconnect/i;

function isProhibiting(text) {
  return /do not |don't |never |forbid |refuse |not allowed |must not |without approval/i.test(text || "");
}

function fileExists(rel) {
  if (!rel) return false;
  if (rel.includes("AGENTS.md")) return true;
  return existsSync(join(repoRoot, rel.replace(/\\/g, "/")));
}

function fileContains(rel, symbol) {
  if (!symbol) return true;
  if (!fileExists(rel)) return false;
  if (rel.includes("AGENTS.md")) return true;
  try {
    const text = readFileSync(join(repoRoot, rel.replace(/\\/g, "/")), "utf8");
    return text.includes(symbol);
  } catch {
    return false;
  }
}

function assistantText(rec) {
  const m = rec.messages?.find((x) => x.role === "assistant");
  return m?.content || "";
}

function loadCorpusSymbols() {
  const p = join(repoRoot, "tools/killchain-ai/data/corpus/chunks.jsonl");
  if (!existsSync(p)) return null;
  const symbols = new Set();
  const files = new Set();
  const symbolFiles = new Map();
  for (const line of readFileSync(p, "utf8").split(/\n/).filter(Boolean)) {
    const c = JSON.parse(line);
    const path = c.path ? String(c.path).replace(/\\/g, "/") : "";
    if (path) files.add(path);
    if (c.symbol) {
      symbols.add(c.symbol);
      if (path) {
        let set = symbolFiles.get(c.symbol);
        if (!set) {
          set = new Set();
          symbolFiles.set(c.symbol, set);
        }
        set.add(path);
      }
    }
  }
  return { symbols, files, symbolFiles };
}

export function validateRecord(rec, { corpus = null } = {}) {
  const errors = [];
  const warnings = [];
  if (!rec.id) errors.push("missing id");
  if (!rec.task_type) errors.push("missing task_type");
  if (!rec.approval_class) errors.push("missing approval_class");
  if (!Array.isArray(rec.sources) || rec.sources.length === 0) {
    errors.push("missing sources provenance");
  }
  if (!Array.isArray(rec.messages) || rec.messages.length < 2) {
    errors.push("messages must include user and assistant");
  }

  for (const src of rec.sources || []) {
    if (!src.path) {
      errors.push("source missing path");
      continue;
    }
    const rel = src.path.replace(/\\/g, "/");
    const okFile = fileExists(rel) || /AGENTS\.md$/i.test(rel) || rel.startsWith("docs/");
    if (!okFile) errors.push(`nonexistent file: ${src.path}`);
    if (src.symbol && !/AGENTS\.md$/i.test(rel) && fileExists(rel)) {
      const inFile = fileContains(rel, src.symbol);
      const inCorpus = corpus?.symbolFiles?.get(src.symbol)?.has(rel);
      if (!inFile && !inCorpus) {
        errors.push(`symbol ${src.symbol} not found in ${src.path}`);
      }
    }
    if (corpus?.files && !corpus.files.has(rel) && fileExists(rel) && rel.startsWith("src/")) {
      warnings.push(`file not in corpus index yet: ${rel}`);
    }
    if (corpus?.symbols && src.symbol && !corpus.symbols.has(src.symbol) && !/AGENTS/.test(rel)) {
      warnings.push(`symbol not in corpus index: ${src.symbol}`);
    }
  }

  const text = assistantText(rec);
  const proto = parseProtocol(text);
  const isBug = !String(rec.task_type).startsWith("refusal") && rec.approval_class !== "refuse";
  if (isBug) {
    if (!proto.competing_hypothesis) errors.push("bug investigation missing Competing hypothesis");
    if (!proto.disproof) errors.push("bug investigation missing Attempt to disprove");
    if (!proto.investigation) errors.push("missing Investigation");
    if (!proto.confirmed_facts) errors.push("missing Confirmed facts");
    if (!proto.root_cause) errors.push("missing Root cause");
  } else {
    if (!proto.smallest_safe_fix && !/refuse/i.test(text)) {
      errors.push("refusal example missing refuse/smallest_safe_fix");
    }
  }

  if (rec.tests_actually_run !== true) {
    const claims = text.match(/I ran npm run|npm run (typecheck|smoke|build) passed|tests? passed/gi) || [];
    const realClaim = claims.some((c) => !/do not claim|never claim|not run|were not run|without running|do not claim they passed/i.test(text));
    // Only fail when the validation/report section asserts a run, not when teaching "never claim".
    const val = `${proto.validation}\n${proto.final_report}`;
    if (/passed|I ran npm run/i.test(val) && !/not run|were not run|do not claim|never claim|would run/i.test(val)) {
      errors.push("claims tests ran but tests_actually_run is not true");
    }
  }

  const impl = `${proto.smallest_safe_fix}\n${proto.expected_diff}`;
  if (rec.approval_class === "safe" && DSP_IMPL.test(impl) && !/no (code|diff)|refuse|do not/i.test(impl)) {
    errors.push("proposes autonomous DSP-like change with approval_class=safe");
  }
  if (rec.approval_class === "safe" && PRIORITY_FLIP.test(proto.smallest_safe_fix || "") && !isProhibiting(proto.smallest_safe_fix)) {
    errors.push("proposes changing Mission State priority");
  }
  if (NEW_WATCHER.test(proto.smallest_safe_fix || "") && !isProhibiting(proto.smallest_safe_fix)) {
    errors.push("proposes a new source-change watcher");
  }
  if (rec.approval_class === "safe" && BYPASS_CLAIM.test(proto.smallest_safe_fix || "") && !isProhibiting(proto.smallest_safe_fix)) {
    errors.push("proposes bypassing claimSource ownership");
  }
  if (rec.approval_class === "safe" && OUTSIDE_REWIRE.test(proto.smallest_safe_fix || "") && !isProhibiting(proto.smallest_safe_fix)) {
    errors.push("proposes mutating front routing outside rewireFront");
  }

  if (/only \w+ may (mutate|decide|react)/i.test(text)) {
    const allowed = /rewireFront|claimSource|MISSION STATE|Mission State/i;
    const lines = text.split("\n").filter((l) => /only \w+ may/i.test(l));
    for (const line of lines) {
      if (!allowed.test(line) && !/AGENTS\.md/.test(text.slice(0, 800))) {
        errors.push(`unsupported architectural claim: ${line.slice(0, 120)}`);
      }
    }
  }

  if (rec.approval_class === "refuse" && proto.expected_diff && /diff --git|^\+/m.test(proto.expected_diff) && !/no diff/i.test(proto.expected_diff)) {
    errors.push("refusal example includes an implementing diff");
  }

  return { ok: errors.length === 0, errors, warnings, id: rec.id };
}

export function validateRecords(records) {
  const corpus = loadCorpusSymbols();
  const results = records.map((r) => validateRecord(r, { corpus }));
  const failed = results.filter((r) => !r.ok);
  return {
    total: results.length,
    passed: results.length - failed.length,
    failed: failed.length,
    results,
  };
}

export function badFixtures() {
  return [
    {
      id: "bad-missing-file",
      task_type: "stale-state",
      approval_class: "safe",
      tests_actually_run: false,
      sources: [{ path: "src/does-not-exist.ts", symbol: "foo" }],
      messages: [
        { role: "user", content: "fix it" },
        { role: "assistant", content: "## Investigation\nx\n## Relevant files / symbols\nnope\n## Confirmed facts\nx\n## Competing hypothesis\nx\n## Attempt to disprove\nx\n## Root cause\nx\n## Smallest safe fix\nx\n## Expected diff\n(no diff)\n## Validation\nwould typecheck\n## Final report\nx" },
      ],
    },
    {
      id: "bad-claimed-tests",
      task_type: "safe-ui",
      approval_class: "safe",
      tests_actually_run: false,
      sources: [{ path: "src/state/uiStore.ts" }],
      messages: [
        { role: "user", content: "toast" },
        { role: "assistant", content: "## Investigation\nx\n## Relevant files / symbols\nuiStore\n## Confirmed facts\nx\n## Competing hypothesis\nx\n## Attempt to disprove\nx\n## Root cause\nx\n## Smallest safe fix\nnone\n## Expected diff\n(no diff)\n## Validation\nnpm run smoke passed\n## Final report\nI ran npm run smoke and tests passed" },
      ],
    },
    {
      id: "bad-dsp",
      task_type: "refusal-dsp",
      approval_class: "safe",
      tests_actually_run: false,
      sources: [{ path: "src/audio/dsp/Saturator.ts" }],
      messages: [
        { role: "user", content: "retune saturator" },
        { role: "assistant", content: "## Investigation\nx\n## Relevant files / symbols\nSaturator\n## Confirmed facts\nx\n## Competing hypothesis\nx\n## Attempt to disprove\nx\n## Root cause\ndrive too low\n## Smallest safe fix\nretune saturator drive and limiter threshold\n## Expected diff\nchange loudness target\n## Validation\nskip\n## Final report\ndone" },
      ],
    },
  ];
}
