/**
 * Shared StageViz drawing kit — the depth language every module visualizer
 * paints with, plus the caches that make it cheap.
 *
 * WHY THIS EXISTS
 * Each of the ~44 stage visualizers had hand-rolled its own `hexAlpha` (42
 * copies, each re-parsing hex strings dozens of times per frame), built its
 * gradients fresh every frame, and reached for `shadowBlur` for glow — the most
 * expensive operation in canvas 2D. They also fed `JSON.stringify(state)` to
 * the RAF pump as a motion key, which the pump evaluates once per entry per
 * frame, paused or not.
 *
 * RECIPE for a visualizer
 *   const { wrapRef, canvasRef, sizeRef, visibleRef } = useStageCanvas(H);
 *   …
 *   startStageVizLoop(paint, () => ({
 *     flash: flashRef.current,
 *     active: live,
 *     visible: visibleRef.current,          // ← skips paint when off-screen
 *     motionKey: motionHash(a, b, c),       // ← never JSON.stringify
 *   }));
 *
 *   function paint(now: number) {
 *     const { w: W, h: H } = sizeRef.current;
 *     ctx.clearRect(0, 0, W, H);
 *     plate(ctx, W, H, color, { energy });  // recessed lit chamber
 *     … module's own signature drawing …
 *     lit(ctx, () => drawGlow(ctx, x, y, 18, color, 0.8));  // additive bloom
 *     bezel(ctx, W, H, color);             // inner bevel + vignette, last
 *   }
 *
 * Everything here is pure drawing: no audio, no store access.
 */

/** Cheap clamp — hot path, avoid importing across module boundaries. */
function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// ── color ────────────────────────────────────────────────────────────────

const rgbCache = new Map<string, [number, number, number]>();

/** Parse `#rgb` / `#rrggbb` once per distinct hex, then remember it. */
export function rgbOf(hex: string): [number, number, number] {
  const hit = rgbCache.get(hex);
  if (hit) return hit;
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const out: [number, number, number] = [
    parseInt(full.slice(0, 2), 16) || 0,
    parseInt(full.slice(2, 4), 16) || 0,
    parseInt(full.slice(4, 6), 16) || 0,
  ];
  if (rgbCache.size < 512) rgbCache.set(hex, out);
  return out;
}

const alphaCache = new Map<string, string>();

/**
 * `rgba()` string for a hex + alpha. Alpha is quantized to 1/255 so a knob
 * sweep reuses cached strings instead of minting a new one every frame.
 */
export function hexA(hex: string, a: number): string {
  const q = (clamp01(a) * 255) | 0;
  const key = `${hex}${q}`;
  const hit = alphaCache.get(key);
  if (hit) return hit;
  const [r, g, b] = rgbOf(hex);
  const out = `rgba(${r},${g},${b},${(q / 255).toFixed(3)})`;
  if (alphaCache.size < 4096) alphaCache.set(key, out);
  return out;
}

/** Blend two hexes — for per-module accent mixing. Cached by pair + amount. */
const mixCache = new Map<string, string>();
export function mixHex(a: string, b: string, t: number): string {
  const q = (clamp01(t) * 64) | 0;
  const key = `${a}${b}${q}`;
  const hit = mixCache.get(key);
  if (hit) return hit;
  const [r1, g1, b1] = rgbOf(a);
  const [r2, g2, b2] = rgbOf(b);
  const u = q / 64;
  const to = (n: number) => Math.round(n).toString(16).padStart(2, "0");
  const out = `#${to(r1 + (r2 - r1) * u)}${to(g1 + (g2 - g1) * u)}${to(b1 + (b2 - b1) * u)}`;
  if (mixCache.size < 1024) mixCache.set(key, out);
  return out;
}

// ── motion key ───────────────────────────────────────────────────────────

/**
 * Allocation-free change key for the RAF pump.
 *
 * The pump calls `hints()` for every entry every frame, so this must not
 * allocate. Values are quantized to ~1e-3 before hashing, which also stops
 * float dust from waking a paused canvas.
 */
