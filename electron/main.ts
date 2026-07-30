import { app, BrowserWindow, ipcMain, dialog, shell, protocol, screen, desktopCapturer, session, crashReporter } from "electron";
import path from "node:path";
import { promises as fs } from "node:fs";
import { execFile } from "node:child_process";
import http from "node:http";
import dgram from "node:dgram";
import os from "node:os";
import { installNativeMidiHost, shutdownNativeMidiHost } from "./midiHost";

const isDev = process.env.NODE_ENV === "development";

// ──────────────── Crash logging (v1.5) ────────────────
// Local-only: native crash dumps stay on disk (uploadToServer: false) and
// process failures are appended to <userData>/crash.log. Remote reporting
// (Sentry) is opt-in in Settings and only activates when a DSN is baked in
// at build time — see src/lib/crashReporting.ts.
crashReporter.start({ uploadToServer: false, submitURL: "" });

const crashLogPath = () => path.join(app.getPath("userData"), "crash.log");

async function appendCrashLog(source: string, detail: string): Promise<void> {
  try {
    await fs.appendFile(
      crashLogPath(),
      `[${new Date().toISOString()}] [${source}] ${detail}\n`,
      "utf8",
    );
  } catch {
    /* the crash logger must never crash anything */
  }
}

process.on("uncaughtException", (err) => {
  void appendCrashLog("main:uncaught", String(err?.stack ?? err));
});
app.on("render-process-gone", (_e, wc, details) => {
  void appendCrashLog(
    "renderer-gone",
    `reason=${details.reason} exit=${details.exitCode} url=${wc.getURL()}`,
  );
});
app.on("child-process-gone", (_e, details) => {
  void appendCrashLog(
    "child-gone",
    `type=${details.type} reason=${details.reason} exit=${details.exitCode}`,
  );
});

// Renderer error hook (window.onerror / unhandledrejection) → same log.
ipcMain.on("crash:renderer", (_e, entry: { source?: string; message?: string }) => {
  void appendCrashLog(
    `renderer:${entry?.source ?? "error"}`,
    String(entry?.message ?? "").slice(0, 4000),
  );
});
ipcMain.handle("crash:openLog", async () => {
  try {
    await fs.access(crashLogPath());
  } catch {
    await fs.writeFile(crashLogPath(), "", "utf8");
  }
  shell.showItemInFolder(crashLogPath());
});

// Let the splash-screen intro sound play on launch without a user gesture.
// Chromium blocks audible autoplay by default; this opt-in must be set before
// the app is ready.
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

// Web MIDI on Windows 11 + MIDI Services: Chromium's WinRT MIDI backend often
// hangs requestMIDIAccess forever (or returns an empty list). Force the
// classic WinMM path so class-compliant controllers (e.g. Akai MPK Mini)
// enumerate normally. Must be set before app ready.
app.commandLine.appendSwitch("disable-features", "MidiManagerWinrt");

// ──────────────── Lean harder on the hardware ────────────────
// Push the heavy lifting onto the GPU and give V8 real headroom. All of the
// visualisers (scope, spectrum, wavetable stacks, meters) are <canvas>, and
// the chrome is a busy compositing scene — letting Chromium GPU-rasterise and
// composite them keeps the CPU free for the audio render thread. We skip the
// conservative GPU blocklist so this also kicks in on driver combos Chromium
// would otherwise force onto the software rasteriser.
app.commandLine.appendSwitch("ignore-gpu-blocklist");
app.commandLine.appendSwitch("enable-gpu-rasterization");
app.commandLine.appendSwitch("enable-zero-copy");
app.commandLine.appendSwitch("canvas-oop-rasterization");
// Size V8's old-space heap to half of installed RAM (clamped 2–8 GB) so large
// libraries, wavetable banks and reference buffers never crowd against the
// default ~2 GB renderer ceiling on a well-specced machine.
{
  const totalGB = os.totalmem() / 1024 ** 3;
  const heapMB = Math.min(8192, Math.max(2048, Math.round(totalGB / 2) * 1024));
  app.commandLine.appendSwitch("js-flags", `--max-old-space-size=${heapMB}`);
}

// Register a custom CORS-friendly scheme that streams arbitrary local files
// to the renderer with the right headers. The renderer plays user tracks via
// `playground-audio:///C:/path/to/track.mp3` instead of `file:///...` so that
// Web Audio's `createMediaElementSource` produces real samples instead of
// silence (cross-origin file:// URLs are CORS-tainted and yield zeros).
//
// This MUST be called before app.whenReady() resolves.
protocol.registerSchemesAsPrivileged([
  {
    scheme: "playground-audio",
    privileges: {
      standard: true,
      secure: true,
      stream: true,
      supportFetchAPI: true,
      bypassCSP: true,
      corsEnabled: true,
    },
  },
]);

// Every container/codec Electron's Chromium can decode through <audio>.
// WAV (PCM) and FLAC cover hi-res up to 24-bit / high sample rates; the
// Web Audio graph then runs at 32-bit float internally, so lossless tracks
// stay full-quality. (AIFF, ALAC, WMA, DSD are NOT decodable by Chromium
// and would need bundled decoders.)
const AUDIO_MIME: Record<string, string> = {
  ".wav":  "audio/wav",
  ".wave": "audio/wav",
  ".flac": "audio/flac",
  ".mp3":  "audio/mpeg",
  ".ogg":  "audio/ogg",
  ".oga":  "audio/ogg",
  ".opus": "audio/ogg",
  ".m4a":  "audio/mp4",
  ".m4b":  "audio/mp4",
  ".mp4":  "audio/mp4",
  ".aac":  "audio/aac",
  ".webm": "audio/webm",
  ".weba": "audio/webm",
  ".mka":  "audio/x-matroska",
};

