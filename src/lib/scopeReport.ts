/**
 * Scope "Before / After" report — renders two captured spectrum + stats
 * snapshots into a single shareable PNG (spectrum overlay + numbers table).
 * Capture happens in ScopeView (it owns the hi-res analyser taps); this
 * module is pure rendering + save.
 */

export interface ScopeCapture {
  /** Hi-res float spectrum in dBFS (copy of the analyser buffer). */
  spectrumDb: Float32Array;
  nyquist: number;
  lufsShort: number;
  lufsIntegrated: number;
  peakDb: number;
  rmsDb: number;
  crest: number;
  centroid: number;
  corr: number;
  widthPct: number;
  dynamics: number;
  at: number;
}

const W = 1280;
const H = 880;
const SPEC_X = 70;
const SPEC_Y = 96;
const SPEC_W = W - SPEC_X - 40;
const SPEC_H = 430;
const DB_MIN = -84;
const DB_MAX = 0;
const FREQ_MARKS = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
const DB_MARKS = [0, -12, -24, -36, -48, -60, -72];

const COLOR_A = "#7a3bff"; // before — violet
const COLOR_B = "#22e8ff"; // after — cyan

function fToX(f: number): number {
  const lo = Math.log10(20), hi = Math.log10(20000);
  const frac = (Math.log10(Math.max(20, Math.min(20000, f))) - lo) / (hi - lo);
  return SPEC_X + frac * SPEC_W;
}

function dbToY(db: number): number {
  const frac = (DB_MAX - Math.max(DB_MIN, Math.min(DB_MAX, db))) / (DB_MAX - DB_MIN);
  return SPEC_Y + frac * SPEC_H;
}