export function motionHash(...vals: (number | boolean | undefined)[]): number {
  let h = 2166136261;
  for (let i = 0; i < vals.length; i++) {
    const v = vals[i];
    const n = typeof v === "number" ? (v * 1000) | 0 : v ? 1 : 0;
    h ^= n + 0x9e3779b9 + (h << 6) + (h >>> 2);
    h |= 0;
  }
  return h;
}

// ── per-context caches ───────────────────────────────────────────────────

type Ctx = CanvasRenderingContext2D;

const gradCache = new WeakMap<Ctx, Map<string, CanvasGradient>>();

/**
 * Cache a gradient against its context. `key` MUST include every input that
 * shapes it (size, colors, stops) — a stale key means a stale gradient.
 */
export function cachedGrad(ctx: Ctx, key: string, make: (c: Ctx) => CanvasGradient): CanvasGradient {
  let m = gradCache.get(ctx);
  if (!m) {
    m = new Map();
    gradCache.set(ctx, m);
  }
  let g = m.get(key);
  if (!g) {
    // Size changes churn keys; a flat cap is enough to bound a resize storm.
    if (m.size > 64) m.clear();
    g = make(ctx);
    m.set(key, g);
  }
  return g;
}

const patternCache = new WeakMap<Ctx, Map<string, CanvasPattern | null>>();

function cachedPattern(ctx: Ctx, key: string, make: () => HTMLCanvasElement): CanvasPattern | null {
  let m = patternCache.get(ctx);
  if (!m) {
    m = new Map();
    patternCache.set(ctx, m);
  }
  if (m.has(key)) return m.get(key)!;
  const p = ctx.createPattern(make(), "repeat");
  m.set(key, p);
  return p;
}

// ── glow (replaces shadowBlur) ───────────────────────────────────────────

const glowCache = new Map<string, HTMLCanvasElement>();

/**
 * Pre-rendered soft radial sprite. `shadowBlur` re-blurs on every draw call;
 * this bakes the falloff once and blits it, which is both far cheaper and a
 * softer, deeper bloom than the hard shadow ring.
 */
function glowSprite(color: string, radius: number): HTMLCanvasElement {
  const r = Math.max(2, Math.min(160, Math.round(radius)));
  const key = `${color}|${r}`;
  const hit = glowCache.get(key);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = r * 2;
  c.height = r * 2;
  const g = c.getContext("2d");
  if (g) {
    const rg = g.createRadialGradient(r, r, 0, r, r, r);
    rg.addColorStop(0, hexA(color, 0.9));
    rg.addColorStop(0.28, hexA(color, 0.38));
    rg.addColorStop(0.62, hexA(color, 0.1));
    rg.addColorStop(1, hexA(color, 0));
    g.fillStyle = rg;
    g.fillRect(0, 0, r * 2, r * 2);
  }
  if (glowCache.size > 240) glowCache.clear();
  glowCache.set(key, c);
  return c;
}

/** Soft bloom at a point. Pair with `lit()` for additive light. */
export function drawGlow(ctx: Ctx, x: number, y: number, radius: number, color: string, alpha = 1): void {
  const a = clamp01(alpha);
  if (a <= 0.004 || radius <= 0) return;
  const s = glowSprite(color, radius);
  const prev = ctx.globalAlpha;
  ctx.globalAlpha = prev * a;
  ctx.drawImage(s, x - radius, y - radius, radius * 2, radius * 2);
  ctx.globalAlpha = prev;
}

/** Run `fn` in additive-light mode — the cheapest way to make things luminous. */
export function lit(ctx: Ctx, fn: () => void): void {
  const prev = ctx.globalCompositeOperation;
  ctx.globalCompositeOperation = "lighter";
  fn();
  ctx.globalCompositeOperation = prev;
}