function mimeTypeFor(filePath: string): string {
  return AUDIO_MIME[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

function registerAudioProtocol(): void {
  protocol.handle("playground-audio", async (request) => {
    let filePath = "(unparsed)";
    try {
      const url = new URL(request.url);
      // The renderer encodes the file path as ?p=<encoded full path>.
      // Encoding it in the URL *path* is unreliable because Chromium's
      // standard-scheme parser normalises drive letters into the host
      // slot ("playground-audio:///C:/foo" becomes ".../c/foo", losing
      // the colon). The query string is preserved verbatim.
      const qp = url.searchParams.get("p");
      if (qp) {
        filePath = qp;
      } else {
        // Legacy URL form (pre-fix builds): try the path component too.
        filePath = decodeURIComponent(url.pathname);
        if (process.platform === "win32" && /^\/[a-zA-Z]:/.test(filePath)) {
          filePath = filePath.slice(1);
        }
      }

      const stat = await fs.stat(filePath);
      const total = stat.size;
      const mime = mimeTypeFor(filePath);
      const range = request.headers.get("range");

      console.log(`[playground-audio] ${request.method} ${filePath} (${total} bytes, mime=${mime}, range=${range ?? "none"})`);

      if (request.method === "HEAD") {
        return new Response(null, {
          status: 200,
          headers: {
            "Content-Type":    mime,
            "Content-Length":  String(total),
            "Accept-Ranges":   "bytes",
            "Access-Control-Allow-Origin": "*",
          },
        });
      }

      if (range) {
        const m = /^bytes=(\d+)-(\d*)$/.exec(range);
        if (m) {
          const start = parseInt(m[1], 10);
          const end   = m[2] ? Math.min(parseInt(m[2], 10), total - 1) : total - 1;
          const len   = end - start + 1;
          const fh = await fs.open(filePath, "r");
          const buf = Buffer.alloc(len);
          await fh.read(buf, 0, len, start);
          await fh.close();
          return new Response(buf, {
            status: 206,
            headers: {
              "Content-Type":   mime,
              "Content-Length": String(len),
              "Content-Range":  `bytes ${start}-${end}/${total}`,
              "Accept-Ranges":  "bytes",
              "Access-Control-Allow-Origin": "*",
            },
          });
        }
      }

      const data = await fs.readFile(filePath);
      return new Response(data, {
        status: 200,
        headers: {
          "Content-Type":   mime,
          "Content-Length": String(total),
          "Accept-Ranges":  "bytes",
          "Access-Control-Allow-Origin": "*",
        },
      });
    } catch (err) {
      console.error(`[playground-audio] failed to serve ${filePath}:`, err);
      const msg = err instanceof Error ? err.message : String(err);
      return new Response(`playground-audio error: ${msg}`, {
        status: 500,
        headers: { "Content-Type": "text/plain", "Access-Control-Allow-Origin": "*" },
      });
    }
  });
}

let mainWindow: BrowserWindow | null = null;

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1120,
    minHeight: 720,
    backgroundColor: "#06060c",
    title: "Kill-Chain",
    // Frameless so native OS chrome is gone; min/max/close live in TitleBar.
    frame: false,
    titleBarStyle: "hidden",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Required so the renderer can use AudioWorklet / Web Audio reliably.
      backgroundThrottling: false,
      // In-app browser (Airspace view) embeds sites via <webview>.
      webviewTag: true,
    },
    show: false,
  });

  // ── Airspace <webview> hardening ──
  // Strip any privileged options a guest page could try to smuggle in and
  // keep guests fully isolated (no node, no preload).
  mainWindow.webContents.on("will-attach-webview", (event, webPreferences, params) => {
    delete (webPreferences as { preload?: string }).preload;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
    if (params.src && !/^https?:\/\//i.test(String(params.src))) {
      event.preventDefault();
    }
  });

  // Popups from guest pages: navigate the SAME webview for http(s) targets,
  // deny everything else (no stray OS windows from ads / target=_blank).
  // Also bookkeep the guest so the "airspace" display-media mode can answer
  // capture requests with THIS webview's main frame (per-frame tab capture).
  mainWindow.webContents.on("did-attach-webview", (_e, guest) => {
    airspaceWebContents = guest;
    guest.once("destroyed", () => {
      if (airspaceWebContents === guest) airspaceWebContents = null;
    });
    guest.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url)) {
        guest.loadURL(url).catch((err) => {
          console.warn("[airspace] popup redirect failed:", err);
        });
      }
      return { action: "deny" };
    });
  });

  mainWindow.once("ready-to-show", () => mainWindow?.show());

  // The broadcast window is a satellite of the main one — no point leaving
  // it orphaned (it would keep the app alive with no way to control it).
  mainWindow.on("closed", () => closeVizWindow());

  // Safety net: force-show the window after a few seconds even if
  // ready-to-show never fires. Without this, a renderer error during
  // initial load (failed asset, JS throw, etc.) results in an
  // *invisible* window and the app looks like it "did nothing".
  // DevTools is only auto-opened in development so production launches
  // stay clean (no stray console/DevTools window popping up).
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      console.warn("[main] ready-to-show didn't fire within 5s; force-showing window.");
      mainWindow.show();
      if (isDev) mainWindow.webContents.openDevTools({ mode: "detach" });
    }
  }, 5000);

  // Log every renderer failure to the launch log so we always know why.
  mainWindow.webContents.on("did-fail-load", (_e, code, desc, url) => {
    console.error(`[main] did-fail-load: ${code} ${desc} (${url})`);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      if (isDev) mainWindow.webContents.openDevTools({ mode: "detach" });
    }
  });

  // v2.4: a dead renderer now RECOVERS — reload the window instead of
  // leaving a frozen ghost. "clean-exit" / "killed" are deliberate (window
  // close, app quit), everything else is a crash worth restarting from.
  mainWindow.webContents.on("render-process-gone", (_e, details) => {
    console.error(`[main] render-process-gone: reason=${details.reason} exitCode=${details.exitCode}`);
    if (details.reason === "clean-exit" || details.reason === "killed") return;
    if (mainWindow && !mainWindow.isDestroyed()) {
      setTimeout(() => {
        try {
          mainWindow?.webContents.reload();
          mainWindow?.show();
        } catch { /* window torn down mid-recovery */ }
      }, 350);
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  // DevTools is no longer auto-opened in production, but keep it reachable
  // for diagnostics via F12 / Ctrl+Shift+I.
  mainWindow.webContents.on("before-input-event", (_e, input) => {
    if (input.type !== "keyDown") return;
    const f12 = input.key === "F12";
    const ctrlShiftI =
      (input.control || input.meta) && input.shift && input.key.toLowerCase() === "i";
    if (f12 || ctrlShiftI) {
      mainWindow?.webContents.toggleDevTools();
    }
  });

  if (isDev) {
    mainWindow.loadURL("http://localhost:5173");
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    const indexPath = path.join(__dirname, "..", "dist", "index.html");
    mainWindow.loadFile(indexPath).catch((err) => {
      console.error(`[main] loadFile failed for ${indexPath}:`, err);
    });
  }
}

ipcMain.handle("dialog:openAudio", async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Load a track into the lab",
    properties: ["openFile"],
    filters: [
      {
        name: "Audio",
        extensions: Object.keys(AUDIO_MIME).map((e) => e.slice(1)),
      },
    ],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

// Multi-select variant — the Restoration Bay's offline batch processor.
ipcMain.handle("dialog:openAudioMulti", async (): Promise<string[]> => {
  if (!mainWindow) return [];
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Pick audio files to restore",
    properties: ["openFile", "multiSelections"],
    filters: [
      {
        name: "Audio",
        extensions: Object.keys(AUDIO_MIME).map((e) => e.slice(1)),
      },
    ],
  });
  return result.canceled ? [] : result.filePaths;
});

// Single output-folder picker (batch restore writes results there).
ipcMain.handle("dialog:pickOutputFolder", async (): Promise<string | null> => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Choose an output folder for restored files",
    properties: ["openDirectory", "createDirectory"],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

// Dialog-free write into a folder the user already picked (batch restore).
ipcMain.handle(
  "file:writeIn",
  async (_e, opts: { dir: string; name: string; dataBase64: string }) => {
    try {
      // The name must stay a plain file name — no path traversal.
      const safeName = path.basename(String(opts.name || "output.wav"));
      const full = path.join(String(opts.dir), safeName);
      await fs.writeFile(full, Buffer.from(opts.dataBase64, "base64"));
      return full;
    } catch (err) {
      console.error("[file:writeIn] write failed:", err);
      return null;
    }
  },
);

// ── Generic file save/open (Fire Command WAV export + project files) ──

ipcMain.handle(
  "file:save",
  async (
    _e,
    opts: {
      defaultName: string;
      filters: { name: string; extensions: string[] }[];
      dataBase64: string;
    },
  ) => {
    if (!mainWindow) return null;
    const result = await dialog.showSaveDialog(mainWindow, {
      title: "Save",
      defaultPath: opts.defaultName,
      filters: opts.filters,
    });
    if (result.canceled || !result.filePath) return null;
    try {
      await fs.writeFile(result.filePath, Buffer.from(opts.dataBase64, "base64"));
      return result.filePath;
    } catch (err) {
      console.error("[file:save] write failed:", err);
      return null;
    }
  },
);

ipcMain.handle(
  "file:openText",
  async (_e, filters: { name: string; extensions: string[] }[]) => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Open",
      properties: ["openFile"],
      filters,
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    try {
      const text = await fs.readFile(result.filePaths[0], "utf8");
      return { path: result.filePaths[0], text };
    } catch (err) {
      console.error("[file:openText] read failed:", err);
      return null;
    }
  },
);

// ──────────────── Music library (folder scan) ────────────────
interface LibFileEntry {
  path: string;
  name: string;
  ext: string;
  size: number;
  mtimeMs: number;
}

const LIBRARY_EXTS = new Set(Object.keys(AUDIO_MIME));

async function walkAudioDir(dir: string, out: LibFileEntry[], cap: number): Promise<void> {
  if (out.length >= cap) return;
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    console.warn(`[library] cannot read ${dir}:`, err);
    return;
  }
  for (const ent of entries) {
    if (out.length >= cap) return;
    // Skip hidden/system folders to keep scans quick and avoid junk.
    if (ent.name.startsWith(".")) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      await walkAudioDir(full, out, cap);
    } else if (ent.isFile()) {
      const ext = path.extname(ent.name).toLowerCase();
      if (!LIBRARY_EXTS.has(ext)) continue;
      try {
        const st = await fs.stat(full);
        out.push({ path: full, name: ent.name, ext, size: st.size, mtimeMs: st.mtimeMs });
      } catch { /* unreadable file — skip */ }
    }
  }
}

