/**
 * Live Robo Puppy watch window.
 *
 * A tiny local HTTP server (never 5173 / 5174) that serves a single page with
 * his avatar, what he is doing, a derived ETA, and a working / finished
 * signal. Status is polled from real mission-runner files — nothing is faked.
 *
 *   node tools/killchain-ai/src/cli.mjs puppy watch
 */
import { createServer as createNetServer } from "node:net";
import { createServer } from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dataDir, repoRoot, toolsRoot } from "../paths.mjs";
import { puppyStatus } from "./status.mjs";
import { machineHeat } from "./heat.mjs";

export const WATCH_PORT = 5176;
export const APP_PORT = 5173;
export const HARNESS_PORT = 5174;
/** Exported so other tooling can assert it does not collide with this range. */
export const WATCH_PORT_SCAN = [5176, 5177, 5178, 5179, 5181];
const PORT_SCAN = WATCH_PORT_SCAN;

const CHROME = process.env.CHROME_PATH
  || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const AVATAR = join(repoRoot, "tools/killchain-ai/assets/robo-puppy.jpg");
const BARK = join(repoRoot, "tools/killchain-ai/assets/robo-puppy-bark.mp3");
export const WINDOW_STALE_MS = 4000;
export const WATCH_PAGE_VERSION = "copper-bark-1";
/** Mission/overnight no longer pop the 5176 Chrome window. Puppy lives in Prism. */
export const WATCH_WINDOW_DEFAULT_OPEN = false;

function stateFile() {
  const dir = join(dataDir, "overnight", "puppy");
  mkdirSync(dir, { recursive: true });
  return join(dir, "watch.json");
}

export function portFree(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const s = createNetServer();
    s.unref();
    s.once("error", () => resolve(false));
    s.listen(port, host, () => s.close(() => resolve(true)));
  });
}

export async function pickWatchPort({ preferred = WATCH_PORT } = {}) {
  const order = [preferred, ...PORT_SCAN.filter((p) => p !== preferred)];
  for (const port of order) {
    if (port === APP_PORT || port === HARNESS_PORT) continue;
    if (await isOurWatch(port)) return { port, reused: true };
    if (await portFree(port)) return { port, reused: false };
  }
  throw new Error(`no free puppy-watch port in ${order.join(", ")}`);
}

export async function fetchWatchStatus(port) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/status`, { signal: AbortSignal.timeout(800) });
    if (!r.ok) return null;
    const j = await r.json();
    return j?.agent === "ROBO PUPPY" ? j : null;
  } catch {
    return null;
  }
}

export async function isOurWatch(port) {
  return Boolean(await fetchWatchStatus(port));
}

/** One Chrome app window. A live heartbeat or existing HWND means do not spawn another. */
export function shouldSpawnWatchWindow({ open = true, windowLive = false, hwndLive = false } = {}) {
  if (!open) return { spawn: false, reason: "open-disabled" };
  if (windowLive || hwndLive) return { spawn: false, reason: "window-alive", focus: true };
  return { spawn: true, reason: "no-live-window" };
}

/**
 * Mission run/resume only opens the old 5176 window when `--watch` is explicit.
 * `--no-watch` remains accepted so existing scripts do not break.
 */
export function autoOpenWatchWindow(flags = {}) {
  if (flags["no-watch"] === true || flags.watch === "false") return false;
  return flags.watch === true || flags.watch === "true";
}

function pageHtml() {
  const raw = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "watch-page.html"), "utf8");
  return raw.replaceAll("%%PAGE_VERSION%%", WATCH_PAGE_VERSION);
}

/** Dedicated Chrome profile for the watch window — not the user's main Chrome. */
function puppyChromeProfile() {
  return join(tmpdir(), "kc-puppy-watch");
}

export function closePuppyProfileChrome() {
  if (process.platform !== "win32") return { ok: false, via: "unsupported" };
  const marker = "kc-puppy-watch";
  const ps = `
Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe'" |
  Where-Object { $_.CommandLine -match [regex]::Escape(${JSON.stringify(marker)}) } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
`;
  try {
    spawnSync("powershell.exe", ["-NoProfile", "-Command", ps], {
      timeout: 5000,
      windowsHide: true,
    });
    return { ok: true, via: "profile" };
  } catch {
    return { ok: false, via: "profile" };
  }
}

function send(res, status, body, type = "text/plain; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function windowsToast(title, body) {
  if (process.platform !== "win32") return;
  const ps = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$n = New-Object System.Windows.Forms.NotifyIcon
$n.Icon = [System.Drawing.SystemIcons]::Information
$n.Visible = $true
$n.ShowBalloonTip(8000, ${JSON.stringify(title)}, ${JSON.stringify(String(body || "").slice(0, 200))}, [System.Windows.Forms.ToolTipIcon]::Info)
Start-Sleep -Seconds 9
$n.Dispose()
`;
  try {
    const child = spawn("powershell.exe", ["-NoProfile", "-STA", "-Command", ps], {
      windowsHide: true,
      stdio: "ignore",
      detached: true,
    });
    child.unref();
  } catch {
    /* optional */
  }
}

