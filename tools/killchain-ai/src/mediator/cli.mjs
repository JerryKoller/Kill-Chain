/**
 * Mediator CLI.
 *
 * Follows the existing tooling convention: a `<name>Main({ flags, pos, log })`
 * entry point with an `if (sub === ...)` chain, dispatched from src/cli.mjs.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { missionsSpecDir } from "../paths.mjs";
import { sha256File } from "./missionSession.mjs";
import {
  baselinePath,
  captureBaseline,
  loadBaseline,
  protectedProductionFiles,
  renderVerify,
  saveBaseline,
  verifyBaseline,
} from "./worktreeBaseline.mjs";
import { BENCHMARK_CASES } from "./fixtures.mjs";
import { DemoMediatorSession } from "./demoSession.mjs";
import { MEDIATOR_PORT, pickPort, startMediatorServer } from "./server.mjs";
import { MODES, MODE_AUTO, ROUTE_DEEP, ROUTE_FAST, ROUTE_VISUAL } from "./router.mjs";
import {
  COST_FREE,
  discoverModels,
  eligibleFor,
  freeSupervisorCandidates,
  readCatalog,
  roleEligibility,
} from "./modelDiscovery.mjs";
import { PUPPY_ROLE, assignRole, loadRegistry, modelMetrics, roleModel, saveRegistry } from "./modelRegistry.mjs";
import { avatarSvgPath, identityPath, mediatorBenchDir } from "./paths.mjs";
import { generateIdentity } from "./identityGen.mjs";
import { loadIdentity } from "./identity.mjs";
import { puppySkillProfile } from "./skillProfile.mjs";
import { renderBenchmarkTable, runBenchmark } from "./benchmark.mjs";
import { runMediatorTests } from "./test.mjs";

const DEEP_DEFAULT = "opencode/nemotron-3-ultra-free";

function printHelp(log) {
  log(`kc-ai mediator — Robo Puppy Mediator, autonomous training console

  mediator                       launch the console (default port ${MEDIATOR_PORT})
  mediator console [--open]      same; --open starts the Prism window
  mediator status                current roles, identity, and run state
  mediator models [--refresh]    discover models from the live OpenCode install
  mediator autoconfig            assign roles from discovered free/eligible models
  mediator use --role R --model M   pin a model to a role
  mediator benchmark [--models a,b] [--case id]   score FAST candidates on fixtures
  mediator identity              have the DEEP supervisor design its own identity
  mediator reset-identity --confirm   replace the existing identity (destructive)
  mediator baseline capture      hash every dirty file; classify semantic vs EOL churn
  mediator baseline verify       detect drift, reverts, or lost parked work
  mediator demo                  run the safe fixture demo headlessly
  mediator run <spec> --authorize-production
                                 drive a REAL mission through the runner
  mediator profile               Robo Puppy's report card
  mediator test                  deterministic Mediator tests

Flags: --port N  --open  --brief "text"  --mode AUTO_ROUTE|FAST_ONLY|DEEP_ONLY  --max-tasks N`);
}

const ROLE_ALIASES = {
  FAST: ROUTE_FAST, FAST_SUPERVISOR: ROUTE_FAST,
  DEEP: ROUTE_DEEP, DEEP_SUPERVISOR: ROUTE_DEEP,
  VISUAL: ROUTE_VISUAL, VISUAL_REVIEW: ROUTE_VISUAL,
  PUPPY: PUPPY_ROLE, ROBO_PUPPY: PUPPY_ROLE,
};

function fmtMs(ms) {
  if (ms == null) return "—";
  return ms < 60000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

export async function mediatorMain({ flags = {}, pos = [], log = console.log } = {}) {
  const sub = pos[0];

  if (sub === "help" || sub === "-h") return printHelp(log);

  // ---- status ------------------------------------------------------------
  if (sub === "status") {
    const reg = loadRegistry();
    const identity = loadIdentity();
    log(`identity:  ${identity ? `${identity.displayName} — "${identity.tagline}"` : "(not chosen yet — run `mediator identity`)"}`);
    if (identity) log(`           chosen by ${identity.creatingModel} on ${new Date(identity.createdAt).toLocaleString()}`);
    log(`avatar:    ${existsSync(avatarSvgPath) ? avatarSvgPath : "(none)"}`);
    log("");
    log("roles:");
    for (const [role, id] of Object.entries(reg.roles)) {
      const m = id ? modelMetrics(reg, id) : null;
      log(`  ${role.padEnd(16)} ${(id || "(unassigned)").padEnd(40)} ${m && m.calls ? `${m.calls} calls, median ${fmtMs(m.medianLatencyMs)}` : "no observations yet"}`);
    }
    const catalog = readCatalog();
    log("");
    log(catalog
      ? `catalog:   ${catalog.models.length} models via ${catalog.source} at ${new Date(catalog.discoveredAt).toLocaleString()}`
      : "catalog:   not discovered yet — run `mediator models`");
    return undefined;
  }

  // ---- model discovery ---------------------------------------------------
  if (sub === "models") {
    log("discovering models from the installed OpenCode…");
    const catalog = await discoverModels({ refresh: Boolean(flags.refresh) });
    if (!catalog.models.length) {
      log(`no models discovered: ${catalog.error}`);
      return undefined;
    }
    log(`source: ${catalog.source}${catalog.stale ? " (STALE — served from cache)" : ""}`);
    log("");
    log(["MODEL", "COST", "CTX", "TOOL", "IMG", "ELIGIBLE"].join("\t"));
    for (const m of catalog.models) {
      const el = Object.entries(roleEligibility(m)).filter(([, v]) => v).map(([k]) => k.split("_")[0]);
      log([
        m.id,
        m.local ? "LOCAL" : m.costClass,
        m.contextLimit ?? "?",
        m.toolcall == null ? "?" : (m.toolcall ? "y" : "n"),
        m.image == null ? "?" : (m.image ? "y" : "n"),
        el.join(",") || "-",
      ].join("\t"));
    }
    log("");
    log("FREE is shown only where the provider's own metadata reports zero input and output cost.");
    return undefined;
  }

  // ---- autoconfig --------------------------------------------------------
  if (sub === "autoconfig") {
    const catalog = readCatalog() || await discoverModels({});
    if (!catalog.models.length) {
      log(`cannot autoconfigure: ${catalog.error}`);
      return undefined;
    }
    const reg = loadRegistry();
    const fastFree = freeSupervisorCandidates(catalog.models);
    const deep = catalog.models.find((m) => m.id === DEEP_DEFAULT)
      || eligibleFor(catalog.models, ROUTE_DEEP).find((m) => m.costClass === COST_FREE);
    const visual = eligibleFor(catalog.models, ROUTE_VISUAL).find((m) => m.costClass === COST_FREE)
      || eligibleFor(catalog.models, ROUTE_VISUAL)[0];
    const puppy = catalog.models.find((m) => m.id === "ollama/qwen3.5:9b");

    // Prefer a benchmarked winner over a guess.
    const bench = readLatestBenchmark();
    const fast = (bench?.recommended && catalog.models.find((m) => m.id === bench.recommended))
      || fastFree.find((m) => m.id !== DEEP_DEFAULT)
      || fastFree[0];

    if (fast) assignRole(reg, ROUTE_FAST, fast.id);
    if (deep) assignRole(reg, ROUTE_DEEP, deep.id);
    if (visual) assignRole(reg, ROUTE_VISUAL, visual.id);
    if (puppy) assignRole(reg, PUPPY_ROLE, puppy.id);
    saveRegistry(reg);

    log("roles assigned:");
    for (const [role, id] of Object.entries(reg.roles)) log(`  ${role.padEnd(16)} ${id || "(unassigned)"}`);
    if (!bench?.recommended) {
      log("");
      log("FAST was chosen by eligibility only. Run `mediator benchmark` to choose it by measurement.");
    }
    return undefined;
  }

  if (sub === "use") {
    const role = ROLE_ALIASES[String(flags.role || "").toUpperCase()];
    if (!role) return log("--role must be one of FAST, DEEP, VISUAL, PUPPY");
    if (!flags.model) return log("--model is required");
    const reg = loadRegistry();
    assignRole(reg, role, String(flags.model));
    saveRegistry(reg);
    log(`${role} → ${flags.model}`);
    return undefined;
  }

  // ---- benchmark ---------------------------------------------------------
  if (sub === "benchmark") {
    const catalog = readCatalog() || await discoverModels({});
    let candidates;
    if (flags.models) {
      candidates = String(flags.models).split(",").map((s) => s.trim()).filter(Boolean);
    } else {
      candidates = freeSupervisorCandidates(catalog.models).map((m) => m.id);
    }
    if (!candidates.length) return log("no candidate models found. Run `mediator models` first.");
    const cases = flags.case
      ? BENCHMARK_CASES.filter((c) => c.id === String(flags.case))
      : BENCHMARK_CASES;
    if (!cases.length) return log(`unknown case: ${flags.case}`);

    log(`benchmarking ${candidates.length} model(s) on ${cases.length} fixture case(s). No production access.`);
    const report = await runBenchmark({ candidates, cases, log });
    log("");
    log(renderBenchmarkTable(report.results));
    log("");
    log(`recommended FAST: ${report.recommended || "(none passed)"}`);
    log(`report: ${report.outPath}`);
    return undefined;
  }

  // ---- identity ----------------------------------------------------------
  if (sub === "identity" || sub === "reset-identity") {
    const force = sub === "reset-identity";
    if (force && !flags.confirm) {
      log("Regenerating replaces a deliberate one-time choice made by the Mediator itself.");
      log("Re-run with --confirm if that is what you want.");
      return undefined;
    }
    const reg = loadRegistry();
    const model = String(flags.model || roleModel(reg, ROUTE_DEEP) || DEEP_DEFAULT);
    log(`asking ${model} to design the Mediator's visual identity…`);
    const res = await generateIdentity({ model, force, log });
    if (!res.ok) {
      log(`identity not created: ${res.reason}`);
      return undefined;
    }
    if (res.reused) {
      log(`identity already chosen: ${res.identity.displayName}. Use \`mediator reset-identity --confirm\` to replace it.`);
      return undefined;
    }
    log("");
    log(`  name:      ${res.identity.displayName}`);
    log(`  tagline:   ${res.identity.tagline}`);
    log(`  concept:   ${res.identity.avatar.concept}`);
    log(`  primary:   ${res.identity.theme.primary}`);
    log(`  written:   ${identityPath}`);
    log(`             ${avatarSvgPath}`);
    if (res.warnings?.length) log(`  warnings:  ${res.warnings.join(", ")}`);
    return undefined;
  }

  // ---- profile -----------------------------------------------------------
  if (sub === "profile") {
    const pr = puppySkillProfile({ includeSimulated: flags.simulated !== "false" });
    if (pr.note) log(pr.note);
    log(`total tasks: ${pr.totalTasks}`);
    log("");
    log(["FAMILY", "TASKS", "1ST-PASS", "EMPTY", "SCOPE", "DEEP"].join("\t"));
    for (const f of pr.families) {
      const p = (v) => (v == null ? "—" : `${Math.round(v * 100)}%`);
      log([f.family, f.tasks, p(f.firstPassSuccess), p(f.emptyEditRate), p(f.scopeViolationRate), p(f.deepEscalationRate)].join("\t"));
    }
    log("");
    log("Rates are withheld below 3 samples. Nothing here is estimated.");
    return undefined;
  }

  // ---- headless fixture demo --------------------------------------------
  if (sub === "demo") {
    const reg = loadRegistry();
    if (!roleModel(reg, ROUTE_FAST) || !roleModel(reg, ROUTE_DEEP)) {
      log("roles are not configured. Run `mediator models` then `mediator autoconfig` first.");
      return undefined;
    }
    const brief = String(flags.brief
      || "Fixture demo: drive the Singularity shader fixture back to a compiling state using the smallest verified steps.");
    const session = new DemoMediatorSession({
      brief,
      mode: MODES.includes(flags.mode) ? flags.mode : MODE_AUTO,
      maxTasks: Number(flags["max-tasks"]) || 6,
      log,
    });
    log(`run ${session.runId} — fixture dispatch, no production access`);
    const final = await session.start();
    log("");
    log(`final state: ${final.state}${final.blockedReason ? ` — ${final.blockedReason}` : ""}`);
    log(`tasks: ${final.taskCount}  escalations: ${final.escalationCount}`);
    log(`timings: routing ${fmtMs(final.timings.routingMs)}, supervisor ${fmtMs(final.timings.supervisorMs)}, worker ${fmtMs(final.timings.workerMs)}`);
    return undefined;
  }

  // ---- worktree baseline --------------------------------------------------
  if (sub === "baseline") {
    const action = pos[1] || "verify";
    if (action === "capture") {
      const b = captureBaseline({ note: String(flags.note || "") });
      saveBaseline(b);
      log(`captured ${b.counts.total} dirty entries at ${b.branch} ${b.head.slice(0, 7)}`);
      log(`  semantic dirt:      ${b.counts.semantic}`);
      log(`  line-ending churn:  ${b.counts.eolOnly}`);
      log(`  untracked:          ${b.counts.untracked}`);
      log(`  deleted:            ${b.counts.deleted}`);
      log(`  written to ${baselinePath}`);
      const prot = protectedProductionFiles(b);
      log("");
      log(`protected production files (semantic dirt under src/ electron/ scripts/): ${prot.length}`);
      for (const p of prot) log(`  ${p.sha256.slice(0, 16)}…  ${p.path}`);
      return undefined;
    }
    if (action === "verify") {
      const b = loadBaseline();
      if (!b) return log("no baseline captured yet. Run `mediator baseline capture` first.");
      const v = verifyBaseline(b);
      log(renderVerify(v));
      if (!v.safe) process.exitCode = 1;
      return undefined;
    }
    return log("usage: mediator baseline capture|verify");
  }

  // ---- real production mission (requires explicit authorization) ----------
  if (sub === "run") {
    const specArg = pos[1];
    if (!specArg) return log("usage: mediator run <base-mission.md> --authorize-production");
    const specPath = existsSync(specArg) ? specArg : join(missionsSpecDir, specArg.endsWith(".md") ? specArg : `${specArg}.md`);
    if (!existsSync(specPath)) return log(`mission spec not found: ${specPath}`);
    if (!flags["authorize-production"]) {
      log("This runs Robo Puppy against real production files through the mission runner.");
      log("Re-run with --authorize-production to confirm.");
      log(`  base spec: ${specPath}`);
      return undefined;
    }
    const reg = loadRegistry();
    if (!roleModel(reg, ROUTE_FAST) || !roleModel(reg, ROUTE_DEEP)) {
      return log("roles are not configured. Run `mediator models` then `mediator autoconfig` first.");
    }
    const { MissionMediatorSession } = await import("./missionSession.mjs");
    const session = new MissionMediatorSession({
      baseSpecPath: specPath,
      authorized: true,
      brief: String(flags.brief || readFileSync(specPath, "utf8")),
      mode: MODES.includes(flags.mode) ? flags.mode : MODE_AUTO,
      maxTasks: Number(flags["max-tasks"]) || 4,
      maxSupervisorCalls: Number(flags["max-calls"]) || 24,
      log,
    });
    log(`run ${session.runId} — PRODUCTION dispatch against ${specPath}`);
    log(`  preserved files hashed: ${session.preservedPaths.length}`);
    const final = await session.start();
    log("");
    log(`final state: ${final.state}${final.blockedReason ? ` — ${final.blockedReason}` : ""}`);
    log(`tasks: ${final.taskCount}  escalations: ${final.escalationCount}  supervisor calls: ${final.supervisorCalls}`);
    const drift = session.preservedPaths.filter((p) => session.preservedBaseline[p] !== sha256File(p));
    log(drift.length ? `PRESERVED FILE DRIFT: ${drift.join(", ")}` : "preserved files unchanged");
    return undefined;
  }

  if (sub === "test") {
    const { failed } = await runMediatorTests({ log });
    if (failed) process.exitCode = 1;
    return undefined;
  }

  // ---- default: launch the console ---------------------------------------
  if (!sub || sub === "serve" || sub === "console") {
    const port = flags.port ? Number(flags.port) : await pickPort();
    const handle = await startMediatorServer({ port, log });
    if (flags.open === true || flags.open === "true") {
      const { openPrismWindow } = await import("./launch.mjs");
      openPrismWindow(handle.url);
    }
    log("");
    log(`  Robo Puppy Mediator — Autonomous Training Console`);
    log(`  ${handle.url}`);
    log("");
    const identity = loadIdentity();
    log(identity
      ? `  Mediator identity: ${identity.displayName} — "${identity.tagline}"`
      : "  No identity chosen yet. Run `mediator identity` to have the deep supervisor design one.");
    const reg = loadRegistry();
    log(`  FAST: ${roleModel(reg, ROUTE_FAST) || "(unassigned)"}   DEEP: ${roleModel(reg, ROUTE_DEEP) || "(unassigned)"}`);
    log("");
    log("  Ctrl-C to stop.");
    const shutdown = () => {
      log("\nstopping safely…");
      handle.close().then(() => process.exit(0));
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
    return new Promise(() => {});
  }

  printHelp(log);
  throw new Error(`unknown mediator subcommand: ${sub}`);
}

function readLatestBenchmark() {
  try {
    const p = join(mediatorBenchDir, "latest.json");
    return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
  } catch {
    return null;
  }
}