ipcMain.handle("dialog:openFolder", async (): Promise<string[]> => {
  if (!mainWindow) return [];
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Add music folders to your library",
    properties: ["openDirectory", "multiSelections"],
  });
  if (result.canceled) return [];
  return result.filePaths;
});

ipcMain.handle("library:scan", async (_e, folders: string[]): Promise<LibFileEntry[]> => {
  const cap = 50000;
  const out: LibFileEntry[] = [];
  for (const f of folders ?? []) {
    if (typeof f !== "string") continue;
    await walkAudioDir(f, out, cap);
    if (out.length >= cap) break;
  }
  console.log(`[library] scanned ${folders?.length ?? 0} folder(s) → ${out.length} tracks`);
  return out;
});

/** Managed folder for Fire Command → Library exports. */
ipcMain.handle("library:getExportDir", async (): Promise<string> => {
  const dir = path.join(app.getPath("music"), "Kill-Chain", "Fire Exports");
  await fs.mkdir(dir, { recursive: true });
  return dir;
});

/** Stat one audio file for library ingest after export. */
ipcMain.handle("library:statFile", async (_e, filePath: string): Promise<LibFileEntry | null> => {
  try {
    if (typeof filePath !== "string" || !filePath) return null;
    const st = await fs.stat(filePath);
    if (!st.isFile()) return null;
    const ext = path.extname(filePath).toLowerCase();
    if (!LIBRARY_EXTS.has(ext)) return null;
    return {
      path: filePath,
      name: path.basename(filePath),
      ext,
      size: st.size,
      mtimeMs: st.mtimeMs,
    };
  } catch {
    return null;
  }
});

