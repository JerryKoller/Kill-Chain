import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { GlassPanel } from "@/components/shared/GlassPanel";
import { getEngine } from "@/audio/AudioEngine";
import { saveScopeReport, type ScopeCapture } from "@/lib/scopeReport";
import { useUIStore } from "@/state/uiStore";

// ─── display range constants ─────────────────────────────────────────────────
const FREQ_MARKS = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
const DB_MARKS = [0, -12, -24, -36, -48, -60, -72];
const DISPLAY_DB_MIN = -84;
const DISPLAY_DB_MAX = 0;
const LUFS_MIN = -60;
const LUFS_MAX = -3;
const LUFS_HISTORY = 100;

// ─── helpers ─────────────────────────────────────────────────────────────────
function fToX(f: number, W: number): number {
  const lo = Math.log10(20), hi = Math.log10(20000);
  return ((Math.log10(Math.max(20, Math.min(20000, f))) - lo) / (hi - lo)) * W;
}
function dbToY(db: number, H: number): number {
  return Math.max(0, Math.min(H,
    ((DISPLAY_DB_MAX - db) / (DISPLAY_DB_MAX - DISPLAY_DB_MIN)) * H,
  ));
}
function lufsToFrac(lufs: number): number {
  return Math.max(0, Math.min(1, (lufs - LUFS_MIN) / (LUFS_MAX - LUFS_MIN)));
}
function fmtLufs(l: number): string {
  return l < -100 ? "—" : `${l.toFixed(1)}`;
}

interface ScopeStats {
  rmsDb: number;
  peakDb: number;
  crest: number;
  centroid: number;
  corr: number;
  widthPct: number;
  dynamics: number;
  balance: number; // -1 (L) .. +1 (R)
}

const EMPTY_STATS: ScopeStats = {
  rmsDb: -120, peakDb: -120, crest: 0, centroid: 0,
  corr: 0, widthPct: 0, dynamics: 0, balance: 0,
};

