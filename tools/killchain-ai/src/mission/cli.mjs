import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { missionsDataDir, missionsSpecDir, repoRoot } from "../paths.mjs";
import { parseMissionFile } from "./schema.mjs";
import { listMissions, loadMission, readText } from "./store.mjs";
import { runMission } from "./runner.mjs";
import { runMissionTests } from "./test.mjs";

function resolveSpec(p) {
  if (!p) throw new Error("mission spec path required");
  const candidates = [];
  if (isAbsolute(p)) candidates.push(p);
  else {
    candidates.push(resolve(process.cwd(), p));
    candidates.push(resolve(repoRoot, p));
    candidates.push(resolve(missionsSpecDir, p));
    candidates.push(resolve(missionsSpecDir, `${p}.md`));
  }
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  throw new Error(`mission spec not found: ${p}`);
}

function printHelp() {
  console.log(`Kill Chain local mission runner

Usage:
  kc-ai mission <command>

Commands:
  create --template ui-feature|audio-critical|read-only|single-patch --id <kebab-id>
  validate <file>
  run <file> [--dry-run] [--stop-after STATE] [--approve-audio-edit]
  status [id]
  resume <id> [--dry-run] [--stop-after STATE] [--retry] [--approve-audio-edit]
  report <id>
  test

Examples:
  .\\tools\\killchain-ai\\kc-ai.ps1 mission validate .\\tools\\killchain-ai\\missions\\pilot-fire-ux-plan.md
  .\\tools\\killchain-ai\\kc-ai.ps1 mission run .\\tools\\killchain-ai\\missions\\pilot-fire-ux-plan.md --dry-run
  .\\tools\\killchain-ai\\kc-ai.ps1 mission status pilot-fire-ux-plan
  .\\tools\\killchain-ai\\kc-ai.ps1 mission resume pilot-fire-ux-plan --dry-run
  .\\tools\\killchain-ai\\kc-ai.ps1 mission report pilot-fire-ux-plan
  .\\tools\\killchain-ai\\kc-ai.ps1 mission test

Dry-run: preflight, retrieve, investigate, plan, critic, proposal; stop before production edits.
  --retry on resume: restore FAILED/BLOCKED to the previous state.
State lives in gitignored tools/killchain-ai/data/missions/<id>/
Does not commit, push, or fine-tune.
`);
}

export async function missionMain({ flags, pos, log = console.log }) {
  const sub = pos[0];
  if (!sub || sub === "help" || sub === "-h") {
    printHelp();
    return;
  }

  if (sub === "test") {
    await runMissionTests();
    return;
  }

  if (sub === "create") {
    const template = String(flags.template || "ui-feature");
    const id = String(flags.id || pos[1] || "").trim();
    if (!id) throw new Error("mission create requires --id <kebab-id>");
    const src = join(missionsSpecDir, "templates", `${template}.md`);
    if (!existsSync(src)) throw new Error(`unknown template ${template} (${src})`);
    const out = flags.out
      ? (isAbsolute(flags.out) ? flags.out : resolve(repoRoot, flags.out))
      : join(missionsSpecDir, `${id}.md`);
    mkdirSync(dirname(out), { recursive: true });
    let text = readFileSync(src, "utf8");
    text = text.replace(/"id":\s*"[^"]+"/, `"id": "${id}"`);
    writeFileSync(out, text, "utf8");
    log(`wrote ${out}`);
    return;
  }

  if (sub === "validate") {
    const file = resolveSpec(pos[1]);
    const parsed = parseMissionFile(file);
    console.log(JSON.stringify({
      file,
      ok: parsed.ok,
      errors: parsed.errors,
      warnings: parsed.warnings,
      spec: parsed.spec && {
        id: parsed.spec.id,
        title: parsed.spec.title,
        level: parsed.spec.level,
        levelName: parsed.spec.levelInfo?.name,
        allowedPaths: parsed.spec.allowedPaths,
        validation: parsed.spec.validation,
      },
    }, null, 2));
    if (!parsed.ok) process.exitCode = 1;
    return;
  }

  if (sub === "status") {
    const id = pos[1];
    if (!id) {
      const list = listMissions();
      console.log(JSON.stringify({ dataRoot: missionsDataDir, missions: list }, null, 2));
      return;
    }
    const loaded = loadMission(id);
    console.log(JSON.stringify({
      dir: loaded.dir,
      state: loaded.status.state,
      dryRun: loaded.status.dryRun,
      modelCalls: loaded.status.modelCalls,
      blockedReason: loaded.status.blockedReason,
      failedReason: loaded.status.failedReason,
      transitions: loaded.status.transitions,
      invocations: loaded.status.invocations?.map((i) => ({
        n: i.n, phase: i.phase, durationMs: i.durationMs, firstTool: i.firstTool, textChars: i.textChars,
      })),
    }, null, 2));
    return;
  }

  if (sub === "report") {
    const id = pos[1];
    if (!id) throw new Error("mission report <id>");
    const loaded = loadMission(id);
    const report = readText(loaded.dir, "FINAL_REPORT.md") || "(no FINAL_REPORT.md yet)";
    console.log(report);
    return;
  }

  if (sub === "run") {
    const file = resolveSpec(pos[1]);
    const status = await runMission({
      specPath: file,
      dryRun: Boolean(flags["dry-run"]),
      stopAfter: flags["stop-after"] || null,
      approveAudioEdit: Boolean(flags["approve-audio-edit"]),
      log,
    });
    log(`mission ${status.missionId} → ${status.state}`);
    if (status.blockedReason) log(`blocked: ${status.blockedReason}`);
    if (status.failedReason) log(`failed: ${status.failedReason}`);
    if (["BLOCKED", "FAILED"].includes(status.state)) process.exitCode = 1;
    return;
  }

  if (sub === "resume") {
    const id = pos[1];
    if (!id) throw new Error("mission resume <id>");
    const status = await runMission({
      resumeId: id,
      dryRun: Boolean(flags["dry-run"]),
      stopAfter: flags["stop-after"] || null,
      approveAudioEdit: Boolean(flags["approve-audio-edit"]),
      retry: Boolean(flags.retry),
      log,
    });
    log(`mission ${status.missionId} → ${status.state}`);
    if (status.blockedReason) log(`blocked: ${status.blockedReason}`);
    if (["BLOCKED", "FAILED"].includes(status.state)) process.exitCode = 1;
    return;
  }

  printHelp();
  throw new Error(`unknown mission command: ${sub}`);
}
