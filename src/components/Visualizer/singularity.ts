/**
 * SINGULARITY — the v1.8 flagship visualizer: a raymarched energy core in a
 * turbulent void, rendered on a private WebGL2 canvas and blitted into the
 * shared 2D canvas each frame (so it participates in the normal mode system
 * and Cinema Lock crossfades like every other renderer).
 *
 * Pipeline (all offscreen, internal resolution capped at ~1.1 MP):
 *   1. scene pass    — raymarched core + shock rings + void swirl → FBO
 *   2. bright pass   — threshold + downsample to 1/4 res
 *   3. blur passes   — separable gaussian H then V (real bloom)
 *   4. composite     — scene + bloom with radial chromatic aberration,
 *                      grain and vignette → canvas, then drawImage → host
 *
 * Audio mapping (all from the shared VisualIntel snapshot):
 *   loudness        → forward flow speed + camera push-in
 *   bass / kick     → core radius impact + shock ring spawns
 *   hi transients   → bloom boost + chromatic aberration bursts
 *   stereo width    → camera sway/roll + turbulence
 *   track palette   → core / ring / glow colour temperature
 *   section energy  → overall scene intensity
 *
 * If WebGL2 is unavailable (or the context is lost) the mode degrades to a
 * simple 2D pulsing-core fallback so it never renders a black hole of
 * nothing.
 */

import type { ModeRenderer, RenderFrame, ThemePalette } from "./renderers";

// v2.2 — the internal budget now targets DEVICE pixels (the host canvas is
// DPR-scaled, so rendering at CSS resolution looked soft on hi-dpi displays).
const MAX_PIXELS = 2_400_000; // internal render budget (device px)
const RINGS = 4;

// ── shaders ──────────────────────────────────────────────────────────────────

