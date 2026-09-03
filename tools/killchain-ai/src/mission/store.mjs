import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
  readdirSync,
  unlinkSync,
} from "node:fs";
import { join, resolve, sep } from "node:path";
import { missionsDataDir } from "../paths.mjs";
import { assertTransition } from "./machine.mjs";
import { assertSafeMissionId } from "./schema.mjs";

export function missionStateDir(id, dataRoot = missionsDataDir) {
  assertSafeMissionId(id);
  const dir = join(dataRoot, id);
  const resolved = resolve(dir);
  const root = resolve(dataRoot);
  const prefix = root.endsWith(sep) ? root : root + sep;
  if (resolved !== root && !resolved.toLowerCase().startsWith(prefix.toLowerCase())) {
    throw new Error(`mission dir escapes data root: ${id}`);
  }
  return dir;
}

export function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeJson(path, obj) {
  writeFileSync(path, `${JSON.stringify(obj, null, 2)}\n`, "utf8");
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function newStatus(spec, { dryRun, head, branch } = {}) {
  const now = new Date().toISOString();
  return {
    missionId: spec.id,
    state: "CREATED",
    dryRun: Boolean(dryRun || spec.dryRun),
    startedAt: now,
    updatedAt: now,
    endedAt: null,
    headAtStart: head || null,
    branchAtStart: branch || null,
    expectedHead: head || null,
    expectedAppDirty: [],
    modelCalls: 0,
    invocations: [],
    transitions: [],
    phaseIndex: 0,
    proposalRound: 0,
    planRetries: 0,
    editRetries: 0,
    repairRetries: 0,
    criticRetries: 0,
    unixViolations: 0,
    mcpFirstMisses: 0,
    visibleTextMisses: 0,
    forceEditAfterProposal: false,
    checkpoints: 0,
    warnings: [],
    blockedReason: null,
    failedReason: null,
    lastError: null,
    resumeCount: 0,
  };
}

export function loadMission(id, dataRoot = missionsDataDir) {
  const dir = missionStateDir(id, dataRoot);
  const statusPath = join(dir, "status.json");
  const missionPath = join(dir, "mission.json");
  if (!existsSync(statusPath) || !existsSync(missionPath)) {
    throw new Error(`no persisted mission state at ${dir}`);
  }
  return {
    dir,
    status: readJson(statusPath),
    spec: readJson(missionPath),
  };
}

export function listMissions(dataRoot = missionsDataDir) {
  if (!existsSync(dataRoot)) return [];
  return readdirSync(dataRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      try {
        const status = readJson(join(dataRoot, d.name, "status.json"));
        return {
          id: d.name,
          state: status.state,
          updatedAt: status.updatedAt,
          dryRun: status.dryRun,
          modelCalls: status.modelCalls,
        };
      } catch {
        return { id: d.name, state: "UNKNOWN" };
      }
    });
}

export function createMissionStore(spec, { dryRun, head, branch, dataRoot = missionsDataDir } = {}) {
  const dir = ensureDir(missionStateDir(spec.id, dataRoot));
  ensureDir(join(dir, "sessions"));
  ensureDir(join(dir, "checkpoints"));
  ensureDir(join(dir, "quarantine"));
  const status = newStatus(spec, { dryRun, head, branch });
  writeJson(join(dir, "mission.json"), spec);
  writeJson(join(dir, "status.json"), status);
  writeFileSync(join(dir, "JOURNAL.md"), `# Journal — ${spec.id}\n\n`, "utf8");
  writeFileSync(join(dir, "CURRENT_PHASE.md"), "CREATED\n", "utf8");
  return { dir, status, spec };
}

export function saveStatus(dir, status) {
  status.updatedAt = new Date().toISOString();
  writeJson(join(dir, "status.json"), status);
  writeFileSync(join(dir, "CURRENT_PHASE.md"), `${status.state}\n`, "utf8");
}

export function appendJournal(dir, line) {
  const ts = new Date().toISOString();
  appendFileSync(join(dir, "JOURNAL.md"), `- ${ts}  ${line}\n`, "utf8");
}

export function transition(dir, status, to, note = "") {
  const from = status.state;
  assertTransition(from, to);
  status.state = to;
  status.transitions.push({ from, to, at: new Date().toISOString(), note });
  if (["COMPLETE", "BLOCKED", "FAILED"].includes(to)) status.endedAt = new Date().toISOString();
  saveStatus(dir, status);
  appendJournal(dir, `${from} → ${to}${note ? ` — ${note}` : ""}`);
  return status;
}

export function writeText(dir, name, text) {
  writeFileSync(join(dir, name), text.endsWith("\n") ? text : `${text}\n`, "utf8");
}

export function readText(dir, name) {
  const p = join(dir, name);
  return existsSync(p) ? readFileSync(p, "utf8") : "";
}

export function writeLock(dir) {
  writeJson(join(dir, "RUNNING.lock"), { pid: process.pid, at: new Date().toISOString() });
}

export function clearLock(dir) {
  const p = join(dir, "RUNNING.lock");
  if (!existsSync(p)) return;
  try {
    unlinkSync(p);
  } catch {
    /* ignore */
  }
}

export function readLock(dir) {
  const p = join(dir, "RUNNING.lock");
  if (!existsSync(p)) return null;
  try {
    return readJson(p);
  } catch {
    return null;
  }
}

export function pidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
