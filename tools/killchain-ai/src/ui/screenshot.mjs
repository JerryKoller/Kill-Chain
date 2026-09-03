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

async function evalValue(client, expression) {
  const ev = await client.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (ev.exceptionDetails) {
    return { error: ev.exceptionDetails.text || "eval-error" };
  }
  return ev.result?.value ?? null;
}

function clickExactText(text) {
  return `(() => {
    const want = ${JSON.stringify(text)};
    const nodes = [...document.querySelectorAll("button, label, a, [role='button']")];
    const el = nodes.find((n) => (n.innerText || "").replace(/\\s+/g, " ").trim() === want
      || (n.innerText || "").includes(want) && (n.innerText || "").length < 120);
    if (!el) return { ok: false, want };
    el.click();
    return { ok: true, want, tag: el.tagName, text: (el.innerText || "").slice(0, 80) };
  })()`;
}

/**
 * Diagnostic-only: hide splash, accept license, skip tour, open Fire Command.
 * Does not change production splash/license/tour behavior.
 */
export async function captureFireCommand({
  url = "http://127.0.0.1:5174/",
  outPath,
  width = 1440,
  height = 900,
  waitMs = 20000,
  port = 9340,
} = {}) {
  const dir = screenshotDir();
  const dest = outPath || join(dir, "fire-command.png");
  const session = await launchHeadlessChrome({ url, width, height, port });
  const log = [];
  try {
    await session.client.send("Page.enable");
    await session.client.send("Runtime.enable");
    const t0 = Date.now();
    while (Date.now() - t0 < waitMs) {
      const ready = await evalValue(session.client, `({
        rootChildren: document.getElementById("root")?.childElementCount || 0,
        buttons: document.querySelectorAll("button").length,
        textLen: (document.body && document.body.innerText || "").length,
        hasLicense: /Agree to continue|I agree/.test(document.body.innerText || ""),
        hasTour: /Skip tour/.test(document.body.innerText || ""),
      })`);
      log.push({ wait: Date.now() - t0, ready });
      if (ready && (ready.rootChildren > 0 || ready.buttons > 0 || ready.textLen > 40)) break;
      await new Promise((r) => setTimeout(r, 400));
    }
    await evalValue(session.client, `(() => {
      const splash = document.getElementById("boot-splash");
      if (splash) { splash.classList.add("boot-hide"); splash.style.display = "none"; }
      return Boolean(splash);
    })()`);
    await new Promise((r) => setTimeout(r, 400));

    const licenseCb = await evalValue(session.client, `(() => {
      const input = document.querySelector("input[type=checkbox]");
      if (!input) return { ok: false, reason: "no-checkbox" };
      if (!input.checked) input.click();
      return { ok: true, checked: input.checked };
    })()`);
    log.push({ licenseCb });
    await new Promise((r) => setTimeout(r, 200));
    const agree = await evalValue(session.client, clickExactText("I agree — continue"));
    log.push({ agree });
    await new Promise((r) => setTimeout(r, 800));

    const skip = await evalValue(session.client, clickExactText("Skip tour"));
    log.push({ skip });
    await new Promise((r) => setTimeout(r, 1200));

    const fireClick = await evalValue(session.client, `(() => {
      const el = document.querySelector("button[data-module='fire']");
      if (!el) return { ok: false, reason: "no-data-module-fire" };
      el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
      el.click();
      return { ok: true, aria: el.getAttribute("aria-current"), text: (el.innerText || "").slice(0, 80) };
    })()`);
    log.push({ fireClick });
    await new Promise((r) => setTimeout(r, 800));
    const gotIt = await evalValue(session.client, clickExactText("Got it"));
    log.push({ gotIt });
    await new Promise((r) => setTimeout(r, 600));
    const perf = await evalValue(session.client, `(() => {
      const tabs = [...document.querySelectorAll("button")];
      const el = tabs.find((n) => (n.innerText || "").trim() === "PERF" || (n.getAttribute("title") || "").startsWith("Performance"));
      if (!el) return { ok: false, reason: "no-PERF-tab" };
      el.click();
      return { ok: true, text: (el.innerText || "").slice(0, 40), title: el.getAttribute("title") };
    })()`);
    log.push({ perf });
    await new Promise((r) => setTimeout(r, 800));

    const t1 = Date.now();
    let opened = null;
    while (Date.now() - t1 < 45000) {
      opened = await evalValue(session.client, `({
        href: location.href,
        ariaFire: document.querySelector("button[data-module='fire']")?.getAttribute("aria-current") || null,
        weaponsEl: Boolean(document.querySelector('[title="Fire Command MK IV — weapons free"]')),
        hasWeapons: /weapons free|Fire Command MK/i.test(document.body.innerText || ""),
        hasRhythm: /Rhythm Shutter/.test(document.body.innerText || ""),
        hasGate: /\\bGate\\b/.test(document.body.innerText || ""),
        hasMacro: /\\bMacro\\b/.test(document.body.innerText || ""),
        error: (document.body.innerText || "").match(/Something went wrong|ErrorBoundary|is not defined/)?.[0] || null,
        textSample: (document.body.innerText || "").slice(0, 500),
      })`);
      if (opened?.weaponsEl || opened?.hasWeapons || opened?.hasRhythm) break;
      await new Promise((r) => setTimeout(r, 600));
    }
    if (!(opened?.weaponsEl || opened?.hasWeapons || opened?.hasRhythm)) {
      const seeded = await evalValue(session.client, `(() => {
        try {
          const key = "audio-playground.settings.v1";
          const raw = JSON.parse(localStorage.getItem(key) || "{}");
          raw.onboardingDone = true;
          raw.legalAcceptedVersion = raw.legalAcceptedVersion || "1.0-draft";
          raw.legalAcceptedAt = raw.legalAcceptedAt || new Date().toISOString();
          raw.lastSeenVersion = raw.lastSeenVersion || "3.5.0";
          localStorage.setItem(key, JSON.stringify(raw));
          localStorage.setItem("killchain.lastView.v1", "fire");
          location.reload();
          return { ok: true };
        } catch (e) {
          return { ok: false, error: String(e) };
        }
      })()`);
      log.push({ seeded });
      await new Promise((r) => setTimeout(r, 2500));
      const t2 = Date.now();
      while (Date.now() - t2 < 45000) {
        opened = await evalValue(session.client, `({
          href: location.href,
          ariaFire: document.querySelector("button[data-module='fire']")?.getAttribute("aria-current") || null,
          weaponsEl: Boolean(document.querySelector('[title="Fire Command MK IV — weapons free"]')),
          hasWeapons: /weapons free|Fire Command MK/i.test(document.body.innerText || ""),
          hasRhythm: /Rhythm Shutter/.test(document.body.innerText || ""),
          hasGate: /\\bGate\\b/.test(document.body.innerText || ""),
          hasMacro: /\\bMacro\\b/.test(document.body.innerText || ""),
          splash: Boolean(document.getElementById("boot-splash")) && getComputedStyle(document.getElementById("boot-splash")).display !== "none",
          textSample: (document.body.innerText || "").slice(0, 500),
        })`);
        if (opened?.splash) {
          await evalValue(session.client, `(() => {
            const splash = document.getElementById("boot-splash");
            if (splash) { splash.style.display = "none"; }
            return true;
          })()`);
        }
        if (opened?.weaponsEl || opened?.hasWeapons || opened?.hasRhythm) break;
        await new Promise((r) => setTimeout(r, 600));
      }
    }
    log.push({ opened });
    const scrollPerf = await evalValue(session.client, `(() => {
      const hit = [...document.querySelectorAll("div,span")].find((n) => {
        const t = (n.innerText || "").trim();
        return (t === "Rhythm Shutter" || t.startsWith("Rhythm Shutter") || t === "Macros" || t === "Macro") && t.length < 80;
      });
      if (hit) {
        hit.scrollIntoView({ block: "center", inline: "nearest" });
        return { ok: true, text: (hit.innerText || "").slice(0, 80) };
      }
      return { ok: false };
    })()`);
    log.push({ scrollPerf });
    await new Promise((r) => setTimeout(r, 500));

    const metrics = await evalValue(session.client, `(() => {
      const byText = (needle) => {
        const el = [...document.querySelectorAll("div,span,button,h1,h2,h3")].find(
          (n) => (n.innerText || "").includes(needle) && (n.innerText || "").length < 200,
        );
        if (!el) return { needle, found: false };
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return {
          needle,
          found: true,
          tag: el.tagName,
          text: (el.innerText || "").slice(0, 160),
          box: { x: r.x, y: r.y, w: r.width, h: r.height },
          overflowX: el.scrollWidth - el.clientWidth,
          gap: cs.gap,
          opacity: cs.opacity,
          color: cs.color,
        };
      };
      return {
        href: location.href,
        viewport: { innerWidth: window.innerWidth, innerHeight: window.innerHeight },
        rhythm: byText("Rhythm Shutter"),
        gate: byText("Gate"),
        macro: byText("Macro"),
        skipTour: byText("Skip tour"),
      };
    })()`);
    const shot = await session.client.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
      fromSurface: true,
    });
    const buf = Buffer.from(shot.data, "base64");
    mkdirSync(join(dest, ".."), { recursive: true });
    writeFileSync(dest, buf);
    const stats = pngStats(buf);
    const viewports = {};
    for (const w of DEFAULT_VIEWPORTS) {
      try {
        await session.client.send("Emulation.setDeviceMetricsOverride", {
          width: w,
          height,
          deviceScaleFactor: 1,
          mobile: false,
        });
        await new Promise((r) => setTimeout(r, 350));
      } catch { /* emulation optional */ }
      const vpShot = await session.client.send("Page.captureScreenshot", {
        format: "png",
        captureBeyondViewport: false,
        fromSurface: true,
      });
      const vpBuf = Buffer.from(vpShot.data, "base64");
      const vpPath = join(dir, `fire-command-${w}.png`);
      writeFileSync(vpPath, vpBuf);
      const vpMetrics = await evalValue(session.client, metricsExpression({
        selectors: ["#root", "button[data-module='fire']"],
      }));
      viewports[String(w)] = {
        path: vpPath,
        bytes: vpBuf.length,
        stats: pngStats(vpBuf),
        overflow: vpMetrics?.bodyOverflowX,
        viewport: vpMetrics?.viewport,
      };
    }
    const report = {
      at: new Date().toISOString(),
      dest,
      bytes: buf.length,
      stats,
      opened,
      log,
      metrics,
      viewports,
      note: "Diagnostic Chrome only. Production splash/license/tour unchanged.",
    };
    writeFileSync(join(dir, "fire-command-capture.json"), `${JSON.stringify(report, null, 2)}\n`);
    return { ok: Boolean(opened?.hasRhythm || opened?.hasWeapons || opened?.weaponsEl), ...report };
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
