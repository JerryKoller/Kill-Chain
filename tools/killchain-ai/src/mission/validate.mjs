import { spawn } from "node:child_process";
import { repoRoot } from "../paths.mjs";
import { restoreGenerated, wasPathClean } from "./gitops.mjs";
import { killTree } from "./opencode.mjs";

export const VALIDATION_SCRIPTS = {
  typecheck: ["run", "typecheck"],
  build: ["run", "build"],
  smoke: ["run", "smoke"],
  "distort-hunt": ["run", "distort-hunt"],
  "leak-check": ["run", "leak-check"],
  "project-repro": ["run", "project-repro"],
  soak: ["run", "soak"],
  "heap-diff": ["run", "heap-diff"],
};

export function runNpmScript(name, { cwd = repoRoot, timeoutMs = 10 * 60 * 1000 } = {}) {
  const args = VALIDATION_SCRIPTS[name];
  if (!args) return Promise.resolve({ name, ok: false, code: 2, stdout: "", stderr: `unknown script ${name}`, durationMs: 0 });
  return new Promise((resolve) => {
    const started = Date.now();
    const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";
    const child = spawn(npmBin, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      shell: false,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += d;
      if (stdout.length > 80_000) stdout = stdout.slice(-80_000);
    });
    child.stderr.on("data", (d) => {
      stderr += d;
      if (stderr.length > 80_000) stderr = stderr.slice(-80_000);
    });
    const t = setTimeout(() => {
      killTree(child);
      resolve({
        name,
        ok: false,
        code: 124,
        stdout,
        stderr: `${stderr}\n[timeout ${timeoutMs}ms]`,
        durationMs: Date.now() - started,
      });
    }, timeoutMs);
    child.on("error", (e) => {
      clearTimeout(t);
      resolve({ name, ok: false, code: 1, stdout, stderr: String(e), durationMs: Date.now() - started });
    });
    child.on("exit", (code) => {
      clearTimeout(t);
      resolve({
        name,
        ok: code === 0,
        code: code ?? 1,
        stdout,
        stderr,
        durationMs: Date.now() - started,
      });
    });
  });
}

export async function runValidation(spec, { snapshot, log = () => {}, run = runNpmScript } = {}) {
  const required = spec.validation?.required || [];
  const results = [];
  for (const name of required) {
    log(`validation: npm run ${name}`);
    const r = await run(name);
    results.push(r);
    if (!r.ok) break;
  }
  const tsClean = snapshot ? wasPathClean(snapshot, "tsconfig.tsbuildinfo") : true;
  let restored = [];
  if (spec.validation?.restoreTsbuildinfo !== false && tsClean) {
    restored = restoreGenerated(["tsconfig.tsbuildinfo"], { wasClean: true });
  }
  const ok = results.length === required.length && results.every((r) => r.ok);
  return {
    ok,
    results,
    restored,
    at: new Date().toISOString(),
  };
}

export function validationSummary(report) {
  return (report.results || []).map((r) => ({
    name: r.name,
    ok: r.ok,
    code: r.code,
    durationMs: r.durationMs,
    tail: `${r.stderr || r.stdout || ""}`.trim().slice(-1500),
  }));
}
