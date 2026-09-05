/**
 * Isolated Robo Puppy night curriculum.
 *
 * Sandboxes live outside the repo (same reason as editCurriculum: OpenCode
 * otherwise resolves production paths). Fixtures are synthetic — never the
 * parked Fire Command files or Singularity.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { dataDir, repoRoot } from "../paths.mjs";
import { runOpenCode } from "../mission/opencode.mjs";
import { DEFAULT_MISSION_MODEL, normalizeModelId } from "../mission/model.mjs";
import { sha256File } from "../mediator/missionSession.mjs";

const PROTECTED = [
  "src/components/FireCommand/GatePanel.tsx",
  "src/components/FireCommand/MacroPanel.tsx",
  "src/components/FireCommand/ModuleEnableToggle.tsx",
  "src/components/Visualizer/singularity.ts",
];

const EXPECTED = {
  "src/components/FireCommand/GatePanel.tsx": "fd8ecba02255d936496de7968596fde37ad7d04dada260805c35c41e9e35a62b",
  "src/components/FireCommand/MacroPanel.tsx": "8fe631ca02ae0a9ac9961a9d90879ddba86bbd7c135d8af7ad986ddde3dd7562",
  "src/components/FireCommand/ModuleEnableToggle.tsx": "592fadf912c4e5b48d64cf3662285b21c155aeaeed74edfc27aaf0fbfe1263e9",
  "src/components/Visualizer/singularity.ts": "01c82ee09184ad2a200946b5da2780beff87420c8b689ec1e4c9974d2c6c0f68",
};

const outRoot = join(dataDir, "overnight", "self-improvement-2026-09-05", "curriculum");

function sha(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

function assertProtected() {
  const drifted = [];
  for (const rel of PROTECTED) {
    const h = sha256File(rel);
    if (h !== EXPECTED[rel]) drifted.push({ rel, h, expected: EXPECTED[rel] });
  }
  if (drifted.length) {
    throw new Error(`protected production drift: ${drifted.map((d) => d.rel).join(", ")}`);
  }
}

export const HELD_OUT = [
  {
    id: "ho-ts-undeclared",
    family: "typescript_microfix",
    rel: "src/add.ts",
    fixtureSource: "export function add(a: number, b: number): number {\n  return a + bb;\n}\n",
    goldSource: "export function add(a: number, b: number): number {\n  return a + b;\n}\n",
    goal: "In src/add.ts, identifier `bb` is undeclared. Change it to `b`. Change nothing else.",
  },
  {
    id: "ho-glsl-ro",
    family: "compiler_microfix",
    rel: "src/scene.glsl",
    fixtureSource: "void main() {\n  gl_FragColor = vec4(ro, 1.0);\n}\n",
    goldSource: "void main() {\n  vec3 ro = vec3(0.0);\n  gl_FragColor = vec4(ro, 1.0);\n}\n",
    goal: "In src/scene.glsl, `ro` is undeclared. Declare `vec3 ro = vec3(0.0);` before it is used. Change nothing else.",
  },
  {
    id: "ho-ts-typo-name",
    family: "typescript_microfix",
    rel: "src/clamp.ts",
    fixtureSource: "export function clamp01(x: number): number {\n  if (x < 0) return 0;\n  if (x > 1) return 1;\n  return xx;\n}\n",
    goldSource: "export function clamp01(x: number): number {\n  if (x < 0) return 0;\n  if (x > 1) return 1;\n  return x;\n}\n",
    goal: "In src/clamp.ts, `xx` is undeclared. Return `x` instead. Change nothing else.",
  },
  {
    id: "ho-ts-plus-one",
    family: "typescript_microfix",
    rel: "src/inc.ts",
    fixtureSource: "export function inc(n: number): number {\n  return n;\n}\n",
    goldSource: "export function inc(n: number): number {\n  return n + 1;\n}\n",
    goal: "In src/inc.ts, `inc` must return n + 1. Change only the return expression.",
  },
];

function promptFor(task) {
  return `You are Robo Puppy. CURRENT PASS: EXECUTION. The change is already approved.

AUTHORIZED FILE (the only file you may modify):
- ${task.rel}

APPROVED CHANGE:
${task.goal}

REQUIREMENTS:
- Use an edit/write tool. A description is not a deliverable.
- Modify only the authorized file.
- Smallest possible edit.
- Do not reformat unrelated lines. Do not re-plan.

When finished, state in one sentence what you changed.`;
}

function sandboxFor(taskId) {
  const dir = join(tmpdir(), "kc-night-curriculum", taskId);
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const f of ["tsconfig.json", "package.json", "opencode.json", "AGENTS.md"]) {
    const src = join(repoRoot, f);
    if (existsSync(src)) cpSync(src, join(dir, f));
  }
  return dir;
}

function summarize(rows) {
  const n = rows.length;
  if (!n) return { n: 0 };
  const firstPass = rows.filter((r) => r.first.accepted).length;
  const afterTutor = rows.filter((r) => r.final.accepted).length;
  const empty = rows.filter((r) => r.first.emptyEdit).length;
  const editInvoke = rows.filter((r) => r.first.editInvoked).length;
  const calls = rows.map((r) => r.calls);
  const toEdit = rows.filter((r) => r.first.editInvoked).map((r) => r.callsToFirstEdit).filter((x) => x != null);
  const mid = (arr) => {
    const a = arr.filter(Number.isFinite).slice().sort((x, y) => x - y);
    if (!a.length) return null;
    return a[Math.floor(a.length / 2)];
  };
  return {
    n,
    firstPassSuccess: firstPass / n,
    successAfterTutoring: afterTutor / n,
    emptyEditRate: empty / n,
    editInvokeRate: editInvoke / n,
    medianCalls: mid(calls),
    medianCallsToFirstEdit: mid(toEdit),
  };
}

export async function runNightCurriculum({
  model = DEFAULT_MISSION_MODEL,
  timeoutMs = 120000,
  heldOut = HELD_OUT,
  log = console.log,
} = {}) {
  mkdirSync(outRoot, { recursive: true });
  mkdirSync(join(outRoot, "sessions"), { recursive: true });
  assertProtected();
  const started = Date.now();
  const results = [];

  log(`night curriculum: ${heldOut.length} held-out isolated fixtures | ${normalizeModelId(model)}`);
  log("production paths are read-only; sandboxes are outside the repo");

  for (const task of heldOut) {
    assertProtected();
    const dir = sandboxFor(task.id);
    const target = join(dir, task.rel);
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(target, task.fixtureSource, "utf8");
    const beforeSha = sha(Buffer.from(task.fixtureSource));
    const t0 = Date.now();
    let parsed = { tools: [], firstTool: null };
    let error = null;
    try {
      const res = await runOpenCode({
        prompt: promptFor(task),
        title: `night-curr ${task.id}`,
        outPath: join(outRoot, "sessions", `${task.id}.jsonl`),
        cwd: dir,
        model,
        timeoutMs,
      });
      parsed = res.parsed || parsed;
    } catch (err) {
      error = String(err?.message || err);
      log(`  ${task.id}: ERROR ${error}`);
    }
    const after = existsSync(target) ? readFileSync(target, "utf8") : task.fixtureSource;
    const tools = parsed.tools || [];
    const editInvoked = tools.some((t) => /edit|write|str_replace|apply_patch|search_replace/i.test(String(t)));
    const emptyEdit = sha(Buffer.from(after)) === beforeSha;
    const accepted = after.includes(task.goldNeedle || "") || after.replace(/\r\n/g, "\n") === task.goldSource.replace(/\r\n/g, "\n");
    const row = {
      id: task.id,
      family: task.family,
      split: "held-out",
      teachingLevel: 0,
      ms: Date.now() - t0,
      calls: 1,
      callsToFirstEdit: editInvoked ? 1 : null,
      tools,
      firstTool: parsed.firstTool || tools[0] || null,
      byteDelta: Buffer.byteLength(after) - Buffer.byteLength(task.fixtureSource),
      first: { accepted, emptyEdit, editInvoked },
      final: { accepted, emptyEdit, editInvoked },
      error,
    };
    results.push(row);
    log(`  ${task.id}: edit=${editInvoked} empty=${emptyEdit} accept=${accepted} ${row.ms}ms tools=${tools.join(",") || "(none)"}`);
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }

  assertProtected();
  const summary = {
    at: new Date().toISOString(),
    model: normalizeModelId(model),
    durationMs: Date.now() - started,
    heldOut: summarize(results),
    results,
  };
  writeFileSync(join(outRoot, "held-out.json"), JSON.stringify(summary, null, 2), "utf8");
  log(`held-out edit-invoke ${summary.heldOut.editInvokeRate} first-pass ${summary.heldOut.firstPassSuccess}`);
  return summary;
}

