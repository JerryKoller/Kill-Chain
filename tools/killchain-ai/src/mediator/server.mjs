/**
 * Mediator console server.
 *
 * Tooling only. Port 5173 is the application and is never touched.
 *
 * Live updates use Server-Sent Events rather than a poll loop, so an idle
 * console costs approximately nothing while it is left open for hours. State is
 * read from durable files, so a refresh or reconnect replays real history
 * instead of showing an empty page.
 */
import { createServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { machineHeat } from "../puppy/heat.mjs";
import { repoRoot, toolsRoot } from "../paths.mjs";
import { DemoMediatorSession } from "./demoSession.mjs";
import { MODES, MODE_AUTO } from "./router.mjs";
import { avatarSvgPath, consoleStatePath, ensureMediatorDirs } from "./paths.mjs";
import { loadIdentity, provisionalIdentity } from "./identity.mjs";
import { loadRegistry, registryView } from "./modelRegistry.mjs";
import { puppySkillProfile } from "./skillProfile.mjs";
import { puppyPanel } from "./puppyState.mjs";
import { readCatalog } from "./modelDiscovery.mjs";
import { readEvents } from "./eventLog.mjs";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Mediator port range.
 *
 * Chosen by runtime inspection, not by preference. Two existing tooling surfaces
 * already claim ranges and will silently take a port during discovery:
 *   Puppy watch   5176, 5177, 5178, 5179, 5181   (watch.mjs WATCH_PORT_SCAN)
 *   Singularity harness  5174, 5175, 5180, 5182, 5183, 5184  (captureHarness.mjs PORT_SCAN)
 * 5173 is the application and is never touched.
 *
 * 5185+ is the first band claimed by neither, so the Mediator lives there and
 * no existing tooling file had to change to make room for it.
 */
export const MEDIATOR_PORT = 5185;
export const MEDIATOR_PORT_FALLBACKS = [5186, 5187, 5188];
export const APP_PORT = 5173;

const PUPPY_AVATAR = join(toolsRoot, "assets", "robo-puppy.jpg");
const PUPPY_BARK = join(toolsRoot, "assets", "robo-puppy-bark.mp3");

export function portFree(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const s = createNetServer();
    s.once("error", () => resolve(false));
    s.once("listening", () => s.close(() => resolve(true)));
    s.listen(port, host);
  });
}

/** Never kill an unrelated process. Fail clearly instead. */
export async function pickPort({ preferred = MEDIATOR_PORT, fallbacks = MEDIATOR_PORT_FALLBACKS } = {}) {
  if (preferred === APP_PORT) throw new Error("refusing to bind port 5173 (the application)");
  if (await portFree(preferred)) return preferred;
  for (const p of fallbacks) {
    if (await portFree(p)) return p;
  }
  throw new Error(
    `Mediator port ${preferred} is occupied and no documented fallback (${fallbacks.join(", ")}) is free. `
    + "Free one of those ports or pass --port. Nothing was killed.",
  );
}