/** Glowing stroke without shadowBlur: wide faint pass, then the crisp core. */
export function glowStroke(
  ctx: Ctx,
  path: () => void,
  color: string,
  opts?: { width?: number; glow?: number; alpha?: number },
): void {
  const w = opts?.width ?? 1.5;
  const g = opts?.glow ?? 1;
  const a = clamp01(opts?.alpha ?? 1);
  if (g > 0) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = hexA(color, 0.1 * a * g);
    ctx.lineWidth = w + 5 * g;
    ctx.beginPath();
    path();
    ctx.stroke();
    ctx.strokeStyle = hexA(color, 0.18 * a * g);
    ctx.lineWidth = w + 2 * g;
    ctx.beginPath();
    path();
    ctx.stroke();
    ctx.restore();
  }
  ctx.strokeStyle = hexA(color, a);
  ctx.lineWidth = w;
  ctx.beginPath();
  path();
  ctx.stroke();
}

// ── depth language ───────────────────────────────────────────────────────

/**
 * The recessed lit chamber every module sits in: a deep vertical body, an
 * accent glow pooled toward the floor, and a horizon line. `energy` (0..1)
 * opens the pool up as the module gets busier.
 */
export function plate(
  ctx: Ctx,
  W: number,
  H: number,
  color: string,
  opts?: { energy?: number; horizon?: number; floor?: string },
): void {
  const energy = clamp01(opts?.energy ?? 0.3);
  const horizon = opts?.horizon ?? 0.62;
  const e = (energy * 20) | 0;
  const body = cachedGrad(ctx, `plate|${W}|${H}|${color}|${e}|${horizon}`, (c) => {
    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "rgba(4,5,10,0.96)");
    g.addColorStop(clamp01(horizon - 0.25), "rgba(6,7,14,0.9)");
    g.addColorStop(1, hexA(color, 0.05 + energy * 0.07));
    return g;
  });
  ctx.fillStyle = body;
  ctx.fillRect(0, 0, W, H);

  const pool = cachedGrad(ctx, `pool|${W}|${H}|${color}|${e}`, (c) => {
    const g = c.createRadialGradient(W * 0.5, H * horizon, 2, W * 0.5, H * horizon, Math.max(W, H) * 0.72);
    g.addColorStop(0, hexA(color, 0.1 + energy * 0.2));
    g.addColorStop(0.4, hexA(color, 0.04 + energy * 0.08));
    g.addColorStop(1, hexA(color, 0));
    return g;
  });
  ctx.fillStyle = pool;
  ctx.fillRect(0, 0, W, H);
}

/**
 * Inner bevel + edge vignette. Draw LAST: it seats the artwork inside the
 * panel instead of letting it float on a flat rectangle.
 */
export function bezel(ctx: Ctx, W: number, H: number, color: string, alpha = 1): void {
  const vig = cachedGrad(ctx, `vig|${W}|${H}`, (c) => {
    const g = c.createRadialGradient(W * 0.5, H * 0.5, Math.min(W, H) * 0.25, W * 0.5, H * 0.5, Math.max(W, H) * 0.78);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(0,0,0,0.55)");
    return g;
  });
  ctx.save();
  ctx.globalAlpha = clamp01(alpha);
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, W, H);
  // Light catches the top lip, shadow pools under the bottom.
  ctx.fillStyle = "rgba(255,255,255,0.055)";
  ctx.fillRect(0, 0, W, 1);
  ctx.fillStyle = "rgba(0,0,0,0.4)";
  ctx.fillRect(0, H - 1, W, 1);
  ctx.fillStyle = hexA(color, 0.09);
  ctx.fillRect(0, 0, 1, H);
  ctx.fillRect(W - 1, 0, 1, H);
  ctx.restore();
}

