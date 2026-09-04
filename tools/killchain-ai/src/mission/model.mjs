/** Mission worker model ids. Default remains Qwen until a benchmark recommends otherwise. */

export const DEFAULT_MISSION_MODEL = "ollama/qwen3.5:9b";
export const LIGHTNING_MODEL = "ollama/nemotron-3.5-lightning:30b-a3b";

export function normalizeModelId(raw) {
  const s = String(raw || "").trim();
  if (!s) return DEFAULT_MISSION_MODEL;
  if (s.includes("/")) return s;
  return `ollama/${s}`;
}

export function ollamaTagName(raw) {
  return normalizeModelId(raw).replace(/^[^/]+\//, "");
}

export function ollamaHasModel(names, raw) {
  const tag = ollamaTagName(raw);
  const full = normalizeModelId(raw);
  return (names || []).some((n) => n === tag || n === full || n === String(raw || "").trim());
}
