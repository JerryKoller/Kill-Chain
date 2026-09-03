import { callersOf, calleesOf, hybridSearch, invariants, symbolLookup, testsFor } from "./hybrid.mjs";
import { contextPack } from "./pack.mjs";

function ok(id, result) {
  return {
    jsonrpc: "2.0",
    id,
    result,
  };
}

function err(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

const TOOLS = [
  { name: "search", description: "Hybrid Kill Chain search (exact symbol/path, BM25, graph, optional embeddings). Use before guessing file names.", inputSchema: { type: "object", properties: { query: { type: "string" }, k: { type: "number" } }, required: ["query"] } },
  { name: "symbol", description: "Look up a function/class/store by exact name, useX hook prefix, or file basename (sessionSnapshotsStore → useSessionSnapshotsStore).", inputSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } },
  { name: "callers", description: "Callers of a symbol from the corpus call graph. Bare store names resolve like symbol lookup.", inputSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } },
  { name: "callees", description: "Callees of a symbol from the corpus call graph. Bare store names resolve like symbol lookup.", inputSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } },
  { name: "tests_for", description: "Indexed tests and smoke cases for a symbol or path. An empty/honest-none result means no indexed coverage — do not invent tests.", inputSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } },
  { name: "invariants", description: "AGENTS.md / architecture invariants and danger rules. Accepts descriptive queries; ranks by token overlap.", inputSchema: { type: "object", properties: { query: { type: "string" } } } },
  { name: "context_pack", description: "Compact provenance-backed Kill Chain context pack. Prefer omitting budget (default 8000; clamped 2000–32000). After tools finish, write the investigation report as the user-visible final answer, not only as hidden reasoning.", inputSchema: { type: "object", properties: { task: { type: "string" }, budget: { type: "number", minimum: 2000, maximum: 32000, default: 8000 } }, required: ["task"] } },
];

function hitText(res, limit = 8) {
  const hits = res.hits || [];
  if (!hits.length) {
    return res.notice || "No indexed hits. This is a correct empty result when nothing in the corpus matches — not a tool failure. Do not invent files, symbols, or tests.";
  }
  return hits.slice(0, limit).map((h) => {
    const c = h.chunk;
    return [
      `# ${c.title}`,
      `${c.path}${c.lineStart ? `:${c.lineStart}-${c.lineEnd}` : ""} ${c.symbol || ""}`,
      `type=${c.type} subsystem=${c.subsystem} git=${c.gitCommit}`,
      (c.text || "").slice(0, 1600),
    ].join("\n");
  }).join("\n\n---\n\n");
}

async function callTool(name, args) {
  switch (name) {
    case "search": {
      const r = await hybridSearch(args.query, { k: args.k || 12 });
      return hitText(r);
    }
    case "symbol":
      return hitText(symbolLookup(args.name), 12);
    case "callers":
      return hitText(callersOf(args.name), 16);
    case "callees":
      return hitText(calleesOf(args.name), 16);
    case "tests_for":
      return hitText(testsFor(args.name), 16);
    case "invariants":
      return hitText(invariants(args.query || ""), 20);
    case "context_pack": {
      const pack = await contextPack(args.task, { budget: args.budget || 8000 });
      return pack.markdown;
    }
    default:
      throw new Error(`Unknown tool ${name}`);
  }
}

function writeFrame(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

async function handleMessage(msg) {
  if (!msg || msg.jsonrpc !== "2.0") return;
  const { id, method, params } = msg;
  if (method === "initialize") {
    writeFrame(ok(id, {
      protocolVersion: "2024-11-05",
      serverInfo: { name: "killchain-retrieve", version: "0.1.0" },
      capabilities: { tools: {} },
      instructions: "After Kill Chain retrieval tools finish, the user-visible assistant message must contain the investigation report. Do not leave findings only in hidden reasoning. Include confirmed facts from code, one competing hypothesis you checked, the conclusion, the smallest safe fix if any, validation commands without claiming they passed, and remaining uncertainties.",
    }));
    return;
  }
  if (method === "notifications/initialized" || method === "initialized") return;
  if (method === "tools/list") {
    writeFrame(ok(id, { tools: TOOLS }));
    return;
  }
  if (method === "tools/call") {
    try {
      const text = await callTool(params.name, params.arguments || {});
      writeFrame(ok(id, { content: [{ type: "text", text }] }));
    } catch (e) {
      writeFrame(err(id, -32000, e instanceof Error ? e.message : String(e)));
    }
    return;
  }
  if (id !== undefined) writeFrame(err(id, -32601, `Unknown method ${method}`));
}

export function startMcpStdio() {
  let buf = Buffer.alloc(0);
  process.stdin.on("data", (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    while (true) {
      const headerEnd = buf.indexOf("\r\n\r\n");
      const ndjsonNl = buf.indexOf("\n");
      if (headerEnd !== -1 && (buf.slice(0, 20).toString().toLowerCase().includes("content-length"))) {
        const header = buf.slice(0, headerEnd).toString("utf8");
        const m = header.match(/content-length:\s*(\d+)/i);
        if (!m) break;
        const len = Number(m[1]);
        const start = headerEnd + 4;
        if (buf.length < start + len) break;
        const json = buf.slice(start, start + len).toString("utf8");
        buf = buf.slice(start + len);
        void handleMessage(JSON.parse(json));
        continue;
      }
      if (buf[0] === 0x7b /* { */ && ndjsonNl !== -1) {
        const line = buf.slice(0, ndjsonNl).toString("utf8").trim();
        buf = buf.slice(ndjsonNl + 1);
        if (line) void handleMessage(JSON.parse(line));
        continue;
      }
      break;
    }
  });
}