/** Glass sheen sweeping the upper third — reads as a curved cover. */
export function sheen(ctx: Ctx, W: number, H: number, alpha = 0.06): void {
  const g = cachedGrad(ctx, `sheen|${W}|${H}`, (c) => {
    const lg = c.createLinearGradient(0, 0, W * 0.65, H * 0.5);
    lg.addColorStop(0, "rgba(255,255,255,0.11)");
    lg.addColorStop(0.5, "rgba(255,255,255,0.02)");
    lg.addColorStop(1, "rgba(255,255,255,0)");
    return lg;
  });
  ctx.save();
  ctx.globalAlpha = clamp01(alpha) / 0.06 * 0.6;
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(W, 0);
  ctx.lineTo(W, H * 0.3);
  ctx.quadraticCurveTo(W * 0.5, H * 0.46, 0, H * 0.26);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** Static film grain via one cached 64px tile. Adds tooth to flat gradients. */
export function grain(ctx: Ctx, W: number, H: number, amount = 0.035): void {
  if (amount <= 0.002) return;
  const p = cachedPattern(ctx, "grain64", () => {
    const c = document.createElement("canvas");
    c.width = 64;
    c.height = 64;
    const g = c.getContext("2d");
    if (g) {
      const img = g.createImageData(64, 64);
      for (let i = 0; i < img.data.length; i += 4) {
        const v = 128 + ((Math.random() * 2 - 1) * 64);
        img.data[i] = v;
        img.data[i + 1] = v;
        img.data[i + 2] = v;
        img.data[i + 3] = 255;
      }
      g.putImageData(img, 0, 0);
    }
    return c;
  });
  if (!p) return;
  ctx.save();
  ctx.globalCompositeOperation = "overlay";
  ctx.globalAlpha = clamp01(amount);
  ctx.fillStyle = p;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

/** CRT scanlines — cached tile, `spacing` px apart. */
export function scanlines(ctx: Ctx, W: number, H: number, alpha = 0.06, spacing = 3): void {
  if (alpha <= 0.002) return;
  const s = Math.max(2, Math.min(8, Math.round(spacing)));
  const p = cachedPattern(ctx, `scan${s}`, () => {
    const c = document.createElement("canvas");
    c.width = 2;
    c.height = s;
    const g = c.getContext("2d");
    if (g) {
      g.fillStyle = "rgba(0,0,0,1)";
      g.fillRect(0, 0, 2, 1);
    }
    return c;
  });
  if (!p) return;
  ctx.save();
  ctx.globalAlpha = clamp01(alpha);
  ctx.fillStyle = p;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

/**
 * Receding depth planes — the cheapest way to turn a flat 2D readout into a
 * space with distance. `count` planes fade and compress toward the horizon.
 */
export function strata(
  ctx: Ctx,
  W: number,
  H: number,
  color: string,
  opts?: { count?: number; horizon?: number; alpha?: number; skew?: number },
): void {
  const n = Math.max(2, Math.min(14, opts?.count ?? 7));
  const hz = (opts?.horizon ?? 0.34) * H;
  const a = opts?.alpha ?? 0.14;
  const skew = opts?.skew ?? 0;
  ctx.save();
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    // Perspective compression: planes bunch up as they approach the horizon.
    const y = hz + Math.pow(t, 1.9) * (H - hz);
    const fade = a * (0.25 + t * 0.75);
    ctx.strokeStyle = hexA(color, fade);
    ctx.lineWidth = 0.5 + t * 0.9;
    ctx.beginPath();
    ctx.moveTo(-skew * (1 - t), y);
    ctx.lineTo(W + skew * (1 - t), y);
    ctx.stroke();
  }
  ctx.restore();
}

/** Perspective side rails converging on a vanishing point. */
export function railsToHorizon(
  ctx: Ctx,
  W: number,
  H: number,
  color: string,
  opts?: { count?: number; horizon?: number; alpha?: number },
): void {
  const n = Math.max(2, Math.min(24, opts?.count ?? 9));
  const hz = (opts?.horizon ?? 0.34) * H;
  const a = opts?.alpha ?? 0.1;
  ctx.save();
  ctx.strokeStyle = hexA(color, a);
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  for (let i = 0; i <= n; i++) {
    const x = (i / n) * W;
    ctx.moveTo(x, H);
    ctx.lineTo(W * 0.5 + (x - W * 0.5) * 0.06, hz);
  }
  ctx.stroke();
  ctx.restore();
}

/** Dot lattice — quiet texture for pads and matrices. */
export function lattice(ctx: Ctx, W: number, H: number, color: string, step = 12, alpha = 0.1): void {
  const s = Math.max(4, Math.round(step));
  const p = cachedPattern(ctx, `dot${s}|${color}`, () => {
    const c = document.createElement("canvas");
    c.width = s;
    c.height = s;
    const g = c.getContext("2d");
    if (g) {
      g.fillStyle = color;
      g.fillRect(0, 0, 1, 1);
    }
    return c;
  });
  if (!p) return;
  ctx.save();
  ctx.globalAlpha = clamp01(alpha);
  ctx.fillStyle = p;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

// ── labelling ────────────────────────────────────────────────────────────

/**
 * Reserved top strip.
 *
 * Every stage renders DOM text OVER the canvas — a character eyebrow pinned
 * top-left and a status readout top-right — so canvas telemetry drawn in the
 * top corners collides with it. Headless canvas renders can't show that, so
 * treat these as hard margins: start a top label row at `VIZ_TOP_LABEL_X` and
 * keep the right end clear of `VIZ_TOP_RESERVE_R`.
 */
export const VIZ_TOP_LABEL_X = 132;
export const VIZ_TOP_LABEL_Y = 16;
export const VIZ_TOP_RESERVE_R = 110;

/** Telemetry type face — one voice for every module's readouts. */
export const VIZ_FONT_LABEL = "800 8px ui-sans-serif, system-ui, sans-serif";
export const VIZ_FONT_VALUE = "700 9px ui-monospace, SFMono-Regular, Menlo, monospace";
export const VIZ_FONT_TITLE = "900 9px ui-sans-serif, system-ui, sans-serif";

/**
 * Bottom-left signature + bottom-right status, the shared footer every stage
 * carries. Returns nothing; draws with the standard fonts and insets.
 */
export function footer(
  ctx: Ctx,
  W: number,
  H: number,
  left: string,
  right: string,
  color: string,
  rightColor?: string,
): void {
  const grad = cachedGrad(ctx, `foot|${W}|${H}`, (c) => {
    const g = c.createLinearGradient(0, H - 18, 0, H);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(0,0,0,0.55)");
    return g;
  });
  ctx.fillStyle = grad;
  ctx.fillRect(0, H - 18, W, 18);
  ctx.font = VIZ_FONT_TITLE;
  ctx.textAlign = "left";
  ctx.fillStyle = hexA(color, 0.82);
  ctx.fillText(left, 11, H - 5);
  if (right) {
    ctx.font = VIZ_FONT_VALUE;
    ctx.textAlign = "right";
    ctx.fillStyle = hexA(rightColor ?? color, 0.85);
    ctx.fillText(right, W - 11, H - 5);
  }
}

/** Rounded-rect path helper (no allocation beyond the path itself). */
export function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w * 0.5, h * 0.5);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** Small caps status pill — used for the mode chip most stages carry. */
export function pill(
  ctx: Ctx,
  cx: number,
  y: number,
  text: string,
  color: string,
  opts?: { glow?: number; height?: number },
): void {
  ctx.font = VIZ_FONT_LABEL;
  const w = ctx.measureText(text).width + 14;
  const h = opts?.height ?? 13;
  const x = cx - w * 0.5;
  ctx.fillStyle = "rgba(0,0,0,0.6)";
  roundRect(ctx, x, y, w, h, h * 0.5);
  ctx.fill();
  ctx.strokeStyle = hexA(color, 0.5 + (opts?.glow ?? 0) * 0.4);
  ctx.lineWidth = 1;
  roundRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, (h - 1) * 0.5);
  ctx.stroke();
  ctx.fillStyle = hexA(color, 0.96);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, cx, y + h * 0.5 + 0.5);
  ctx.textBaseline = "alphabetic";
}
