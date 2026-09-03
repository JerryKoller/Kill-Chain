/**
 * Mission-owned dirty-file attribution.
 *
 * Porcelain `xy + path` is not a content identity: editing an already-dirty
 * file keeps ` M path`, so the runner used to report "0 allowed files" and
 * skip restoring plan-critic writes. This module fingerprints bytes, stores
 * lossless copies, and restores exact pre-phase state without `git checkout`.
 */
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { missionsDataDir, repoRoot } from "../paths.mjs";
import { GENERATED_SIDE_EFFECTS, gitShowHead, isAppPath, isToolingPath } from "./gitops.mjs";
import { ID_RE, matchesAny, pathEditable, toPosixRel } from "./schema.mjs";

export const WRITE_INVOKE_PHASES = new Set(["edit", "repair"]);

export function phaseWritesApp(phase) {
  return WRITE_INVOKE_PHASES.has(String(phase || "").split("-")[0]);
}

export function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

export function blobPath(root, rel) {
  const parts = toPosixRel(rel).split("/").filter(Boolean);
  if (parts.some((p) => p === ".." || p === ".")) {
    throw new Error(`refusing path escape: ${rel}`);
  }
  return join(root, ...parts);
}

export function createFsIo(root, { readHead } = {}) {
  return {
    root,
    exists(rel) {
      return existsSync(blobPath(root, rel));
    },
    read(rel) {
      const abs = blobPath(root, rel);
      if (!existsSync(abs)) return null;
      return readFileSync(abs);
    },
    write(rel, buf) {
      const abs = blobPath(root, rel);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, buf);
    },
    remove(rel) {
      const abs = blobPath(root, rel);
      if (!existsSync(abs)) return;
      const st = statSync(abs);
      if (st.isDirectory()) rmSync(abs, { recursive: true, force: true });
      else unlinkSync(abs);
    },
    readHead(rel) {
      if (readHead) return readHead(rel);
      if (root !== repoRoot) return null;
      return gitShowHead(rel, { cwd: root });
    },
  };
}

/**
 * Expand allowed/read patterns to concrete files so a glob allowlist is
 * fingerprinted before Qwen runs (otherwise a modified existing file looks
 * like a "new" path and restore would delete it).
 */
export function expandPatterns(root, patterns) {
  const out = [];
  const seen = new Set();
  const add = (p) => {
    const rel = toPosixRel(p);
    if (!rel || seen.has(rel)) return;
    seen.add(rel);
    out.push(rel);
  };
  for (const pat of patterns || []) {
    const g = toPosixRel(pat);
    if (!g || g.includes("..")) continue;
    if (!g.includes("*")) {
      add(g);
      continue;
    }
    const prefix = g.endsWith("/**")
      ? g.slice(0, -3)
      : g.slice(0, g.indexOf("*")).replace(/\/$/, "");
    const abs = prefix ? blobPath(root, prefix) : root;
    if (!existsSync(abs)) continue;
    const st = statSync(abs);
    if (st.isFile()) {
      if (matchesAny(prefix, [g])) add(prefix);
      continue;
    }
    const walk = (dir, rel) => {
      let ents;
      try {
        ents = readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const ent of ents) {
        if (ent.name === "node_modules" || ent.name === ".git" || ent.name === "dist") continue;
        const r = rel ? `${rel}/${ent.name}` : ent.name;
        if (ent.isDirectory()) walk(join(dir, ent.name), r);
        else if (matchesAny(r, [g])) add(r);
      }
    };
    walk(abs, prefix);
  }
  return out;
}

export function fingerprintBuffer(rel, buf) {
  const p = toPosixRel(rel);
  if (buf == null) {
    return { path: p, exists: false, hash: null, size: 0, crlf: false };
  }
  return {
    path: p,
    exists: true,
    hash: sha256(buf),
    size: buf.length,
    crlf: buf.includes(0x0d),
  };
}

export function fingerprintRel(io, rel) {
  return fingerprintBuffer(rel, io.read(rel));
}