const VS_QUAD = `#version 300 es
layout(location=0) in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FS_SCENE = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outCol;

uniform vec2 uRes;
uniform float uTime;    // wall-clock seconds (slow drifts)
uniform float uFlow;    // loudness-integrated travel through the noise field
uniform float uLoud;    // 0..1 smoothed loudness
uniform float uBass;    // 0..1 low-band energy
uniform float uKick;    // kick impact envelope (fast decay)
uniform float uWidth;   // 0..1 stereo width
uniform float uEnergy;  // 0..1 section energy
uniform float uBeat;    // legacy beat envelope
uniform float uBeatPh;  // 0..1 phase within the current beat (BPM-locked)
uniform float uBarPh;   // 0..1 phase within the current bar
uniform float uMode;    // 0 calm … 1 drop — structural morph
uniform vec3 uColA;     // core colour
uniform vec3 uColB;     // ring / void colour
uniform vec3 uColC;     // hot glow accent
uniform vec4 uRings;    // shock ring ages 0..1 (>=1 dead)

float hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float noise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x),
        mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x),
        mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}
float fbm(vec3 p) {
  float a = 0.5;
  float s = 0.0;
  for (int i = 0; i < 4; i++) {
    s += a * noise(p);
    p = p * 2.03 + vec3(1.7, 9.2, 3.1);
    a *= 0.5;
  }
  return s;
}

void main() {
  vec2 uv = (vUv * uRes - 0.5 * uRes) / uRes.y;

  // camera: pushed in by loudness, swayed + rolled by stereo width
  float sway = uWidth * 0.4;
  vec3 ro = vec3(
    sin(uTime * 0.23) * sway,
    cos(uTime * 0.17) * sway * 0.7,
    3.6 - uLoud * 1.1 - uEnergy * 0.35);
  vec3 rd = normalize(vec3(uv, -1.55));
  float roll = sin(uTime * 0.11) * uWidth * 0.35;
  float cr = cos(roll), sr = sin(roll);
  rd.xy = mat2(cr, -sr, sr, cr) * rd.xy;

  // Beat-locked breathing: a decaying thump right after every beat tick, so
  // the core visibly pumps with the tempo even between kick onsets.
  float thump = exp(-uBeatPh * 4.5) * 0.09;
  float coreR = 0.68 + uBass * 0.24 + uKick * 0.22 + thump;
  // uMode morphs the structure: calm = smooth plasma shell, drop = jagged
  // high-frequency filaments with deeper turbulence.
  float turb = 0.30 + uWidth * 0.40 + uEnergy * 0.20 + uMode * 0.30;
  float nScale = 1.55 + uMode * 0.85;

  // Orbiting satellites: two hot fragments circle the core, their orbital
  // position hard-locked to the bar phase (one lap per bar / per two bars).
  float sa1 = uBarPh * 6.2831853;
  float sa2 = -uBarPh * 3.1415927 + 2.1;
  vec3 sat1 = vec3(cos(sa1), sin(sa1 * 0.7) * 0.4, sin(sa1)) * (coreR + 0.85);
  vec3 sat2 = vec3(cos(sa2), sin(sa2 * 0.9) * 0.5, sin(sa2)) * (coreR + 1.35);

  // ── raymarch the core (glow-accumulating march) ──
  vec3 col = vec3(0.0);
  float t = 0.0;
  for (int i = 0; i < 44; i++) {
    vec3 p = ro + rd * t;
    float r = length(p);
    float n = fbm(p * nScale + vec3(0.0, 0.0, -uFlow));
    float d = r - (coreR + (n - 0.5) * turb);
    float glow = exp(-abs(d) * 3.4);
    col += uColA * glow * 0.030 * (1.0 + uKick * 1.6);
    col += uColC * exp(-r * 2.4) * 0.011 * (1.0 + uBass * 1.6);
    // satellite glows (cheap point-glow accumulation)
    float ds1 = length(p - sat1);
    float ds2 = length(p - sat2);
    col += uColC * exp(-ds1 * 7.0) * 0.05 * (0.5 + uEnergy);
    col += uColB * exp(-ds2 * 8.0) * 0.04 * (0.5 + uEnergy);
    if (d < 0.015) {
      // emissive shell — filaments carved by the noise
      float fil = smoothstep(0.35, 0.75, n);
      col += mix(uColA, uColC, fil) * (0.40 + n * 0.65) * (0.60 + uKick * 1.1);
      break;
    }
    t += max(0.045, d * 0.65);
    if (t > 9.0) break;
  }

  // ── shock rings in the core plane (z = 0), kicked by bass hits ──
  if (rd.z < -0.05) {
    float tp = -ro.z / rd.z;
    vec3 pp = ro + rd * tp;
    float rr = length(pp.xy);
    float ring = 0.0;
    for (int i = 0; i < 4; i++) {
      float age = uRings[i];
      if (age >= 1.0) continue;
      float ringR = coreR * 1.15 + age * 4.6;
      float w = 0.05 + age * 0.22;
      float q = (rr - ringR) / w;
      ring += exp(-q * q) * (1.0 - age) * (1.0 - age);
    }
    col += uColB * ring * 0.70;
    col += vec3(1.0) * ring * 0.06;
    // accretion disc: spiral arms sweeping with the bar phase
    float pa = atan(pp.y, pp.x);
    float arm = sin(pa * 3.0 - uBarPh * 6.2831853 - rr * 2.2) * 0.5 + 0.5;
    float acc = exp(-abs(rr - coreR * 1.7) * 1.4) * (0.05 + arm * 0.10) * (0.4 + uEnergy);
    col += uColB * acc;
  }

  // ── void swirl backdrop ──
  float ang = atan(uv.y, uv.x);
  float rad = length(uv);
  float swirl = fbm(vec3(uv * 2.6, uTime * 0.04) + vec3(ang * 0.6 + uFlow * 0.06, 0.0, 0.0));
  vec3 bg = mix(uColB * 0.10, uColA * 0.20, swirl)
          * smoothstep(0.12, 0.95, rad)
          * (0.30 + uEnergy * 0.55 + uBeat * 0.15);
  col += bg;

  // pin-prick stars streaking with flow
  float star = hash(vec3(floor(uv * 90.0), floor(uFlow * 2.0)));
  if (star > 0.9965) col += vec3(0.5, 0.6, 0.7) * (star - 0.9965) * 150.0 * (0.3 + uLoud);

  outCol = vec4(col, 1.0);
}`;

const FS_BRIGHT = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outCol;
uniform sampler2D uTex;
uniform float uThresh;
void main() {
  vec3 c = texture(uTex, vUv).rgb;
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  outCol = vec4(c * smoothstep(uThresh, uThresh + 0.35, l), 1.0);
}`;

const FS_BLUR = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outCol;
uniform sampler2D uTex;
uniform vec2 uDir; // (1/w, 0) or (0, 1/h)
void main() {
  vec3 s = texture(uTex, vUv).rgb * 0.227027;
  s += texture(uTex, vUv + uDir * 1.3846).rgb * 0.316216;
  s += texture(uTex, vUv - uDir * 1.3846).rgb * 0.316216;
  s += texture(uTex, vUv + uDir * 3.2308).rgb * 0.070270;
  s += texture(uTex, vUv - uDir * 3.2308).rgb * 0.070270;
  outCol = vec4(s, 1.0);
}`;

