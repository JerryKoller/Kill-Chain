// Tiny CDP driver for dev-time verification (Node ≥22 global WebSocket).
// Usage: node scripts/cdp-eval.mjs <expression-file.js | inline-expression> [--shot out.png]
import { readFileSync, writeFileSync } from "node:fs";

const PORT = Number(process.env.CDP_PORT || 9223);
const arg = process.argv[2];
const shotIdx = process.argv.indexOf("--shot");
const shotPath = shotIdx > 0 ? process.argv[shotIdx + 1] : null;

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === "page" && !/devtools/i.test(t.url));
if (!page) {
  console.error("no page target");
  process.exit(1);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const mid = ++id;
    pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });

ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(msg.error.message));
    else resolve(msg.result);
  }
};

await new Promise((r) => (ws.onopen = r));

let expression = "1+1";
if (arg && !arg.startsWith("--")) {
  try {
    expression = readFileSync(arg, "utf8");
  } catch {
    expression = arg;
  }
}

try {
  if (expression !== "-") {
    const res = await send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      timeout: 30000,
    });
    if (res.exceptionDetails) {
      console.error("EXCEPTION:", JSON.stringify(res.exceptionDetails, null, 2).slice(0, 2000));
    } else {
      console.log(JSON.stringify(res.result?.value ?? res.result, null, 2));
    }
  }
  if (shotPath) {
    const shot = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(shotPath, Buffer.from(shot.data, "base64"));
    console.log("shot →", shotPath);
  }
} finally {
  ws.close();
}
