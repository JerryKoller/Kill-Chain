/**
 * Capture a specific Kill Chain visualizer mode from the running dev server.
 *
 * The mode is not a route — it lives in localStorage under
 * `killchain.visualizer.v1` as `{ "mode": "<id>" }`. So the recipe is: open the
 * app, write the key, reload, let the canvas run for a fixed number of frames,
 * then grab the surface.
 *
 * TWO BLOCKERS FOUND WHILE BUILDING THIS. Both were discovered by capturing
 * and looking at the result, not by reasoning about it:
 *
 *   1. Two gates stand in front of the app. A legal modal ("Agree to
 *      continue", requires settings.legalAcceptedVersion === LEGAL_VERSION)
 *      and the 7-step onboarding tour (settings.onboardingDone). Both are
 *      seeded below. The first baseline attempt screenshotted the EULA.
 *
 *   2. THE VISUALIZER IS NOT REACHABLE IN THE VITE WEB BUILD. The `▦
 *      VISUALIZER` launch button (`.kc-vz-launch`) lives inside the Library
 *      view's controls block, and that whole block is replaced by a "Library
 *      needs the desktop app" empty state on the web build. The overlay's
 *      `open` flag is session-only by design, so it cannot be seeded around.
 *
 * So this function works against an ELECTRON target, not `vite`. Electron
 * accepts `--remote-debugging-port` as a CLI switch, which needs no production
 * change:
 *
 *     npx cross-env NODE_ENV=development electron . --remote-debugging-port=9222
 *
 * then call with `{ attachPort: 9222 }`. A track must be loaded once so the
 * Library controls render.
 *
 * The alternative — and the better one for a fast creative loop — is a
 * tooling-only harness page that mounts `createSingularity` on a bare canvas
 * with a synthetic IntelSnapshot. That is deterministic, needs no audio, no
 * gates and no desktop shell. It is specified in the mission brief and is NOT
 * built yet.
 *
 * AUDIO REACTIVITY CAVEAT: every renderer is driven by the shared VisualIntel
 * snapshot. With nothing playing, rms/low/mid/high/beat sit near zero and the
 * frame shows the IDLE look. Idle frames are usable for before/after
 * comparison as long as BOTH sides are captured identically, but they prove
 * nothing about beat response, ring spawns or transient bloom.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launchHeadlessChrome, cdpList, attachCdp } from "./cdp.mjs";
import { pngStats } from "./pngStats.mjs";

/**
 * Attach to an already-running Electron (or Chrome) exposing a debugging
 * port. Picks the largest visible page target, which is the app window.
 */
async function attachExisting(port) {
  const targets = await cdpList(port);
  const pages = (targets || []).filter((t) => t.type === "page" && !/devtools:/.test(t.url || ""));
  if (!pages.length) throw new Error(`no page targets on debugging port ${port}`);
  const client = await attachCdp(pages[0].webSocketDebuggerUrl);
  return {
    client,
    // Attaching must never kill the user's running app.
    close: async () => {
      try {
        await client.close?.();
      } catch {
        /* socket already closed */
      }
    },
  };
}

export const VISUALIZER_STORAGE_KEY = "killchain.visualizer.v1";

/**
 * The app shows a legal gate ("Agree to continue") before rendering anything,
 * so a fresh headless profile never reaches the visualizer at all — the first
 * baseline attempt captured the EULA modal instead of the canvas.
 *
 * `isLegalAccepted()` requires `legalAcceptedAt` set and `legalAcceptedVersion`
 * equal to `LEGAL_VERSION`. Seeding those in the throwaway headless profile is
 * a screenshot-harness concern on the developer's own machine; it changes no
 * repository file and no real user profile.
 */
export const SETTINGS_STORAGE_KEY = "audio-playground.settings.v1";
export const LEGAL_VERSION = "1.0-draft";

/**
 * @param {object} o
 * @param {string} o.mode visualizer id, e.g. "singularity"
 * @param {string} o.outPath absolute .png path
 * @param {number} o.settleMs how long to let the canvas animate before capture
 */
