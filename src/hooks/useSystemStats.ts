import { useEffect, useRef, useState } from "react";
import { peekEngine } from "@/audio/AudioEngine";

export interface MonitorData {
  electron: boolean;
  /** System-wide CPU load 0..100 (null in a plain browser). */
  sysCpuPercent: number | null;
  /** This app's share of total CPU 0..100. */
  appCpuPercent: number | null;
  /** Resident memory of all app processes, MB. */
  appRamMB: number | null;
  sysRamUsedMB: number | null;
  sysRamTotalMB: number | null;
  cores: number | null;
  procCount: number | null;
  // ── audio engine ──
  voices: number;
  sampleRate: number | null;
  audioState: string;
  // ── gpu (resolved once) ──
  gpu: { accelerated: boolean; renderer: string } | null;
}

const EMPTY: MonitorData = {
  electron: false,
  sysCpuPercent: null,
  appCpuPercent: null,
  appRamMB: null,
  sysRamUsedMB: null,
  sysRamTotalMB: null,
  cores: null,
  procCount: null,
  voices: 0,
  sampleRate: null,
  audioState: "idle",
  gpu: null,
};

/** Read the GPU renderer string once via a throwaway WebGL context. */
function readGpuRenderer(): string {
  try {
    const c = document.createElement("canvas");
    const gl = (c.getContext("webgl") || c.getContext("experimental-webgl")) as WebGLRenderingContext | null;
    if (!gl) return "Software";
    const dbg = gl.getExtension("WEBGL_debug_renderer_info");
    const raw = dbg
      ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)
      : gl.getParameter(gl.RENDERER);
    const lose = gl.getExtension("WEBGL_lose_context");
    lose?.loseContext();
    return cleanRendererName(String(raw || "GPU"));
  } catch {
    return "—";
  }
}

/** Trim the verbose "ANGLE (Vendor, Device Direct3D11 ...)" wrapper to the
 *  human-readable device name. */
function cleanRendererName(s: string): string {
  const angle = /^ANGLE \((?:[^,]+,\s*)?([^,]+?)(?:\s*\([^)]*\))?(?:,[^)]*)?\)$/.exec(s);
  if (angle?.[1]) return angle[1].replace(/\s+Direct3D.*$/i, "").trim();
  return s;
}

/**
 * Poll CPU / RAM / GPU / audio stats for the title-bar resource monitor.
 * Degrades gracefully in a plain browser: no per-process CPU, but JS-heap
 * memory (Chrome's `performance.memory`) and live audio stats still show.
 */
export function useSystemStats(intervalMs = 1000): MonitorData {
  const [data, setData] = useState<MonitorData>(EMPTY);
  const gpuRef = useRef<MonitorData["gpu"]>(null);

  useEffect(() => {
    let alive = true;
    const sys = typeof window !== "undefined" ? window.playground?.system : undefined;
    const electron = !!sys;

    // Resolve GPU info once (renderer name in-renderer, accel flag from main).
    (async () => {
      const renderer = readGpuRenderer();
      let accelerated = renderer !== "Software" && renderer !== "—";
      try {
        const info = await sys?.getGpuInfo();
        if (info) accelerated = info.accelerated;
      } catch { /* keep heuristic */ }
      gpuRef.current = { accelerated, renderer };
    })();

    const sampleAudio = () => {
      const e = peekEngine();
      if (!e) return { voices: 0, sampleRate: null as number | null, audioState: "idle" };
      let voices = 0;
      try {
        voices = e.fireCommand.getActiveVoiceCount();
        voices += e.peekFireCommandB()?.getActiveVoiceCount() ?? 0;
      } catch { /* ignore */ }
      return { voices, sampleRate: e.ctx.sampleRate, audioState: e.ctx.state as string };
    };

    const tick = async () => {
      if (document.hidden) return; // don't burn cycles when the window is hidden
      const audio = sampleAudio();

      if (electron && sys) {
        try {
          const s = await sys.getStats();
          if (!alive) return;
          setData({
            electron: true,
            sysCpuPercent: s.sysCpuPercent,
            appCpuPercent: s.appCpuPercent,
            appRamMB: s.appRamMB,
            sysRamUsedMB: s.sysRamUsedMB,
            sysRamTotalMB: s.sysRamTotalMB,
            cores: s.cores,
            procCount: s.procCount,
            gpu: gpuRef.current,
            ...audio,
          });
          return;
        } catch { /* fall through to browser path */ }
      }

      // Browser fallback — JS heap only.
      const mem = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
      if (!alive) return;
      setData({
        ...EMPTY,
        electron: false,
        appRamMB: mem ? Math.round(mem.usedJSHeapSize / 1024 / 1024) : null,
        cores: typeof navigator !== "undefined" ? navigator.hardwareConcurrency ?? null : null,
        gpu: gpuRef.current,
        ...audio,
      });
    };

    void tick();
    const id = window.setInterval(tick, intervalMs);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [intervalMs]);

  return data;
}