/** Image picker for album artwork (Fire → Library export). */
ipcMain.handle(
  "dialog:openImage",
  async (): Promise<{ path: string; base64: string; mime: string } | null> => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Choose album artwork",
      properties: ["openFile"],
      filters: [
        { name: "Images", extensions: ["jpg", "jpeg", "png", "webp"] },
      ],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const filePath = result.filePaths[0];
    try {
      const buf = await fs.readFile(filePath);
      // Soft cap ~8 MB — keeps ID3 APIC frames reasonable.
      if (buf.byteLength > 8 * 1024 * 1024) {
        console.warn("[dialog:openImage] image too large:", buf.byteLength);
        return null;
      }
      const ext = path.extname(filePath).toLowerCase();
      const mime =
        ext === ".png" ? "image/png"
        : ext === ".webp" ? "image/webp"
        : "image/jpeg";
      return { path: filePath, base64: buf.toString("base64"), mime };
    } catch (err) {
      console.error("[dialog:openImage] read failed:", err);
      return null;
    }
  },
);

ipcMain.handle("shell:open", async (_e, url: string) => {
  if (!url) return;
  // Allow http(s) URLs and known Windows settings deep-links (ms-settings:*),
  // plus file:// for local docs. Anything else is rejected to avoid being
  // turned into a code-execution vector by a malicious renderer.
  const safe =
    /^https?:\/\//i.test(url) ||
    /^ms-settings:/i.test(url) ||
    /^file:\/\//i.test(url);
  if (!safe) {
    console.warn("[shell:open] refused unsafe URL:", url);
    return;
  }
  try {
    await shell.openExternal(url);
  } catch (err) {
    console.warn("[shell:open] failed:", err);
  }
});

ipcMain.handle("window:minimize", () => mainWindow?.minimize());
ipcMain.handle("window:maximize", () => {
  if (!mainWindow) return false;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
  return mainWindow.isMaximized();
});
ipcMain.handle("window:isMaximized", () => mainWindow?.isMaximized() ?? false);
ipcMain.handle("window:close", () => mainWindow?.close());

// ──────────────── Mini-mode / always-on-top ────────────────
let savedBounds: Electron.Rectangle | null = null;

ipcMain.handle("window:alwaysOnTop", (_e, on: boolean) => {
  if (!mainWindow) return;
  mainWindow.setAlwaysOnTop(!!on, "floating");
});
ipcMain.handle("window:miniSize", (_e, mini: boolean) => {
  if (!mainWindow) return;
  if (mini) {
    savedBounds = mainWindow.getBounds();
    mainWindow.setResizable(true);
    mainWindow.setMinimumSize(360, 130);
    mainWindow.setSize(520, 160, true);
    const display = screen.getPrimaryDisplay();
    const wa = display.workArea;
    mainWindow.setPosition(wa.x + wa.width - 540, wa.y + 40, true);
  } else if (savedBounds) {
    mainWindow.setMinimumSize(1120, 720);
    mainWindow.setBounds(savedBounds, true);
    savedBounds = null;
  }
});
ipcMain.handle("window:fullscreen", (_e, full: boolean) => {
  mainWindow?.setFullScreen(!!full);
});

// ──────────────── Visualizer broadcast window (v1.5) ────────────────
// A second frameless window running the same bundle with ?viz=1 — it renders
// analyser frames STREAMED from the main window over IPC (it never touches
// the audio engine). Designed for OBS window capture / second-monitor use.
let vizWindow: BrowserWindow | null = null;

function closeVizWindow(): void {
  if (vizWindow && !vizWindow.isDestroyed()) vizWindow.close();
  vizWindow = null;
}

ipcMain.handle("viz:displays", () => {
  const primaryId = screen.getPrimaryDisplay().id;
  return screen.getAllDisplays().map((d, i) => ({
    id: d.id,
    label: d.label || `Display ${i + 1}`,
    width: d.size.width,
    height: d.size.height,
    primary: d.id === primaryId,
  }));
});

ipcMain.handle(
  "viz:open",
  (
    _e,
    opts: {
      displayId?: number;
      fullscreen?: boolean;
      alwaysOnTop?: boolean;
      transparent?: boolean;
    } | undefined,
  ) => {
    closeVizWindow();
    const target =
      screen.getAllDisplays().find((d) => d.id === opts?.displayId) ??
      screen.getPrimaryDisplay();
    const wa = target.workArea;
    vizWindow = new BrowserWindow({
      x: wa.x + 40,
      y: wa.y + 40,
      width: Math.min(1280, wa.width - 80),
      height: Math.min(720, wa.height - 80),
      frame: false,
      // Transparent windows (OBS overlay trick) can't be resized on Windows
      // once created; acceptable for the capture use-case.
      transparent: !!opts?.transparent,
      backgroundColor: opts?.transparent ? "#00000000" : "#04050a",
      title: "Kill-Chain — Broadcast",
      skipTaskbar: false,
      webPreferences: {
        preload: path.join(__dirname, "preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
      },
      show: false,
    });
    if (opts?.alwaysOnTop) vizWindow.setAlwaysOnTop(true, "screen-saver");
    vizWindow.once("ready-to-show", () => {
      if (!vizWindow) return;
      vizWindow.show();
      if (opts?.fullscreen) {
        // Borderless fullscreen on the CHOSEN display: position first, then
        // go fullscreen so Chromium picks that display.
        vizWindow.setBounds(target.bounds);
        vizWindow.setFullScreen(true);
      }
    });
    vizWindow.on("closed", () => {
      vizWindow = null;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("viz:closed");
      }
    });
    const query: Record<string, string> = { viz: "1" };
    if (opts?.transparent) query.transparent = "1";
    if (isDev) {
      vizWindow.loadURL(
        `http://localhost:5173/?viz=1${opts?.transparent ? "&transparent=1" : ""}`,
      );
    } else {
      vizWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"), {
        query,
      });
    }
    return true;
  },
);

ipcMain.handle("viz:close", () => closeVizWindow());
ipcMain.handle("viz:isOpen", () => vizWindow !== null && !vizWindow.isDestroyed());

// Called FROM the broadcast window itself (F key) — toggles ITS fullscreen.
ipcMain.handle("viz:setFullscreen", (e, full: boolean) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (win && win === vizWindow) win.setFullScreen(!!full);
});

