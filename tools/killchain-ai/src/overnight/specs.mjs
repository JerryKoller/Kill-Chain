import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { missionsSpecDir } from "../paths.mjs";
import { DIAGNOSTIC_SENTENCE, SINGULARITY_REL } from "./yard.mjs";
import { sanitizeGlText } from "./probeShape.mjs";

const PARKED = [
  "src/components/FireCommand/GatePanel.tsx",
  "src/components/FireCommand/MacroPanel.tsx",
  "src/components/FireCommand/ModuleEnableToggle.tsx",
];

const FORBIDDEN = [
  "src/audio/**",
  "src/state/**",
  "src/lib/sourceArbiter.ts",
  "electron/**",
  "package.json",
  "package-lock.json",
  "src/components/FireCommand/**",
  "src/components/Playground/**",
  "src/components/Visualizer/renderers.ts",
  "src/components/Visualizer/modeFactory.ts",
  "src/components/Visualizer/VisualizerOverlay.tsx",
  "src/components/Visualizer/visualIntel.ts",
];

const READ_ONLY = [
  "src/components/Visualizer/renderers.ts",
  "src/components/Visualizer/modeFactory.ts",
  "src/components/Visualizer/VisualizerOverlay.tsx",
  "src/components/Visualizer/visualIntel.ts",
  "src/components/Visualizer/director.ts",
  "src/components/Visualizer/lumaKey.ts",
  "src/state/visualizerStore.ts",
];

function yaml(obj) {
  return JSON.stringify(obj, null, 2);
}

function commonFront(over) {
  return {
    level: 1,
    model: "ollama/qwen3.5:9b",
    allowedPaths: [SINGULARITY_REL],
    adoptDirtyPaths: [SINGULARITY_REL],
    readOnlyPaths: READ_ONLY,
    preserveDirtyPaths: PARKED,
    forbiddenPaths: FORBIDDEN,
    validation: { required: ["typecheck", "build"], optional: [], restoreTsbuildinfo: true },
    maxPhases: 1,
    maxRetriesPerPhase: 1,
    maxWallClockMs: 2700000,
    sessionTimeoutMs: 900000,
    proposalRounds: 1,
    checkpointPolicy: "state-only",
    commitPolicy: "none",
    corpus: "if-stale",
    diff: { maxFiles: 1, maxInsertions: 400, warnOnly: true },
    ...over,
  };
}

export function writeMissionMarkdown(id, { front, body }) {
  const spec = { id, ...commonFront(front) };
  const text = `---\n${yaml(spec)}\n---\n\n${body.trim()}\n`;
  const out = join(missionsSpecDir, `${id}.md`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, text, "utf8");
  return out;
}

export function p1FallbackMission({ id = "singularity-night-p1-fallback" } = {}) {
  return writeMissionMarkdown(id, {
    front: {
      title: "SINGULARITY — remove fallback diagnostic sentence",
      goal: "The persistent fallback diagnostic sentence visually conflicts with the shared Kill Chain visualizer presentation. Remove that visual clutter locally within singularity.ts while preserving fallback behavior.",
      adoptCheckpoint: "singularity-visual-overhaul/checkpoints/01",
      maxModelCalls: 16,
      acceptance: [
        "The fallback drawing path still exists and still draws a visible core",
        "The persistent diagnostic sentence is no longer painted on the canvas",
        "No additional files were created",
        "createSingularity(pal) still satisfies the ModeRenderer contract",
        "MAX_PIXELS still caps internal resolution",
        "dispose() still releases GPU resources",
        "npm run typecheck passes",
        "npm run build passes",
      ],
    },
    body: `# One job

You are Robo Puppy.

Authorized file: \`${SINGULARITY_REL}\`

The persistent fallback diagnostic sentence visually conflicts with the shared Kill Chain visualizer presentation. Remove that visual clutter locally within singularity.ts while preserving fallback behavior.

The sentence currently painted is:

\`${DIAGNOSTIC_SENTENCE}\`

## Do

- Stop painting that sentence (remove or visually suppress the fillText that draws it).
- Keep the fallback core drawing so the mode is not a blank canvas when fallback runs.
- Keep createSingularity, resize, draw, dispose, the WebGL2 request, and MAX_PIXELS.

## Do not

- Do not create extra files (\`.bak\`, \`.tmp\`, copy.ts, backup.ts, or any other sidecar). The runner already checkpoints.
- Do not edit any other path.
- Do not git commit, push, merge, rebase, or reset.

If your first edit is mechanically invalid, make one bounded repair. If still invalid, stop. Do not expand the job.`,
  });
}

