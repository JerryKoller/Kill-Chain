/**
 * Durable timeline.
 *
 * Mission truth must survive a browser refresh, a UI reconnect, and a Mediator
 * restart, so nothing important lives only in page memory. Events are appended
 * as JSONL per run and replayed on connect.
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { ensureDir, mediatorRunsDir } from "./paths.mjs";

export const EVENT_KINDS = [
  "RUN_STARTED",
  "BRIEF_RECEIVED",
  "ROUTE",
  "SUPERVISOR_CALL",
  "SUPERVISOR_DECISION",
  "TASK_DISPATCHED",
  "WORKER_RESULT",
  "VALIDATION",
  "CHECKPOINT",
  "ESCALATION",
  "ESCALATION_RESOLVED",
  "GEAR_CHANGE",
  "PROVIDER_FAILURE",
  "PAUSED",
  "STOPPED",
  "RUN_FINISHED",
  "NOTE",
];

export function runDir(runId) {
  return ensureDir(join(mediatorRunsDir, runId));
}

export function eventsPath(runId) {
  return join(runDir(runId), "events.jsonl");
}

export function statePath(runId) {
  return join(runDir(runId), "state.json");
}

export function appendEvent(runId, event) {
  const row = {
    at: Date.now(),
    kind: EVENT_KINDS.includes(event.kind) ? event.kind : "NOTE",
    ...event,
  };
  appendFileSync(eventsPath(runId), `${JSON.stringify(row)}\n`, "utf8");
  return row;
}

export function readEvents(runId, { limit = null } = {}) {
  const p = eventsPath(runId);
  if (!existsSync(p)) return [];
  const rows = readFileSync(p, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  return limit ? rows.slice(-limit) : rows;
}

export function saveRunState(runId, state) {
  writeFileSync(statePath(runId), `${JSON.stringify(state, null, 2)}\n`, "utf8");
  return state;
}

export function loadRunState(runId) {
  const p = statePath(runId);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

/** Human-readable timeline row for the console. */
export function describeEvent(e) {
  switch (e.kind) {
    case "ROUTE":
      return `${e.role === "HUMAN" ? "PAUSE FOR HUMAN" : e.role} — ${e.reason || ""}`;
    case "SUPERVISOR_DECISION":
      return `${e.decision}${e.confidence != null ? ` (confidence ${e.confidence})` : ""} — ${e.reason || ""}`;
    case "TASK_DISPATCHED":
      return `Task to Robo Puppy: ${e.workerObjective || ""}`;
    case "WORKER_RESULT":
      return e.summary || "worker returned";
    case "GEAR_CHANGE":
      return `${e.from} → ${e.to}${e.reason ? ` — ${e.reason}` : ""}`;
    case "PROVIDER_FAILURE":
      return `${e.model || "provider"} failed: ${e.error || "unknown"}`;
    default:
      return e.note || e.reason || e.kind;
  }
}