// Hot path: analyser frames from the main renderer → broadcast renderer.
// Fire-and-forget (`send`, not `invoke`) at ~30 fps; typed arrays survive
// the structured-clone serialization intact.
ipcMain.on("viz:frame", (_e, payload) => {
  if (vizWindow && !vizWindow.isDestroyed()) {
    vizWindow.webContents.send("viz:frame", payload);
  }
});

// ──────────────── System resource monitor ────────────────
// System-wide CPU load is computed from os.cpus() time deltas between polls,
// which is reliable across Electron versions (unlike getAppMetrics'
// version-dependent percentCPUUsage scaling). We keep the previous snapshot
// here so each call measures the interval since the last one.
let prevCpuTimes = os.cpus().map((c) => ({ ...c.times }));

function sampleSystemCpuPercent(): number {
  const cur = os.cpus().map((c) => c.times);
  let idleDelta = 0;
  let totalDelta = 0;
  for (let i = 0; i < cur.length; i++) {
    const prev = prevCpuTimes[i] ?? cur[i];
    const idle = cur[i].idle - prev.idle;
    const total =
      cur[i].user - prev.user +
      (cur[i].nice - prev.nice) +
      (cur[i].sys - prev.sys) +
      (cur[i].idle - prev.idle) +
      (cur[i].irq - prev.irq);
    idleDelta += idle;
    totalDelta += total;
  }
  prevCpuTimes = cur;
  if (totalDelta <= 0) return 0;
  return Math.max(0, Math.min(100, (1 - idleDelta / totalDelta) * 100));
}

ipcMain.handle("system:stats", () => {
  const cores = os.cpus().length || 1;
  const sysCpuPercent = sampleSystemCpuPercent();

  // App footprint: sum the working set + best-effort CPU across every helper
  // process (main, renderer, GPU, utility) that Chromium spawns for us.
  let appCpuRaw = 0;
  let appRamKB = 0;
  let procCount = 0;
  try {
    for (const m of app.getAppMetrics()) {
      appCpuRaw += m.cpu?.percentCPUUsage ?? 0;
      appRamKB += m.memory?.workingSetSize ?? 0;
      procCount++;
    }
  } catch { /* metrics unavailable */ }

  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  return {
    cores,
    sysCpuPercent,
    // percentCPUUsage is historically per-core; normalise to a share of the
    // whole machine and clamp so the figure stays intuitive.
    appCpuPercent: Math.max(0, Math.min(100, appCpuRaw / cores)),
    appRamMB: Math.round(appRamKB / 1024),
    sysRamUsedMB: Math.round((totalMem - freeMem) / 1024 / 1024),
    sysRamTotalMB: Math.round(totalMem / 1024 / 1024),
    procCount,
  };
});

ipcMain.handle("system:gpuInfo", () => {
  try {
    const status = app.getGPUFeatureStatus();
    const compositing = status.gpu_compositing || "unknown";
    return {
      accelerated: compositing.includes("enabled"),
      compositing,
      rasterization: status.rasterization || "unknown",
      webgl: status.webgl || "unknown",
    };
  } catch {
    return { accelerated: false, compositing: "unknown", rasterization: "unknown", webgl: "unknown" };
  }
});

// ──────────────── Windows audio device + Bluetooth ────────────────
function runPowerShell(script: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (process.platform !== "win32") {
      reject(new Error("PowerShell helpers are Windows-only"));
      return;
    }
    execFile(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy", "Bypass",
        "-Command", script,
      ],
      { windowsHide: true, maxBuffer: 4 * 1024 * 1024, timeout: 8000 },
      (err, stdout) => {
        if (err) reject(err);
        else resolve(stdout);
      },
    );
  });
}

ipcMain.handle("audio:getDefaultOutputName", async () => {
  if (process.platform !== "win32") return null;
  try {
    // No native binding required: query the Multimedia Render endpoint
    // through the standard WMI / registry surface.
    const script = `
      $ErrorActionPreference = 'SilentlyContinue'
      $renderRoot = 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\MMDevices\\Audio\\Render'
      Get-ChildItem $renderRoot | ForEach-Object {
        $props = $_.OpenSubKey('Properties')
        if ($null -ne $props) {
          $name = $props.GetValue('{a45c254e-df1c-4efd-8020-67d146a850e0},2')
          $state = (Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue).DeviceState
          if ($state -eq 1) { $name }
        }
      } | Select-Object -First 1
    `;
    const out = (await runPowerShell(script)).trim();
    return out || null;
  } catch (err) {
    console.warn("[audio] default output query failed:", err);
    return null;
  }
});

ipcMain.handle("audio:listVirtualCables", async (): Promise<string[]> => {
  if (process.platform !== "win32") return [];
  try {
    // Scan BOTH render and capture endpoints for known virtual-cable
    // driver friendly names. PnP devices use a friendly name property
    // {a45c254e-df1c-4efd-8020-67d146a850e0},2 — same as default-output.
    const script = `
      $ErrorActionPreference = 'SilentlyContinue'
      $matchers = @(
        'CABLE','VB-Audio','Voicemeeter','VAC ','Virtual Audio Cable',
        'Synchronous Audio Router','VirtualAudio','HiFi Cable'
      )
      $roots = @(
        'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\MMDevices\\Audio\\Render',
        'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\MMDevices\\Audio\\Capture'
      )
      $names = New-Object System.Collections.Generic.HashSet[string]
      foreach ($r in $roots) {
        Get-ChildItem $r -ErrorAction SilentlyContinue | ForEach-Object {
          $props = $_.OpenSubKey('Properties')
          if ($null -ne $props) {
            $n = $props.GetValue('{a45c254e-df1c-4efd-8020-67d146a850e0},2')
            if ($n) {
              foreach ($m in $matchers) {
                if ($n -like "*$m*") { [void]$names.Add($n); break }
              }
            }
          }
        }
      }
      $names -join [Environment]::NewLine
    `;
    const out = (await runPowerShell(script)).trim();
    if (!out) return [];
    return out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  } catch (err) {
    console.warn("[audio] virtual-cable scan failed:", err);
    return [];
  }
});

