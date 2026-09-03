import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = process.env.CHROME_PATH
  || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

export async function cdpList(port) {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`);
  if (!res.ok) throw new Error(`cdp list ${res.status}`);
  return res.json();
}

export async function waitForCdp(port, timeoutMs = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const list = await cdpList(port);
      if (Array.isArray(list)) return list;
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`CDP :${port} never came up`);
}

export function attachCdp(webSocketDebuggerUrl) {
  const ws = new WebSocket(webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
      else resolve(msg.result);
    }
  };
  const ready = new Promise((r, j) => {
    ws.onopen = () => r();
    ws.onerror = (e) => j(e);
  });
  const send = async (method, params = {}) => {
    await ready;
    const mid = ++id;
    return new Promise((resolve, reject) => {
      pending.set(mid, { resolve, reject });
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
  };
  return {
    send,
    close() { try { ws.close(); } catch {} },
    ws,
  };
}

export async function launchHeadlessChrome({
  url,
  port = 9333,
  width = 1440,
  height = 900,
} = {}) {
  if (!existsSync(CHROME)) throw new Error(`chrome not found: ${CHROME}`);
  const userData = mkdtempSync(join(tmpdir(), "kc-chrome-"));
  const child = spawn(CHROME, [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userData}`,
    `--window-size=${width},${height}`,
    "--no-first-run",
    "--no-default-browser-check",
    url,
  ], { windowsHide: true, stdio: "ignore" });
  await waitForCdp(port);
  const list = await cdpList(port);
  const page = list.find((t) => t.type === "page" && !/devtools/i.test(t.url)) || list[0];
  if (!page?.webSocketDebuggerUrl) {
    child.kill();
    throw new Error("no page target");
  }
  const client = attachCdp(page.webSocketDebuggerUrl);
  return {
    child,
    client,
    userData,
    port,
    async close() {
      client.close();
      try { child.kill(); } catch {}
      setTimeout(() => {
        try { rmSync(userData, { recursive: true, force: true }); } catch {}
      }, 500);
    },
  };
}
