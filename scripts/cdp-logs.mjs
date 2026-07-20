// Dump buffered console/log entries + exceptions from the dev renderer.
const PORT = 9223;
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === "page" && !/devtools/i.test(t.url));
if (!page) {
  console.error("no page target");
  process.exit(1);
}
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const mid = ++id;
    const onMsg = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id === mid) {
        ws.removeEventListener("message", onMsg);
        resolve(m.result);
      }
    };
    ws.addEventListener("message", onMsg);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });

ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.method === "Log.entryAdded") {
    const e = m.params.entry;
    console.log(`[${e.level}] ${e.text?.slice(0, 500)} ${e.url ?? ""}:${e.lineNumber ?? ""}`);
  } else if (m.method === "Runtime.exceptionThrown") {
    const d = m.params.exceptionDetails;
    console.log(`[EXCEPTION] ${d.text} ${d.exception?.description?.slice(0, 800) ?? ""}`);
  } else if (m.method === "Runtime.consoleAPICalled") {
    const args = m.params.args.map((a) => a.value ?? a.description ?? "").join(" ");
    console.log(`[console.${m.params.type}] ${args.slice(0, 500)}`);
  }
});

await new Promise((r) => (ws.onopen = r));
await send("Log.enable");
await send("Runtime.enable");
// Reload to replay boot with listeners attached.
await send("Page.enable");
await send("Page.reload");
await new Promise((r) => setTimeout(r, 7000));
ws.close();