export async function captureVisualizer({
  mode = "singularity",
  url = "http://127.0.0.1:5174/",
  outPath,
  width = 1440,
  height = 900,
  settleMs = 6000,
  port = 9334,
  /** Attach to an already-running Electron/Chrome with this debugging port
   *  instead of launching headless Chrome. Required to reach the visualizer,
   *  which is desktop-only. */
  attachPort = null,
} = {}) {
  if (!outPath) throw new Error("captureVisualizer requires outPath");
  const session = attachPort
    ? await attachExisting(attachPort)
    : await launchHeadlessChrome({ url, width, height, port });
  const diag = { mode, url, width, height, settleMs };
  try {
    await session.client.send("Page.enable");
    await session.client.send("Runtime.enable");

    // localStorage throws SecurityError on about:blank, so wait until the
    // document actually has an http origin before seeding. Observed live: the
    // seed silently failed and the capture returned the legal gate.
    let origin = null;
    for (let i = 0; i < 40; i += 1) {
      const o = await session.client.send("Runtime.evaluate", {
        expression: "String(location.origin || '')",
        returnByValue: true,
      });
      origin = o.result?.value || "";
      if (/^https?:/.test(origin)) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    diag.origin = origin;
    if (!/^https?:/.test(origin)) {
      diag.ok = false;
      diag.error = `page never reached an http origin (got ${JSON.stringify(origin)}); is the dev server running at ${url}?`;
      return diag;
    }

    // Seed the mode AND clear the legal gate, then reload so the stores pick
    // both up on init. Without the gate the canvas never mounts.
    const seed = await session.client.send("Runtime.evaluate", {
      expression: `(() => {
        try {
          localStorage.setItem(${JSON.stringify(VISUALIZER_STORAGE_KEY)}, JSON.stringify({ mode: ${JSON.stringify(mode)} }));
          let settings = {};
          try { settings = JSON.parse(localStorage.getItem(${JSON.stringify(SETTINGS_STORAGE_KEY)}) || "{}") || {}; } catch { settings = {}; }
          settings.legalAcceptedVersion = ${JSON.stringify(LEGAL_VERSION)};
          settings.legalAcceptedAt = new Date().toISOString();
          // Second gate: the 7-step onboarding tour modal covers the app.
          settings.onboardingDone = true;
          localStorage.setItem(${JSON.stringify(SETTINGS_STORAGE_KEY)}, JSON.stringify(settings));
          return { seeded: true };
        } catch (e) { return { seeded: false, error: String(e) }; }
      })()`,
      returnByValue: true,
    });
    diag.seed = seed.result?.value || null;
    await session.client.send("Page.reload", { ignoreCache: false });
    await new Promise((r) => setTimeout(r, 2500));

    // Hide the boot splash if it is still up.
    await session.client.send("Runtime.evaluate", {
      expression: `(() => {
        const s = document.getElementById("boot-splash");
        if (s) { s.classList.add("boot-hide"); s.style.display = "none"; }
        return Boolean(s);
      })()`,
      returnByValue: true,
    });

    // The overlay's `open` flag is session-only (deliberately not persisted),
    // so it cannot be seeded — it has to be opened the way a user does. The
    // launch button lives on the Library view, so reach that first if needed.
    const openOverlay = await session.client.send("Runtime.evaluate", {
      awaitPromise: true,
      returnByValue: true,
      expression: `(async () => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const findLaunch = () => document.querySelector(".kc-vz-launch")
          || Array.from(document.querySelectorAll("button")).find((b) => /visualizer/i.test(b.textContent || ""));
        const steps = [];

        let btn = findLaunch();
        if (!btn) {
          // Not on the Library view — click the nav entry that owns it.
          const nav = Array.from(document.querySelectorAll("button, a"))
            .find((e) => /^\\s*library\\s*$/i.test((e.textContent || "").trim()))
            || Array.from(document.querySelectorAll("button, a"))
              .find((e) => /library/i.test(e.textContent || ""));
          if (nav) { nav.click(); steps.push("clicked nav:library"); await sleep(1200); }
          btn = findLaunch();
        }
        if (btn) { btn.click(); steps.push("clicked visualizer launch"); await sleep(1800); }
        else steps.push("launch button not found");

        const big = Array.from(document.querySelectorAll("canvas"))
          .map((c) => ({ w: c.clientWidth, h: c.clientHeight }))
          .sort((a, b) => (b.w * b.h) - (a.w * a.h))[0] || null;
        return { steps, largestCanvas: big };
      })()`,
    });
    diag.openOverlay = openOverlay.result?.value || null;

    // Confirm the mode actually took and a canvas is present and animating.
    const probe = await session.client.send("Runtime.evaluate", {
      awaitPromise: true,
      returnByValue: true,
      expression: `(async () => {
        const readMode = () => {
          try { return JSON.parse(localStorage.getItem(${JSON.stringify(VISUALIZER_STORAGE_KEY)}) || "{}").mode || null; }
          catch { return null; }
        };
        const canvases = () => Array.from(document.querySelectorAll("canvas"))
          .map((c) => ({ w: c.width, h: c.height, cls: c.className || "" }));
        // Count animation frames over a short window to prove it is live.
        let frames = 0;
        const t0 = performance.now();
        await new Promise((res) => {
          const tick = () => { frames += 1; if (performance.now() - t0 > 900) res(); else requestAnimationFrame(tick); };
          requestAnimationFrame(tick);
        });
        return {
          mode: readMode(),
          canvases: canvases(),
          framesIn900ms: frames,
          webgl2: (() => { try { return Boolean(document.createElement("canvas").getContext("webgl2")); } catch { return false; } })(),
        };
      })()`,
    });
    diag.probe = probe.result?.value || null;

    await new Promise((r) => setTimeout(r, settleMs));

    const shot = await session.client.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
      fromSurface: true,
    });
    const buf = Buffer.from(shot.data, "base64");
    mkdirSync(join(outPath, ".."), { recursive: true });
    writeFileSync(outPath, buf);
    diag.bytes = buf.length;
    try {
      diag.stats = pngStats(buf);
    } catch {
      diag.stats = null;
    }
    diag.ok = true;
    return diag;
  } catch (e) {
    diag.ok = false;
    diag.error = e.message;
    return diag;
  } finally {
    try {
      await session.close();
    } catch {
      /* headless chrome already gone */
    }
  }
}

