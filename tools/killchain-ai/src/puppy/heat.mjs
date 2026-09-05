/**
 * Machine heat for the Robo Puppy watch window.
 *
 * RAM comes from os.totalmem / os.freemem.
 * GPU util + temperature come from nvidia-smi when it is actually present.
 * Missing tools or unparseable output yield nulls, never a plausible 0%.
 */
import { spawnSync } from "node:child_process";
import os from "node:os";

const NVIDIA_QUERY = [
  "--query-gpu=name,utilization.gpu,temperature.gpu,memory.used,memory.total",
  "--format=csv,noheader,nounits",
];
const NVIDIA_FALLBACK = "C:\\Windows\\System32\\nvidia-smi.exe";
const CACHE_MS = 2000;

const cache = { at: 0, value: null };

export function resetHeatCache() {
  cache.at = 0;
  cache.value = null;
}

function num(raw) {
  const t = String(raw ?? "").trim();
  if (!t || /^\[?n\/a\]?$/i.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function unknownGpu(from) {
  return {
    name: null,
    utilPct: null,
    tempC: null,
    memUsedMiB: null,
    memTotalMiB: null,
    real: false,
    from,
  };
}

export function parseNvidiaSmi(stdout) {
  const line = String(stdout || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!line) return unknownGpu("nvidia-smi returned no GPUs");
  const parts = line.split(",").map((p) => p.trim());
  if (parts.length < 3) return unknownGpu("nvidia-smi output was unparseable");
  const name = parts[0] || null;
  const utilPct = num(parts[1]);
  const tempC = num(parts[2]);
  const memUsedMiB = parts.length > 3 ? num(parts[3]) : null;
  const memTotalMiB = parts.length > 4 ? num(parts[4]) : null;
  const real = utilPct != null || tempC != null;
  if (!real) {
    return {
      ...unknownGpu("nvidia-smi reported N/A for util and temp"),
      name,
      memUsedMiB,
      memTotalMiB,
    };
  }
  return {
    name,
    utilPct,
    tempC,
    memUsedMiB,
    memTotalMiB,
    real: true,
    from: "nvidia-smi --query-gpu",
  };
}

export function ramHeat(osApi = os) {
  const total = osApi.totalmem();
  const free = osApi.freemem();
  const used = total - free;
  const pct = total > 0 ? Math.round((used / total) * 1000) / 10 : null;
  return {
    usedBytes: used,
    freeBytes: free,
    totalBytes: total,
    pct,
    real: Number.isFinite(total) && total > 0,
    from: "os.totalmem/freemem",
  };
}

export function heatBand(kind, n) {
  if (n == null || !Number.isFinite(n)) return "unknown";
  if (kind === "temp") {
    if (n >= 80) return "hot";
    if (n >= 65) return "warn";
    return "ok";
  }
  if (n >= 80) return "hot";
  if (n >= 55) return "warn";
  return "ok";
}

function runSmi(spawn, bin) {
  return spawn(bin, NVIDIA_QUERY, {
    encoding: "utf8",
    timeout: 2000,
    windowsHide: true,
  });
}

export function gpuHeat({
  now = Date.now(),
  cacheMs = CACHE_MS,
  spawn = spawnSync,
  cacheStore = cache,
} = {}) {
  if (cacheStore.value && now - cacheStore.at < cacheMs) return cacheStore.value;
  let result = runSmi(spawn, "nvidia-smi");
  if (result?.error?.code === "ENOENT" && process.platform === "win32") {
    result = runSmi(spawn, NVIDIA_FALLBACK);
  }
  let gpu;
  if (result?.error?.code === "ENOENT") {
    gpu = unknownGpu("nvidia-smi not found");
  } else if (result?.error) {
    gpu = unknownGpu(`nvidia-smi spawn failed: ${result.error.message || result.error.code}`);
  } else if (result?.status !== 0) {
    const err = String(result?.stderr || result?.stdout || "exit " + result?.status).trim().slice(0, 160);
    gpu = unknownGpu(`nvidia-smi failed: ${err || "non-zero exit"}`);
  } else {
    gpu = parseNvidiaSmi(result.stdout);
  }
  cacheStore.at = now;
  cacheStore.value = gpu;
  return gpu;
}

export function machineHeat(opts = {}) {
  return {
    ram: ramHeat(opts.osApi),
    gpu: gpuHeat(opts),
    at: opts.now || Date.now(),
  };
}