ipcMain.handle("bluetooth:list", async () => {
  if (process.platform !== "win32") return [];
  try {
    // Best-effort: pnp class "Bluetooth" devices + AudioEndpoint friendly
    // names. Battery is exposed for some BT LE devices via the Battery
    // class. We expose what we can find; users get an honest empty list
    // when nothing matches.
    const script = `
      $ErrorActionPreference = 'SilentlyContinue'
      $bt = Get-PnpDevice -Class Bluetooth -Status OK
      $audio = Get-PnpDevice -Class AudioEndpoint -Status OK |
        Where-Object { $_.FriendlyName -match 'Hands.Free|Headphones|Headset|Earbuds' }
      $items = @()
      foreach ($d in $bt) {
        $name = $d.FriendlyName
        $battery = $null
        # Try to pull battery percentage from device properties (BT LE).
        $prop = Get-PnpDeviceProperty -InstanceId $d.InstanceId -KeyName 'DEVPKEY_Device_BatteryLife'
        if ($prop -and $prop.Data) { $battery = [int]$prop.Data }
        $items += [pscustomobject]@{
          name = $name
          connected = $true
          battery = $battery
          codec = $null
        }
      }
      foreach ($a in $audio) {
        $items += [pscustomobject]@{
          name = $a.FriendlyName
          connected = $true
          battery = $null
          codec = $null
        }
      }
      $items | ConvertTo-Json -Compress -Depth 3
    `;
    const out = (await runPowerShell(script)).trim();
    if (!out) return [];
    const parsed = JSON.parse(out);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch (err) {
    console.warn("[bluetooth] list failed:", err);
    return [];
  }
});

// ──────────────── Mobile-friendly Remote HTTP/WebSocket ────────────────
let remoteServer: http.Server | null = null;
let remotePort = 0;

function remoteState() {
  if (!remoteServer) return { running: false, port: 0, url: "" };
  const ip = pickLocalIp();
  return { running: true, port: remotePort, url: `http://${ip}:${remotePort}` };
}

function pickLocalIp(): string {
  const nets = os.networkInterfaces();
  for (const list of Object.values(nets)) {
    if (!list) continue;
    for (const n of list) {
      if (n.family === "IPv4" && !n.internal) return n.address;
    }
  }
  return "127.0.0.1";
}

ipcMain.handle("remote:start", async (_e, port: number) => {
  if (remoteServer) return remoteState();
  remotePort = port;
  remoteServer = http.createServer((req, res) => {
    if (req.url === "/" || req.url === "/index.html") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(REMOTE_HTML);
      return;
    }
    if (req.url?.startsWith("/cmd/")) {
      const cmd = req.url.slice(5);
      mainWindow?.webContents.send("remote:cmd", cmd);
      res.writeHead(204);
      res.end();
      return;
    }
    res.writeHead(404);
    res.end("not found");
  });
  await new Promise<void>((resolve, reject) => {
    if (!remoteServer) return reject();
    remoteServer.once("error", (err) => {
      console.error("[remote] failed to bind:", err);
      remoteServer = null;
      reject(err);
    });
    remoteServer.listen(port, () => resolve());
  });
  console.log(`[remote] listening on http://${pickLocalIp()}:${port}`);
  return remoteState();
});

ipcMain.handle("remote:stop", async () => {
  if (!remoteServer) return;
  await new Promise<void>((resolve) => remoteServer!.close(() => resolve()));
  remoteServer = null;
  remotePort = 0;
  console.log("[remote] stopped");
});

ipcMain.handle("remote:status", () => remoteState());