function traceSpectrum(
  ctx: CanvasRenderingContext2D,
  cap: ScopeCapture,
  color: string,
  fill: boolean,
): void {
  const n = cap.spectrumDb.length;
  ctx.beginPath();
  let first = true;
  for (let i = 1; i < n; i++) {
    const hz = (i / n) * cap.nyquist;
    if (hz < 20 || hz > 20000) continue;
    const db = cap.spectrumDb[i];
    if (!Number.isFinite(db)) continue;
    const x = fToX(hz);
    const y = dbToY(db);
    if (first) { ctx.moveTo(x, y); first = false; } else ctx.lineTo(x, y);
  }
  if (first) return;
  if (fill) {
    ctx.save();
    ctx.lineTo(SPEC_X + SPEC_W, SPEC_Y + SPEC_H);
    ctx.lineTo(SPEC_X, SPEC_Y + SPEC_H);
    ctx.closePath();
    ctx.fillStyle = `${color}22`;
    ctx.fill();
    ctx.restore();
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.6;
  ctx.shadowColor = color;
  ctx.shadowBlur = 6;
  ctx.stroke();
  ctx.shadowBlur = 0;
}

function fmt(v: number, digits = 1, dash = -119): string {
  return v <= dash ? "—" : v.toFixed(digits);
}

function fmtHz(hz: number): string {
  if (!hz) return "—";
  return hz >= 1000 ? `${(hz / 1000).toFixed(2)} kHz` : `${hz.toFixed(0)} Hz`;
}

/** Render the before/after report and return a base64-encoded PNG. */
export function renderScopeReportPng(before: ScopeCapture, after: ScopeCapture): string {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;

  // Background
  ctx.fillStyle = "#07070f";
  ctx.fillRect(0, 0, W, H);

  // Header
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.font = "700 26px JetBrains Mono, monospace";
  ctx.fillText("KILL-CHAIN — SIGNAL SCOPE REPORT", 40, 46);
  ctx.font = "13px JetBrains Mono, monospace";
  ctx.fillStyle = "rgba(255,255,255,0.45)";
  ctx.fillText(
    `Before / After comparison · ${new Date().toLocaleString()}`,
    40, 70,
  );

  // Spectrum grid
  ctx.font = "11px JetBrains Mono, monospace";
  ctx.lineWidth = 1;
  for (const db of DB_MARKS) {
    const y = dbToY(db);
    ctx.strokeStyle = db === 0 ? "rgba(255,255,255,0.16)" : "rgba(255,255,255,0.06)";
    ctx.beginPath(); ctx.moveTo(SPEC_X, y); ctx.lineTo(SPEC_X + SPEC_W, y); ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.3)";
    ctx.textAlign = "right";
    ctx.fillText(`${db}`, SPEC_X - 6, y + 4);
  }
  ctx.textAlign = "left";
  for (const f of FREQ_MARKS) {
    const x = fToX(f);
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.beginPath(); ctx.moveTo(x, SPEC_Y); ctx.lineTo(x, SPEC_Y + SPEC_H); ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.3)";
    ctx.fillText(f >= 1000 ? `${f / 1000}k` : `${f}`, x + 3, SPEC_Y + SPEC_H + 16);
  }

  // Traces — before under after
  traceSpectrum(ctx, before, COLOR_A, true);
  traceSpectrum(ctx, after, COLOR_B, true);

  // Legend
  ctx.font = "12px JetBrains Mono, monospace";
  ctx.fillStyle = COLOR_A;
  ctx.fillRect(SPEC_X, SPEC_Y - 20, 22, 4);
  ctx.fillText("BEFORE", SPEC_X + 30, SPEC_Y - 13);
  ctx.fillStyle = COLOR_B;
  ctx.fillRect(SPEC_X + 130, SPEC_Y - 20, 22, 4);
  ctx.fillText("AFTER", SPEC_X + 160, SPEC_Y - 13);

  // Stats table
  const rows: { label: string; unit: string; a: string; b: string; delta: string }[] = [];
  const push = (
    label: string, unit: string, a: number, b: number,
    format: (v: number) => string, deltaDigits = 1,
  ) => {
    const valid = (v: number) => v > -119 && Number.isFinite(v);
    rows.push({
      label, unit,
      a: format(a),
      b: format(b),
      delta: valid(a) && valid(b)
        ? `${b - a >= 0 ? "+" : ""}${(b - a).toFixed(deltaDigits)}`
        : "—",
    });
  };
  push("Short-term loudness", "LUFS", before.lufsShort, after.lufsShort, (v) => fmt(v));
  push("Integrated loudness", "LUFS", before.lufsIntegrated, after.lufsIntegrated, (v) => fmt(v));
  push("True peak", "dBFS", before.peakDb, after.peakDb, (v) => fmt(v));
  push("RMS level", "dB", before.rmsDb, after.rmsDb, (v) => fmt(v));
  push("Crest factor", "dB", before.crest, after.crest, (v) => (v ? v.toFixed(1) : "—"));
  push("Spectral centroid", "", before.centroid, after.centroid, fmtHz, 0);
  push("Stereo correlation", "", before.corr, after.corr, (v) => v.toFixed(2), 2);
  push("Stereo width", "% side", before.widthPct, after.widthPct, (v) => v.toFixed(0), 0);
  push("Dynamics", "LU range", before.dynamics, after.dynamics, (v) => (v ? v.toFixed(1) : "—"));

  const tableY = SPEC_Y + SPEC_H + 50;
  const rowH = 28;
  const cols = { label: 40, a: 560, b: 760, delta: 960, unit: 1120 };

  ctx.font = "700 12px JetBrains Mono, monospace";
  ctx.fillStyle = "rgba(255,255,255,0.4)";
  ctx.fillText("METRIC", cols.label, tableY);
  ctx.fillStyle = COLOR_A;
  ctx.fillText("BEFORE", cols.a, tableY);
  ctx.fillStyle = COLOR_B;
  ctx.fillText("AFTER", cols.b, tableY);
  ctx.fillStyle = "rgba(255,255,255,0.4)";
  ctx.fillText("Δ", cols.delta, tableY);
  ctx.fillText("UNIT", cols.unit, tableY);

  ctx.font = "13px JetBrains Mono, monospace";
  rows.forEach((r, i) => {
    const y = tableY + 22 + i * rowH;
    if (i % 2 === 0) {
      ctx.fillStyle = "rgba(255,255,255,0.03)";
      ctx.fillRect(cols.label - 8, y - 17, W - 80, rowH - 4);
    }
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.fillText(r.label, cols.label, y);
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.fillText(r.a, cols.a, y);
    ctx.fillText(r.b, cols.b, y);
    ctx.fillStyle = r.delta.startsWith("+") ? "#9dff5b" : r.delta === "—" ? "rgba(255,255,255,0.35)" : "#ffb648";
    ctx.fillText(r.delta, cols.delta, y);
    ctx.fillStyle = "rgba(255,255,255,0.4)";
    ctx.fillText(r.unit, cols.unit, y);
  });

  // Footer
  ctx.font = "11px JetBrains Mono, monospace";
  ctx.fillStyle = "rgba(255,255,255,0.3)";
  ctx.fillText(
    "Loudness per ITU-R BS.1770 · spectrum: 8192-pt FFT, float dB · generated by Kill-Chain",
    40, H - 24,
  );

  const dataUrl = canvas.toDataURL("image/png");
  return dataUrl.slice(dataUrl.indexOf(",") + 1);
}

/** Save the rendered report through the Electron save dialog. */
export async function saveScopeReport(before: ScopeCapture, after: ScopeCapture): Promise<string | null> {
  const b64 = renderScopeReportPng(before, after);
  const save = window.playground?.files?.save;
  if (!save) {
    // Browser dev fallback — trigger a download.
    const a = document.createElement("a");
    a.href = `data:image/png;base64,${b64}`;
    a.download = "killchain-scope-report.png";
    a.click();
    return "download";
  }
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  return save(
    `killchain-report-${stamp}.png`,
    [{ name: "PNG image", extensions: ["png"] }],
    b64,
  );
}