export function focusPuppyWindow() {
  if (process.platform !== "win32") return { ok: false, via: "unsupported" };
  const ps = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class PuppyWin {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
"@
$p = Get-Process | Where-Object { $_.MainWindowTitle -match 'ROBO PUPPY' } | Select-Object -First 1
if (-not $p -or [int64]$p.MainWindowHandle -eq 0) { Write-Output 'missing'; exit 0 }
[void][PuppyWin]::ShowWindow($p.MainWindowHandle, 9)
[void][PuppyWin]::SetForegroundWindow($p.MainWindowHandle)
Write-Output 'focused'
`;
  try {
    const r = spawnSync("powershell.exe", ["-NoProfile", "-Command", ps], {
      encoding: "utf8",
      timeout: 4000,
      windowsHide: true,
    });
    const out = String(r.stdout || "").trim();
    return { ok: out === "focused", via: "hwnd", raw: out };
  } catch {
    return { ok: false, via: "hwnd" };
  }
}

export function openWatchWindow(origin) {
  const url = `${origin}/`;
  if (existsSync(CHROME)) {
    const child = spawn(CHROME, [
      `--app=${url}`,
      "--window-size=520,1200",
      `--user-data-dir=${puppyChromeProfile()}`,
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

export async function openOrFocusWatchWindow(origin) {
  let windowLive = false;
  try {
    const r = await fetch(`${origin}/api/status`, { signal: AbortSignal.timeout(800) });
    const j = await r.json();
    windowLive = Boolean(j?.windowLive);
  } catch {
    /* closed or not our watch */
  }
  const hwnd = focusPuppyWindow();
  const decision = shouldSpawnWatchWindow({ open: true, windowLive, hwndLive: hwnd.ok });
  if (!decision.spawn) {
    if (!hwnd.ok) focusPuppyWindow();
    return { ok: true, opened: false, focused: true, reason: decision.reason, url: `${origin}/` };
  }
  return { ...openWatchWindow(origin), opened: true, focused: false, reason: decision.reason };
}

export function startWatchServer({
  port = WATCH_PORT,
  missionId = null,
  log = console.log,
} = {}) {
  let lastWorking = null;
  let windowSeenAt = 0;
  const server = createServer((req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    if (url.pathname === "/avatar.jpg") {
      if (!existsSync(AVATAR)) return send(res, 404, "no avatar");
      res.writeHead(200, { "Content-Type": "image/jpeg", "Cache-Control": "no-store" });
      res.end(readFileSync(AVATAR));
      return;
    }
    if (url.pathname === "/bark.mp3") {
      if (!existsSync(BARK)) return send(res, 404, "no bark");
      res.writeHead(200, { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" });
      res.end(readFileSync(BARK));
      return;
    }
    if (url.pathname === "/api/status") {
      if (url.searchParams.get("window") === "1") windowSeenAt = Date.now();
      const s = puppyStatus({ missionId: missionId || url.searchParams.get("mission") || null });
      s.heat = machineHeat();
      s.windowLive = windowSeenAt > 0 && (Date.now() - windowSeenAt) < WINDOW_STALE_MS;
      s.pageVersion = WATCH_PAGE_VERSION;
      if (lastWorking === true && s.working === false && s.finished) {
        const title = s.state === "COMPLETE" ? "Robo Puppy finished" : "Robo Puppy stopped";
        windowsToast(title, s.blockedReason || s.workingOn || s.state);
      }
      lastWorking = !!s.working;
      send(res, 200, JSON.stringify(s), "application/json; charset=utf-8");
      return;
    }
    if (url.pathname === "/" || url.pathname === "/index.html") {
      send(res, 200, pageHtml(), "text/html; charset=utf-8");
      return;
    }
    send(res, 404, "not found");
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const origin = `http://127.0.0.1:${port}`;
      writeFileSync(stateFile(), `${JSON.stringify({ at: new Date().toISOString(), port, origin, pid: process.pid, missionId }, null, 2)}\n`);
      log(`puppy watch on ${origin}`);
      resolve({ server, port, origin });
    });
  });
}

export async function ensureWatchWindow({
  missionId = null,
  open = WATCH_WINDOW_DEFAULT_OPEN,
  preferredPort = WATCH_PORT,
  log = () => {},
} = {}) {
  const picked = await pickWatchPort({ preferred: preferredPort });
  if (picked.reused) {
    const origin = `http://127.0.0.1:${picked.port}`;
    if (open) await openOrFocusWatchWindow(origin);
    log(`reusing puppy watch on ${origin}`);
    return { origin, port: picked.port, started: false };
  }
  const cli = join(toolsRoot, "src", "cli.mjs");
  const args = [cli, "puppy", "watch", "--port", String(picked.port)];
  if (missionId) args.push("--mission", String(missionId));
  if (!open) args.push("--no-open");
  const child = spawn(process.execPath, args, {
    cwd: repoRoot,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    env: { ...process.env, BROWSER: "none" },
  });
  child.unref();
  const origin = `http://127.0.0.1:${picked.port}`;
  const t0 = Date.now();
  while (Date.now() - t0 < 8000) {
    if (await isOurWatch(picked.port)) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  log(`started puppy watch on ${origin} pid=${child.pid}`);
  return { origin, port: picked.port, started: true, pid: child.pid };
}

export async function watchCli({ pos = [], flags = {}, log = console.log } = {}) {
  const missionId = flags.mission || pos[0] || null;
  const preferred = Number(flags.port || WATCH_PORT);
  const open = flags.open !== "false" && flags["no-open"] !== true;
  const picked = await pickWatchPort({ preferred });
  if (picked.reused) {
    const origin = `http://127.0.0.1:${picked.port}`;
    log(`already watching at ${origin}`);
    if (open) await openOrFocusWatchWindow(origin);
    return { origin, port: picked.port, reused: true };
  }
  const { origin, port } = await startWatchServer({ port: picked.port, missionId, log });
  if (open) {
    closePuppyProfileChrome();
    openWatchWindow(origin);
  }
  log(`window: ${origin}`);
  log("leave this running; Ctrl+C closes the live feed (not the last screenshot).");
  await new Promise(() => {});
}