const REMOTE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no">
<title>Kill-Chain Remote</title>
<style>
  *,*::before,*::after{box-sizing:border-box}
  html,body{margin:0;height:100%;background:#06060c;color:#e7e9ff;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;-webkit-tap-highlight-color:transparent}
  body{display:flex;flex-direction:column;padding:18px;gap:14px}
  h1{font-size:14px;letter-spacing:.3em;text-transform:uppercase;color:#9aa0c7;margin:0;text-align:center}
  .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;flex:1}
  button{appearance:none;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.10);border-radius:14px;color:#fff;font-size:15px;font-weight:600;padding:18px 6px;cursor:pointer;transition:transform .1s ease,background .2s ease}
  button:active{transform:scale(.96);background:rgba(34,232,255,.15);border-color:rgba(34,232,255,.6)}
  .accent{background:rgba(34,232,255,.10);border-color:rgba(34,232,255,.45);color:#22e8ff}
  .row{display:flex;gap:8px}
  .row button{flex:1}
  footer{font-size:11px;color:#666;text-align:center;letter-spacing:.2em;text-transform:uppercase}
</style>
</head>
<body>
<h1>Kill-Chain Remote</h1>
<div class="row">
  <button class="accent" data-c="prev">&#9198; Prev</button>
  <button class="accent" data-c="play-pause">Play / Pause</button>
  <button class="accent" data-c="next">&#9197; Next</button>
</div>
<div class="grid">
  <button data-c="warmer">Warmer</button>
  <button data-c="cleaner">Cleaner</button>
  <button data-c="punchier">Punchier</button>
  <button data-c="wider">Wider</button>
  <button data-c="bigger">Bigger</button>
  <button data-c="tighter">Tighter</button>
  <button data-c="snapshot-a">Snap A</button>
  <button data-c="swap-ab">Swap A&#8596;B</button>
  <button data-c="reset">Reset</button>
  <button data-c="viz-next">Next scene</button>
  <button data-c="correction-toggle">Correction</button>
  <button data-c="bypass-toggle">Bypass</button>
</div>
<footer>connected to Kill-Chain</footer>
<script>
  document.querySelectorAll('button[data-c]').forEach(b=>{
    b.addEventListener('click',()=>{
      fetch('/cmd/' + b.dataset.c, { method: 'POST' }).catch(()=>{});
      if (window.navigator.vibrate) navigator.vibrate(8);
    });
  });
</script>
</body>
</html>`;

// ──────────────── System-audio loopback (getDisplayMedia) ────────────────
//
// Electron 32+ refuses navigator.mediaDevices.getDisplayMedia() unless the
// session has a displayMedia request handler. We register one that auto-picks
// the primary screen *with audio* — this is exactly what we want for system
// loopback. No picker dialog is shown to the user.
//
// Audio mode (set by the renderer via "loopback:setMode" BEFORE it calls
// getDisplayMedia):
//
//   "loopback"          The user keeps hearing raw Windows audio alongside
//                       the processed feed. Feedback risk on single-device
//                       setups → renderer engages FeedbackKiller + gain trim.
//
//   "loopbackWithMute"  Chromium mutes the DEFAULT render endpoint's master
//                       volume (IAudioEndpointVolume) while the WASAPI
//                       loopback tap — which sits BEFORE the endpoint mute —
//                       keeps capturing everything. The user hears ONLY the
//                       processed feed. IMPORTANT: the mute silences every
//                       app on that endpoint INCLUDING Kill-Chain itself, so
//                       the renderer only picks this mode when its output
//                       sink is routed to a DIFFERENT device than the
//                       Windows default. (Chromium unmutes automatically
//                       when the capture stream stops.)
//
//   "airspace"          Per-frame tab capture of the Airspace <webview>.
//                       The handler answers with the guest's WebFrameMain as
//                       the audio source; Chromium diverts ONLY that frame's
//                       audio into the capture stream and (with
//                       enableLocalEcho: false) mutes its local playback for
//                       the duration — the user hears exclusively the
//                       processed feed, no system-wide capture, no feedback
//                       risk, works on a single output device. Local
//                       playback is restored automatically when the stream
//                       stops. Requires an attached webview; falls back to
//                       "loopback" when none exists.
let loopbackAudioMode: "loopback" | "loopbackWithMute" | "airspace" = "loopback";

/** The Airspace <webview> guest — tracked via did-attach-webview. */
let airspaceWebContents: Electron.WebContents | null = null;

ipcMain.handle("loopback:setMode", (_e, mode: string) => {
  if (mode === "airspace") {
    if (airspaceWebContents && !airspaceWebContents.isDestroyed()) {
      loopbackAudioMode = "airspace";
    } else {
      console.warn(
        "[loopback] airspace capture requested but no webview is attached; falling back to system loopback",
      );
      loopbackAudioMode = "loopback";
    }
  } else {
    loopbackAudioMode = mode === "loopbackWithMute" ? "loopbackWithMute" : "loopback";
  }
  console.log(`[loopback] audio mode set to "${loopbackAudioMode}"`);
  return loopbackAudioMode;
});

/**
 * Web MIDI in Electron never shows Chromium's permission prompt — without
 * these handlers, requestMIDIAccess resolves with an empty input list.
 * Kill-Chain is a local desktop app: grant MIDI (and keep other permissions
 * working for system-audio capture / clipboard).
 */
function installMidiPermissions(): void {
  const s = session.defaultSession;
  const allow = (permission: string) =>
    permission === "midi" ||
    permission === "midiSysex" ||
    permission === "media" ||
    permission === "display-capture" ||
    permission === "fullscreen" ||
    permission === "clipboard-read" ||
    permission === "clipboard-sanitized-write";

  s.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(allow(String(permission)));
  });
  s.setPermissionCheckHandler((_wc, permission) => allow(String(permission)));
  // Chromium also gates per-device MIDI after the coarse permission — without
  // this, inputs can stay empty even when WinMM sees the controller.
  if (typeof s.setDevicePermissionHandler === "function") {
    s.setDevicePermissionHandler((details) => {
      const t = String((details as { deviceType?: string }).deviceType ?? "");
      return t === "midi" || t === "midiSysex" || t === "hid" || t === "serial" || t === "usb";
    });
  }
}

function installDisplayMediaHandler(): void {
  const s = session.defaultSession;
  s.setDisplayMediaRequestHandler(
    async (_request, callback) => {
      try {
        // Airspace mode: capture ONLY the webview frame's audio (and its
        // video, which the renderer discards). enableLocalEcho: false makes
        // Chromium mute the frame's local playback while captured, so the
        // user hears exclusively Kill-Chain's processed output.
        if (loopbackAudioMode === "airspace") {
          if (airspaceWebContents && !airspaceWebContents.isDestroyed()) {
            const frame = airspaceWebContents.mainFrame;
            callback({ video: frame, audio: frame, enableLocalEcho: false });
            return;
          }
          console.warn("[loopback] airspace webview gone at request time; using system loopback");
        }
        const sources = await desktopCapturer.getSources({
          types: ["screen"],
        });
        const primary = sources[0];
        if (!primary) {
          console.warn("[loopback] no screen sources available");
          callback({}); // user-facing reject
          return;
        }
        callback({
          video: primary,
          audio: loopbackAudioMode === "airspace" ? "loopback" : loopbackAudioMode,
        });
      } catch (err) {
        console.error("[loopback] handler failed:", err);
        callback({});
      }
    },
    { useSystemPicker: false },
  );
}

ipcMain.handle("loopback:listSources", async () => {
  try {
    const sources = await desktopCapturer.getSources({
      types: ["screen", "window"],
      thumbnailSize: { width: 64, height: 36 },
    });
    return sources.map((s) => ({
      id: s.id,
      name: s.name,
      kind: s.id.startsWith("screen:") ? "screen" : "window",
    }));
  } catch (err) {
    console.warn("[loopback] listSources failed:", err);
    return [];
  }
});

// ──────────────── Airspace AdBlock ────────────────
// Network-layer request blocking on the Airspace <webview> session. A curated
// hostname blocklist (ad exchanges, trackers, analytics) plus a couple of
// path heuristics covers display ads and tracking on the sites Airspace is
// meant for. In-player video ads served from a site's own media CDN (e.g.
// YouTube's) can't be reliably separated from content at this layer.
const ADBLOCK_HOSTS = [
  "doubleclick.net", "googlesyndication.com", "googleadservices.com",
  "googletagmanager.com", "googletagservices.com", "google-analytics.com",
  "adservice.google.com", "pagead2.googlesyndication.com",
  "adnxs.com", "adsrvr.org", "adform.net", "criteo.com", "criteo.net",
  "taboola.com", "outbrain.com", "revcontent.com", "mgid.com",
  "scorecardresearch.com", "quantserve.com", "chartbeat.com",
  "moatads.com", "adsafeprotected.com", "doubleverify.com",
  "amazon-adsystem.com", "media.net", "pubmatic.com", "rubiconproject.com",
  "openx.net", "casalemedia.com", "33across.com", "yieldmo.com",
  "smartadserver.com", "teads.tv", "sharethrough.com", "spotxchange.com",
  "hotjar.com", "mouseflow.com", "fullstory.com", "mixpanel.com",
  "branch.io", "braze.com", "amplitude.com", "segment.io", "segment.com",
  "bugsnag.com", "sentry-cdn.com",
  "facebook.net", "connect.facebook.net",
  "ads.twitter.com", "static.ads-twitter.com", "analytics.tiktok.com",
  "yandex.ru/ads", "adroll.com", "bidswitch.net", "rlcdn.com",
  "krxd.net", "exelator.com", "bluekai.com", "demdex.net", "everesttech.net",
  "zemanta.com", "gumgum.com", "undertone.com", "sonobi.com", "indexww.com",
];

const ADBLOCK_PATH_RE = /\/(pagead|adsbygoogle|ad_status|prebid|apstag)\b|[/.]ads?[/.-]|\/adserver\//i;

let adblockEnabled = true;
let adblockBlocked = 0;
let adblockInstalled = false;

function urlIsAd(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl);
    const host = u.hostname.toLowerCase();
    for (const h of ADBLOCK_HOSTS) {
      if (host === h || host.endsWith(`.${h}`)) return true;
    }
    // Path heuristics only on third-party-looking asset requests; keep them
    // conservative so site functionality doesn't break.
    if (ADBLOCK_PATH_RE.test(u.pathname) && /\b(ad|ads|adserv|sync|pixel)\b/i.test(u.pathname)) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

function installAirspaceAdblock(): void {
  if (adblockInstalled) return;
  adblockInstalled = true;
  const ses = session.fromPartition("persist:airspace");
  ses.webRequest.onBeforeRequest({ urls: ["http://*/*", "https://*/*"] }, (details, callback) => {
    if (adblockEnabled && urlIsAd(details.url)) {
      adblockBlocked++;
      callback({ cancel: true });
      return;
    }
    callback({});
  });
  console.log("[adblock] Airspace request filter installed");
}

ipcMain.handle("airspace:setAdblock", (_e, on: boolean) => {
  adblockEnabled = !!on;
  installAirspaceAdblock();
  console.log(`[adblock] ${adblockEnabled ? "enabled" : "disabled"} (blocked so far: ${adblockBlocked})`);
  return { enabled: adblockEnabled, blocked: adblockBlocked };
});

ipcMain.handle("airspace:adblockStatus", () => ({
  enabled: adblockEnabled,
  blocked: adblockBlocked,
}));

// ──────────────── Head tracker (opentrack UDP) ────────────────
// Listens for the de-facto standard opentrack "UDP over network" packets:
// six little-endian float64s — X, Y, Z (cm), yaw, pitch, roll (degrees).
// Tobii (via opentrack), AITrack/webcam trackers, phone IMU apps and the
// Headphone / speaker IMU bridges all speak it. Data is throttled to ~30 Hz and
// pushed to the renderer, which steers the 3rd Dimension listener.
let headtrackSocket: dgram.Socket | null = null;
let headtrackPort = 0;
let headtrackLastSend = 0;
let headtrackPackets = 0;

function stopHeadtrack(): void {
  if (headtrackSocket) {
    try { headtrackSocket.close(); } catch { /* already closed */ }
    headtrackSocket = null;
  }
  headtrackPort = 0;
  headtrackPackets = 0;
}

ipcMain.handle("headtrack:start", async (_e, port: number) => {
  const p = Math.max(1, Math.min(65535, Math.round(Number(port) || 4242)));
  if (headtrackSocket && headtrackPort === p) {
    return { running: true, port: p };
  }
  stopHeadtrack();
  return await new Promise<{ running: boolean; port: number; error?: string }>((resolve) => {
    const sock = dgram.createSocket("udp4");
    sock.on("error", (err) => {
      console.warn("[headtrack] socket error:", err.message);
      stopHeadtrack();
      resolve({ running: false, port: p, error: err.message });
    });
    sock.on("message", (msg) => {
      // opentrack UDP: 6 × float64 LE = 48 bytes. Tolerate longer packets.
      if (msg.length < 48) return;
      headtrackPackets++;
      const now = Date.now();
      if (now - headtrackLastSend < 33) return; // ~30 Hz to the renderer
      headtrackLastSend = now;
      try {
        const data = {
          x: msg.readDoubleLE(0),
          y: msg.readDoubleLE(8),
          z: msg.readDoubleLE(16),
          yaw: msg.readDoubleLE(24),
          pitch: msg.readDoubleLE(32),
          roll: msg.readDoubleLE(40),
        };
        if (!Number.isFinite(data.yaw)) return;
        mainWindow?.webContents.send("headtrack:data", data);
      } catch { /* malformed packet */ }
    });
    sock.bind(p, () => {
      headtrackSocket = sock;
      headtrackPort = p;
      console.log(`[headtrack] listening for opentrack UDP on port ${p}`);
      resolve({ running: true, port: p });
    });
  });
});

ipcMain.handle("headtrack:stop", () => {
  stopHeadtrack();
  console.log("[headtrack] stopped");
});

ipcMain.handle("headtrack:status", () => ({
  running: headtrackSocket !== null,
  port: headtrackPort,
  packets: headtrackPackets,
}));

// ── Single-instance lock (v2.4) ────────────────────────────────────────────
// A second launch focuses the existing window instead of spawning a rival
// process (two AudioContexts fighting over the same output device, doubled
// remote servers, doubled headtrack sockets…).
const gotInstanceLock = app.requestSingleInstanceLock();
if (!gotInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    registerAudioProtocol();
    installMidiPermissions();
    installNativeMidiHost();
    installDisplayMediaHandler();
    installAirspaceAdblock();
    createMainWindow();
  });
}

app.on("before-quit", () => {
  shutdownNativeMidiHost();
  if (remoteServer) {
    try { remoteServer.close(); } catch { /* ignore */ }
    remoteServer = null;
  }
  stopHeadtrack();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
});
