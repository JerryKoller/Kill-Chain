import { parseMarkdownFile } from "./parseMd.mjs";
import { findAgentsMd, repoRel } from "../paths.mjs";
import { VALIDATION_COMMANDS } from "./subsystems.mjs";

const HARD_INVARIANTS = [
  {
    id: "inv-rewireFront",
    symbol: "rewireFront",
    text: "Only rewireFront() may mutate front routing gains.",
    tags: ["rewireFront", "front-routing", "AudioEngine"],
  },
  {
    id: "inv-claimSource",
    symbol: "claimSource",
    text: "Only claimSource() may decide playback ownership.",
    tags: ["claimSource", "sourceArbiter", "one-audible-source"],
  },
  {
    id: "inv-mission-state",
    symbol: "initMissionState",
    text: "Only MISSION STATE may react to source changes.",
    tags: ["Mission State", "runPipeline", "no-new-watchers"],
  },
  {
    id: "inv-finally-disconnect",
    symbol: null,
    text: "Live audio-tap nodes must be disconnected in finally blocks.",
    tags: ["finally", "resource-leak", "ScriptProcessorNode"],
  },
  {
    id: "inv-timer-cleanup",
    symbol: "stopMissionState",
    text: "Intervals and requestAnimationFrame loops must be cleaned up.",
    tags: ["setInterval", "requestAnimationFrame", "unmount"],
  },
  {
    id: "inv-store-engine-sync",
    symbol: "setBypass",
    text: "Store writes and matching AudioEngine calls must occur in the same synchronous action.",
    tags: ["audioStore", "AudioEngine", "stale-state"],
  },
  {
    id: "inv-reportStorageFailure",
    symbol: "reportStorageFailure",
    text: "Persistence failures must call reportStorageFailure.",
    tags: ["persist", "localStorage", "appHealth"],
  },
  {
    id: "inv-one-source",
    symbol: "claimSource",
    text: "Preserve the one-audible-source rule.",
    tags: ["claimSource", "double-playback"],
  },
  {
    id: "inv-one-fft",
    symbol: null,
    text: "Preserve the one-high-rate-FFT-pipeline design unless explicitly authorized otherwise.",
    tags: ["visualIntel", "analyser", "FFT"],
  },
];

const MISSION_PRIORITY = {
  id: "inv-mission-priority",
  text: "MISSION STATE priority: manual override > saved source memory > Auto-Lock > Auto-Flatten. Do not change this order without approval.",
  tags: ["Mission State", "manualHold", "Auto-Lock", "Auto-Flatten"],
};

const AUDIO_APPROVAL = [
  "DSP algorithms",
  "EQ curves",
  "correction profiles",
  "gain staging",
  "limiter/compressor behavior",
  "transient processing",
  "saturation",
  "restoration algorithms",
  "spatialization",
  "3D behavior",
  "crossover behavior",
  "loudness targets",
  "preset tuning",
];

function findLine(sections, needle) {
  for (const s of sections) {
    if (s.text.includes(needle) || s.title.includes(needle)) {
      const idx = s.text.split(/\r?\n/).findIndex((l) => l.includes(needle));
      return {
        path: s.path,
        lineStart: idx >= 0 ? s.lineStart + idx : s.lineStart,
        lineEnd: s.lineEnd,
        section: s.title,
      };
    }
  }
  return null;
}

/**
 * First-class invariant / danger / validation chunks. Every fact cites
 * AGENTS.md or architecture docs — never unsourced.
 */
