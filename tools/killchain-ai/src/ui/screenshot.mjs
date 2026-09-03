import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dataDir } from "../paths.mjs";
import { pngStats } from "./pngStats.mjs";
import { launchHeadlessChrome } from "./cdp.mjs";
import { metricsExpression } from "./metrics.mjs";

const CHROME = process.env.CHROME_PATH
  || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

export const DEFAULT_VIEWPORTS = [1440, 1366, 1280];

export function screenshotDir() {
  const dir = join(dataDir, "overnight", "screenshots");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function run(cmd, args, { timeoutMs = 45000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const t = setTimeout(() => {
      try { child.kill(); } catch {}
      resolve({ ok: false, code: 124, stdout, stderr: stderr + "\n[timeout]" });
    }, timeoutMs);
    child.stdout?.on("data", (d) => { stdout += d; });
    child.stderr?.on("data", (d) => { stderr += d; });
    child.on("error", (e) => {
      clearTimeout(t);
      resolve({ ok: false, code: 1, stdout, stderr: String(e) });
    });
    child.on("exit", (code) => {
      clearTimeout(t);
      resolve({ ok: code === 0, code: code ?? 1, stdout, stderr });
    });
  });
}

/**
 * One-shot Chromium screenshot. Does not change production app behavior.
 * Variants GPU vs disable-gpu diagnose compositor-black captures.
 */
export async function chromeScreenshot({
  url,
  outPath,
  width = 1440,
  height = 900,
  disableGpu = false,
  virtualTimeBudgetMs = 8000,
} = {}) {
  if (!existsSync(CHROME)) {
    return { ok: false, error: `chrome not found: ${CHROME}` };
  }
  mkdirSync(join(outPath, ".."), { recursive: true });
  const args = [
    "--headless=new",
    "--hide-scrollbars",
    `--window-size=${width},${height}`,
    `--screenshot=${outPath}`,
    `--virtual-time-budget=${virtualTimeBudgetMs}`,
    "--no-first-run",
    "--no-default-browser-check",
  ];
  if (disableGpu) args.push("--disable-gpu");
  args.push(url);
  const proc = await run(CHROME, args, { timeoutMs: virtualTimeBudgetMs + 20000 });
  if (!existsSync(outPath)) {
    return { ok: false, error: "no screenshot file", proc };
  }
  const buf = readFileSync(outPath);
  const stats = pngStats(buf);
  return { ok: true, outPath, bytes: buf.length, stats, proc, disableGpu, url, width, height };
}

export async function diagnoseViteScreenshot({
  url = "http://127.0.0.1:5174/",
  widths = DEFAULT_VIEWPORTS,
} = {}) {
  const dir = screenshotDir();
  const results = [];
  for (const width of widths) {
    for (const disableGpu of [false, true]) {
      const name = `vite-${width}-gpu${disableGpu ? "off" : "on"}.png`;
      const outPath = join(dir, name);
      const r = await chromeScreenshot({ url, outPath, width, height: 900, disableGpu });
      results.push({ name, ...r, stats: r.stats || null });
    }
  }
  const report = {
    at: new Date().toISOString(),
    url,
    chrome: CHROME,
    note: "Electron CDP (9223) was down during this run; these captures are Chromium-headless against the Vite URL, not BrowserWindow.capturePage.",
    results: results.map((r) => ({
      name: r.name,
      ok: r.ok,
      bytes: r.bytes || 0,
      disableGpu: r.disableGpu,
      width: r.width,
      likelyBlack: r.stats?.likelyBlack,
      likelyUsable: r.stats?.likelyUsable,
      blackRatio: r.stats?.blackRatio,
      maxLuma: r.stats?.maxLuma,
      error: r.error || null,
    })),
  };
  writeFileSync(join(dir, "DIAGNOSE.json"), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

/**
 * Capture after mount. Optionally hide #boot-splash in THIS diagnostic
 * browser only — production splash/audio gating is unchanged.
 */
export async function captureReadyUi({
  url = "http://127.0.0.1:5174/",
  outPath,
  width = 1440,
  height = 900,
  hideSplash = true,
  selectors = ["#root", "button"],
  waitMs = 8000,
} = {}) {
  const session = await launchHeadlessChrome({ url, width, height, port: 9333 });
  try {
    await session.client.send("Page.enable");
    await session.client.send("Runtime.enable");
    const t0 = Date.now();
    let ready = null;
    while (Date.now() - t0 < waitMs) {
      const ev = await session.client.send("Runtime.evaluate", {
        expression: `(() => {
          const splash = document.getElementById("boot-splash");
          const root = document.getElementById("root");
          return {
            href: location.href,
            splash: Boolean(splash),
            splashClass: splash ? splash.className : null,
            rootChildren: root ? root.childElementCount : 0,
            buttons: document.querySelectorAll("button").length,
            textLen: (document.body && document.body.innerText || "").length,
          };
        })()`,
        returnByValue: true,
      });
      ready = ev.result?.value || ev.result;
      if (ready && (ready.rootChildren > 0 || ready.buttons > 2 || ready.textLen > 80)) break;
      await new Promise((r) => setTimeout(r, 400));
    }
    if (hideSplash) {
      await session.client.send("Runtime.evaluate", {
        expression: `(() => {
          const splash = document.getElementById("boot-splash");
          if (splash) { splash.classList.add("boot-hide"); splash.style.display = "none"; }
          return Boolean(splash);
        })()`,
        returnByValue: true,
      });
      await new Promise((r) => setTimeout(r, 500));
    }
    const metrics = await session.client.send("Runtime.evaluate", {
      expression: metricsExpression({ selectors }),
      returnByValue: true,
    });
    const shot = await session.client.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
      fromSurface: true,
    });
    const buf = Buffer.from(shot.data, "base64");
    mkdirSync(join(outPath, ".."), { recursive: true });
    writeFileSync(outPath, buf);
    return {
      ok: true,
      outPath,
      bytes: buf.length,
      stats: pngStats(buf),
      ready,
      metrics: metrics.result?.value || metrics.result,
      hideSplash,
    };
  } finally {
    await session.close();
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  diagnoseViteScreenshot({ url: process.argv[2] || "http://127.0.0.1:5174/" }).then((r) => {
    console.log(JSON.stringify(r, null, 2));
  }).catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
