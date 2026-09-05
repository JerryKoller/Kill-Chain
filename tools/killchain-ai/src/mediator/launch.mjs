/**
 * Launch Prism as the single operator GUI.
 *
 * Starts the Mediator console on 5185 if needed, opens one Chrome app window,
 * and does not spawn the old 5176 Puppy watch window.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { repoRoot, toolsRoot } from "../paths.mjs";
import { closePuppyProfileChrome } from "../puppy/watch.mjs";
import { APP_PORT, MEDIATOR_PORT, portFree } from "./server.mjs";

export const PRISM_PORT = MEDIATOR_PORT;
export const PRISM_ORIGIN = `http://127.0.0.1:${PRISM_PORT}`;

const CHROME = process.env.CHROME_PATH
  || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

export function prismChromeProfile() {
  return join(tmpdir(), "kc-prism-console");
}

export async function isPrismUp({ origin = PRISM_ORIGIN } = {}) {
  try {
    const r = await fetch(`${origin}/api/state`, { signal: AbortSignal.timeout(800) });
    if (!r.ok) return false;
    const j = await r.json();
    return Boolean(j?.identity?.displayName || j?.puppy);
  } catch {
    return false;
  }
}

export function openPrismWindow(origin = PRISM_ORIGIN) {
  const url = origin.endsWith("/") ? origin : `${origin}/`;
  if (existsSync(CHROME)) {
    const child = spawn(CHROME, [
      `--app=${url}`,
      "--window-size=1280,900",
      `--user-data-dir=${prismChromeProfile()}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--autoplay-policy=no-user-gesture-required",
    ], { detached: true, stdio: "ignore", windowsHide: false });
    child.unref();
    return { ok: true, via: "chrome-app", url };
  }
  spawn(process.platform === "win32" ? "cmd.exe" : "xdg-open",
    process.platform === "win32" ? ["/c", "start", "", url] : [url],
    { detached: true, stdio: "ignore", windowsHide: true });
  return { ok: true, via: "os", url };
}

function spawnPrismServer({ port = PRISM_PORT, log = () => {} } = {}) {
  if (port === APP_PORT) throw new Error("refusing to bind port 5173 (the application)");
  const cli = join(toolsRoot, "src", "cli.mjs");
  const child = spawn(process.execPath, [cli, "mediator", "console", "--port", String(port)], {
    cwd: repoRoot,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
  log(`started Prism console on http://127.0.0.1:${port}/ pid=${child.pid}`);
  return { pid: child.pid, port };
}

async function waitForPrism({ origin = PRISM_ORIGIN, ms = 15000 } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await isPrismUp({ origin })) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

/**
 * One-click entry: reuse a live console, otherwise start one, then open the window.
 * Closes the old 5176 Chrome app so Puppy is not a second GUI.
 */
export async function launchPrism({ log = console.log } = {}) {
  closePuppyProfileChrome();
  const origin = PRISM_ORIGIN;
  const free = await portFree(PRISM_PORT);
  if (!free && !(await isPrismUp({ origin }))) {
    throw new Error(`port ${PRISM_PORT} is occupied by something that is not Prism`);
  }
  if (free) spawnPrismServer({ port: PRISM_PORT, log });
  const up = await waitForPrism({ origin });
  if (!up) throw new Error(`Prism did not come up on ${origin}`);
  const opened = openPrismWindow(origin);
  log(`Prism: ${opened.url}`);
  return { origin, reused: !free, ...opened };
}
