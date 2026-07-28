/**
 * Native WinMM MIDI host (main process).
 *
 * Chromium Web MIDI on Windows 11 is unreliable (WinRT hang / empty lists /
 * exclusive-port blindness). This path uses the same WinMM stack as FL Studio
 * via @julusian/midi so Fire Command sees class-compliant controllers.
 */
import { BrowserWindow, ipcMain } from "electron";
import { Input } from "@julusian/midi";

export type NativeMidiInputInfo = { id: string; name: string; port: number };

type Opened = {
  port: number;
  name: string;
  id: string;
  input: Input;
};

let opened: Opened[] = [];
let started = false;

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

function listPorts(): NativeMidiInputInfo[] {
  const probe = new Input();
  try {
    const n = probe.getPortCount();
    const out: NativeMidiInputInfo[] = [];
    for (let i = 0; i < n; i++) {
      const name = probe.getPortName(i) || `MIDI Input ${i + 1}`;
      out.push({ id: `native:${i}:${name}`, name, port: i });
    }
    return out;
  } finally {
    try { probe.destroy(); } catch { /* ignore */ }
  }
}

function stopAll(): void {
  for (const o of opened) {
    try { o.input.closePort(); } catch { /* ignore */ }
    try { o.input.destroy(); } catch { /* ignore */ }
  }
  opened = [];
  started = false;
}

function startAll(): { inputs: NativeMidiInputInfo[]; error: string | null } {
  stopAll();
  const ports = listPorts();
  if (ports.length === 0) {
    started = true;
    return {
      inputs: [],
      error: "No MIDI inputs (close FL Studio / other DAWs, then Rescan)",
    };
  }

  const openedInfos: NativeMidiInputInfo[] = [];
  const errors: string[] = [];

  for (const p of ports) {
    const input = new Input();
    try {
      // Ignore clock / active-sensing noise; keep notes + CC.
      input.ignoreTypes(true, true, true);
      input.openPort(p.port);
      input.on("message", (_delta, message) => {
        // @julusian/midi emits number[]; also accept Buffer / TypedArray.
        const bytes = Array.from(message as ArrayLike<number>, (b) => Number(b) & 0xff);
        if (bytes.length < 1) return;
        broadcast("midi:message", { id: p.id, name: p.name, bytes });
      });
      opened.push({ port: p.port, name: p.name, id: p.id, input });
      openedInfos.push(p);
    } catch (err) {
      try { input.destroy(); } catch { /* ignore */ }
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${p.name}: ${msg}`);
    }
  }

  started = true;
  let error: string | null = null;
  if (openedInfos.length === 0) {
    error =
      errors[0]?.includes("busy") || errors[0]?.toLowerCase().includes("use")
        ? "MIDI port in use — quit FL Studio (and other DAWs), then Rescan"
        : errors[0] ?? "Failed to open MIDI ports";
  } else if (errors.length > 0) {
    error = `Opened ${openedInfos.length}; some ports failed (${errors[0]})`;
  }

  return { inputs: openedInfos, error };
}

export function installNativeMidiHost(): void {
  ipcMain.handle("midi:list", () => {
    try {
      return { ok: true as const, inputs: listPorts(), started, error: null as string | null };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false as const, inputs: [] as NativeMidiInputInfo[], started, error: msg };
    }
  });

  ipcMain.handle("midi:start", () => {
    try {
      const r = startAll();
      return { ok: true as const, ...r, started };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false as const, inputs: [] as NativeMidiInputInfo[], started: false, error: msg };
    }
  });

  ipcMain.handle("midi:stop", () => {
    stopAll();
    return { ok: true as const };
  });

  ipcMain.handle("midi:rescan", () => {
    try {
      const r = startAll();
      return { ok: true as const, ...r, started };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false as const, inputs: [] as NativeMidiInputInfo[], started: false, error: msg };
    }
  });
}

export function shutdownNativeMidiHost(): void {
  stopAll();
}