const FS_COMPOSITE = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outCol;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform float uBloomK;
uniform float uAberr;  // chromatic aberration strength (uv units)
uniform float uTime;
void main() {
  vec2 dir = vUv - 0.5;
  float k = uAberr;
  vec3 c;
  c.r = texture(uScene, vUv + dir * k * 1.6).r;
  c.g = texture(uScene, vUv).g;
  c.b = texture(uScene, vUv - dir * k * 1.4).b;
  vec3 b;
  b.r = texture(uBloom, vUv + dir * k * 2.4).r;
  b.g = texture(uBloom, vUv).g;
  b.b = texture(uBloom, vUv - dir * k * 2.1).b;
  c += b * uBloomK;
  // vignette + subtle animated grain
  float vig = 1.0 - dot(dir, dir) * 0.85;
  c *= max(0.0, vig);
  float grain = fract(sin(dot(vUv * uTime, vec2(12.9898, 78.233))) * 43758.5453);
  c += (grain - 0.5) * 0.012;
  // filmic-style tone map — rolls highlights off softly so the core reads
  // as HOT without white-washing the whole frame (the old curve clipped).
  c = 1.0 - exp(-c * 1.15);
  outCol = vec4(c, 1.0);
}`;

// ── GL plumbing ──────────────────────────────────────────────────────────────

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader | null {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.warn("[singularity] shader compile failed:", gl.getShaderInfoLog(sh));
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

function link(gl: WebGL2RenderingContext, fs: string): WebGLProgram | null {
  const v = compile(gl, gl.VERTEX_SHADER, VS_QUAD);
  const f = compile(gl, gl.FRAGMENT_SHADER, fs);
  if (!v || !f) return null;
  const p = gl.createProgram();
  if (!p) return null;
  gl.attachShader(p, v);
  gl.attachShader(p, f);
  gl.linkProgram(p);
  gl.deleteShader(v);
  gl.deleteShader(f);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    console.warn("[singularity] program link failed:", gl.getProgramInfoLog(p));
    gl.deleteProgram(p);
    return null;
  }
  return p;
}

interface Target {
  fbo: WebGLFramebuffer;
  tex: WebGLTexture;
  w: number;
  h: number;
}

function makeTarget(gl: WebGL2RenderingContext, w: number, h: number): Target | null {
  const tex = gl.createTexture();
  const fbo = gl.createFramebuffer();
  if (!tex || !fbo) return null;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { fbo, tex, w, h };
}

// ── the renderer ─────────────────────────────────────────────────────────────

export function createSingularity(pal: ThemePalette): ModeRenderer {
  const canvas = document.createElement("canvas");
  let gl: WebGL2RenderingContext | null = null;
  try {
    gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: "high-performance",
    });
  } catch {
    gl = null;
  }

  let failed = !gl;
  canvas.addEventListener("webglcontextlost", (e) => {
    e.preventDefault();
    failed = true;
  });

  let progScene: WebGLProgram | null = null;
  let progBright: WebGLProgram | null = null;
  let progBlur: WebGLProgram | null = null;
  let progComp: WebGLProgram | null = null;
  let sceneT: Target | null = null;
  let brightT: Target | null = null;
  let blurA: Target | null = null;
  let blurB: Target | null = null;
  // uniform locations (scene)
  let uLoc: Record<string, WebGLUniformLocation | null> = {};

  if (gl) {
    progScene = link(gl, FS_SCENE);
    progBright = link(gl, FS_BRIGHT);
    progBlur = link(gl, FS_BLUR);
    progComp = link(gl, FS_COMPOSITE);
    if (!progScene || !progBright || !progBlur || !progComp) {
      failed = true;
    } else {
      const quad = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, quad);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([-1, -1, 3, -1, -1, 3]),
        gl.STATIC_DRAW,
      );
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      uLoc = {
        sRes: gl.getUniformLocation(progScene, "uRes"),
        sTime: gl.getUniformLocation(progScene, "uTime"),
        sFlow: gl.getUniformLocation(progScene, "uFlow"),
        sLoud: gl.getUniformLocation(progScene, "uLoud"),
        sBass: gl.getUniformLocation(progScene, "uBass"),
        sKick: gl.getUniformLocation(progScene, "uKick"),
        sWidth: gl.getUniformLocation(progScene, "uWidth"),
        sEnergy: gl.getUniformLocation(progScene, "uEnergy"),
        sBeat: gl.getUniformLocation(progScene, "uBeat"),
        sBeatPh: gl.getUniformLocation(progScene, "uBeatPh"),
        sBarPh: gl.getUniformLocation(progScene, "uBarPh"),
        sMode: gl.getUniformLocation(progScene, "uMode"),
        sColA: gl.getUniformLocation(progScene, "uColA"),
        sColB: gl.getUniformLocation(progScene, "uColB"),
        sColC: gl.getUniformLocation(progScene, "uColC"),
        sRings: gl.getUniformLocation(progScene, "uRings"),
        bTex: gl.getUniformLocation(progBright, "uTex"),
        bThresh: gl.getUniformLocation(progBright, "uThresh"),
        uTex: gl.getUniformLocation(progBlur, "uTex"),
        uDir: gl.getUniformLocation(progBlur, "uDir"),
        cScene: gl.getUniformLocation(progComp, "uScene"),
        cBloom: gl.getUniformLocation(progComp, "uBloom"),
        cBloomK: gl.getUniformLocation(progComp, "uBloomK"),
        cAberr: gl.getUniformLocation(progComp, "uAberr"),
        cTime: gl.getUniformLocation(progComp, "uTime"),
      };
    }
  }

  // audio-driven CPU state
  let flow = 0;          // loudness-integrated travel
  let kickEnv = 0;       // core impact envelope
  let hiEnv = 0;         // transient burst envelope (bloom + aberration)
  let loudSm = 0;
  let modeSm = 0.35;     // smoothed structural morph (section-driven)
  const ringAges = new Float32Array(RINGS).fill(1);
  let ringCursor = 0;

  let glW = 0;
  let glH = 0;

  const allocTargets = (w: number, h: number): void => {
    if (!gl) return;
    sceneT = makeTarget(gl, w, h);
    const bw = Math.max(8, w >> 2);
    const bh = Math.max(8, h >> 2);
    brightT = makeTarget(gl, bw, bh);
    blurA = makeTarget(gl, bw, bh);
    blurB = makeTarget(gl, bw, bh);
    if (!sceneT || !brightT || !blurA || !blurB) failed = true;
  };

  const fallbackPulse = (f: RenderFrame): void => {
    // WebGL2 missing: minimal 2D core so the mode still lives
    const { g, W, H } = f;
    g.fillStyle = "rgba(4,5,10,0.35)";
    g.fillRect(0, 0, W, H);
    const cx = W / 2;
    const cy = H / 2;
    const r = Math.min(W, H) * (0.12 + f.low * 0.1 + f.beat * 0.05);
    const c = f.intel.colA;
    const grad = g.createRadialGradient(cx, cy, 0, cx, cy, r * 3);
    grad.addColorStop(0, `rgba(${c[0]},${c[1]},${c[2]},0.85)`);
    grad.addColorStop(0.35, `rgba(${c[0]},${c[1]},${c[2]},0.25)`);
    grad.addColorStop(1, "rgba(4,5,10,0)");
    g.fillStyle = grad;
    g.beginPath();
    g.arc(cx, cy, r * 3, 0, Math.PI * 2);
    g.fill();
    g.font = `10px JetBrains Mono, monospace`;
    g.textAlign = "center";
    g.fillStyle = `rgba(${pal.cyan[0]},${pal.cyan[1]},${pal.cyan[2]},0.45)`;
    g.fillText("SINGULARITY — WEBGL2 UNAVAILABLE, RUNNING FALLBACK CORE", cx, H - 24);
  };

  return {
    resize(W: number, H: number) {
      if (!gl || failed) return;
      // Target the host's DEVICE pixels (the shared canvas is DPR-scaled) so
      // the blit doesn't upscale a soft image, then clamp to the budget.
      const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
      const devW = W * dpr;
      const devH = H * dpr;
      const scale = Math.min(1, Math.sqrt(MAX_PIXELS / Math.max(1, devW * devH)));
      glW = Math.max(64, Math.round(devW * scale));
      glH = Math.max(64, Math.round(devH * scale));
      canvas.width = glW;
      canvas.height = glH;
      allocTargets(glW, glH);
    },

    draw(f: RenderFrame) {
      const it = f.intel;
      const dt = f.dt;

      // envelopes
      loudSm += (Math.min(1, f.rms * 2.8) - loudSm) * (1 - Math.exp(-dt / 0.2));
      flow += dt * (0.25 + loudSm * 2.4) * (f.reduced ? 0.4 : 1);
      if (it.kickHit) {
        kickEnv = 1;
        ringAges[ringCursor] = 0;
        ringCursor = (ringCursor + 1) % RINGS;
      }
      kickEnv *= Math.exp(-dt * 6);
      const hiTarget = Math.max(it.hat, it.snare * 0.6);
      hiEnv = Math.max(hiEnv * Math.exp(-dt * 5), hiTarget);
      for (let i = 0; i < RINGS; i++) {
        if (ringAges[i] < 1) ringAges[i] = Math.min(1, ringAges[i] + dt * (0.55 + loudSm * 0.5));
      }

      if (failed || !gl || !sceneT || !brightT || !blurA || !blurB) {
        fallbackPulse(f);
        return;
      }

      const timeS = f.now / 1000;

      // ── pass 1: scene ──
      gl.bindFramebuffer(gl.FRAMEBUFFER, sceneT.fbo);
      gl.viewport(0, 0, sceneT.w, sceneT.h);
      gl.useProgram(progScene);
      gl.uniform2f(uLoc.sRes, sceneT.w, sceneT.h);
      gl.uniform1f(uLoc.sTime, timeS);
      gl.uniform1f(uLoc.sFlow, flow);
      gl.uniform1f(uLoc.sLoud, loudSm);
      gl.uniform1f(uLoc.sBass, f.low);
      gl.uniform1f(uLoc.sKick, kickEnv);
      gl.uniform1f(uLoc.sWidth, it.width);
      gl.uniform1f(uLoc.sEnergy, it.energy);
      gl.uniform1f(uLoc.sBeat, f.beat);
      // BPM-locked phases (fall back to a slow free-run when no tempo lock,
      // so the breathing/orbits never freeze).
      const tempoLocked = it.bpm > 0 && it.bpmConf > 0.25;
      gl.uniform1f(uLoc.sBeatPh, tempoLocked ? it.beatPhase : (timeS * 0.9) % 1);
      gl.uniform1f(uLoc.sBarPh, tempoLocked ? it.barPhase : (timeS * 0.11) % 1);
      // Structural morph: drops & buildups sharpen the core into filaments.
      const modeTarget =
        it.section === "drop" ? 1 : it.section === "buildup" ? 0.6 :
        it.section === "breakdown" ? 0.15 : 0.35;
      modeSm += (modeTarget - modeSm) * (1 - Math.exp(-dt / 0.8));
      gl.uniform1f(uLoc.sMode, modeSm);
      gl.uniform3f(uLoc.sColA, it.colA[0] / 255, it.colA[1] / 255, it.colA[2] / 255);
      gl.uniform3f(uLoc.sColB, it.colB[0] / 255, it.colB[1] / 255, it.colB[2] / 255);
      gl.uniform3f(uLoc.sColC, it.colC[0] / 255, it.colC[1] / 255, it.colC[2] / 255);
      gl.uniform4f(uLoc.sRings, ringAges[0], ringAges[1], ringAges[2], ringAges[3]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      // ── pass 2: bright extract (into quarter-res) ──
      gl.bindFramebuffer(gl.FRAMEBUFFER, brightT.fbo);
      gl.viewport(0, 0, brightT.w, brightT.h);
      gl.useProgram(progBright);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, sceneT.tex);
      gl.uniform1i(uLoc.bTex, 0);
      gl.uniform1f(uLoc.bThresh, 0.68 - hiEnv * 0.12);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      // ── pass 3: separable blur H → V ──
      gl.useProgram(progBlur);
      gl.uniform1i(uLoc.uTex, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, blurA.fbo);
      gl.viewport(0, 0, blurA.w, blurA.h);
      gl.bindTexture(gl.TEXTURE_2D, brightT.tex);
      gl.uniform2f(uLoc.uDir, 1 / blurA.w, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindFramebuffer(gl.FRAMEBUFFER, blurB.fbo);
      gl.viewport(0, 0, blurB.w, blurB.h);
      gl.bindTexture(gl.TEXTURE_2D, blurA.tex);
      gl.uniform2f(uLoc.uDir, 0, 1 / blurB.h);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      // ── pass 4: composite to the GL canvas ──
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, glW, glH);
      gl.useProgram(progComp);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, sceneT.tex);
      gl.uniform1i(uLoc.cScene, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, blurB.tex);
      gl.uniform1i(uLoc.cBloom, 1);
      gl.uniform1f(uLoc.cBloomK, 0.55 + hiEnv * 0.55 + kickEnv * 0.25);
      gl.uniform1f(uLoc.cAberr, (f.reduced ? 0.002 : 0.005) + hiEnv * 0.011 + it.engagePulse * 0.008);
      gl.uniform1f(uLoc.cTime, timeS % 100);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      // blit into the shared 2D canvas
      f.g.drawImage(canvas, 0, 0, f.W, f.H);
    },
  };
}