export function collectWatchPaths(spec, porcelain = [], attribution = {}, io = null) {
  const paths = new Set();
  const add = (p) => {
    const rel = toPosixRel(p);
    if (!rel || GENERATED_SIDE_EFFECTS.includes(rel)) return;
    paths.add(rel);
  };
  for (const p of spec.allowedPaths || []) {
    if (!String(p).includes("*")) add(p);
  }
  if (io?.root) {
    for (const p of expandPatterns(io.root, spec.allowedPaths || [])) add(p);
  }
  for (const p of attribution.adopted || []) add(p);
  for (const p of attribution.preserved || []) add(p);
  for (const p of attribution.missionOwned || []) add(p);
  for (const p of attribution.watched || []) add(p);
  for (const row of porcelain || []) {
    if (!row?.path) continue;
    if (isToolingPath(row.path)) continue;
    if (!isAppPath(row.path) && !matchesAny(row.path, spec.allowedPaths || [])) continue;
    add(row.path);
  }
  return [...paths];
}

export function fingerprintPaths(io, paths, { includeBytes = false } = {}) {
  const files = {};
  for (const rel of paths) {
    const buf = io.read(rel);
    const fp = fingerprintBuffer(rel, buf);
    if (includeBytes && buf) fp.bytes = buf;
    files[toPosixRel(rel)] = fp;
  }
  return files;
}

export function diffFingerprints(before = {}, after = {}) {
  const paths = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changed = [];
  const added = [];
  const deleted = [];
  const unchanged = [];
  const hashes = {};
  for (const p of paths) {
    const a = before[p];
    const b = after[p];
    const aHash = a?.exists ? a.hash : null;
    const bHash = b?.exists ? b.hash : null;
    hashes[p] = { before: aHash, after: bHash };
    if (aHash === bHash && Boolean(a?.exists) === Boolean(b?.exists)) unchanged.push(p);
    else if (!a?.exists && b?.exists) added.push(p);
    else if (a?.exists && !b?.exists) deleted.push(p);
    else changed.push(p);
  }
  const dirty = [...changed, ...added, ...deleted];
  return { changed, added, deleted, unchanged, dirty, hashes };
}

export function snapshotNameDir(missionDir, name) {
  return join(missionDir, "attribution", name);
}