export function p1TeacherMission({ id = "singularity-night-p1-teacher", lineHint = "" } = {}) {
  return writeMissionMarkdown(id, {
    front: {
      title: "SINGULARITY — apply teacher: remove diagnostic fillText",
      goal: "Remove the fillText that paints the fallback diagnostic sentence. Keep fallbackPulse core drawing. No other change.",
      adoptCheckpoint: "singularity-visual-overhaul/checkpoints/01",
      maxModelCalls: 16,
      acceptance: [
        "The diagnostic fillText is gone",
        "fallbackPulse still draws the core",
        "No sidecar files",
        "typecheck and build pass",
      ],
    },
    body: `# Teacher apply — one edit

Authorized file: \`${SINGULARITY_REL}\`

A previous attempt did not remove the diagnostic sentence.

Teacher diagnosis:
The fallback path paints a centered fillText of \`${DIAGNOSTIC_SENTENCE}\`${lineHint ? ` ${lineHint}` : ""}.
Delete that fillText call (and only the text styling that exists solely to support it). Leave the radial core drawing in place.

Do not create backup files. Do not edit other functions unless required to compile.`,
  });
}

export function pipelineRepairMission({ n, stage, log, window, extra = "", id: idIn = "" } = {}) {
  const id = idIn || `singularity-night-p4-r${n}`;
  const logText = sanitizeGlText(log).slice(0, 1800);
  const windowText = sanitizeGlText(window).slice(0, 2200);
  return writeMissionMarkdown(id, {
    front: {
      title: `SINGULARITY — repair ${stage}`,
      goal: `Make only this pipeline stage succeed: ${stage}. Do not change unrelated shaders, fallback presentation, or other files.`,
      maxModelCalls: 16,
      diff: { maxFiles: 1, maxInsertions: 200, warnOnly: true },
      acceptance: [
        `The failing stage ${stage} no longer fails for the recorded reason`,
        "Other pipeline stages are not rewritten unless this stage cannot compile without them",
        "No sidecar files",
        "createSingularity contract, MAX_PIXELS, and dispose remain",
        "typecheck and build pass",
      ],
    },
    body: `# One diagnosed failure

You are Robo Puppy. Authorized file: \`${SINGULARITY_REL}\`

The harness obtained a WebGL2 context. That is not the bug.

Failed stage: **${stage}**

Compile/link log:
\`\`\`
${logText || "(no log)"}
\`\`\`

Relevant source window (do not rewrite the whole file):
\`\`\`
${windowText || "(no window)"}
\`\`\`

${extra}

Change only what this stage needs so it compiles and links as GLSL ES 3.00 / WebGL2.
Do not create extra files.
Do not expand into visual redesign.`,
  });
}