// ─── main component ───────────────────────────────────────────────────────────
export function ScopeView() {
  const specRef = useRef<HTMLCanvasElement>(null);
  const spectroRef = useRef<HTMLCanvasElement>(null);
  const scopeRef = useRef<HTMLCanvasElement>(null);
  const gonioRef = useRef<HTMLCanvasElement>(null);
  const metersRef = useRef<HTMLCanvasElement>(null);

  const [showInput, setShowInput] = useState(true);
  const showInputRef = useRef(true);
  showInputRef.current = showInput;

  const [live, setLive] = useState(false);

  const statsRef = useRef<ScopeStats>(EMPTY_STATS);
  const [stats, setStats] = useState<ScopeStats>(EMPTY_STATS);

  // Before/After report captures — the draw loop fulfils requests since it
  // owns the hi-res spectrum buffers.
  const captureReqRef = useRef<"before" | "after" | null>(null);
  const capturesRef = useRef<{ before?: ScopeCapture; after?: ScopeCapture }>({});
  const [captured, setCaptured] = useState<{ before: boolean; after: boolean }>({
    before: false,
    after: false,
  });
  const toast = useUIStore((s) => s.toast);

  useEffect(() => {
    const engine = getEngine();
    const actx = engine.ctx as AudioContext;

    // The LUFS meter is lazy-started for performance; the Scope's M/S/I bars
    // depend on it, so make sure it's running while this view is mounted.
    engine.ensureLufsMeter();

    // ── extra stereo analysers tapped from destinationTap ──
    const splitter = actx.createChannelSplitter(2);
    const aL = actx.createAnalyser();
    const aR = actx.createAnalyser();
    aL.fftSize = 1024;
    aR.fftSize = 1024;
    aL.smoothingTimeConstant = 0.35;
    aR.smoothingTimeConstant = 0.35;
    engine.destinationTap.connect(splitter);
    splitter.connect(aL, 0);
    splitter.connect(aR, 1);

    // ── hi-res float spectrum taps (Scope-private) ──
    // The shared engine analysers are 2048-pt/8-bit — fine for visualizers,
    // coarse for measurement. The Scope gets its own 8192-point FFTs read as
    // FLOAT dB (≈ 5.4 Hz/bin at 44.1 kHz, no 8-bit quantisation), one on the
    // processed output and one on the raw input.
    const hiPost = actx.createAnalyser();
    hiPost.fftSize = 8192;
    hiPost.smoothingTimeConstant = 0.55;
    const hiPre = actx.createAnalyser();
    hiPre.fftSize = 8192;
    hiPre.smoothingTimeConstant = 0.55;
    engine.destinationTap.connect(hiPost);
    engine.preTap.connect(hiPre);

    // ── pre-allocate buffers ──
    const hiN = hiPost.frequencyBinCount;
    const postDb = new Float32Array(hiN) as Float32Array<ArrayBuffer>;
    const preDb = new Float32Array(hiN) as Float32Array<ArrayBuffer>;
    const postTimeF = new Float32Array(hiPost.fftSize) as Float32Array<ArrayBuffer>;
    const peakHold = new Float32Array(hiN).fill(-180);

    const tdL = new Float32Array(aL.fftSize) as Float32Array<ArrayBuffer>;
    const tdR = new Float32Array(aR.fftSize) as Float32Array<ArrayBuffer>;

    const momentaryHist: number[] = [];

    let raf = 0;
    let lastTick = 0;
    let frame = 0;
    let prevLive = false;
    const MIN_INTERVAL = 33; // ~30 fps — plenty for analysis read-outs

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      if (document.hidden || now - lastTick < MIN_INTERVAL) return;
      lastTick = now;
      frame++;
      // The spectrum + oscilloscope repaint every tick; the heavier stereo
      // scope, spectrogram, loudness meters and numeric stats run at half rate
      // so the whole view stays smooth without any visible loss of detail.
      const heavy = frame % 2 === 0;
      // read data (float — no 8-bit quantisation staircase)
      hiPost.getFloatFrequencyData(postDb);
      hiPre.getFloatFrequencyData(preDb);
      hiPost.getFloatTimeDomainData(postTimeF);
      aL.getFloatTimeDomainData(tdL);
      aR.getFloatTimeDomainData(tdR);

      // live indicator — only re-render React when the flag actually flips
      const rms = engine.getOutputRms();
      const isLive = rms > 0.001;
      if (isLive !== prevLive) { prevLive = isLive; setLive(isLive); }

      // LUFS history
      const lufs = engine.lufs;
      momentaryHist.push(lufs.momentaryLufs);
      if (momentaryHist.length > LUFS_HISTORY) momentaryHist.shift();

      // peak in dBFS from the float time domain (true sample peak, 8192 span)
      let peakLinear = 0;
      for (let i = 0; i < postTimeF.length; i++) {
        const v = Math.abs(postTimeF[i]);
        if (v > peakLinear) peakLinear = v;
      }
      const peakDb = peakLinear > 1e-6 ? 20 * Math.log10(peakLinear) : -96;

      const nyq = actx.sampleRate / 2;

      // ── SPECTRUM ──────────────────────────────────────────────────────────
      {
        const canvas = specRef.current;
        if (canvas) {
          const dpr = window.devicePixelRatio || 1;
          const W = canvas.clientWidth, H = canvas.clientHeight;
          if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
            canvas.width = Math.round(W * dpr);
            canvas.height = Math.round(H * dpr);
          }
          const ctx = canvas.getContext("2d")!;
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.clearRect(0, 0, W, H);

          // grid
          ctx.font = "9px JetBrains Mono, monospace";
          ctx.lineWidth = 1;
          for (const db of DB_MARKS) {
            const y = dbToY(db, H);
            ctx.strokeStyle = db === 0 ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.05)";
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
            ctx.fillStyle = "rgba(255,255,255,0.22)";
            ctx.fillText(`${db}`, 3, y - 2);
          }
          for (const f of FREQ_MARKS) {
            const x = fToX(f, W);
            ctx.strokeStyle = "rgba(255,255,255,0.05)";
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
            ctx.fillStyle = "rgba(255,255,255,0.22)";
            ctx.fillText(f >= 1000 ? `${f / 1000}k` : `${f}`, x + 2, H - 3);
          }

          // helper: trace a float-dB spectrum as a path
          const tracePath = (buf: Float32Array<ArrayBuffer>): Path2D => {
            const p = new Path2D();
            let first = true;
            for (let i = 1; i < hiN; i++) {
              const hz = (i / hiN) * nyq;
              if (hz < 20 || hz > 20000) continue;
              const db = buf[i];
              if (!Number.isFinite(db) || db < DISPLAY_DB_MIN) continue;
              const x = fToX(hz, W);
              const y = dbToY(db, H);
              if (first) { p.moveTo(x, y); first = false; } else p.lineTo(x, y);
            }
            p.lineTo(fToX(20000, W), H);
            p.lineTo(fToX(20, W), H);
            p.closePath();
            return p;
          };

          // peak hold decay (dB domain, ~7 dB/s at 30 fps)
          for (let i = 0; i < hiN; i++) {
            const db = postDb[i];
            if (Number.isFinite(db) && db > peakHold[i]) peakHold[i] = db;
            else peakHold[i] -= 0.24;
          }

          // input (pre-EQ) overlay
          if (showInputRef.current) {
            const preP = tracePath(preDb);
            ctx.fillStyle = "rgba(122,59,255,0.18)";
            ctx.fill(preP);
          }

          // output fill
          const outP = tracePath(postDb);
          const grad = ctx.createLinearGradient(0, 0, 0, H);
          grad.addColorStop(0, "rgba(34,232,255,0.55)");
          grad.addColorStop(0.5, "rgba(34,232,255,0.15)");
          grad.addColorStop(1, "rgba(34,232,255,0)");
          ctx.fillStyle = grad;
          ctx.fill(outP);

          // output line + glow
          ctx.save();
          ctx.strokeStyle = "#22e8ff";
          ctx.lineWidth = 1.5;
          ctx.shadowColor = "#22e8ff";
          ctx.shadowBlur = 5;
          ctx.stroke(outP);
          ctx.restore();

          // peak hold dashed line
          ctx.save();
          ctx.strokeStyle = "rgba(255,255,255,0.45)";
          ctx.lineWidth = 1;
          ctx.setLineDash([2, 5]);
          ctx.beginPath();
          let first = true;
          for (let i = 1; i < hiN; i++) {
            const hz = (i / hiN) * nyq;
            if (hz < 20 || hz > 20000) continue;
            const db = peakHold[i];
            if (!Number.isFinite(db) || db < DISPLAY_DB_MIN) continue;
            const x = fToX(hz, W);
            const y = dbToY(db, H);
            if (first) { ctx.moveTo(x, y); first = false; } else ctx.lineTo(x, y);
          }
          ctx.stroke();
          ctx.restore();
        }
      }

      // ── GONIOMETER ────────────────────────────────────────────────────────
      if (heavy) {
        const canvas = gonioRef.current;
        if (canvas) {
          const dpr = window.devicePixelRatio || 1;
          const W = canvas.clientWidth, H = canvas.clientHeight;
          if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
            canvas.width  = Math.round(W * dpr);
            canvas.height = Math.round(H * dpr);
            const ctx = canvas.getContext("2d")!;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.fillStyle = "#06060c";
            ctx.fillRect(0, 0, W, H);
          }
          const ctx = canvas.getContext("2d")!;
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

          // trail fade — persistence effect
          ctx.fillStyle = "rgba(6,6,12,0.22)";
          ctx.fillRect(0, 0, W, H);

          const CORR_BAR_H = 18;
          const cx = W / 2;
          const cy = (H - CORR_BAR_H - 6) / 2;
          const r  = Math.min(cx, cy) * 0.87;

          // guide circles
          ctx.strokeStyle = "rgba(255,255,255,0.06)";
          ctx.lineWidth = 1;
          [0.33, 0.66, 1].forEach((frac) => {
            ctx.beginPath();
            ctx.arc(cx, cy, r * frac, 0, Math.PI * 2);
            ctx.stroke();
          });

          // axes
          ctx.strokeStyle = "rgba(255,255,255,0.10)";
          const d45 = r * Math.cos(Math.PI / 4);
          ctx.beginPath();
          ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy + r);
          ctx.moveTo(cx - r, cy); ctx.lineTo(cx + r, cy);
          ctx.stroke();
          ctx.strokeStyle = "rgba(255,255,255,0.04)";
          ctx.beginPath();
          ctx.moveTo(cx - d45, cy - d45); ctx.lineTo(cx + d45, cy + d45);
          ctx.moveTo(cx + d45, cy - d45); ctx.lineTo(cx - d45, cy + d45);
          ctx.stroke();

          // axis labels
          ctx.font = "9px JetBrains Mono, monospace";
          ctx.fillStyle = "rgba(255,255,255,0.3)";
          ctx.textAlign = "center";
          ctx.fillText("M", cx, cy - r - 4);
          ctx.textAlign = "left";
          ctx.fillText("L", cx - r - 12, cy + 4);
          ctx.textAlign = "right";
          ctx.fillText("R", cx + r + 12, cy + 4);
          ctx.textAlign = "left";

          // compute correlation
          let sumLR = 0, sumL2 = 0, sumR2 = 0;
          const TDN = tdL.length;
          for (let i = 0; i < TDN; i++) {
            sumLR += tdL[i] * tdR[i];
            sumL2 += tdL[i] * tdL[i];
            sumR2 += tdR[i] * tdR[i];
          }
          const denom = Math.sqrt(sumL2 * sumR2);
          const corr = denom > 1e-9 ? Math.max(-1, Math.min(1, sumLR / denom)) : 0;

          // plot goniometer points (mid-side: X=side, Y=mid/up)
          for (let i = 0; i < TDN - 1; i += 3) {
            const l  = tdL[i];
            const rv = tdR[i];
            const intensity = Math.min(1, (Math.abs(l) + Math.abs(rv)) * 3.5);
            if (intensity < 0.015) continue;
            const px = cx + (l - rv) * r * 0.78;
            const py = cy - (l + rv) * r * 0.78;
            const alpha = 0.25 + intensity * 0.65;
            // colour shifts from cyan (in-phase) toward green (wide stereo)
            const hue = 185 + Math.abs(l - rv) * 60;
            ctx.fillStyle = `hsla(${hue},90%,65%,${alpha.toFixed(2)})`;
            ctx.fillRect(px - 0.7, py - 0.7, 1.4, 1.4);
          }

          // correlation bar
          const barY = H - CORR_BAR_H;
          const barW = W - 8;
          ctx.fillStyle = "rgba(255,255,255,0.06)";
          ctx.fillRect(4, barY, barW, CORR_BAR_H - 4);
          const corrFill = ((corr + 1) / 2) * barW;
          ctx.fillStyle = corr < 0 ? "#ff5b8a" : corr < 0.3 ? "#ffb648" : "#9dff5b";
          ctx.fillRect(4, barY, corrFill, CORR_BAR_H - 4);
          ctx.font = "8px JetBrains Mono, monospace";
          ctx.fillStyle = "rgba(255,255,255,0.35)";
          ctx.textAlign = "left";
          ctx.fillText("CORR", 4, barY - 2);
          ctx.textAlign = "right";
          ctx.fillText(`${corr.toFixed(2)}`, W - 4, barY - 2);
          ctx.textAlign = "left";
        }
      }

      // ── LOUDNESS METERS ──────────────────────────────────────────────────
      if (heavy) {
        const canvas = metersRef.current;
        if (canvas) {
          const dpr = window.devicePixelRatio || 1;
          const W = canvas.clientWidth, H = canvas.clientHeight;
          if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
            canvas.width  = Math.round(W * dpr);
            canvas.height = Math.round(H * dpr);
          }
          const ctx = canvas.getContext("2d")!;
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.clearRect(0, 0, W, H);

          const LBL = 28;
          const VAL = 44;
          const BAR_X = LBL;
          const BAR_W = W - LBL - VAL - 4;
          const BAR_H = 16;
          const GAP = 26;

          ctx.font = "10px JetBrains Mono, monospace";

          const drawBar = (label: string, val: number, y: number, isIntegrated = false) => {
            // track
            ctx.fillStyle = "rgba(255,255,255,0.06)";
            ctx.fillRect(BAR_X, y, BAR_W, BAR_H);
            // tick marks at -23, -18, -14, -9, -6, -3 LUFS
            ctx.strokeStyle = "rgba(255,255,255,0.12)";
            ctx.lineWidth = 1;
            for (const mark of [-23, -18, -14, -9, -6, -3]) {
              if (mark < LUFS_MIN || mark > LUFS_MAX) continue;
              const mx = BAR_X + lufsToFrac(mark) * BAR_W;
              ctx.beginPath(); ctx.moveTo(mx, y); ctx.lineTo(mx, y + BAR_H); ctx.stroke();
            }
            // fill
            if (val > -120) {
              const fillW = lufsToFrac(val) * BAR_W;
              const grad = ctx.createLinearGradient(BAR_X, 0, BAR_X + BAR_W, 0);
              grad.addColorStop(0,    "#22e8ff");
              grad.addColorStop(0.6,  "#7a3bff");
              grad.addColorStop(0.82, "#ffb648");
              grad.addColorStop(1,    "#ff2bd6");
              ctx.fillStyle = grad;
              ctx.fillRect(BAR_X, y, fillW, BAR_H);
              if (isIntegrated) {
                // -14 LUFS streaming target marker
                const targetX = BAR_X + lufsToFrac(-14) * BAR_W;
                ctx.strokeStyle = "rgba(255,255,255,0.55)";
                ctx.lineWidth = 2;
                ctx.beginPath(); ctx.moveTo(targetX, y - 2); ctx.lineTo(targetX, y + BAR_H + 2); ctx.stroke();
              }
            }
            // label
            ctx.fillStyle = "rgba(255,255,255,0.5)";
            ctx.textAlign = "left";
            ctx.fillText(label, 0, y + BAR_H - 3);
            // value
            const valStr = fmtLufs(val);
            ctx.fillStyle = val > -9 ? "#ff5b8a" : val > -14 ? "#ffb648" : "#9dff5b";
            ctx.textAlign = "right";
            ctx.fillText(valStr, W, y + BAR_H - 3);
            ctx.textAlign = "left";
          };

          drawBar("M",  lufs.momentaryLufs,  6);
          drawBar("S",  lufs.shortTermLufs,   6 + GAP);
          drawBar("I",  lufs.integratedLufs,  6 + GAP * 2, true);

          // history chart
          const chartTop = 6 + GAP * 3 + 4;
          const chartH   = Math.max(40, H - chartTop - GAP - 8);
          ctx.fillStyle = "rgba(255,255,255,0.04)";
          ctx.fillRect(0, chartTop, W, chartH);
          // -14 LUFS reference line in chart
          const refY = chartTop + chartH - lufsToFrac(-14) * chartH;
          ctx.strokeStyle = "rgba(255,255,255,0.18)";
          ctx.lineWidth = 1;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(0, refY); ctx.lineTo(W, refY);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.font = "8px JetBrains Mono, monospace";
          ctx.fillStyle = "rgba(255,255,255,0.3)";
          ctx.fillText("−14 LUFS", 2, refY - 2);

          if (momentaryHist.length > 1) {
            ctx.beginPath();
            const stepW = W / (LUFS_HISTORY - 1);
            for (let i = 0; i < momentaryHist.length; i++) {
              const x = i * stepW;
              const y = chartTop + chartH - lufsToFrac(momentaryHist[i]) * chartH;
              if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            }
            ctx.strokeStyle = "#22e8ff";
            ctx.lineWidth = 1.5;
            ctx.shadowColor = "#22e8ff";
            ctx.shadowBlur  = 5;
            ctx.stroke();
            ctx.shadowBlur = 0;
          }
          ctx.font = "8px JetBrains Mono, monospace";
          ctx.fillStyle = "rgba(255,255,255,0.25)";
          ctx.fillText("Momentary history", 2, chartTop + 10);

          // peak bar
          const pkY = H - BAR_H - 4;
          ctx.fillStyle = "rgba(255,255,255,0.06)";
          ctx.fillRect(BAR_X, pkY, BAR_W, BAR_H);
          const pkFrac = Math.max(0, Math.min(1, (peakDb + 96) / 96));
          ctx.fillStyle = peakDb > -3 ? "#ff5b8a" : peakDb > -12 ? "#ffb648" : "#9dff5b";
          ctx.fillRect(BAR_X, pkY, pkFrac * BAR_W, BAR_H);
          ctx.fillStyle = "rgba(255,255,255,0.45)";
          ctx.textAlign = "left";
          ctx.font = "10px JetBrains Mono, monospace";
          ctx.fillText("PK", 0, pkY + BAR_H - 3);
          ctx.textAlign = "right";
          ctx.fillStyle = peakDb > -3 ? "#ff5b8a" : "#9dff5b";
          ctx.fillText(`${peakDb.toFixed(1)} dBFS`, W, pkY + BAR_H - 3);
          ctx.textAlign = "left";
        }
      }

      // ── SPECTROGRAM (scrolling waterfall) ─────────────────────────────────
      if (heavy) {
        const canvas = spectroRef.current;
        if (canvas) {
          // Use device pixels 1:1 so the self-scroll copy stays pixel-exact.
          const W = canvas.clientWidth, H = canvas.clientHeight;
          if (W > 0 && H > 0) {
            if (canvas.width !== W || canvas.height !== H) {
              canvas.width = W; canvas.height = H;
            }
            const ctx = canvas.getContext("2d")!;
            const COL = 2;
            // Scroll existing content left by COL px.
            ctx.drawImage(canvas, COL, 0, W - COL, H, 0, 0, W - COL, H);
            // Paint the freshest column on the right edge.
            const lo = Math.log10(20), hi = Math.log10(20000);
            const x = W - COL;
            for (let y = 0; y < H; y++) {
              const frac = 1 - y / H; // bottom = low, top = high
              const f = Math.pow(10, lo + frac * (hi - lo));
              const bin = Math.min(hiN - 1, Math.round((f / nyq) * hiN));
              const db = postDb[bin];
              const amp = Number.isFinite(db) ? Math.max(0, Math.min(1, (db + 100) / 100)) : 0;
              if (amp < 0.015) {
                ctx.fillStyle = "#05050b";
              } else {
                // Thermal map: dim blue → cyan → magenta → white-hot.
                const hue = 250 - amp * 210;
                const light = 12 + amp * 52;
                ctx.fillStyle = `hsl(${hue}, 92%, ${light}%)`;
              }
              ctx.fillRect(x, y, COL, 1);
            }
          }
        }
      }

      // ── OSCILLOSCOPE (L / R waveform) ─────────────────────────────────────
      {
        const canvas = scopeRef.current;
        if (canvas) {
          const dpr = window.devicePixelRatio || 1;
          const W = canvas.clientWidth, H = canvas.clientHeight;
          if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
            canvas.width = Math.round(W * dpr);
            canvas.height = Math.round(H * dpr);
          }
          const ctx = canvas.getContext("2d")!;
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.clearRect(0, 0, W, H);
          const cy = H / 2;
          // centre line + thirds
          ctx.strokeStyle = "rgba(255,255,255,0.08)";
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(W, cy); ctx.stroke();
          ctx.strokeStyle = "rgba(255,255,255,0.04)";
          ctx.beginPath();
          ctx.moveTo(0, cy - H * 0.25); ctx.lineTo(W, cy - H * 0.25);
          ctx.moveTo(0, cy + H * 0.25); ctx.lineTo(W, cy + H * 0.25);
          ctx.stroke();

          const drawWave = (buf: Float32Array, color: string, amp: number) => {
            ctx.beginPath();
            const N = buf.length;
            for (let i = 0; i < N; i++) {
              const x = (i / (N - 1)) * W;
              const y = cy - buf[i] * amp * (H * 0.46);
              if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            }
            ctx.strokeStyle = color;
            ctx.lineWidth = 1.4;
            ctx.shadowColor = color;
            ctx.shadowBlur = 3;
            ctx.stroke();
            ctx.shadowBlur = 0;
          };
          drawWave(tdL, "rgba(34,232,255,0.9)", 1);
          drawWave(tdR, "rgba(255,43,214,0.8)", 1);
        }
      }

      // ── STATS (numeric read-outs) ─────────────────────────────────────────
      if (heavy) {
        const rmsLin = rms; // engine.getOutputRms() captured above
        const rmsDb = rmsLin > 1e-7 ? 20 * Math.log10(rmsLin) : -120;
        const crest = peakDb > -119 && rmsDb > -119 ? peakDb - rmsDb : 0;

        // Spectral centroid (perceived brightness) — true linear magnitudes
        // from the float spectrum, so quiet-but-bright content reads honestly.
        let num = 0, den = 0;
        for (let i = 1; i < hiN; i++) {
          const db = postDb[i];
          if (!Number.isFinite(db)) continue;
          const hz = (i / hiN) * nyq;
          if (hz < 20 || hz > 20000) continue;
          const m = Math.pow(10, db / 20);
          num += hz * m; den += m;
        }
        const centroid = den > 1e-9 ? num / den : 0;

        // Mid/Side + correlation + balance from the stereo time-domain taps.
        let sumLR = 0, sumL2 = 0, sumR2 = 0, mid2 = 0, side2 = 0;
        const TDN = tdL.length;
        for (let i = 0; i < TDN; i++) {
          const l = tdL[i], r = tdR[i];
          sumLR += l * r; sumL2 += l * l; sumR2 += r * r;
          const m = (l + r) * 0.5, s = (l - r) * 0.5;
          mid2 += m * m; side2 += s * s;
        }
        const denom = Math.sqrt(sumL2 * sumR2);
        const corr = denom > 1e-9 ? Math.max(-1, Math.min(1, sumLR / denom)) : 0;
        const midRms = Math.sqrt(mid2 / TDN);
        const sideRms = Math.sqrt(side2 / TDN);
        const widthPct = midRms + sideRms > 1e-7
          ? (sideRms / (midRms + sideRms)) * 100 : 0;
        const lRms = Math.sqrt(sumL2 / TDN);
        const rRms = Math.sqrt(sumR2 / TDN);
        const balance = lRms + rRms > 1e-7 ? (rRms - lRms) / (lRms + rRms) : 0;

        // Loudness range (dynamics) from recent momentary history.
        let dyn = 0;
        const valid = momentaryHist.filter((v) => v > -70);
        if (valid.length > 4) {
          dyn = Math.max(...valid) - Math.min(...valid);
        }

        statsRef.current = {
          rmsDb, peakDb, crest, centroid, corr, widthPct, dynamics: dyn, balance,
        };

        // ── BEFORE/AFTER report capture (fulfilled here — stats are fresh) ──
        const req = captureReqRef.current;
        if (req) {
          captureReqRef.current = null;
          capturesRef.current[req] = {
            spectrumDb: postDb.slice(),
            nyquist: nyq,
            lufsShort: lufs.shortTermLufs,
            lufsIntegrated: lufs.integratedLufs,
            peakDb,
            rmsDb,
            crest,
            centroid,
            corr,
            widthPct,
            dynamics: dyn,
            at: Date.now(),
          };
          setCaptured({
            before: !!capturesRef.current.before,
            after: !!capturesRef.current.after,
          });
        }
      }
    };

    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      engine.releaseLufsMeter();
      // Tear down the whole tap chain — leaving aL/aR wired kept them (and
      // their FFT work) alive after every visit to this view.
      try { engine.destinationTap.disconnect(splitter); } catch { /* ignore */ }
      try { splitter.disconnect(); } catch { /* ignore */ }
      try { aL.disconnect(); } catch { /* ignore */ }
      try { aR.disconnect(); } catch { /* ignore */ }
      try { engine.destinationTap.disconnect(hiPost); } catch { /* ignore */ }
      try { engine.preTap.disconnect(hiPre); } catch { /* ignore */ }
    };
  }, []);

  // Mirror the live stats into React state at a calm rate so the read-out
  // cards update smoothly without re-rendering on every animation frame.
  // Skip hidden windows and identical snapshots (silence) entirely.
  useEffect(() => {
    let lastSig = "";
    const id = window.setInterval(() => {
      if (document.hidden) return;
      const s = statsRef.current;
      const sig = `${s.rmsDb.toFixed(1)}|${s.peakDb.toFixed(1)}|${s.crest.toFixed(1)}|${s.centroid.toFixed(0)}|${s.corr.toFixed(2)}|${s.widthPct.toFixed(0)}|${s.dynamics.toFixed(1)}|${s.balance.toFixed(2)}`;
      if (sig === lastSig) return;
      lastSig = sig;
      setStats({ ...s });
    }, 140);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="flex flex-col gap-3 pb-4">
      {/* ── Header ── */}
      <div className="sticky top-0 z-20 -mx-4 px-4 pt-3 pb-2 bg-ink/85 backdrop-blur-md border-b border-white/[0.05]">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-[0.3em] text-dim">
              Signal Scope
            </div>
            <div className="text-sm text-white/70 truncate">
              Real-time spectrum · stereo image · loudness — full recon on your signal
            </div>
          </div>
          <div className="flex items-center gap-3">
            {/* LIVE indicator */}
            <AnimatePresence>
              {live && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-lime/90"
                >
                  <span className="w-2 h-2 rounded-full bg-lime animate-pulse" />
                  Live
                </motion.div>
              )}
            </AnimatePresence>
            <button
              onClick={() => setShowInput((v) => !v)}
              className={`kc-btn kc-btn--sm kc-btn--ghost ${showInput ? "kc-on" : ""}`}
              title="Toggle pre-EQ input overlay on spectrum"
            >
              Input overlay
            </button>

            {/* Before/After report (v1.5) */}
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => { captureReqRef.current = "before"; toast("Capturing BEFORE…"); }}
                className={`kc-btn kc-btn--sm kc-btn--ghost ${captured.before ? "kc-on" : ""}`}
                title="Capture the current spectrum + stats as the BEFORE side (do this with your changes bypassed or before tweaking)"
              >
                {captured.before ? "✓ Before" : "⊙ Before"}
              </button>
              <button
                onClick={() => { captureReqRef.current = "after"; toast("Capturing AFTER…"); }}
                className={`kc-btn kc-btn--sm kc-btn--ghost ${captured.after ? "kc-on" : ""}`}
                title="Capture the current spectrum + stats as the AFTER side"
              >
                {captured.after ? "✓ After" : "⊙ After"}
              </button>
              <button
                disabled={!captured.before || !captured.after}
                onClick={() => {
                  const { before, after } = capturesRef.current;
                  if (!before || !after) return;
                  void saveScopeReport(before, after).then((path) => {
                    if (path) toast("Report exported — spectrum overlay + loudness stats");
                  });
                }}
                className="kc-btn kc-btn--sm kc-btn--accent"
                title="Render a shareable before/after PNG report (spectrum overlay + LUFS / crest / width / centroid deltas)"
              >
                ⇩ Report
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Live stats strip ── */}
      <StatsStrip stats={stats} />

      {/* ── Spectrum ── */}
      <GlassPanel intense className="p-3 overflow-hidden" style={{ height: "280px" }}>
        <div className="flex items-center justify-between mb-2 px-1">
          <div className="text-[10px] uppercase tracking-[0.3em] text-dim">
            Frequency Spectrum
          </div>
          <div className="flex gap-4 text-[9px] uppercase tracking-widest text-dim">
            <span className="flex items-center gap-1.5">
              <span className="w-4 h-0.5 bg-cyan rounded" />Output (post-DSP)
            </span>
            {showInput && (
              <span className="flex items-center gap-1.5">
                <span className="w-4 h-0.5 bg-violet-400 opacity-70 rounded" />Input
              </span>
            )}
            <span className="flex items-center gap-1.5">
              <span className="w-4 border-t border-dashed border-white/50" />Peak hold
            </span>
          </div>
        </div>
        <canvas
          ref={specRef}
          className="w-full rounded-lg"
          style={{ height: "calc(100% - 28px)" }}
        />
      </GlassPanel>

      {/* ── Spectrogram (waterfall) ── */}
      <GlassPanel intense className="p-3 overflow-hidden" style={{ height: "200px" }}>
        <div className="flex items-center justify-between mb-2 px-1">
          <div className="text-[10px] uppercase tracking-[0.3em] text-dim">
            Spectrogram
          </div>
          <div className="text-[9px] uppercase tracking-widest text-dim">
            time → · low freq bottom · bright = loud
          </div>
        </div>
        <canvas
          ref={spectroRef}
          className="w-full rounded-lg"
          style={{ height: "calc(100% - 28px)", background: "#05050b" }}
        />
      </GlassPanel>

      {/* ── Oscilloscope + Goniometer ── */}
      <div className="grid grid-cols-12 gap-3">
        {/* Oscilloscope */}
        <GlassPanel intense className="col-span-12 lg:col-span-7 p-3 flex flex-col">
          <div className="flex items-center justify-between mb-2 px-1">
            <div className="text-[10px] uppercase tracking-[0.3em] text-dim">
              Oscilloscope
            </div>
            <div className="flex gap-3 text-[9px] uppercase tracking-widest text-dim">
              <span className="flex items-center gap-1.5">
                <span className="w-4 h-0.5 bg-cyan rounded" />L
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-4 h-0.5 rounded" style={{ background: "#ff2bd6" }} />R
              </span>
            </div>
          </div>
          <div className="relative flex-1 min-h-[200px]">
            <canvas
              ref={scopeRef}
              className="w-full h-full rounded-lg"
              style={{ background: "#06060c" }}
            />
          </div>
        </GlassPanel>

        {/* Goniometer */}
        <GlassPanel intense className="col-span-12 lg:col-span-5 p-3 flex flex-col">
          <div className="text-[10px] uppercase tracking-[0.3em] text-dim mb-2 px-1">
            Stereo Image
          </div>
          <div className="relative flex-1 min-h-[220px]">
            <canvas
              ref={gonioRef}
              className="w-full h-full rounded-lg"
              style={{ background: "#06060c" }}
            />
          </div>
          <div className="mt-2 px-1 grid grid-cols-3 text-[9px] text-dim text-center">
            <span>← L heavy</span>
            <span>Center = mono</span>
            <span>R heavy →</span>
          </div>
        </GlassPanel>
      </div>

      {/* ── LUFS & peak meters ── */}
      <GlassPanel intense className="p-3 flex flex-col">
        <div className="flex items-baseline justify-between mb-2 px-1">
          <div className="text-[10px] uppercase tracking-[0.3em] text-dim">
            Loudness (LUFS · ITU-R BS.1770)
          </div>
          <div className="text-[9px] text-dim">
            M = momentary · S = short-term · I = integrated · dashed = −14 target
          </div>
        </div>
        <canvas
          ref={metersRef}
          className="w-full rounded-lg flex-1"
          style={{ minHeight: "220px" }}
        />
      </GlassPanel>
    </div>
  );
}

