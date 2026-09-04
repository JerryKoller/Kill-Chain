/**
 * Deterministic preservation guard for the SINGULARITY visualizer.
 *
 * History says this is necessary. In the sequential repair benchmark the local
 * worker "fixed" a file by deleting 1233 lines including the feature it was
 * asked to preserve, and the harness scored it as a success until a guard was
 * added. A creative mission with genuine freedom needs the same protection:
 * Robo Puppy may change how Singularity LOOKS, but not stop it being
 * Singularity.
 *
 * Every check is mechanical. None of them judge aesthetics.
 */

/** Structural facts that define Singularity as a Kill Chain renderer. */
const REQUIRED = [
  {
    id: "export-factory",
    why: "modeFactory.ts calls createSingularity(pal); losing it breaks the mode registry",
    test: (src) => /export\s+function\s+createSingularity\s*\(/.test(src),
  },
  {
    id: "moderenderer-resize",
    why: "ModeRenderer contract requires resize(W, H)",
    test: (src) => /\bresize\s*[(:]/.test(src),
  },
  {
    id: "moderenderer-draw",
    why: "ModeRenderer contract requires draw(frame)",
    test: (src) => /\bdraw\s*[(:]/.test(src),
  },
  {
    id: "dispose-gpu",
    why: "WebGL resources must be releasable; dispose() is how the overlay tears the mode down",
    test: (src) => /\bdispose\s*[(:]/.test(src),
  },
  {
    id: "webgl2-context",
    why: "Singularity is the WebGL2 renderer; dropping the context request changes what it is",
    test: (src) => /webgl2/i.test(src),
  },
  {
    id: "fallback-path",
    why: "documented behaviour: it must degrade to a 2D core rather than render nothing when WebGL2 is unavailable",
    test: (src) => /fallback/i.test(src),
  },
  {
    id: "audio-reactive",
    why: "it must stay driven by the shared VisualIntel snapshot, not run its own detectors",
    test: (src) => /\bintel\b/.test(src),
  },
  {
    id: "pixel-budget",
    why: "the internal resolution cap is what keeps it from melting a laptop GPU",
    test: (src) => /MAX_PIXELS/.test(src),
  },
];

/**
 * Things that must not appear. Robo Puppy owning the shader is fine; Robo
 * Puppy reaching into audio or state from a visualizer is not.
 */
const FORBIDDEN = [
  { id: "audio-engine", re: /\bAudioEngine\b|from\s+["']@?\/?.*audio\/AudioEngine/, why: "visualizers never touch the engine" },
  { id: "claim-source", re: /\bclaimSource\b/, why: "playback ownership is not a visualizer concern" },
  { id: "rewire-front", re: /\brewireFront\b/, why: "front routing is not a visualizer concern" },
  { id: "own-analyser", re: /createAnalyser\s*\(|new\s+AnalyserNode/, why: "one high-rate FFT pipeline; renderers consume intel, they do not analyse" },
  { id: "store-write", re: /useVisualizerStore\.setState|localStorage\.setItem/, why: "a renderer must not write app state or persistence" },
  { id: "new-dependency", re: /^\s*import\s+[^;]*from\s+["'](?!\.\/|\.\.\/|@\/)[a-z@]/m, why: "no new third-party dependency inside the visualizer" },
];

/**
 * Check a candidate `singularity.ts` body.
 * @param {string} source
 * @param {object} [o]
 * @param {string} [o.baseline] the pre-mission source, for size comparison
 */
export function checkSingularity(source, { baseline = null } = {}) {
  const src = String(source || "");
  const missing = REQUIRED.filter((r) => !r.test(src)).map((r) => ({ id: r.id, why: r.why }));
  const forbidden = FORBIDDEN.filter((f) => f.re.test(src)).map((f) => ({ id: f.id, why: f.why }));

  // Shader stages. Singularity's documented pipeline is scene -> bright ->
  // blur -> composite. Losing the scene or composite stage means it is no
  // longer the same renderer; losing bloom is a legitimate creative choice.
  const stages = {
    scene: /FS_SCENE|fsScene/.test(src),
    bright: /FS_BRIGHT|fsBright/.test(src),
    blur: /FS_BLUR|fsBlur/.test(src),
    composite: /FS_COMPOSITE|fsComposite/.test(src),
  };
  if (!stages.scene) missing.push({ id: "shader-scene", why: "the scene pass is the renderer itself" });
  if (!stages.composite) missing.push({ id: "shader-composite", why: "the composite pass is what reaches the host canvas" });

  const lines = src.split(/\r?\n/).length;
  const baseLines = baseline ? String(baseline).split(/\r?\n/).length : null;
  // A creative rewrite may legitimately shrink the file, but a collapse to a
  // fraction of its size is the deletion failure mode, not a redesign.
  const collapsed = baseLines ? lines < baseLines * 0.5 : false;

  const errors = [
    ...missing.map((m) => `missing:${m.id} (${m.why})`),
    ...forbidden.map((f) => `forbidden:${f.id} (${f.why})`),
  ];
  if (collapsed) errors.push(`collapsed: ${lines} lines vs baseline ${baseLines} — more than half the renderer was deleted`);

  return {
    ok: errors.length === 0,
    errors,
    missing,
    forbidden,
    stages,
    lines,
    baseLines,
    collapsed,
  };
}

/** Human-readable rejection note for the mission journal / correction packet. */
export function formatSingularityGuard(result) {
  if (result.ok) {
    return `SINGULARITY GUARD: PASS (${result.lines} lines, stages: ${Object.entries(result.stages).filter(([, v]) => v).map(([k]) => k).join("+") || "none"})`;
  }
  return [
    "SINGULARITY GUARD: REJECTED",
    "",
    "This candidate no longer satisfies what makes Singularity itself.",
    "Restore the missing behaviour; do not delete more to make the error go away.",
    "",
    ...result.errors.map((e) => `- ${e}`),
  ].join("\n");
}
