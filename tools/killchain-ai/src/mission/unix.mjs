/** Unix tools Qwen must not invoke as OpenCode tools on this Windows machine. */
export const UNIX_TOOL_NAMES = new Set([
  "bash",
  "sh",
  "zsh",
  "grep",
  "egrep",
  "fgrep",
  "sed",
  "awk",
  "head",
  "tail",
  "find",
]);

const UNIX_CMD_RE = /^\s*(grep|egrep|fgrep|sed|awk|head|tail|find|bash|zsh)\b/;

function toolName(entry) {
  if (!entry) return "";
  if (typeof entry === "string") return entry;
  return String(entry.tool || entry.name || "").trim();
}

function toolCommand(entry) {
  if (!entry || typeof entry === "string") return "";
  const input = entry.input || entry.state?.input || entry.args || {};
  return String(input.command || input.cmd || "").trim();
}

/**
 * Flag Unix-tool invocations from an OpenCode transcript.
 * Does not scan source-file contents — only tool names and shell command strings.
 */
export function scanUnixTools(tools) {
  const violations = [];
  for (const entry of tools || []) {
    const name = toolName(entry);
    const base = name.split("_").pop() || name;
    const cmd = toolCommand(entry);
    if (UNIX_TOOL_NAMES.has(name.toLowerCase()) || UNIX_TOOL_NAMES.has(base.toLowerCase())) {
      violations.push({ tool: name, command: cmd.slice(0, 200), reason: "unix-tool-name" });
      continue;
    }
    if ((name === "bash" || base === "bash" || name === "shell" || base === "shell") && UNIX_CMD_RE.test(cmd)) {
      violations.push({ tool: name, command: cmd.slice(0, 200), reason: "unix-command-string" });
    }
  }
  return violations;
}

export function isKillchainMcpTool(name) {
  const n = String(name || "").toLowerCase();
  return n.startsWith("killchain_") || n.startsWith("killchain-");
}