function StatsStrip({ stats }: { stats: ScopeStats }) {
  const kHz = stats.centroid >= 1000;
  const balLabel =
    stats.balance < -0.02 ? "L" : stats.balance > 0.02 ? "R" : "C";
  const corrColor =
    stats.corr < 0 ? "#ff5b8a" : stats.corr < 0.3 ? "#ffb648" : "#9dff5b";
  const cards: { label: string; value: string; hint: string; color?: string }[] = [
    { label: "RMS", value: stats.rmsDb <= -119 ? "—" : `${stats.rmsDb.toFixed(1)}`, hint: "dB" },
    { label: "Peak", value: stats.peakDb <= -119 ? "—" : `${stats.peakDb.toFixed(1)}`, hint: "dBFS", color: stats.peakDb > -1 ? "#ff5b8a" : undefined },
    { label: "Crest", value: stats.crest ? `${stats.crest.toFixed(1)}` : "—", hint: "dB" },
    { label: "Centroid", value: stats.centroid ? (kHz ? `${(stats.centroid / 1000).toFixed(2)}` : `${stats.centroid.toFixed(0)}`) : "—", hint: kHz ? "kHz" : "Hz" },
    { label: "Correlation", value: `${stats.corr.toFixed(2)}`, hint: "−1…+1", color: corrColor },
    { label: "Width", value: `${stats.widthPct.toFixed(0)}`, hint: "% side" },
    { label: "Balance", value: balLabel === "C" ? "C" : `${Math.abs(stats.balance * 100).toFixed(0)} ${balLabel}`, hint: "L · R" },
    { label: "Dynamics", value: stats.dynamics ? `${stats.dynamics.toFixed(1)}` : "—", hint: "LU range" },
  ];
  return (
    <div className="grid grid-cols-4 md:grid-cols-8 gap-2">
      {cards.map((c) => (
        <GlassPanel key={c.label} className="px-3 py-2 flex flex-col items-center justify-center text-center">
          <div className="text-[8px] uppercase tracking-[0.2em] text-dim truncate w-full">
            {c.label}
          </div>
          <div
            className="text-lg font-semibold tabular-nums leading-tight"
            style={{ color: c.color ?? "#e7e9ff" }}
          >
            {c.value}
          </div>
          <div className="text-[8px] text-dim/70">{c.hint}</div>
        </GlassPanel>
      ))}
    </div>
  );
}