function send(res, code, body, type = "text/plain; charset=utf-8") {
  res.writeHead(code, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(body);
}

function sendJson(res, code, obj) {
  send(res, code, JSON.stringify(obj), "application/json; charset=utf-8");
}

async function readBody(req, limit = 1_000_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error("body too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function pageHtml() {
  return readFileSync(join(here, "console-page.html"), "utf8");
}

export function startMediatorServer({ port = MEDIATOR_PORT, host = "127.0.0.1", log = () => {} } = {}) {
  ensureMediatorDirs();

  /** @type {import("./session.mjs").MediatorSession | null} */
  let session = null;
  const clients = new Set();

  const broadcast = () => {
    const payload = JSON.stringify(buildState());
    for (const res of clients) {
      try {
        res.write(`data: ${payload}\n\n`);
      } catch {
        clients.delete(res);
      }
    }
  };

  function buildState() {
    const identity = loadIdentity() || provisionalIdentity();
    const reg = loadRegistry();
    const snap = session ? session.snapshot() : null;
    const events = session ? readEvents(session.runId, { limit: 200 }) : [];
    const noActiveRun = !snap || ["IDLE", "STOPPED", "COMPLETE", "FAILED"].includes(snap.state);
    const puppy = puppyPanel({
      missionId: snap?.missionId || null,
      hints: {
        dispatchedAt: snap?.dispatchedAt || null,
        lastDecision: snap?.lastDecision || null,
        providerError: snap?.providerError || null,
        noActiveRun,
        lastRunCompleted: snap?.state === "COMPLETE",
        // Only assert "unbound" when this console owns a run that has no mission
        // on disk (a fixture run). With no session of our own, a mission may be
        // running from the CLI, and the real runner state must show through —
        // leaving this undefined lets puppyStatus() report it.
        missionBound: snap ? Boolean(snap.missionId) : undefined,
        workerBusy: Boolean(snap?.workerBusy),
        awaitingDeep: Boolean(snap?.awaitingDeep),
        runBlocked: snap?.state === "BLOCKED" ? snap.blockedReason : null,
      },
    });

    return {
      at: Date.now(),
      identity,
      identityIsProvisional: Boolean(identity.provisional),
      run: snap,
      events,
      puppy,
      heat: machineHeat(),
      models: registryView(reg, readCatalog()),
      profile: puppySkillProfile({ includeSimulated: true }),
      modes: MODES,
    };
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://${host}`);
    const p = url.pathname;

    if (p === "/" || p === "/index.html") return send(res, 200, pageHtml(), "text/html; charset=utf-8");

    if (p === "/assets/mediator-avatar.svg") {
      if (!existsSync(avatarSvgPath)) return send(res, 404, "no avatar yet");
      return send(res, 200, readFileSync(avatarSvgPath, "utf8"), "image/svg+xml; charset=utf-8");
    }
    if (p === "/assets/puppy.jpg") {
      if (!existsSync(PUPPY_AVATAR)) return send(res, 404, "no puppy avatar");
      res.writeHead(200, { "Content-Type": "image/jpeg", "Cache-Control": "no-store" });
      return res.end(readFileSync(PUPPY_AVATAR));
    }
    if (p === "/bark.mp3") {
      if (!existsSync(PUPPY_BARK)) return send(res, 404, "no bark");
      res.writeHead(200, { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" });
      return res.end(readFileSync(PUPPY_BARK));
    }

    if (p === "/api/state") return sendJson(res, 200, buildState());

    if (p === "/api/stream") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write(`data: ${JSON.stringify(buildState())}\n\n`);
      clients.add(res);
      const keepAlive = setInterval(() => {
        try {
          res.write(": ping\n\n");
        } catch {
          /* dropped below */
        }
      }, 25000);
      req.on("close", () => {
        clearInterval(keepAlive);
        clients.delete(res);
      });
      return undefined;
    }

    if (p === "/api/control" && req.method === "POST") {
      let body;
      try {
        body = JSON.parse(await readBody(req));
      } catch (err) {
        return sendJson(res, 400, { ok: false, error: String(err?.message || err) });
      }
      const out = await handleControl(body);
      broadcast();
      return sendJson(res, out.ok ? 200 : 400, out);
    }

    return send(res, 404, "not found");
  });

  async function handleControl(body) {
    const action = String(body?.action || "");
    switch (action) {
      case "start": {
        if (session && ["RUNNING", "PAUSING", "STOPPING"].includes(session.state)) {
          return { ok: false, error: "a run is already active" };
        }
        const brief = String(body.brief ?? "");
        if (!brief.trim()) return { ok: false, error: "a mission brief is required" };
        // Only the fixture dispatcher is reachable from the UI. A real
        // production mission requires explicit human authorization on the CLI.
        session = new DemoMediatorSession({
          brief,
          mode: MODES.includes(body.mode) ? body.mode : MODE_AUTO,
          maxTasks: Number(body.maxTasks) || 12,
          log: (m) => { log(m); broadcast(); },
        });
        const original = session.emit.bind(session);
        session.emit = (e) => { const r = original(e); broadcast(); return r; };
        session.start();
        return { ok: true, runId: session.runId };
      }
      case "mode": {
        if (!session) return { ok: false, error: "no active run" };
        if (!MODES.includes(body.mode)) return { ok: false, error: `unknown mode: ${body.mode}` };
        session.setMode(body.mode);
        return { ok: true };
      }
      case "escalate":
        if (!session) return { ok: false, error: "no active run" };
        session.escalateNow();
        return { ok: true };
      case "pause":
        if (!session) return { ok: false, error: "no active run" };
        session.pauseAfterCurrentTask();
        return { ok: true };
      case "resume":
        if (!session) return { ok: false, error: "no active run" };
        return { ok: session.resume(), error: session.state === "PAUSED" ? null : "run is not paused" };
      case "stop":
        if (!session) return { ok: false, error: "no active run" };
        session.stopSafely({ cancelInFlight: Boolean(body.cancelInFlight) });
        return { ok: true };
      default:
        return { ok: false, error: `unknown action: ${action}` };
    }
  }

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      const url = `http://${host}:${port}/`;
      log(`Mediator console: ${url}`);
      resolve({
        server,
        url,
        port,
        close: () => new Promise((r) => {
          for (const c of clients) { try { c.end(); } catch { /* closing */ } }
          clients.clear();
          if (session) session.stopSafely({ cancelInFlight: true });
          server.close(() => r());
        }),
        get session() { return session; },
        buildState,
      });
    });
  });
}

export { repoRoot, consoleStatePath };