/**
 * Frame-rate sample for the current mode. Crude but sufficient to catch a
 * change that halves the frame rate, which is the performance regression that
 * actually matters for a visualizer.
 */
export async function measureVisualizerFps({
  mode = "singularity",
  url = "http://127.0.0.1:5174/",
  sampleMs = 4000,
  width = 1440,
  height = 900,
  port = 9335,
} = {}) {
  const session = await launchHeadlessChrome({ url, width, height, port });
  try {
    await session.client.send("Runtime.enable");
    await session.client.send("Runtime.evaluate", {
      expression: `localStorage.setItem(${JSON.stringify(VISUALIZER_STORAGE_KEY)}, JSON.stringify({ mode: ${JSON.stringify(mode)} }))`,
      returnByValue: true,
    });
    await session.client.send("Page.reload", {});
    await new Promise((r) => setTimeout(r, 3500));
    const r = await session.client.send("Runtime.evaluate", {
      awaitPromise: true,
      returnByValue: true,
      expression: `(async () => {
        let frames = 0;
        const t0 = performance.now();
        await new Promise((res) => {
          const tick = () => {
            frames += 1;
            if (performance.now() - t0 > ${Number(sampleMs)}) res(); else requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        });
        const ms = performance.now() - t0;
        return { frames, ms, fps: +(frames / (ms / 1000)).toFixed(1) };
      })()`,
    });
    return { ok: true, mode, ...(r.result?.value || {}) };
  } catch (e) {
    return { ok: false, mode, error: e.message };
  } finally {
    try {
      await session.close();
    } catch {
      /* already gone */
    }
  }
}
