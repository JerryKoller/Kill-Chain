import { contextBridge, ipcRenderer } from "electron";

const bridge = {
  openAudioFile: (): Promise<string | null> =>
    ipcRenderer.invoke("dialog:openAudio"),
  files: {
    /** Save binary/text data (base64) via the OS save dialog. Returns path. */
    save: (
      defaultName: string,
      filters: { name: string; extensions: string[] }[],
      dataBase64: string,
    ): Promise<string | null> =>
      ipcRenderer.invoke("file:save", { defaultName, filters, dataBase64 }),
    /** Open a text file via the OS dialog. Returns { path, text } or null. */
    openText: (
      filters: { name: string; extensions: string[] }[],
    ): Promise<{ path: string; text: string } | null> =>
      ipcRenderer.invoke("file:openText", filters),
    /** Multi-select audio picker (batch restore). Returns file paths. */
    openAudioMulti: (): Promise<string[]> =>
      ipcRenderer.invoke("dialog:openAudioMulti"),
    /** Single output-folder picker. Returns the folder path or null. */
    pickOutputFolder: (): Promise<string | null> =>
      ipcRenderer.invoke("dialog:pickOutputFolder"),
    /** Dialog-free write into an already-picked folder. Returns full path. */
    writeIn: (dir: string, name: string, dataBase64: string): Promise<string | null> =>
      ipcRenderer.invoke("file:writeIn", { dir, name, dataBase64 }),
  },
  shellOpen: (url: string): Promise<void> =>
    ipcRenderer.invoke("shell:open", url),
  crash: {
    /** Append a renderer error to the local crash log (opt-in gated). */
    log: (source: string, message: string): void =>
      ipcRenderer.send("crash:renderer", { source, message }),
    /** Reveal crash.log in the OS file explorer. */
    openLog: (): Promise<void> => ipcRenderer.invoke("crash:openLog"),
  },
  window: {
    minimize: () => ipcRenderer.invoke("window:minimize"),
    maximize: () => ipcRenderer.invoke("window:maximize") as Promise<boolean>,
    isMaximized: () => ipcRenderer.invoke("window:isMaximized") as Promise<boolean>,
    close: () => ipcRenderer.invoke("window:close"),
    setAlwaysOnTop: (on: boolean) => ipcRenderer.invoke("window:alwaysOnTop", on),
    setMiniSize: (mini: boolean) => ipcRenderer.invoke("window:miniSize", mini),
    setFullscreen: (full: boolean) => ipcRenderer.invoke("window:fullscreen", full),
  },
  platform: process.platform,
  versions: process.versions,

  library: {
    /** Open the OS folder picker (multi-select). Returns chosen folder paths. */
    pickFolders: (): Promise<string[]> => ipcRenderer.invoke("dialog:openFolder"),
    /** Recursively scan folders for audio files. Returns flat file entries. */
    scan: (
      folders: string[],
    ): Promise<
      { path: string; name: string; ext: string; size: number; mtimeMs: number }[]
    > => ipcRenderer.invoke("library:scan", folders),
  },

  airspace: {
    /** Enable/disable ad+tracker blocking on the Airspace browser session. */
    setAdblock: (on: boolean): Promise<{ enabled: boolean; blocked: number }> =>
      ipcRenderer.invoke("airspace:setAdblock", on),
    /** Current AdBlock state + how many requests were blocked this session. */
    getAdblockStatus: (): Promise<{ enabled: boolean; blocked: number }> =>
      ipcRenderer.invoke("airspace:adblockStatus"),
  },

  headtrack: {
    /**
     * Start listening for opentrack-protocol UDP head-tracking packets
     * (6 × float64 LE: x, y, z, yaw, pitch, roll) on the given port.
     */
    start: (port: number): Promise<{ running: boolean; port: number; error?: string }> =>
      ipcRenderer.invoke("headtrack:start", port),
    stop: (): Promise<void> => ipcRenderer.invoke("headtrack:stop"),
    status: (): Promise<{ running: boolean; port: number; packets: number }> =>
      ipcRenderer.invoke("headtrack:status"),
    /** Subscribe to throttled (~30 Hz) tracker data. Returns unsubscribe. */
    onData: (
      cb: (d: { x: number; y: number; z: number; yaw: number; pitch: number; roll: number }) => void,
    ) => {
      const handler = (
        _e: unknown,
        d: { x: number; y: number; z: number; yaw: number; pitch: number; roll: number },
      ) => cb(d);
      ipcRenderer.on("headtrack:data", handler);
      return () => ipcRenderer.removeListener("headtrack:data", handler);
    },
  },

  loopback: {
    /**
     * Choose how the display-media handler captures system audio.
     * "loopback"         → capture only; the user keeps hearing raw Windows
     *                      audio (feedback risk on a single device).
     * "loopbackWithMute" → capture AND mute the default output endpoint, so
     *                      the user hears only the app's processed feed.
     *                      Only safe when the app outputs to a different
     *                      device than the Windows default.
     * "airspace"         → capture ONLY the Airspace webview's audio (tab
     *                      capture); its local playback is muted while
     *                      captured, so the user hears only the processed
     *                      feed. Falls back to "loopback" (reflected in the
     *                      returned mode) when no webview is attached.
     * Must be called BEFORE navigator.mediaDevices.getDisplayMedia().
     * Returns the mode the main process actually accepted.
     */
    setMode: (mode: "loopback" | "loopbackWithMute" | "airspace"): Promise<string> =>
      ipcRenderer.invoke("loopback:setMode", mode),
  },

  audioDevices: {
    getDefaultOutputName: (): Promise<string | null> =>
      ipcRenderer.invoke("audio:getDefaultOutputName"),
    /**
     * Returns a list of virtual-cable drivers detected on the system
     * (VB-Cable, Voicemeeter, VAC, etc.) by scanning Windows audio
     * endpoints via PowerShell. Used by the Routing panel to decide
     * whether to show the install walkthrough.
     */
    listVirtualCables: (): Promise<string[]> =>
      ipcRenderer.invoke("audio:listVirtualCables"),
  },

  bluetooth: {
    listDevices: () => ipcRenderer.invoke("bluetooth:list"),
  },

  remote: {
    start: (port: number) => ipcRenderer.invoke("remote:start", port),
    stop: () => ipcRenderer.invoke("remote:stop"),
    getStatus: () => ipcRenderer.invoke("remote:status"),
    onCommand: (cb: (cmd: string) => void) => {
      const handler = (_e: unknown, cmd: string) => cb(cmd);
      ipcRenderer.on("remote:cmd", handler);
      return () => ipcRenderer.removeListener("remote:cmd", handler);
    },
  },

  viz: {
    /** List displays for the broadcast window's "open on" picker. */
    displays: (): Promise<
      { id: number; label: string; width: number; height: number; primary: boolean }[]
    > => ipcRenderer.invoke("viz:displays"),
    /** Open (or re-open) the broadcast window with the given options. */
    open: (opts: {
      displayId?: number;
      fullscreen?: boolean;
      alwaysOnTop?: boolean;
      transparent?: boolean;
    }): Promise<boolean> => ipcRenderer.invoke("viz:open", opts),
    close: (): Promise<void> => ipcRenderer.invoke("viz:close"),
    isOpen: (): Promise<boolean> => ipcRenderer.invoke("viz:isOpen"),
    /** From the broadcast window itself: toggle its OS fullscreen. */
    setFullscreen: (full: boolean): Promise<void> =>
      ipcRenderer.invoke("viz:setFullscreen", full),
    /** Main window → broadcast window analyser frame (fire-and-forget). */
    sendFrame: (frame: unknown): void => ipcRenderer.send("viz:frame", frame),
    /** Broadcast window: subscribe to streamed frames. Returns unsubscribe. */
    onFrame: (cb: (frame: unknown) => void) => {
      const handler = (_e: unknown, f: unknown) => cb(f);
      ipcRenderer.on("viz:frame", handler);
      return () => ipcRenderer.removeListener("viz:frame", handler);
    },
    /** Main window: notified when the broadcast window closes. */
    onClosed: (cb: () => void) => {
      const handler = () => cb();
      ipcRenderer.on("viz:closed", handler);
      return () => ipcRenderer.removeListener("viz:closed", handler);
    },
  },

  system: {
    /** Live CPU / RAM snapshot for the resource monitor. */
    getStats: (): Promise<{
      cores: number;
      sysCpuPercent: number;
      appCpuPercent: number;
      appRamMB: number;
      sysRamUsedMB: number;
      sysRamTotalMB: number;
      procCount: number;
    }> => ipcRenderer.invoke("system:stats"),
    /** GPU acceleration status (compositing / raster / webgl). */
    getGpuInfo: (): Promise<{
      accelerated: boolean;
      compositing: string;
      rasterization: string;
      webgl: string;
    }> => ipcRenderer.invoke("system:gpuInfo"),
  },

  /**
   * Native WinMM MIDI (main process). Prefer this over Web MIDI on Windows —
   * same stack FL Studio uses; survives Chromium WinRT hangs / empty lists.
   */
  midi: {
    list: (): Promise<{
      ok: boolean;
      inputs: { id: string; name: string; port: number }[];
      started: boolean;
      error: string | null;
    }> => ipcRenderer.invoke("midi:list"),
    start: (): Promise<{
      ok: boolean;
      inputs: { id: string; name: string; port: number }[];
      started: boolean;
      error: string | null;
    }> => ipcRenderer.invoke("midi:start"),
    stop: (): Promise<{ ok: boolean }> => ipcRenderer.invoke("midi:stop"),
    rescan: (): Promise<{
      ok: boolean;
      inputs: { id: string; name: string; port: number }[];
      started: boolean;
      error: string | null;
    }> => ipcRenderer.invoke("midi:rescan"),
    onMessage: (cb: (msg: { id: string; name: string; bytes: number[] }) => void) => {
      const handler = (_e: unknown, msg: { id: string; name: string; bytes: number[] }) => cb(msg);
      ipcRenderer.on("midi:message", handler);
      return () => ipcRenderer.removeListener("midi:message", handler);
    },
  },
};

contextBridge.exposeInMainWorld("playground", bridge);

export type PlaygroundBridge = typeof bridge;
