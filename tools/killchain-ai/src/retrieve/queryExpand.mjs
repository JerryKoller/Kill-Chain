/** Query-side expansion and noise control for exactness-first retrieval. */

const FUNCTION_WORDS = new Set([
  "where", "what", "when", "who", "whom", "which", "why", "how",
  "this", "that", "these", "those", "from", "with", "have", "been",
  "will", "would", "could", "should", "into", "over", "just", "like",
  "only", "some", "such", "very", "more", "most", "other", "than",
  "then", "also", "about", "after", "before", "under", "again", "once",
  "here", "there", "were", "was", "are", "being", "does", "did",
  "doing", "their", "them", "they", "your", "our", "its",
  "must", "may", "can", "not", "dont", "doesn't", "the", "and", "for",
]);

/** Too generic to count as an exact symbol hit by themselves. */
const GENERIC_CODE_TOKENS = new Set([
  "state", "poll", "name", "type", "view", "list", "file", "data",
  "user", "time", "open", "close", "true", "false", "null", "item",
  "value", "index", "count", "status", "error", "event", "props",
  "handler", "store", "hook", "node", "path", "key", "map", "set",
  "get", "add", "run", "init", "load", "save", "next", "prev",
]);

const LIFECYCLE_QUERY = /timer|interval|timeout|poll|raf|animation.?frame|settle/;
const CLEANUP_QUERY = /clear|clean|stop|teardown|unmount|dispos|release|abort|cancel|leak/;

const LIFECYCLE_SYNONYMS = {
  cleared: ["clear", "cleartimeout", "clearinterval"],
  timers: ["timer", "timeout", "interval"],
  timer: ["timeout", "interval"],
  intervals: ["interval", "setinterval"],
  interval: ["setinterval"],
  poll: ["polling", "setinterval"],
  settle: ["settling", "settimeout"],
  cleanup: ["dispose", "release", "teardown", "unmount"],
  cleaned: ["clear", "dispose", "stop"],
};

export function isFunctionWord(t) {
  return FUNCTION_WORDS.has(String(t).toLowerCase());
}

export function isGenericCodeToken(t) {
  return GENERIC_CODE_TOKENS.has(String(t).toLowerCase());
}

export function looksLikeCodeSymbol(token) {
  if (!token || token.length < 3) return false;
  if (/[a-z][A-Z]/.test(token)) return true;
  if (/[_$]/.test(token)) return true;
  if (/^[A-Z][a-z]+[A-Z]/.test(token)) return true;
  return false;
}

export function stemToken(t) {
  const s = String(t).toLowerCase();
  if (s.length < 5) return s;
  return s.replace(/(?:ing|ers|ies|ied|ed|es|s)$/u, "").replace(/ie$/, "y");
}

export function expandQueryTokens(tokens) {
  const out = new Set();
  for (const raw of tokens) {
    const t = String(raw).toLowerCase();
    if (!t || t.length < 2) continue;
    out.add(t);
    const stem = stemToken(t);
    if (stem.length >= 4) out.add(stem);
    const syn = LIFECYCLE_SYNONYMS[t] || LIFECYCLE_SYNONYMS[stem];
    if (syn) for (const x of syn) out.add(x);
  }
  return [...out];
}

export function isLifecycleCleanupQuery(query) {
  const q = String(query).toLowerCase();
  return LIFECYCLE_QUERY.test(q) && CLEANUP_QUERY.test(q);
}

export function wholeWordIn(hay, needle) {
  if (!needle || needle.length < 3) return false;
  const re = new RegExp(`(?:^|[^A-Za-z0-9_])${escapeRe(needle)}(?:$|[^A-Za-z0-9_])`, "i");
  return re.test(hay);
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function querySymbolCandidates(query) {
  const symbols = [];
  for (const m of String(query).matchAll(/\b([A-Za-z_$][A-Za-z0-9_$]{2,})\b/g)) {
    const tok = m[1];
    const lower = tok.toLowerCase();
    if (isFunctionWord(lower)) continue;
    if (tok.length < 4 && !looksLikeCodeSymbol(tok)) continue;
    if (isGenericCodeToken(lower) && !looksLikeCodeSymbol(tok)) continue;
    symbols.push(tok);
  }
  return symbols;
}
