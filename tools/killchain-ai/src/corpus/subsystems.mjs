/** Subsystem + danger maps. Derived from repository layout, not speculation. */

export const SUBSYSTEMS = [
  { id: "constitution", match: (p) => /AGENTS\.md$/i.test(p) || p.includes("tools/killchain-ai/constitution") },
  { id: "architecture", match: (p) => p.startsWith("docs/") },
  { id: "engine", match: (p) => p === "src/audio/AudioEngine.ts" },
  { id: "dsp", match: (p) => p.startsWith("src/audio/dsp/") },
  { id: "audio", match: (p) => p.startsWith("src/audio/") },
  { id: "mission-state", match: (p) => p.includes("missionStateStore") },
  { id: "mission-log", match: (p) => p.includes("missionLogStore") || p.includes("MissionLog") || p.includes("MissionHUD") },
  { id: "ownership", match: (p) => p.includes("sourceArbiter") },
  { id: "playback", match: (p) => p.includes("playerStore") || p.includes("TransportBar") || p.includes("MiniPlayer") },
  { id: "audio-state", match: (p) => p.includes("audioStore") || p.includes("eqStore") },
  { id: "health", match: (p) => p.includes("appHealth") },
  { id: "fire", match: (p) => /fire/i.test(p) && (p.startsWith("src/components/FireCommand") || p.startsWith("src/state/fire") || p.includes("FireCommandSynth") || p.includes("FireDrum")) },
  { id: "airspace", match: (p) => /airspace/i.test(p) },
  { id: "tractor", match: (p) => /tractor/i.test(p) || p.includes("targetLock") || p.includes("lockLibrary") },
  { id: "export", match: (p) => p.includes("bounceExport") || p.includes("fireStudio") || p.includes("offlineRestore") },
  { id: "library", match: (p) => p.includes("libraryStore") || p.startsWith("src/components/Library") },
  { id: "sculptor", match: (p) => p.startsWith("src/components/Playground") || p.includes("chainSnapshot") },
  { id: "dimension", match: (p) => /dimension/i.test(p) || p.includes("Spatializer3D") || p.includes("HRTFRooms") },
  { id: "scope", match: (p) => p.includes("Scope") || p.includes("visualIntel") || p.includes("vizBroadcast") },
  { id: "settings", match: (p) => p.includes("settingsStore") || p.startsWith("src/components/Settings") },
  { id: "calibration", match: (p) => /calibrat/i.test(p) || p.includes("headphoneProfiles") || p.includes("deviceProfiles") },
  { id: "electron", match: (p) => p.startsWith("electron/") },
  { id: "validation", match: (p) => p.startsWith("scripts/") || p === "package.json" },
  { id: "state", match: (p) => p.startsWith("src/state/") },
  { id: "lib", match: (p) => p.startsWith("src/lib/") },
  { id: "ui", match: (p) => p.startsWith("src/components/") || p.startsWith("src/hooks/") },
  { id: "root", match: () => true },
];

export function subsystemFor(posixPath) {
  for (const s of SUBSYSTEMS) {
    if (s.match(posixPath)) return s.id;
  }
  return "root";
}

/** Paths whose edits require human approval per AGENTS.md (audio behavior / major product). */
export const DANGER_PATH_PREFIXES = [
  "src/audio/dsp/",
  "src/audio/profiles/",
];

export const DANGER_PATHS = new Set([
  "src/audio/AudioEngine.ts",
  "src/audio/AutoFlatten.ts",
  "src/audio/defaultCorrectionProfile.ts",
  "src/audio/headphoneProfiles.ts",
  "src/audio/deviceProfiles.ts",
  "src/audio/presets.ts",
  "src/lib/tractorLock.ts",
  "src/lib/tractorAutoLock.ts",
  "src/lib/targetLock.ts",
  "src/lib/tractorBeam.ts",
  "src/lib/tractorLive.ts",
  "src/lib/adaptiveEngine.ts",
  "electron/main.ts",
]);

export const SENSITIVE_SYMBOLS = new Set([
  "rewireFront",
  "connectFrontChain",
  "connectGraph",
  "claimSource",
  "runPipeline",
  "initMissionState",
  "stopMissionState",
  "noteManualOverride",
  "setBypass",
  "setDimensionActive",
  "attachAudioElement",
  "attachMicStream",
  "reportStorageFailure",
]);

export function isDangerPath(posixPath) {
  if (DANGER_PATHS.has(posixPath)) return true;
  return DANGER_PATH_PREFIXES.some((pre) => posixPath.startsWith(pre));
}

export const STORE_ENGINE_PAIRS = [
  { store: "src/state/audioStore.ts", engine: "src/audio/AudioEngine.ts", note: "params, bypass, correction, restore, clarity, room, balance, gain" },
  { store: "src/state/playerStore.ts", engine: "src/audio/AudioEngine.ts", note: "file/loopback attach via attachAudioElement / attachMicStream" },
  { store: "src/state/dimensionStore.ts", engine: "src/audio/AudioEngine.ts", note: "setDimensionActive / setDimensionSignal" },
  { store: "src/state/fireCommandStore.ts", engine: "src/audio/AudioEngine.ts", note: "FireCommandSynth into inputBus" },
];

export const VALIDATION_COMMANDS = [
  { cmd: "npm run typecheck", when: "normal changes", source: "AGENTS.md VALIDATION" },
  { cmd: "npm run build", when: "normal changes (after typecheck)", source: "AGENTS.md VALIDATION" },
  { cmd: "npm run smoke", when: "critical audio, routing, playback, state, device, or export", source: "AGENTS.md VALIDATION" },
  { cmd: "npm run distort-hunt", when: "Fire distortion diagnostics", source: "AGENTS.md VALIDATION" },
  { cmd: "npm run leak-check", when: "resource / analyser leak suspicion", source: "AGENTS.md VALIDATION" },
  { cmd: "npm run project-repro", when: "Fire project round-trip", source: "AGENTS.md VALIDATION" },
  { cmd: "npm run soak", when: "long-session stability", source: "AGENTS.md VALIDATION" },
  { cmd: "npm run heap-diff", when: "heap growth", source: "AGENTS.md VALIDATION" },
];

export const TEST_FILE_HINTS = [
  { path: "scripts/smoke.mjs", covers: ["AudioEngine", "missionStateStore", "claimSource", "sourceArbiter", "bounceExport", "playerStore", "setBypass", "setDimensionActive"] },
  { path: "scripts/smoke-page.js", covers: ["AudioEngine", "missionStateStore", "claimSource", "rewireFront", "setBypass", "SourceMemory", "fireSequencerStore"] },
  { path: "scripts/fire-leak-check.mjs", covers: ["FireCommandSynth", "fireCommandStore"] },
  { path: "scripts/fire-heap-diff.mjs", covers: ["FireCommandView", "fireCommandStore"] },
  { path: "scripts/fire-distort-hunt.mjs", covers: ["FireCommandSynth", "distortionProbe"] },
  { path: "scripts/fire-export-check.mjs", covers: ["fireStudio", "bounceExport"] },
  { path: "src/lib/testHooks.ts", covers: ["__KC_TEST", "smoke"] },
];