export function buildInvariantChunks(gitCommit, archMd, perfMd) {
  const agents = findAgentsMd();
  if (!agents) {
    throw new Error(
      "AGENTS.md not found. Expected C:\\Users\\Zero\\Desktop\\Sony_Project\\Kill-Chain-AI\\AGENTS.md",
    );
  }
  const parsed = parseMarkdownFile(agents.abs, repoRel(agents.abs), { agentsEscapes: true });
  const chunks = [];

  chunks.push({
    id: "constitution:agents:full-toc",
    type: "constitution",
    subsystem: "constitution",
    path: parsed.sections[0] ? repoRel(agents.abs) : agents.rel,
    symbol: null,
    kind: "document",
    lineStart: 1,
    lineEnd: parsed.lineCount,
    title: "Kill Chain AI constitution (AGENTS.md)",
    text: parsed.sections.map((s) => s.text).join("\n\n").slice(0, 14000),
    relationships: { imports: [], importedBy: [], calls: [], calledBy: [], tests: [] },
    gitCommit,
    sources: [{ path: agents.rel, lineStart: 1, lineEnd: parsed.lineCount, origin: agents.source }],
    danger: false,
    tags: ["AGENTS.md", "constitution"],
  });

  for (const sec of parsed.sections) {
    chunks.push({
      id: `constitution:${slug(sec.title)}:${sec.lineStart}`,
      type: "constitution",
      subsystem: "constitution",
      path: agents.rel,
      symbol: null,
      kind: "heading",
      lineStart: sec.lineStart,
      lineEnd: sec.lineEnd,
      title: `AGENTS.md — ${sec.title}`,
      text: sec.text,
      relationships: { imports: [], importedBy: [], calls: [], calledBy: [], tests: [] },
      gitCommit,
      sources: [{ path: agents.rel, lineStart: sec.lineStart, lineEnd: sec.lineEnd, origin: agents.source }],
      danger: /approval|AUDIO BEHAVIOR|MAJOR PRODUCT/i.test(sec.title + sec.text),
      tags: ["AGENTS.md", sec.title],
    });
  }

  for (const inv of HARD_INVARIANTS) {
    const loc = findLine(parsed.sections, inv.text.slice(0, 40)) || findLine(parsed.sections, inv.symbol || "PRIMARY");
    const archLoc = archMd && findLine(archMd.sections, inv.symbol || inv.text.slice(0, 24));
    const sources = [];
    if (loc) sources.push({ path: agents.rel, lineStart: loc.lineStart, lineEnd: loc.lineEnd, quote: inv.text });
    else sources.push({ path: agents.rel, lineStart: 1, lineEnd: parsed.lineCount, quote: inv.text });
    if (archLoc) {
      sources.push({
        path: archMd.path,
        lineStart: archLoc.lineStart,
        lineEnd: archLoc.lineEnd,
        quote: inv.symbol,
      });
    }
    chunks.push({
      id: `invariant:${inv.id}`,
      type: "invariant",
      subsystem: "architecture",
      path: sources[0].path,
      symbol: inv.symbol,
      kind: "rule",
      lineStart: sources[0].lineStart,
      lineEnd: sources[0].lineEnd,
      title: `Invariant — ${inv.text}`,
      text: inv.text + (archLoc ? `\n\nAlso stated in docs/audio-state-machine.md (${archLoc.section}).` : ""),
      relationships: { imports: [], importedBy: [], calls: [], calledBy: [], tests: ["scripts/smoke-page.js"] },
      gitCommit,
      sources,
      danger: true,
      tags: ["invariant", ...inv.tags],
    });
  }

  const prioLoc = findLine(parsed.sections, "manual override") || findLine(parsed.sections, "MISSION STATE");
  chunks.push({
    id: "invariant:mission-priority",
    type: "invariant",
    subsystem: "mission-state",
    path: agents.rel,
    symbol: "runPipeline",
    kind: "rule",
    lineStart: prioLoc?.lineStart ?? 102,
    lineEnd: prioLoc?.lineEnd ?? 116,
    title: "Mission State priority order",
    text: MISSION_PRIORITY.text,
    relationships: {
      imports: ["src/state/missionStateStore.ts"],
      importedBy: [],
      calls: ["tryMemoryRestore", "tryLockRestore", "tryAutoLockScan", "tryAutoFlatten"],
      calledBy: ["pollOnce"],
      tests: ["scripts/smoke-page.js"],
    },
    gitCommit,
    sources: [{ path: agents.rel, lineStart: prioLoc?.lineStart ?? 102, lineEnd: prioLoc?.lineEnd ?? 116, quote: MISSION_PRIORITY.text }],
    danger: true,
    tags: MISSION_PRIORITY.tags,
  });

  chunks.push({
    id: "danger:audio-behavior-approval",
    type: "danger",
    subsystem: "dsp",
    path: agents.rel,
    symbol: null,
    kind: "rule",
    lineStart: 117,
    lineEnd: 154,
    title: "Audio behavior requires human approval",
    text:
      "Do not autonomously alter: " +
      AUDIO_APPROVAL.join("; ") +
      ". You may investigate and propose such changes, but ask before implementing them.",
    relationships: { imports: [], importedBy: [], calls: [], calledBy: [], tests: [] },
    gitCommit,
    sources: [{ path: agents.rel, lineStart: 117, lineEnd: 154 }],
    danger: true,
    tags: ["approval", "DSP", "human-approval"],
  });

  chunks.push({
    id: "danger:major-product-approval",
    type: "danger",
    subsystem: "constitution",
    path: agents.rel,
    symbol: null,
    kind: "rule",
    lineStart: 155,
    lineEnd: 176,
    title: "Major product changes require human approval",
    text: "Do not autonomously: remove features; redesign major UI flows; change persistence formats; add major dependencies; introduce new frameworks; change installer/release behavior; add major new features.",
    relationships: { imports: [], importedBy: [], calls: [], calledBy: [], tests: [] },
    gitCommit,
    sources: [{ path: agents.rel, lineStart: 155, lineEnd: 176 }],
    danger: true,
    tags: ["approval", "product"],
  });

  for (const v of VALIDATION_COMMANDS) {
    chunks.push({
      id: `validation:${v.cmd.replace(/\s+/g, "-")}`,
      type: "validation",
      subsystem: "validation",
      path: agents.rel,
      symbol: null,
      kind: "command",
      lineStart: 177,
      lineEnd: 222,
      title: `Validation — ${v.cmd}`,
      text: `${v.cmd}\nWhen: ${v.when}\nNever claim a test passed unless you actually ran it successfully.\nSource: ${v.source}`,
      relationships: { imports: [], importedBy: [], calls: [], calledBy: [], tests: [] },
      gitCommit,
      sources: [{ path: agents.rel, lineStart: 177, lineEnd: 222, quote: v.cmd }],
      danger: false,
      tags: ["validation", v.cmd],
    });
  }

  if (perfMd) {
    for (const sec of perfMd.sections) {
      chunks.push(mdChunk("architecture", "architecture", sec, gitCommit, ["performance"]));
    }
  }

  return { agents, chunks };
}

export function mdChunk(type, subsystem, sec, gitCommit, extraTags = []) {
  return {
    id: `${type}:${sec.path}:${sec.lineStart}`,
    type,
    subsystem,
    path: sec.path,
    symbol: null,
    kind: "heading",
    lineStart: sec.lineStart,
    lineEnd: sec.lineEnd,
    title: `${sec.path} — ${sec.title}`,
    text: sec.text,
    relationships: { imports: [], importedBy: [], calls: [], calledBy: [], tests: type === "architecture" ? ["scripts/smoke.mjs"] : [] },
    gitCommit,
    sources: [{ path: sec.path, lineStart: sec.lineStart, lineEnd: sec.lineEnd }],
    danger: /invariant|rewireFront|claimSource|MISSION/i.test(sec.title + sec.text),
    tags: extraTags.concat(sec.title),
  };
}

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "section";
}