export function glslMicroRepairMission({
  id,
  family,
  log,
  window,
  emptyRetry = false,
  adoptCheckpoint = "",
  extra = "",
} = {}) {
  const logText = sanitizeGlText(log).slice(0, 1600);
  const windowText = sanitizeGlText(window).slice(0, 2400);
  const familyLabel = sanitizeGlText(family || "current compiler diagnostic");
  const acceptance = emptyRetry
    ? "The authorized file bytes actually change. The previous described-only response is not a repair."
    : `The current undeclared-identifier family (${familyLabel}) disappears from the scene fragment shader compile log.`;
  const body = emptyRetry
    ? `# Execution retry

Your previous response described the repair but did not modify the file.
Apply only the approved ${familyLabel} repair now using the mutation tool.
Do not explain.

Authorized file: \`${SINGULARITY_REL}\``
    : `# One compiler error family

You are Robo Puppy. Authorized file: \`${SINGULARITY_REL}\`

Acceptance: ${acceptance}

Compiler log:
\`\`\`
${logText || "(no log)"}
\`\`\`

Relevant GLSL (about 20–40 lines; do not rewrite the whole file):
\`\`\`
${windowText || "(no window)"}
\`\`\`

Change only what this family needs so GLSL ES 3.00 compiles past these diagnostics.
Do not create extra files.${extra ? `\n\n${extra}` : ""}`;

  return writeMissionMarkdown(id, {
    front: {
      title: emptyRetry
        ? `SINGULARITY — apply ${familyLabel} (empty-edit retry)`
        : `SINGULARITY — resolve ${familyLabel}`,
      goal: emptyRetry
        ? `Apply the approved ${familyLabel} repair to ${SINGULARITY_REL}. Do not explain.`
        : `Resolve the current ${familyLabel} compiler failure in the scene fragment shader.`,
      maxModelCalls: 18,
      adoptCheckpoint: adoptCheckpoint || undefined,
      diff: { maxFiles: 1, maxInsertions: 80, warnOnly: true },
      acceptance: [
        acceptance,
        "No sidecar files required; checkpoint system owns recovery",
        "createSingularity contract, MAX_PIXELS, and dispose remain",
        "typecheck and build pass",
      ],
    },
    body,
  });
}

export function creativeMission({ n, hypothesis, track, previousNote = "", id: idIn = "" } = {}) {
  const id = idIn || `singularity-night-p5-h${n}`;
  const trackLine = track === "REAL_WEBGL2"
    ? "You are iterating on the real WebGL2 Singularity scene."
    : "Honest label: this is the 2D FALLBACK renderer, not the WebGL2 raymarch. Do not spend this task repairing shaders. Iterate only on the fallback drawing.";
  return writeMissionMarkdown(id, {
    front: {
      title: `SINGULARITY — ${hypothesis.id}`,
      goal: hypothesis.prompt,
      maxModelCalls: 16,
      diff: { maxFiles: 1, maxInsertions: 350, warnOnly: true },
      acceptance: [
        "Exactly one visual hypothesis was attempted",
        "createSingularity contract, MAX_PIXELS, dispose, and intel-driven audio remain",
        "No sidecar files",
        "typecheck and build pass",
      ],
    },
    body: `# One visual hypothesis

You are Robo Puppy. Authorized file: \`${SINGULARITY_REL}\`

${trackLine}

Hypothesis (the only job):
${hypothesis.prompt}

Category: ${hypothesis.category}

${previousNote}

Invent the implementation. Do not copy another visualizer's look.
Do not combine extra visual categories.
Do not create extra files.
If the edit is mechanically invalid, one bounded repair then stop.`,
  });
}

export const HYPOTHESES = [
  {
    id: "spatial-depth",
    category: "spatial depth",
    prompt: "The central focal point works, but the outer field feels visually empty compared with Kill Chain's polished visualizers. Form one hypothesis to improve spatial depth while preserving Singularity's identity.",
  },
  {
    id: "secondary-structure",
    category: "secondary structure",
    prompt: "The core reads clearly, but there is little secondary structure once the eye leaves the center. Form one hypothesis that adds a supporting form without competing with the core.",
  },
  {
    id: "accretion-detail",
    category: "accretion-like detail",
    prompt: "The core is promising, but the region immediately around it feels under-described. Form one hypothesis that adds accretion-like detail while keeping Singularity itself, not a different mode.",
  },
  {
    id: "outer-field",
    category: "outer-field activity",
    prompt: "The void around the core is too inert. Form one hypothesis that gives the outer field quiet activity without stealing attention from the center.",
  },
  {
    id: "contrast-hierarchy",
    category: "contrast hierarchy",
    prompt: "The frame needs a clearer contrast hierarchy: a dominant core, a supporting mid-field, and a quieter periphery. Form one hypothesis that improves that hierarchy without blowing out the image.",
  },
  {
    id: "lensing",
    category: "lensing/distortion",
    prompt: "Singularity should feel like gravity is bending the space around the core. Form one hypothesis for a restrained lensing or distortion cue. Do not turn the frame into noise.",
  },
];
