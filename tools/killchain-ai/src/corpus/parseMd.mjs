import { readFileSync } from "node:fs";

/** AGENTS.md in Kill-Chain-AI is stored with escaped markdown markers (\#). */
export function unescapeAgents(text) {
  return text.replace(/^\\(?=[#>*\-\d])/gm, "").replace(/\\([.#])/g, "$1");
}

function headingLevel(line) {
  const m = line.match(/^(#{1,6})\s+(.*)$/);
  if (!m) return null;
  return { level: m[1].length, title: m[2].trim() };
}

/**
 * Split markdown on headings. Each section keeps exact line ranges into the
 * original file (before unescape for AGENTS.md we map via original lines).
 */
export function parseMarkdownFile(abs, rel, { agentsEscapes = false } = {}) {
  const raw = readFileSync(abs, "utf8");
  const originalLines = raw.split(/\r?\n/);
  const lines = agentsEscapes
    ? originalLines.map((l) => l.replace(/^\\(?=#)/, ""))
    : originalLines;

  const sections = [];
  let current = {
    title: rel,
    level: 0,
    start: 1,
    lines: [],
  };

  const flush = (endLine) => {
    const text = current.lines.join("\n").trim();
    if (!text && current.level === 0) return;
    sections.push({
      path: rel,
      title: current.title,
      level: current.level,
      lineStart: current.start,
      lineEnd: endLine,
      text: text.slice(0, 12000),
    });
  };

  for (let i = 0; i < lines.length; i++) {
    const h = headingLevel(lines[i]);
    if (h) {
      flush(i);
      current = { title: h.title, level: h.level, start: i + 1, lines: [lines[i]] };
    } else {
      current.lines.push(lines[i]);
    }
  }
  flush(lines.length);
  return { raw, sections, lineCount: originalLines.length };
}