export function writeSnapshot(missionDir, name, { files = {}, meta = {} } = {}) {
  const dir = snapshotNameDir(missionDir, name);
  const filesDir = join(dir, "files");
  mkdirSync(filesDir, { recursive: true });
  const manifestFiles = {};
  for (const [rel, fp] of Object.entries(files)) {
    const rec = {
      path: toPosixRel(rel),
      exists: Boolean(fp.exists),
      hash: fp.hash || null,
      size: fp.size || 0,
      crlf: Boolean(fp.crlf),
    };
    manifestFiles[rec.path] = rec;
    if (fp.exists && fp.bytes) {
      const dest = blobPath(filesDir, rec.path);
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, fp.bytes);
    }
  }
  const manifest = { ...meta, files: manifestFiles };
  writeFileSync(join(dir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return { dir, manifest };
}

export function readSnapshot(missionDir, name) {
  const dir = snapshotNameDir(missionDir, name);
  const man = join(dir, "manifest.json");
  if (!existsSync(man)) return null;
  const manifest = JSON.parse(readFileSync(man, "utf8"));
  const filesDir = join(dir, "files");
  const files = {};
  for (const [rel, rec] of Object.entries(manifest.files || {})) {
    const blob = blobPath(filesDir, rel);
    const bytes = rec.exists && existsSync(blob) ? readFileSync(blob) : null;
    files[rel] = { ...rec, bytes };
  }
  return { dir, manifest, files };
}

/**
 * Restore exact snapshot bytes. Does not call git checkout.
 * Paths that appeared after the snapshot and are not in it are removed
 * (created during the phase) or listed in `removed`.
 */
export function restoreSnapshot(missionDir, name, io, { extraNowPaths = [] } = {}) {
  const snap = readSnapshot(missionDir, name);
  if (!snap) return { ok: false, restored: [], removed: [], missing: name };
  const restored = [];
  const removed = [];
  for (const [rel, rec] of Object.entries(snap.files)) {
    if (!rec.exists) {
      if (io.exists(rel)) {
        io.remove(rel);
        removed.push(rel);
      }
      continue;
    }
    if (!rec.bytes) continue;
    io.write(rel, rec.bytes);
    restored.push(rel);
  }
  for (const rel of extraNowPaths) {
    const p = toPosixRel(rel);
    if (snap.files[p]) continue;
    if (!io.exists(p)) continue;
    io.remove(p);
    removed.push(p);
  }
  return { ok: true, restored, removed };
}

export function loadParentMission(baseMissionId, dataRoot = missionsDataDir) {
  if (!baseMissionId) return null;
  if (!ID_RE.test(baseMissionId)) return { error: `invalid baseMissionId: ${baseMissionId}` };
  const dir = join(dataRoot, baseMissionId);
  const missionPath = join(dir, "mission.json");
  const statusPath = join(dir, "status.json");
  const attrPath = join(dir, "attribution.json");
  if (!existsSync(missionPath) || !existsSync(statusPath)) {
    return { error: `baseMissionId ${baseMissionId} has no persisted state` };
  }
  return {
    id: baseMissionId,
    dir,
    spec: JSON.parse(readFileSync(missionPath, "utf8")),
    status: JSON.parse(readFileSync(statusPath, "utf8")),
    attribution: existsSync(attrPath) ? JSON.parse(readFileSync(attrPath, "utf8")) : null,
  };
}

export function loadAdoptCheckpoint(spec, dataRoot = missionsDataDir) {
  const raw = String(spec.adoptCheckpoint || "").trim();
  if (!raw) return { files: [], error: null };
  if (raw.includes("..") || raw.startsWith("/") || /^[a-zA-Z]:/.test(raw)) {
    return { files: [], error: `adoptCheckpoint must be mission-relative: ${raw}` };
  }
  const posix = toPosixRel(raw);
  const parts = posix.split("/");
  const missionId = parts[0];
  if (!ID_RE.test(missionId)) return { files: [], error: `adoptCheckpoint mission id invalid: ${raw}` };
  let cdir;
  if (parts.length === 1) {
    cdir = join(dataRoot, missionId, "checkpoints");
    if (!existsSync(cdir)) return { files: [], error: `no checkpoints for ${missionId}` };
    const names = readdirSync(cdir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .filter((n) => /^\d+$/.test(n))
      .sort();
    if (!names.length) return { files: [], error: `no checkpoints for ${missionId}` };
    cdir = join(cdir, names[names.length - 1]);
  } else {
    cdir = join(dataRoot, ...parts);
  }
  const filesTxt = join(cdir, "files.txt");
  const files = existsSync(filesTxt)
    ? readFileSync(filesTxt, "utf8").split(/\r?\n/).map((s) => toPosixRel(s.trim())).filter(Boolean)
    : [];
  return { files, dir: cdir, error: existsSync(cdir) ? null : `adoptCheckpoint not found: ${raw}` };
}

/**
 * Classify preexisting dirt:
 *   adopted  — mission-owned, must be ⊆ allowedPaths
 *   preserved — foreign dirt, not edited, not reverted
 *   unexpected — BLOCK
 */
export function resolveAdoption(spec, porcelain = [], {
  parent = null,
  checkpointFiles = [],
} = {}) {
  const errors = [];
  const adopted = new Set();
  const preserved = new Set();
  const addAdopt = (p) => {
    const rel = toPosixRel(p);
    if (rel) adopted.add(rel);
  };
  const addPreserve = (p) => {
    const rel = toPosixRel(p);
    if (rel) preserved.add(rel);
  };

  for (const p of spec.adoptDirtyPaths || []) {
    if (!matchesAny(p, spec.allowedPaths || [])) {
      errors.push(`adoptDirtyPaths includes "${p}" which is outside allowedPaths`);
    } else addAdopt(p);
  }

  for (const p of [...(spec.preserveDirtyPaths || []), ...(spec.baselineDirtyPaths || [])]) {
    addPreserve(p);
  }

  if (spec.baseMissionId && parent?.error) errors.push(parent.error);
  if (parent?.spec) {
    const parentOwned = [
      ...(parent.attribution?.adopted || []),
      ...(parent.attribution?.missionOwned || []),
      ...(parent.status?.expectedAppDirty || []),
      ...(parent.spec.allowedPaths || []).filter((p) => !String(p).includes("*")),
    ];
    for (const p of parentOwned) {
      if (matchesAny(p, spec.allowedPaths || [])) addAdopt(p);
    }
    for (const row of porcelain) {
      if (!row?.path) continue;
      if (matchesAny(row.path, parent.spec.allowedPaths || []) && matchesAny(row.path, spec.allowedPaths || [])) {
        addAdopt(row.path);
      }
    }
  }

  for (const p of checkpointFiles || []) {
    if (matchesAny(p, spec.allowedPaths || [])) addAdopt(p);
    else errors.push(`adoptCheckpoint file "${p}" is outside allowedPaths`);
  }

  const dirtyApp = (porcelain || []).filter((r) => {
    if (!r?.path || r.path === "tsconfig.tsbuildinfo") return false;
    if (isToolingPath(r.path)) return false;
    return isAppPath(r.path);
  });

  const unexpected = [];
  for (const row of dirtyApp) {
    const p = row.path;
    if (matchesAny(p, [...adopted])) continue;
    if (matchesAny(p, [...preserved])) continue;
    unexpected.push(row);
  }

  return {
    errors,
    adopted: [...adopted],
    preserved: [...preserved],
    unexpected,
  };
}

export function adoptionPreflightErrors(resolved) {
  if (resolved.errors.length) return resolved.errors;
  if (!resolved.unexpected.length) return [];
  return [
    `worktree has unexpected application changes (not adopted or preserved):\n${resolved.unexpected.map((r) => `  ${r.xy} ${r.path}`).join("\n")}`,
  ];
}

export function captureBaseline(missionDir, spec, resolved, io, porcelain) {
  const watch = collectWatchPaths(spec, porcelain, {
    adopted: resolved.adopted,
    preserved: resolved.preserved,
    missionOwned: resolved.adopted,
  }, io);
  const files = fingerprintPaths(io, watch, { includeBytes: true });
  writeSnapshot(missionDir, "baseline", {
    files,
    meta: {
      kind: "baseline",
      at: new Date().toISOString(),
      adopted: resolved.adopted,
      preserved: resolved.preserved,
      allowedPaths: spec.allowedPaths || [],
    },
  });
  const attribution = {
    adopted: resolved.adopted,
    preserved: resolved.preserved,
    missionOwned: [...resolved.adopted],
    baseMissionId: spec.baseMissionId || "",
    adoptCheckpoint: spec.adoptCheckpoint || "",
    baseline: "baseline",
    watched: watch,
    readOnlyViolations: 0,
    automaticRestores: 0,
    phaseDeltas: [],
    totalMissionDiff: { dirty: [], hashes: {} },
  };
  writeFileSync(join(missionDir, "attribution.json"), `${JSON.stringify(attribution, null, 2)}\n`, "utf8");
  return attribution;
}

export function loadAttribution(missionDir) {
  const p = join(missionDir, "attribution.json");
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8"));
}

export function saveAttribution(missionDir, attribution) {
  writeFileSync(join(missionDir, "attribution.json"), `${JSON.stringify(attribution, null, 2)}\n`, "utf8");
}

export function restorePathToPre(io, rel, pre, snapRec, untrackedNow = new Set()) {
  const rec = (pre?.exists && pre.bytes) ? pre : (snapRec?.exists && snapRec.bytes ? snapRec : pre || snapRec);
  if (rec?.exists) {
    const bytes = rec.bytes || snapRec?.bytes;
    if (bytes) {
      io.write(rel, bytes);
      return "restored";
    }
  }
  if (pre && pre.exists === false) {
    if (io.exists(rel)) io.remove(rel);
    return "removed-new";
  }
  if (untrackedNow.has(rel) && io.exists(rel)) {
    io.remove(rel);
    return "removed-untracked";
  }
  if (typeof io.readHead === "function") {
    const head = io.readHead(rel);
    if (head) {
      io.write(rel, head);
      return "head";
    }
  }
  return "skipped";
}

function restoreUnauthorizedPaths(io, paths, preFiles, missionDir, key, untrackedNow) {
  const snap = readSnapshot(missionDir, key);
  for (const p of paths) {
    restorePathToPre(io, p, preFiles[p], snap?.files?.[p], untrackedNow);
  }
}

export function persistTotalMissionDiff(missionDir, spec, attribution, io, porcelain) {
  const baseline = readSnapshot(missionDir, "baseline");
  if (!baseline) return null;
  const watch = collectWatchPaths(spec, porcelain, attribution, io);
  const now = fingerprintPaths(io, watch);
  const delta = diffFingerprints(baseline.files, now);
  const rec = {
    kind: "total-mission",
    at: new Date().toISOString(),
    changed: delta.changed,
    added: delta.added,
    deleted: delta.deleted,
    dirty: delta.dirty,
    hashes: delta.hashes,
    missionOwned: attribution?.missionOwned || [],
  };
  mkdirSync(join(missionDir, "attribution"), { recursive: true });
  writeFileSync(join(missionDir, "attribution", "mission-diff.json"), `${JSON.stringify(rec, null, 2)}\n`, "utf8");
  if (attribution) attribution.totalMissionDiff = { dirty: rec.dirty, hashes: rec.hashes };
  return rec;
}

export function capturePhaseSnapshot(missionDir, key, spec, attribution, io, porcelain) {
  const watch = collectWatchPaths(spec, porcelain, attribution, io);
  if (attribution && Array.isArray(attribution.watched)) {
    attribution.watched = [...new Set([...attribution.watched, ...watch])];
  }
  const files = fingerprintPaths(io, watch, { includeBytes: true });
  writeSnapshot(missionDir, key, {
    files,
    meta: { kind: "phase", key, at: new Date().toISOString() },
  });
  return files;
}

export function enforcePhaseDelta({
  missionDir,
  key,
  preFiles,
  spec,
  io,
  porcelainNow = [],
  writesApp = false,
  attribution,
  quarantineNewFile,
}) {
  const watch = collectWatchPaths(spec, porcelainNow, attribution, io);
  const postFiles = fingerprintPaths(io, watch);
  const delta = diffFingerprints(preFiles, postFiles);
  const deltaRec = {
    key,
    writesApp,
    at: new Date().toISOString(),
    changed: delta.changed,
    added: delta.added,
    deleted: delta.deleted,
    dirty: delta.dirty,
    hashes: delta.hashes,
  };
  mkdirSync(join(missionDir, "attribution"), { recursive: true });
  writeFileSync(
    join(missionDir, "attribution", `${key}-delta.json`),
    `${JSON.stringify(deltaRec, null, 2)}\n`,
    "utf8",
  );

  const editable = (p) => pathEditable(p, spec, { dryRun: false });
  const allowed = delta.dirty.filter((p) => editable(p));
  const unauthorized = delta.dirty.filter((p) => !editable(p) && p !== "tsconfig.tsbuildinfo" && !isToolingPath(p));
  const untrackedNow = new Set((porcelainNow || []).filter((r) => r.untracked).map((r) => toPosixRel(r.path)));
  const extra = delta.added.filter((p) => !preFiles[p]?.exists);

  if (!writesApp && delta.dirty.length) {
    if (typeof quarantineNewFile === "function") {
      for (const p of extra) quarantineNewFile(p);
    }
    restoreSnapshot(missionDir, key, io, {
      extraNowPaths: extra.filter((p) => untrackedNow.has(p) || preFiles[p]?.exists === false),
    });
    restoreUnauthorizedPaths(io, delta.dirty, preFiles, missionDir, key, untrackedNow);
    return {
      ok: false,
      readOnlyViolation: true,
      delta: deltaRec,
      allowed: [],
      unauthorized: delta.dirty,
      restored: true,
    };
  }

  if (writesApp && unauthorized.length) {
    if (typeof quarantineNewFile === "function") {
      for (const p of unauthorized.filter((x) => extra.includes(x))) quarantineNewFile(p);
    }
    restoreUnauthorizedPaths(io, unauthorized, preFiles, missionDir, key, untrackedNow);
    return {
      ok: false,
      readOnlyViolation: false,
      delta: deltaRec,
      allowed,
      unauthorized,
      restored: true,
    };
  }

  if (writesApp) {
    const owned = new Set(attribution.missionOwned || attribution.adopted || []);
    for (const p of allowed) owned.add(p);
    attribution.missionOwned = [...owned];
  }

  return {
    ok: true,
    readOnlyViolation: false,
    delta: deltaRec,
    allowed,
    unauthorized: [],
    restored: false,
  };
}

export function writeLosslessCheckpoint(missionDir, n, {
  spec,
  status,
  attribution,
  io,
  porcelain,
  label,
  validation = null,
  head = null,
  phaseDelta = null,
}) {
  const cdir = join(missionDir, "checkpoints", String(n).padStart(2, "0"));
  mkdirSync(join(cdir, "files"), { recursive: true });
  const watch = collectWatchPaths(spec, porcelain, attribution, io);
  const files = fingerprintPaths(io, watch, { includeBytes: true });
  const changed = [];
  const baseline = readSnapshot(missionDir, "baseline");
  for (const [rel, fp] of Object.entries(files)) {
    const base = baseline?.files?.[rel];
    const baseHash = base?.exists ? base.hash : null;
    const nowHash = fp.exists ? fp.hash : null;
    if (baseHash !== nowHash || Boolean(base?.exists) !== Boolean(fp.exists)) changed.push(rel);
    if (fp.exists && fp.bytes) {
      const dest = blobPath(join(cdir, "files"), rel);
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, fp.bytes);
      const again = readFileSync(dest);
      if (sha256(again) !== fp.hash) {
        throw new Error(`lossless checkpoint hash mismatch for ${rel}`);
      }
    } else if (base?.exists && !fp.exists) {
      const dest = blobPath(join(cdir, "files"), rel);
      if (existsSync(dest)) unlinkSync(dest);
    }
  }
  const total = persistTotalMissionDiff(missionDir, spec, attribution, io, porcelain);
  const meta = {
    head,
    missionId: spec.id,
    phase: status.state,
    phaseIndex: status.phaseIndex,
    label,
    authorizedPaths: spec.allowedPaths || [],
    adopted: attribution.adopted || [],
    preserved: attribution.preserved || [],
    missionOwned: attribution.missionOwned || [],
    changedFiles: changed,
    hashes: Object.fromEntries(Object.entries(files).map(([p, fp]) => [p, { exists: fp.exists, hash: fp.hash, size: fp.size }])),
    validation,
    phaseDelta,
    totalMissionDiff: total ? { dirty: total.dirty, hashes: total.hashes } : null,
    at: new Date().toISOString(),
    recovery: "files/",
  };
  writeFileSync(join(cdir, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`, "utf8");
  writeFileSync(join(cdir, "files.txt"), `${changed.join("\n")}${changed.length ? "\n" : ""}`, "utf8");
  writeFileSync(join(cdir, "label.txt"), `${label}\n`, "utf8");
  writeFileSync(join(cdir, "status.json"), `${JSON.stringify({ ...status, _spec: undefined }, null, 2)}\n`, "utf8");
  return { dir: cdir, changed, meta };
}

export function restoreCheckpointFiles(cdir, files, io) {
  const restored = [];
  const failed = [];
  for (const rel of files) {
    const blob = blobPath(join(cdir, "files"), rel);
    if (!existsSync(blob)) {
      failed.push(rel);
      continue;
    }
    io.write(rel, readFileSync(blob));
    restored.push(rel);
  }
  return { ok: failed.length === 0, restored, failed };
}

export function defaultIo() {
  return createFsIo(repoRoot);
}
