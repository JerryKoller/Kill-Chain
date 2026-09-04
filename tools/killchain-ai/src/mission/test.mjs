import { mkdirSync, mkdtempSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseMissionMarkdown, pathEditable, matchPath } from "./schema.mjs";
import { assertTransition, ALLOWED_TRANSITIONS } from "./machine.mjs";
import { parseOpenCodeJsonl, visibleReportTooThin, buriedVerdict, openCodeRunArgs, parseOpenCodeTokens } from "./opencode.mjs";
import { DEFAULT_MISSION_MODEL, LIGHTNING_MODEL, normalizeModelId, ollamaHasModel } from "./model.mjs";
import { scanUnixTools } from "./unix.mjs";
import { parseCritic, parseMentionedPaths, proposalScopeCheck, checkReferencedFilesExist, evaluateArtifactGate, evaluateCriticGate, checkProposalConcrete, quarantineFitsDest, findWrongStackPaths, existingMarkedNew, findInventedInnerPanelFiles, criticGroundingOk } from "./critic.mjs";
import {
  TUTOR,
  classifyGateFailure,
  kindForError,
  hasSubstanceFor,
  criticFormatPacket,
  referencePacket,
  scopePacket,
  emptyEditPacket,
  validationPacket,
  substantivePacket,
  nearestValidReferences,
} from "./tutor.mjs";
import { LESSONS, PHASES, MIN_SUPPORT, eligibleLessons, selectLessons, formatLessons } from "./lessons.mjs";
import { assertMetrics } from "../ui/metrics.mjs";
import { scanStructure, jsxRepairPacket, fingerprintDelta } from "./jsxStructure.mjs";
import { checkIdentifiers, formatIdentifierPacket } from "./identifierGate.mjs";
import { ACTIONS, classifyFailure, escalate } from "./failureClass.mjs";
import { scanRepoFiles } from "./scanRepo.mjs";
import { repoRoot } from "../paths.mjs";
import { buildTeacherPacket, validateTeacherResponse, PACKET_BUDGET } from "./teacherPacket.mjs";
import { assertSafeMissionId } from "./schema.mjs";
import {
  classifyPorcelain,
  parsePorcelain,
  unauthorizedChanges,
  unexpectedJunk,
  diffCheckArgs,
  allowedAppDiffFiles,
  appDiffFiles,
  changesSince,
  missingCheckpointAppFiles,
  extractFilePatch,
} from "./gitops.mjs";
import { runPreflight } from "./preflight.mjs";
import { runValidation, npmSpawnSpec } from "./validate.mjs";
import { createMissionStore, loadMission, transition } from "./store.mjs";
import { runMission } from "./runner.mjs";
import {
  captureBaseline,
  capturePhaseSnapshot,
  createFsIo,
  enforcePhaseDelta,
  fingerprintRel,
  loadAttribution,
  persistTotalMissionDiff,
  phaseWritesApp,
  resolveAdoption,
  restoreCheckpointFiles,
  restoreSnapshot,
  sha256,
  writeLosslessCheckpoint,
} from "./attribution.mjs";
import { classifyEditOutcome, emptyEditPolicy, expectedEditFiles, isMutationTool, usedMutationTool } from "./editGate.mjs";
import { checkTsSyntax } from "./syntax.mjs";
import { clip, executePrompt, editPrompt } from "./prompts.mjs";
import { countFaults } from "../eval/editCurriculum.mjs";
import { parseHunks, reverseApplyHunk, classifyHunk, selfTest } from "../eval/mineHunks.mjs";
import { FAMILIES } from "../eval/mineEpisodes.mjs";

function ok(name, cond, detail = "") {
  if (cond) {
    console.log(`PASS  ${name}`);
    return true;
  }
  console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  return false;
}

const VALID_SPEC = `---
{
  "id": "test-valid",
  "title": "Valid mission",
  "goal": "Prove the spec parser works",
  "level": 0,
  "readOnlyPaths": ["src/components/FireCommand/**"],
  "acceptance": ["Produce a plan"],
  "validation": { "required": ["typecheck"] },
  "maxPhases": 4,
  "maxRetriesPerPhase": 2,
  "maxModelCalls": 8,
  "corpus": "never"
}
---

Body brief here.
`;

export async function runMissionTests() {
  let passed = 0;
  let failed = 0;
  const check = (name, cond, detail) => {
    if (ok(name, cond, detail)) passed += 1;
    else failed += 1;
  };

  const parsed = parseMissionMarkdown(VALID_SPEC);
  check("valid spec parses", parsed.ok && parsed.spec.id === "test-valid", parsed.errors?.join("; "));
  check("spec body captured", parsed.spec.brief.includes("Body brief"));

  const withModel = parseMissionMarkdown(`---
{
  "id": "model-override-spec",
  "title": "model",
  "goal": "g",
  "level": 0,
  "model": "ollama/nemotron-3.5-lightning:30b-a3b"
}
---
`);
  check("mission spec accepts model override", withModel.ok && withModel.spec.model === "ollama/nemotron-3.5-lightning:30b-a3b");
  check("default model id is Qwen", DEFAULT_MISSION_MODEL === "ollama/qwen3.5:9b");
  check("normalizeModelId prefixes ollama", normalizeModelId("nemotron-3.5-lightning:30b-a3b") === LIGHTNING_MODEL);
  check("ollamaHasModel does not treat Qwen as Lightning", !ollamaHasModel(["qwen3.5:9b"], LIGHTNING_MODEL));
  check("ollamaHasModel matches Lightning tag", ollamaHasModel(["nemotron-3.5-lightning:30b-a3b"], LIGHTNING_MODEL));
  const qwenArgs = openCodeRunArgs({ prompt: "p", title: "t", cwd: "C:/repo" });
  check("OpenCode default args omit -m so opencode.json Qwen remains default", !qwenArgs.includes("-m"));
  const litArgs = openCodeRunArgs({ prompt: "p", title: "t", cwd: "C:/repo", model: LIGHTNING_MODEL });
  check("OpenCode Lightning args pass -m", litArgs.includes("-m") && litArgs.includes(LIGHTNING_MODEL));

  const bad = parseMissionMarkdown("# no frontmatter\n");
  check("invalid spec rejected", !bad.ok);

  const audioAt2 = parseMissionMarkdown(`---
{
  "id": "bad-audio",
  "title": "nope",
  "goal": "edit engine",
  "level": 2,
  "allowedPaths": ["src/audio/AudioEngine.ts"]
}
---
`);
  check("level 2 cannot allow AudioEngine", !audioAt2.ok);

  try {
    assertTransition("CREATED", "COMPLETE");
    check("illegal transition throws", false);
  } catch {
    check("illegal transition throws", true);
  }
  check("PREFLIGHT → INVESTIGATING legal", ALLOWED_TRANSITIONS.PREFLIGHT.includes("INVESTIGATING"));

  check("glob FireCommand file", matchPath("src/components/FireCommand/LivePanel.tsx", "src/components/FireCommand/**"));
  check("glob does not match engine", !matchPath("src/audio/AudioEngine.ts", "src/components/FireCommand/**"));

  const dirty = parsePorcelain(" M src/state/uiStore.ts\n?? tools/killchain-ai/src/mission/foo.mjs\n");
  const classified = classifyPorcelain(dirty);
  check("dirty worktree detects app path", classified.app.some((r) => r.path === "src/state/uiStore.ts"));
  check("tooling dirty is not app", classified.app.length === 1 && classified.tools.length === 1);

  const toolMod = parsePorcelain(" M tools/killchain-ai/README.md\n");
  check(
    "leading-space porcelain keeps tools/ path",
    toolMod[0]?.path === "tools/killchain-ai/README.md" && classifyPorcelain(toolMod).tools.length === 1,
  );

  const specL2 = parseMissionMarkdown(`---
{
  "id": "scope-test",
  "title": "scope",
  "goal": "g",
  "level": 2,
  "allowedPaths": ["src/components/FireCommand/**"]
}
---
`).spec;
  const unauth = unauthorizedChanges([
    { path: "src/audio/AudioEngine.ts", xy: " M", untracked: false },
    { path: "src/components/FireCommand/LivePanel.tsx", xy: " M", untracked: false },
  ], specL2, { dryRun: false });
  check("unauthorized engine detected", unauth.unauthorized.some((r) => r.path.includes("AudioEngine")));
  check("allowed FireCommand kept", unauth.allowed.some((r) => r.path.includes("LivePanel")));

  const junk = unexpectedJunk([
    { path: "findings.md", xy: "??", untracked: true },
    { path: "tools/killchain-ai/data/missions/x/JOURNAL.md", xy: "??", untracked: true },
  ], specL2, { dryRun: true });
  check("junk findings.md detected", junk.some((j) => j.path === "findings.md"));
  check("mission data not junk", !junk.some((j) => j.path.includes("tools/killchain-ai")));

  const val = await runValidation(
    { validation: { required: ["typecheck"], restoreTsbuildinfo: false } },
    {
      snapshot: { porcelain: [] },
      run: async (name) => ({ name, ok: false, code: 1, stdout: "", stderr: "error TS123", durationMs: 3 }),
    },
  );
  check("failed typecheck is not ok", val.ok === false && val.results[0].code === 1);

  const npmSpec = npmSpawnSpec(["run", "typecheck"]);
  check(
    "windows npm spawn uses cmd.exe",
    process.platform === "win32"
      ? npmSpec.command === "cmd.exe" && npmSpec.args.includes("npm") && !npmSpec.args.includes("npm.cmd")
      : npmSpec.command === "npm",
  );

  const pfDirty = await runPreflight(specL2, {
    gitCapture: () => ({ commit: "abc", short: "abc", branch: "ai/kill-chain-agent", dirty: true }),
    gitPorcelain: () => parsePorcelain(" M src/state/uiStore.ts"),
    checkOllama: async () => ({ ok: true, names: ["qwen3.5:9b"] }),
    opencodeVersion: async () => "1.18.26",
    opencodeMcpList: async () => ({ connected: true, line: "killchain connected" }),
    loadCorpusManifest: () => ({ gitCommit: "abc" }),
    snapshotWorktree: () => ({ porcelain: parsePorcelain(" M src/state/uiStore.ts"), head: "abc" }),
  });
  check("dirty worktree preflight BLOCK", pfDirty.ok === false && /uiStore/.test(pfDirty.errors.join(" ")));

  const pfExpectedDirty = await runPreflight({
    ...specL2,
    allowedPaths: ["src/components/FireCommand/GatePanel.tsx"],
    baselineDirtyPaths: ["src/components/FireCommand/ModuleEnableToggle.tsx"],
  }, {
    gitCapture: () => ({ commit: "abc", short: "abc", branch: "ai/kill-chain-agent", dirty: true }),
    gitPorcelain: () => parsePorcelain(" M src/components/FireCommand/GatePanel.tsx\n M src/components/FireCommand/ModuleEnableToggle.tsx"),
    checkOllama: async () => ({ ok: true, names: ["qwen3.5:9b"] }),
    opencodeVersion: async () => "1.18.26",
    opencodeMcpList: async () => ({ connected: true, line: "killchain connected" }),
    loadCorpusManifest: () => ({ gitCommit: "abc" }),
    snapshotWorktree: () => ({ porcelain: parsePorcelain(" M src/components/FireCommand/GatePanel.tsx\n M src/components/FireCommand/ModuleEnableToggle.tsx"), head: "abc" }),
  });
  check(
    "12 unrelated dirty allowed file at start BLOCK unless adopted",
    pfExpectedDirty.ok === false && /GatePanel/.test(pfExpectedDirty.errors.join(" ")),
  );

  const pfAdopt = await runPreflight({
    ...specL2,
    allowedPaths: ["src/components/FireCommand/GatePanel.tsx"],
    adoptDirtyPaths: ["src/components/FireCommand/GatePanel.tsx"],
    preserveDirtyPaths: ["src/components/FireCommand/ModuleEnableToggle.tsx"],
  }, {
    gitCapture: () => ({ commit: "abc", short: "abc", branch: "ai/kill-chain-agent", dirty: true }),
    gitPorcelain: () => parsePorcelain(" M src/components/FireCommand/GatePanel.tsx\n M src/components/FireCommand/ModuleEnableToggle.tsx"),
    checkOllama: async () => ({ ok: true, names: ["qwen3.5:9b"] }),
    opencodeVersion: async () => "1.18.26",
    opencodeMcpList: async () => ({ connected: true, line: "killchain connected" }),
    loadCorpusManifest: () => ({ gitCommit: "abc" }),
    snapshotWorktree: () => ({ porcelain: parsePorcelain(" M src/components/FireCommand/GatePanel.tsx\n M src/components/FireCommand/ModuleEnableToggle.tsx"), head: "abc" }),
  });
  check(
    "adopted allowed + preserved foreign dirt preflight OK",
    pfAdopt.ok === true && /GatePanel/.test((pfAdopt.warnings || []).join(" ")),
  );

  check(
    "allowed app diff excludes baseline dirty toggle",
    allowedAppDiffFiles(
      ["src/components/FireCommand/GatePanel.tsx", "src/components/FireCommand/ModuleEnableToggle.tsx"],
      { ...specL2, allowedPaths: ["src/components/FireCommand/GatePanel.tsx"] },
    ).join(",") === "src/components/FireCommand/GatePanel.tsx",
  );

  const pfOllama = await runPreflight(parsed.spec, {
    gitCapture: () => ({ commit: "abc", short: "abc", branch: "ai/kill-chain-agent", dirty: false }),
    gitPorcelain: () => [],
    checkOllama: async () => ({ ok: false, error: "ECONNREFUSED" }),
    opencodeVersion: async () => "1.18.26",
    opencodeMcpList: async () => ({ connected: true, line: "killchain connected" }),
    loadCorpusManifest: () => ({ gitCommit: "abc" }),
    snapshotWorktree: () => ({ porcelain: [], head: "abc" }),
  });
  check("missing Ollama preflight BLOCK", pfOllama.ok === false && /Ollama/.test(pfOllama.errors.join(" ")));

  const pfMcp = await runPreflight(parsed.spec, {
    gitCapture: () => ({ commit: "abc", short: "abc", branch: "ai/kill-chain-agent", dirty: false }),
    gitPorcelain: () => [],
    checkOllama: async () => ({ ok: true, names: ["qwen3.5:9b"] }),
    opencodeVersion: async () => "1.18.26",
    opencodeMcpList: async () => ({ connected: false, line: "killchain disconnected" }),
    loadCorpusManifest: () => ({ gitCommit: "abc" }),
    snapshotWorktree: () => ({ porcelain: [], head: "abc" }),
  });
  check("MCP disconnected preflight BLOCK", pfMcp.ok === false && /MCP/.test(pfMcp.errors.join(" ")));

  check(
    "CRLF diff --check uses cr-at-eol",
    JSON.stringify(diffCheckArgs()) === JSON.stringify(["-c", "core.whitespace=cr-at-eol", "diff", "--check"]),
  );

  const unix = scanUnixTools([
    { tool: "bash", input: { command: "grep -r foo src" } },
    { tool: "killchain_search", input: { query: "grep in source comment" } },
  ]);
  check("unix bash+grep flagged", unix.some((v) => v.tool === "bash"));
  check("MCP search not flagged as unix", !unix.some((v) => v.tool === "killchain_search"));

  const emptyParsed = parseOpenCodeJsonl(
    `${JSON.stringify({ type: "reasoning", part: { type: "reasoning", text: "hidden only" } })}\n`,
  );
  check("no visible TEXT detected", emptyParsed.visibleTextMissing === true && emptyParsed.reasoning.includes("hidden"));

  const mcpParsed = parseOpenCodeJsonl(
    `${JSON.stringify({ type: "tool_use", part: { type: "tool", tool: "killchain_symbol" } })}\n${JSON.stringify({ type: "text", part: { type: "text", text: "hello" } })}\n`,
  );
  check("MCP first + visible text", mcpParsed.mcpFirst && mcpParsed.text === "hello");
  const tokParsed = parseOpenCodeJsonl(
    `${JSON.stringify({ type: "step_finish", part: { type: "step-finish", tokens: { total: 100, input: 80, output: 20, reasoning: 0 } } })}\n${JSON.stringify({ type: "step_finish", part: { type: "step-finish", tokens: { total: 250, input: 200, output: 50, reasoning: 4 } } })}\n`,
  );
  check("OpenCode tokens take last cumulative step_finish", tokParsed.tokens?.total === 250 && tokParsed.tokens?.output === 50);
  check("parseOpenCodeTokens standalone", parseOpenCodeTokens(`${JSON.stringify({ type: "step_finish", part: { type: "step-finish", tokens: { total: 9, input: 8, output: 1 } } })}\n`).total === 9);

  check("thin final TEXT is too thin", visibleReportTooThin("final", "I will inspect files now.", {}));
  check("long final TEXT is not thin", !visibleReportTooThin("final", "x".repeat(500), {}));
  check(
    "buried VERDICT recovered",
    buriedVerdict(`${"padding\n".repeat(40)}INSPECTED: foo\nVERDICT: READY\n`).includes("READY"),
  );
  check(
    "tooling path excluded from app diff",
    appDiffFiles(["tools/killchain-ai/src/mission/runner.mjs", "src/components/FireCommand/ModuleEnableToggle.tsx"]).length === 1,
  );
  check(
    "generated tsbuildinfo excluded from app diff",
    appDiffFiles(["tsconfig.tsbuildinfo", "src/components/FireCommand/fireUiKit.tsx"]).join(",") === "src/components/FireCommand/fireUiKit.tsx",
  );

  const criticFail = parseCritic("some thoughts\nVERDICT: FAIL\n- missing FireCommandView");
  check("critic FAIL parsed", criticFail.verdict === "FAIL" && criticFail.findings.length === 1);

  const mdVerdict = parseCritic("### INSPECTED\n- src/components/FireCommand/ModuleEnableToggle.tsx\n\n### RISK\nclick feel could change if hit area grows\n\n### EVIDENCE\nonClick still calls setModuleEnable\n\n### VERDICT\nPASS\n");
  check("markdown ### VERDICT PASS parses", !mdVerdict.missingVerdict && mdVerdict.verdict === "PASS" && mdVerdict.inspected.includes("ModuleEnableToggle"));
  const tickVerdict = parseCritic("INSPECTED: FireBreadcrumb.tsx\nRISK: jump hints could bypass Mission State\nEVIDENCE: hints would be UI-only fields\nVERDICT: `READY` with Evidence\n");
  check("backtick VERDICT READY parses", !tickVerdict.missingVerdict && tickVerdict.verdict === "READY");
  check("vue SFC paths are wrong-stack", findWrongStackPaths("edit `src/components/FireCommand/FireBreadcrumb.vue`").includes("src/components/FireCommand/FireBreadcrumb.vue"));
  const markedExisting = existingMarkedNew(" | `src/state/fireCommandStore.ts` | NEW FILE | jump hint state |");
  check("existing file labeled NEW FILE is flagged", markedExisting.includes("src/state/fireCommandStore.ts"));
  const vueGate = evaluateArtifactGate("NEW FILE `src/components/FireCommand/KeyboardHintBar.vue`", { allowedPaths: ["src/components/FireCommand/**"], forbiddenPaths: [], readOnlyPaths: [], level: 0 });
  check("artifact gate rejects .vue", !vueGate.ok && vueGate.errors.some((e) => e.startsWith("wrong-stack")));
  const metricOk = assertMetrics({
    viewport: { innerWidth: 1440 },
    byWidth: { "1440": [{ sel: "#gate-strip", found: true, overflowX: 0, gap: "4.8px", opacity: "1", truncated: false }] },
  }, [{ sel: "#gate-strip", width: 1440, maxOverflowX: 1, gapEquals: "4.8px", minOpacity: 0.5, notTruncated: true }]);
  check("UI metric harness accepts matching boxes", metricOk.ok);
  const metricBad = assertMetrics({
    viewport: { innerWidth: 1280 },
    byWidth: { "1280": [{ sel: "#gate-strip", found: true, overflowX: 40, gap: "20px", opacity: "1", truncated: true }] },
  }, [{ sel: "#gate-strip", width: 1280, maxOverflowX: 1, gapEquals: "4.8px", notTruncated: true }]);
  check("UI metric harness flags overflow/gap/truncation", !metricBad.ok && metricBad.failures.length >= 2);
  const metricTitle = assertMetrics({
    viewport: { innerWidth: 1440 },
    byWidth: { "1440": [{ sel: "[title='Rhythmic audio gate']", found: true, title: "Rhythmic audio gate", overflowX: 0, box: { w: 120 }, truncated: false }] },
  }, [{ sel: "[title='Rhythmic audio gate']", width: 1440, titleEquals: "Rhythmic audio gate", minBoxW: 40 }]);
  check("UI metric harness matches title and min width", metricTitle.ok);
  const criticInvented = evaluateCriticGate({
    criticText: "INSPECTED: src/components/FireCommand/DrivePanel.tsx\nRISK: canvas could be mistaken for a meter\nEVIDENCE: DriveStageViz only reads store\nVERDICT: READY\n",
    spec: { level: 0, allowedPaths: [], forbiddenPaths: [], readOnlyPaths: ["src/components/FireCommand/**"] },
    tools: ["killchain_search"],
    phase: "final",
  });
  check("final critic invented DrivePanel is rejected", criticInvented.errors.some((e) => String(e).includes("DrivePanel")));
  const bareInner = findInventedInnerPanelFiles("edit candidate DrivePanel.tsx and DelayPanel.tsx for the filter row");
  check(
    "bare DrivePanel.tsx / DelayPanel.tsx count as invented inner panels",
    bareInner.some((p) => p.includes("DrivePanel")) && bareInner.some((p) => p.includes("DelayPanel")),
  );
  const bareInnerGate = evaluateArtifactGate(
    "Intended modification: change DrivePanel.tsx contrast for the inner Drive module",
    { allowedPaths: ["src/components/FireCommand/**"], forbiddenPaths: [], readOnlyPaths: [], level: 2 },
  );
  check("artifact gate rejects bare invented inner panel files", !bareInnerGate.ok && bareInnerGate.errors.some((e) => String(e).includes("invented-inner-panel")));
  const forbidOnly = findInventedInnerPanelFiles("Do not invent DrivePanel.tsx or DelayPanel.tsx; those are inner FireCommandView functions.");
  check("forbidding invented inner panel names is not itself a citation", forbidOnly.length === 0);

  const existOk = checkReferencedFilesExist("inspect `src/components/FireCommand/ModuleEnableToggle.tsx`");
  check("valid existing UI file existence", existOk.ok);
  const mdBoldPath = parseMentionedPaths("- **src/state/sessionSnapshotsStore.ts** — Zustand store");
  check("markdown-bold src paths still parse", mdBoldPath.includes("src/state/sessionSnapshotsStore.ts"));

  const loosePaths = parseMentionedPaths("INSPECTED COMPONENTS\n### `Section` Component (fireUiKit.tsx:63)\nFcChip (fcChip.tsx:287)");
  check(
    "bare FireCommand basenames resolve if they exist",
    loosePaths.includes("src/components/FireCommand/fireUiKit.tsx") && loosePaths.includes("src/components/FireCommand/fcChip.tsx"),
    JSON.stringify(loosePaths),
  );

  const existBad = checkReferencedFilesExist("edit candidate `src/components/FireCommand/HomeBandContent.tsx`");
  check("invented HomeBandContent fails existence", !existBad.ok && existBad.missing.some((p) => p.includes("HomeBandContent")));

  const existBase = checkReferencedFilesExist("intended modification `src/components/FireCommand/ModuleEnableToggleBase.tsx`");
  check("invented ModuleEnableToggleBase fails existence", !existBase.ok);

  const specUi = parseMissionMarkdown(`---
{
  "id": "ui-scope",
  "title": "t",
  "goal": "g",
  "level": 1,
  "allowedPaths": ["src/components/FireCommand/ModuleEnableToggle.tsx"]
}
---
`).spec;
  const newFile = evaluateArtifactGate(
    "NEW FILE: `src/components/FireCommand/EnableGlow.tsx` intended modification create helper",
    specUi,
  );
  check("NEW FILE outside exact allowed path fails scope", !newFile.ok);

  const specGlob = parseMissionMarkdown(`---
{
  "id": "ui-glob",
  "title": "t",
  "goal": "g",
  "level": 2,
  "allowedPaths": ["src/components/FireCommand/**"]
}
---
`).spec;
  const newFileOk = evaluateArtifactGate(
    "NEW FILE: `src/components/FireCommand/EnableGlow.tsx` intended modification create helper",
    specGlob,
  );
  check("NEW FILE inside allowed glob passes existence+scope", newFileOk.ok && newFileOk.files.created.includes("src/components/FireCommand/EnableGlow.tsx"));

  const outside = evaluateArtifactGate(
    "intended modification change `src/state/uiStore.ts`",
    specUi,
  );
  check("proposal outside allowedPaths fails", !outside.ok && outside.scope.problems.some((p) => p.path.includes("uiStore")));

  const specDisc = parseMissionMarkdown(`---
{
  "id": "disc-scope",
  "title": "t",
  "goal": "g",
  "level": 0,
  "allowedPaths": [],
  "readOnlyPaths": ["src/components/FireCommand/**"]
}
---
`).spec;
  specDisc.dryRun = true;
  const future = evaluateArtifactGate(
    "intended modification later LEVEL 2 change `src/components/FireCommand/WidthPanel.tsx`",
    specDisc,
  );
  check("level 0 discovery may name future UI edit candidates", future.ok, JSON.stringify(future.errors));

  const missingV = evaluateCriticGate({
    criticText: "looks fine, ship it",
    planText: "inspect src/components/FireCommand/ModuleEnableToggle.tsx",
    spec: specUi,
    tools: ["killchain_search"],
  });
  check("missing VERDICT fails critic gate", missingV.missingVerdict && !missingV.pass);

  const praise = evaluateCriticGate({
    criticText: "VERDICT: PASS\n- looks good\n- comprehensive plan\n- all criteria met",
    planText: "inspect src/components/FireCommand/ModuleEnableToggle.tsx",
    spec: specUi,
    tools: ["killchain_search"],
  });
  check("praise-only PASS fails critic gate", !praise.pass && praise.errors.some((e) => /praise|no-risk|no-evidence|no-inspected/.test(e)));

  const grounded = evaluateCriticGate({
    criticText: [
      "INSPECTED: src/components/FireCommand/ModuleEnableToggle.tsx",
      "RISK: glow styling could look like a larger hit target and change click feel",
      "EVIDENCE: proposal keeps the same onClick and setModuleEnable; inspected ModuleEnableToggle.tsx exists",
      "VERDICT: PASS",
    ].join("\n"),
    planText: "inspect src/components/FireCommand/ModuleEnableToggle.tsx",
    proposalText: "inspect-only `src/components/FireCommand/ModuleEnableToggle.tsx`",
    spec: specUi,
    tools: ["killchain_search", "read"],
  });
  check("grounded PASS with risk/evidence", grounded.pass, JSON.stringify(grounded.errors));

  const headingGate = evaluateCriticGate({
    criticText: [
      "### INSPECTED",
      "- src/components/FireCommand/ModuleEnableToggle.tsx button styles",
      "",
      "### RISK",
      "glow styling could look like a larger hit target and change click feel",
      "",
      "### EVIDENCE",
      "onClick still calls setModuleEnable; inspected ModuleEnableToggle.tsx exists",
      "",
      "### VERDICT",
      "PASS",
    ].join("\n"),
    planText: "inspect src/components/FireCommand/ModuleEnableToggle.tsx",
    spec: specUi,
    tools: ["killchain_search", "read"],
  });
  check("markdown heading critic PASS gate", headingGate.pass, JSON.stringify(headingGate.errors));

  const noTools = evaluateCriticGate({
    criticText: [
      "INSPECTED: src/components/FireCommand/ModuleEnableToggle.tsx",
      "RISK: click semantics could change",
      "EVIDENCE: onClick still calls setModuleEnable",
      "VERDICT: PASS",
    ].join("\n"),
    planText: "inspect src/components/FireCommand/ModuleEnableToggle.tsx",
    spec: specUi,
    tools: [],
  });
  check("level 1 critic with zero tools fails", !noTools.pass && noTools.errors.includes("critic-no-tools"));

  const bashInspect = evaluateCriticGate({
    criticText: [
      "INSPECTED: src/components/FireCommand/ModuleEnableToggle.tsx",
      "RISK: glow styling could look like a larger hit target and change click feel",
      "EVIDENCE: proposal keeps the same onClick and setModuleEnable; inspected ModuleEnableToggle.tsx exists",
      "VERDICT: READY",
    ].join("\n"),
    planText: "inspect src/components/FireCommand/ModuleEnableToggle.tsx",
    proposalText: "inspect-only `src/components/FireCommand/ModuleEnableToggle.tsx`",
    spec: specUi,
    tools: ["bash"],
  });
  check("level 1 critic with bash inspect tools passes", bashInspect.pass, JSON.stringify(bashInspect.errors));

  const finalNoTools = evaluateCriticGate({
    criticText: [
      "INSPECTED: src/components/FireCommand/ModuleEnableToggle.tsx",
      "RISK: glow styling could look like a larger hit target and change click feel",
      "EVIDENCE: proposal keeps the same onClick and setModuleEnable; inspected ModuleEnableToggle.tsx exists",
      "VERDICT: READY",
    ].join("\n"),
    planText: "inspect src/components/FireCommand/ModuleEnableToggle.tsx",
    spec: specUi,
    tools: [],
    phase: "final",
  });
  check("final critic may use prompt diff without tools", finalNoTools.pass, JSON.stringify(finalNoTools.errors));

  const startSnap = { porcelain: parsePorcelain(" M src/components/FireCommand/fireUiKit.tsx") };
  const phaseSnap = { porcelain: parsePorcelain(" M src/components/FireCommand/fireUiKit.tsx\n M src/components/FireCommand/fcChip.tsx") };
  const nowPorc = parsePorcelain(" M src/components/FireCommand/fireUiKit.tsx\n M src/components/FireCommand/fcChip.tsx\n M src/components/FireCommand/GatePanel.tsx");
  const vsStart = changesSince(startSnap, nowPorc);
  const vsPhase = changesSince(phaseSnap, nowPorc);
  check("mission-start delta includes prior phase files", vsStart.added.some((r) => r.path.includes("fcChip")));
  check(
    "phase-start delta excludes prior allowed edits",
    !vsPhase.added.some((r) => r.path.includes("fcChip")) && vsPhase.added.some((r) => r.path.includes("GatePanel")),
  );
  check(
    "missing checkpoint files skip already dirty",
    missingCheckpointAppFiles(
      ["src/components/FireCommand/fireUiKit.tsx", "src/components/FireCommand/fcChip.tsx"],
      ["src/components/FireCommand/fireUiKit.tsx"],
    ).join(",") === "src/components/FireCommand/fcChip.tsx",
  );

  const split = extractFilePatch(
    "diff --git a/src/components/FireCommand/fcChip.tsx b/src/components/FireCommand/fcChip.tsx\nindex 1..2\n--- a/src/components/FireCommand/fcChip.tsx\n+++ b/src/components/FireCommand/fcChip.tsx\n@@ -1 +1 @@\n-a\n+b\ndiff --git a/src/components/FireCommand/fireUiKit.tsx b/src/components/FireCommand/fireUiKit.tsx\n",
    "src/components/FireCommand/fcChip.tsx",
  );
  check("extractFilePatch stops before next file", split.includes("fcChip.tsx") && !split.includes("fireUiKit.tsx"));

  check("quarantine PLAN dump not ingested as proposal", !quarantineFitsDest("1788410059304-PLAN.md", "PROPOSAL.md"));
  check("quarantine PROPOSAL dump matches dest", quarantineFitsDest("PROPOSAL.md", "PROPOSAL.md"));

  const multiOpt = checkProposalConcrete(`
# Proposal
Option A darken disabled
Option B add an icon
Which visual enhancement vector do you prefer? Human review of visual strategy requested before any code edits proceed.
path: src/components/FireCommand/ModuleEnableToggle.tsx
`.repeat(3));
  check("multi-option asks-human proposal fails", !multiOpt.ok && multiOpt.errors.includes("unresolved-design") && multiOpt.errors.includes("option-menu"));
  const optionMenuOnly = checkProposalConcrete(`
File: src/components/FireCommand/FireBreadcrumb.tsx
Intended modification: inspect-only map of presentation issues.
Option A tighten breadcrumb truncation.
Option B restyle the workspace tabs.
Option C add empty-state copy.
Pick later. ${"x".repeat(200)}
`);
  check("option A/B/C menu fails even without asking the operator", !optionMenuOnly.ok && optionMenuOnly.errors.includes("option-menu"));
  const asksOp = checkProposalConcrete(`
File: src/components/FireCommand/HarmonyPanel.tsx
Intended modification: none — inspect only.
Would you like me to perform a fresh investigation or work with a different topic?
Please clarify how you'd like to proceed. ${"x".repeat(200)}
`);
  check("proposal that asks the operator what to do fails", !asksOp.ok && asksOp.errors.includes("asks-operator"));

  const thin = checkProposalConcrete("I will propose later.");
  check("thin proposal fails", !thin.ok && thin.errors.includes("proposal-too-thin"));

  const concreteOk = checkProposalConcrete(`
File: src/components/FireCommand/ModuleEnableToggle.tsx
Symbol: ModuleEnableToggle
Intended modification: darken disabled background only.
BEFORE: background: "rgba(0,0,0,0.45)"
AFTER:  background: "rgba(0,0,0,0.72)"
Why: glanceable off-state. Invariants: same onClick, setModuleEnable, aria-pressed.
Diff class: small UI-only. No Option B. No operator choice.
`.repeat(2));
  check("concrete single-edit proposal passes", concreteOk.ok, JSON.stringify(concreteOk.errors));

  try {
    assertSafeMissionId("../escape");
    check("mission id traversal rejected", false);
  } catch {
    check("mission id traversal rejected", true);
  }

  const dots = parseMissionMarkdown(`---
{
  "id": "dot-dot",
  "title": "t",
  "goal": "g",
  "level": 0,
  "allowedPaths": ["../src/audio/AudioEngine.ts"]
}
---
`);
  check("allowedPaths cannot use ..", !dots.ok);

  const scope = proposalScopeCheck(
    "Change `src/audio/AudioEngine.ts` and `src/components/FireCommand/LivePanel.tsx`",
    specL2,
    { dryRun: true },
  );
  check("proposal flags forbidden AudioEngine", scope.problems.some((p) => p.path.includes("AudioEngine")));

  check("level 0 not editable", !pathEditable("src/components/FireCommand/LivePanel.tsx", parsed.spec, { dryRun: false }));

  const tmp = mkdtempSync(join(tmpdir(), "kc-mission-"));
  const store = createMissionStore(parsed.spec, {
    dryRun: true,
    head: "abc",
    branch: "ai/kill-chain-agent",
    dataRoot: tmp,
  });
  transition(store.dir, store.status, "PREFLIGHT");
  transition(store.dir, store.status, "INVESTIGATING", "unit");
  const loaded = loadMission("test-valid", tmp);
  check("resume loads persisted state", loaded.status.state === "INVESTIGATING" && loaded.spec.id === "test-valid");

  const specPath = join(tmp, "mission.md");
  writeFileSync(specPath, VALID_SPEC, "utf8");

  function fakeInvoke(text, tools = ["killchain_search"]) {
    return async ({ outPath }) => {
      mkdirSync(join(outPath, ".."), { recursive: true });
      const events = [
        ...tools.map((tool) => ({ type: "tool_use", part: { type: "tool", tool } })),
        { type: "text", part: { type: "text", text } },
      ];
      const jsonl = events.map((e) => JSON.stringify(e)).join("\n");
      writeFileSync(outPath, jsonl, "utf8");
      return {
        exitCode: 0,
        durationMs: 5,
        parsed: parseOpenCodeJsonl(jsonl),
        text,
      };
    };
  }

  const liveDeps = {
    gitCapture: () => ({ commit: "abc", short: "abc", branch: "ai/kill-chain-agent", dirty: false }),
    gitPorcelain: () => [],
    checkOllama: async () => ({ ok: true, names: ["qwen3.5:9b"] }),
    opencodeVersion: async () => "1.18.26",
    opencodeMcpList: async () => ({ connected: true, line: "killchain connected" }),
    loadCorpusManifest: () => ({ gitCommit: "abc" }),
    snapshotWorktree: () => ({ porcelain: [], head: "abc" }),
    buildCorpus: async () => {},
    runOpenCode: async ({ prompt, outPath }) => {
      let text = "investigation of Fire Command";
      if (prompt.includes("CURRENT PASS: PLAN")) text = "PLAN: phases\nfiles inspected: src/components/FireCommand/FireCommandView.tsx";
      if (prompt.includes("CURRENT PASS: CRITIC")) {
        text = [
          "INSPECTED: src/components/FireCommand/FireCommandView.tsx",
          "RISK: a later UI edit could change click semantics on enable controls",
          "EVIDENCE: this plan is inspect-only; no onClick or store writes are proposed",
          "VERDICT: PASS",
          "- checked FireCommandView.tsx exists and is named as inspect-only",
        ].join("\n");
      }
      if (prompt.includes("PROPOSAL-BEFORE-WRITE")) {
        text = `${"FILE-BY-FILE: inspect-only `src/components/FireCommand/FireCommandView.tsx`. Dry-run, no production writes. Confirm enable-toggle callers. No AudioEngine. No store writes. ".repeat(6)}`;
      }
      if (prompt.includes("FINAL REVIEW")) {
        text = [
          "INSPECTED: src/components/FireCommand/FireCommandView.tsx",
          "RISK: dry-run could still have proposed a store write",
          "EVIDENCE: proposal is inspect-only and names an existing file; no src/state paths",
          "VERDICT: READY",
        ].join("\n");
      }
      return fakeInvoke(text)({ outPath });
    },
  };

  const run1 = await runMission({
    specPath,
    dryRun: true,
    stopAfter: "PLANNING",
    dataRoot: tmp,
    log: () => {},
    deps: liveDeps,
  });
  check("stop-after PLANNING", run1.state === "PLANNING", `state=${run1.state}`);
  check("investigation persisted before resume", existsSync(join(tmp, "test-valid", "INVESTIGATION.md")));

  const run2 = await runMission({
    resumeId: "test-valid",
    dryRun: true,
    dataRoot: tmp,
    log: () => {},
    deps: liveDeps,
  });
  check("resume continues to COMPLETE", run2.state === "COMPLETE", `state=${run2.state}`);
  check("resume incremented", run2.resumeCount >= 1);
  check("durable investigation exists", existsSync(join(tmp, "test-valid", "INVESTIGATION.md")));
  check("durable PLAN exists", existsSync(join(tmp, "test-valid", "PLAN.md")));
  check("durable FINAL_REPORT exists", existsSync(join(tmp, "test-valid", "FINAL_REPORT.md")));

  const retryPath = join(tmp, "retry.md");
  writeFileSync(retryPath, `---
${JSON.stringify({
    id: "retry-exhausted",
    title: "retries",
    goal: "g",
    level: 0,
    maxRetriesPerPhase: 0,
    maxModelCalls: 20,
    corpus: "never",
  }, null, 2)}
---
`, "utf8");
  const retryRun = await runMission({
    specPath: retryPath,
    dryRun: true,
    dataRoot: tmp,
    log: () => {},
    deps: {
      ...liveDeps,
      runOpenCode: async ({ prompt, outPath }) => {
        const text = prompt.includes("CURRENT PASS: CRITIC")
          ? "VERDICT: FAIL\n- missing files"
          : "plan draft";
        return fakeInvoke(text)({ outPath });
      },
    },
  });
  check("max retry exhausted → BLOCKED", retryRun.state === "BLOCKED", `state=${retryRun.state} reason=${retryRun.blockedReason}`);

  const failInvoke = await runMission({
    specPath,
    dryRun: true,
    dataRoot: join(tmp, "nested-fail"),
    log: () => {},
    deps: {
      ...liveDeps,
      runOpenCode: async () => {
        throw new Error("spawn opencode ENOENT");
      },
    },
  });
  check("model invocation fail is FAILED or BLOCKED", ["FAILED", "BLOCKED"].includes(failInvoke.state), `state=${failInvoke.state}`);

  const FOO = "src/components/FireCommand/Foo.tsx";
  const BAR = "src/components/FireCommand/Bar.tsx";
  const TOGGLE = "src/components/FireCommand/ModuleEnableToggle.tsx";
  const STORE = "src/state/uiStore.ts";
  const NEWF = "src/components/FireCommand/NewPanel.tsx";

  function attrSpec(over = {}) {
    const parsed = parseMissionMarkdown(`---
${JSON.stringify({
    id: over.id || "attr-harness",
    title: "t",
    goal: "g",
    level: 2,
    allowedPaths: over.allowedPaths || [FOO],
    adoptDirtyPaths: over.adoptDirtyPaths || [],
    preserveDirtyPaths: over.preserveDirtyPaths || [],
    baselineDirtyPaths: over.baselineDirtyPaths || [],
    corpus: "never",
    maxModelCalls: 20,
  }, null, 2)}
---
`);
    return parsed;
  }

  function attrWorld(over = {}) {
    const root = mkdtempSync(join(tmpdir(), "kc-attr-"));
    const missionDir = join(root, "mission");
    mkdirSync(missionDir, { recursive: true });
    const head = new Map();
    const io = createFsIo(root, {
      readHead: (rel) => (head.has(rel) ? Buffer.from(head.get(rel)) : null),
    });
    const seed = (rel, buf) => {
      const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
      io.write(rel, b);
      head.set(rel, Buffer.from(b));
    };
    const parsed = attrSpec(over);
    return { root, io, missionDir, spec: parsed.spec, parsed, seed };
  }

  const adoptOutside = attrSpec({
    id: "adopt-outside",
    allowedPaths: [FOO],
    adoptDirtyPaths: [STORE],
  });
  check("13 adopted path outside allowedPaths → reject", !adoptOutside.ok && adoptOutside.errors.some((e) => /adoptDirtyPaths/.test(e)));

  {
    const w = attrWorld();
    w.seed(FOO, "HEAD\n");
    const resolved = resolveAdoption(w.spec, []);
    const attr = captureBaseline(w.missionDir, w.spec, resolved, w.io, []);
    const pre = capturePhaseSnapshot(w.missionDir, "edit", w.spec, attr, w.io, []);
    w.io.write(FOO, Buffer.from("EDIT\n"));
    const r = enforcePhaseDelta({
      missionDir: w.missionDir,
      key: "edit",
      preFiles: pre,
      spec: w.spec,
      io: w.io,
      porcelainNow: [{ xy: " M", path: FOO, untracked: false }],
      writesApp: true,
      attribution: attr,
    });
    check("1 clean authorized file edited during EDITING", r.ok && r.allowed.includes(FOO) && attr.missionOwned.includes(FOO) && w.io.read(FOO).toString() === "EDIT\n");
  }

  {
    const w = attrWorld({ id: "attr-adopt", adoptDirtyPaths: [FOO] });
    w.seed(FOO, "PRIOR\n");
    const porcelain = [{ xy: " M", path: FOO, untracked: false }];
    const resolved = resolveAdoption(w.spec, porcelain);
    check("2 already-dirty authorized file adopted", resolved.adopted.includes(FOO) && !resolved.unexpected.length);
    const attr = captureBaseline(w.missionDir, w.spec, resolved, w.io, porcelain);
    check("2 baseline stores adopted bytes", fingerprintRel(w.io, FOO).hash === sha256(Buffer.from("PRIOR\n")) && attr.missionOwned.includes(FOO));

    const pre1 = capturePhaseSnapshot(w.missionDir, "edit1", w.spec, attr, w.io, porcelain);
    w.io.write(FOO, Buffer.from("REV1\n"));
    const e1 = enforcePhaseDelta({
      missionDir: w.missionDir, key: "edit1", preFiles: pre1, spec: w.spec, io: w.io,
      porcelainNow: porcelain, writesApp: true, attribution: attr,
    });
    const pre2 = capturePhaseSnapshot(w.missionDir, "edit2", w.spec, attr, w.io, porcelain);
    w.io.write(FOO, Buffer.from("REV2\n"));
    const e2 = enforcePhaseDelta({
      missionDir: w.missionDir, key: "edit2", preFiles: pre2, spec: w.spec, io: w.io,
      porcelainNow: porcelain, writesApp: true, attribution: attr,
    });
    check("3 revision edits same file again", e1.ok && e2.ok && e2.delta.hashes[FOO].before === sha256(Buffer.from("REV1\n")) && w.io.read(FOO).toString() === "REV2\n");
    persistTotalMissionDiff(w.missionDir, w.spec, attr, w.io, porcelain);
    check("8 validation after several edits sees total mission state", attr.totalMissionDiff.dirty.includes(FOO) && attr.totalMissionDiff.hashes[FOO].before === sha256(Buffer.from("PRIOR\n")));
  }

  {
    const w = attrWorld({ id: "attr-plan-ro", adoptDirtyPaths: [FOO] });
    const original = Buffer.from("OWNED\n");
    w.seed(FOO, original);
    const porcelain = [{ xy: " M", path: FOO, untracked: false }];
    const attr = captureBaseline(w.missionDir, w.spec, resolveAdoption(w.spec, porcelain), w.io, porcelain);
    const pre = capturePhaseSnapshot(w.missionDir, "plan", w.spec, attr, w.io, porcelain);
    w.io.write(FOO, Buffer.from("PLAN-MUTATION\n"));
    const r = enforcePhaseDelta({
      missionDir: w.missionDir, key: "plan", preFiles: pre, spec: w.spec, io: w.io,
      porcelainNow: porcelain, writesApp: false, attribution: attr,
    });
    check("4 read-only PLANNING modifies adopted dirty file → restore exact pre-phase state", r.readOnlyViolation && r.restored && w.io.read(FOO).equals(original));
  }

  {
    const w = attrWorld({ id: "attr-critic-ro", adoptDirtyPaths: [FOO] });
    const original = Buffer.from("OWNED-CRITIC\n");
    w.seed(FOO, original);
    const porcelain = [{ xy: " M", path: FOO, untracked: false }];
    const attr = captureBaseline(w.missionDir, w.spec, resolveAdoption(w.spec, porcelain), w.io, porcelain);
    const pre = capturePhaseSnapshot(w.missionDir, "plan-critic", w.spec, attr, w.io, porcelain);
    w.io.write(FOO, Buffer.from("CRITIC-MUTATION\n"));
    const r = enforcePhaseDelta({
      missionDir: w.missionDir, key: "plan-critic", preFiles: pre, spec: w.spec, io: w.io,
      porcelainNow: porcelain, writesApp: false, attribution: attr,
    });
    check("5 critic modifies app source → restore", r.readOnlyViolation && w.io.read(FOO).equals(original));
  }

  {
    const w = attrWorld({ id: "attr-unauth", allowedPaths: [FOO] });
    w.seed(FOO, "FOO0\n");
    w.seed(BAR, "BAR0\n");
    const attr = captureBaseline(w.missionDir, w.spec, resolveAdoption(w.spec, []), w.io, []);
    const pre = capturePhaseSnapshot(w.missionDir, "edit-unauth", w.spec, attr, w.io, []);
    w.io.write(FOO, Buffer.from("FOO1\n"));
    w.io.write(BAR, Buffer.from("BAR1\n"));
    const r = enforcePhaseDelta({
      missionDir: w.missionDir, key: "edit-unauth", preFiles: pre, spec: w.spec, io: w.io,
      porcelainNow: [
        { xy: " M", path: FOO, untracked: false },
        { xy: " M", path: BAR, untracked: false },
      ],
      writesApp: true, attribution: attr,
    });
    check(
      "6 unauthorized second file → restore only that delta",
      !r.ok && r.unauthorized.includes(BAR) && r.allowed.includes(FOO)
        && w.io.read(FOO).toString() === "FOO1\n" && w.io.read(BAR).toString() === "BAR0\n",
    );
  }

  {
    const w = attrWorld({ id: "attr-resume", adoptDirtyPaths: [FOO] });
    w.seed(FOO, "RESUME-BASE\n");
    const porcelain = [{ xy: " M", path: FOO, untracked: false }];
    const attr = captureBaseline(w.missionDir, w.spec, resolveAdoption(w.spec, porcelain), w.io, porcelain);
    const loaded = loadAttribution(w.missionDir);
    check("7 resume preserves adopted dirty baseline", loaded.adopted.includes(FOO) && loaded.missionOwned.includes(FOO) && loaded.baseline === "baseline");
    restoreSnapshot(w.missionDir, "baseline", w.io);
    check("7 baseline restore still OWNED", w.io.read(FOO).toString() === "RESUME-BASE\n" && attr.adopted.includes(FOO));
  }

  {
    const w = attrWorld({ id: "attr-ckpt" });
    const body = Buffer.from("CHECKPOINT-FULL-FILE\nsecond line\n");
    w.seed(FOO, body);
    const attr = captureBaseline(w.missionDir, w.spec, resolveAdoption(w.spec, []), w.io, []);
    const pre = capturePhaseSnapshot(w.missionDir, "edit-ckpt", w.spec, attr, w.io, []);
    const edited = Buffer.from("CHECKPOINT-FULL-FILE\nsecond line\nthird\n");
    w.io.write(FOO, edited);
    enforcePhaseDelta({
      missionDir: w.missionDir, key: "edit-ckpt", preFiles: pre, spec: w.spec, io: w.io,
      porcelainNow: [{ xy: " M", path: FOO, untracked: false }], writesApp: true, attribution: attr,
    });
    const ck = writeLosslessCheckpoint(w.missionDir, 1, {
      spec: w.spec, status: { state: "CHECKPOINT", phaseIndex: 0 }, attribution: attr, io: w.io,
      porcelain: [{ xy: " M", path: FOO, untracked: false }], label: "test",
    });
    w.io.write(FOO, Buffer.from("WIPED\n"));
    const rest = restoreCheckpointFiles(ck.dir, [FOO], w.io);
    check("9 checkpoint restoration preserves full file", rest.ok && w.io.read(FOO).equals(edited) && ck.changed.includes(FOO));
  }

  {
    const w = attrWorld({ id: "attr-large" });
    const large = Buffer.from(`${"A".repeat(8000)}${"B".repeat(8000)}${"C".repeat(40000)}\nunique-tail-XYZ\n`);
    w.seed(FOO, "small\n");
    const attr = captureBaseline(w.missionDir, w.spec, resolveAdoption(w.spec, []), w.io, []);
    const pre = capturePhaseSnapshot(w.missionDir, "edit-large", w.spec, attr, w.io, []);
    w.io.write(FOO, large);
    enforcePhaseDelta({
      missionDir: w.missionDir, key: "edit-large", preFiles: pre, spec: w.spec, io: w.io,
      porcelainNow: [{ xy: " M", path: FOO, untracked: false }], writesApp: true, attribution: attr,
    });
    const ck = writeLosslessCheckpoint(w.missionDir, 2, {
      spec: w.spec, status: { state: "CHECKPOINT", phaseIndex: 0 }, attribution: attr, io: w.io,
      porcelain: [{ xy: " M", path: FOO, untracked: false }], label: "large",
    });
    w.io.write(FOO, Buffer.from("truncated?\n"));
    restoreCheckpointFiles(ck.dir, [FOO], w.io);
    const roundtrip = w.io.read(FOO);
    check(
      "10 large diff/checkpoint cannot truncate",
      roundtrip.equals(large) && roundtrip.length > 50000 && clip(large.toString(), 8000).includes("[truncated"),
    );
  }

  {
    const w = attrWorld({
      id: "attr-classify",
      allowedPaths: [FOO],
      adoptDirtyPaths: [FOO],
      preserveDirtyPaths: [TOGGLE],
    });
    const porcelain = [
      { xy: " M", path: FOO, untracked: false },
      { xy: " M", path: TOGGLE, untracked: false },
      { xy: " M", path: STORE, untracked: false },
    ];
    const resolved = resolveAdoption(w.spec, porcelain);
    check("11 mission-owned dirt is not confused with unrelated preexisting dirt", resolved.adopted.includes(FOO) && resolved.preserved.includes(TOGGLE) && resolved.unexpected.some((r) => r.path === STORE));
  }

  {
    const w = attrWorld({ id: "attr-del", allowedPaths: [FOO] });
    w.seed(FOO, "OLD\n");
    const attr = captureBaseline(w.missionDir, w.spec, resolveAdoption(w.spec, []), w.io, []);
    const pre = capturePhaseSnapshot(w.missionDir, "edit-del", w.spec, attr, w.io, []);
    w.io.remove(FOO);
    w.io.write(FOO, Buffer.from("NEW\n"));
    const r = enforcePhaseDelta({
      missionDir: w.missionDir, key: "edit-del", preFiles: pre, spec: w.spec, io: w.io,
      porcelainNow: [{ xy: " M", path: FOO, untracked: false }], writesApp: true, attribution: attr,
    });
    check("14 file deleted/recreated during edit", r.ok && w.io.read(FOO).toString() === "NEW\n" && r.allowed.includes(FOO));
  }

  {
    const w = attrWorld({ id: "attr-crlf", adoptDirtyPaths: [FOO] });
    const crlf = Buffer.from("line1\r\nline2\r\n");
    w.seed(FOO, crlf);
    const porcelain = [{ xy: " M", path: FOO, untracked: false }];
    const attr = captureBaseline(w.missionDir, w.spec, resolveAdoption(w.spec, porcelain), w.io, porcelain);
    const pre = capturePhaseSnapshot(w.missionDir, "plan-crlf", w.spec, attr, w.io, porcelain);
    w.io.write(FOO, Buffer.from("line1\nline2\nmut\n"));
    enforcePhaseDelta({
      missionDir: w.missionDir, key: "plan-crlf", preFiles: pre, spec: w.spec, io: w.io,
      porcelainNow: porcelain, writesApp: false, attribution: attr,
    });
    check("15 CRLF adopted file preserves EOL", w.io.read(FOO).equals(crlf) && fingerprintRel(w.io, FOO).crlf === true);
  }

  {
    const w = attrWorld({ id: "attr-new", allowedPaths: ["src/components/FireCommand/**"] });
    w.seed(FOO, "keep\n");
    const attr = captureBaseline(w.missionDir, w.spec, resolveAdoption(w.spec, []), w.io, []);
    const pre = capturePhaseSnapshot(w.missionDir, "edit-new", w.spec, attr, w.io, []);
    w.io.write(NEWF, Buffer.from("brand-new\n"));
    const r = enforcePhaseDelta({
      missionDir: w.missionDir, key: "edit-new", preFiles: pre, spec: w.spec, io: w.io,
      porcelainNow: [{ xy: "??", path: NEWF, untracked: true }], writesApp: true, attribution: attr,
    });
    const ck = writeLosslessCheckpoint(w.missionDir, 3, {
      spec: w.spec, status: { state: "CHECKPOINT", phaseIndex: 0 }, attribution: attr, io: w.io,
      porcelain: [{ xy: "??", path: NEWF, untracked: true }], label: "newfile",
    });
    w.io.remove(NEWF);
    restoreCheckpointFiles(ck.dir, [NEWF], w.io);
    check("16 untracked authorized NEW FILE survives checkpoints correctly", r.ok && r.allowed.includes(NEWF) && w.io.read(NEWF).toString() === "brand-new\n");
  }

  {
    const w = attrWorld({ id: "attr-ro-new", allowedPaths: ["src/components/FireCommand/**"] });
    w.seed(FOO, "keep\n");
    const attr = captureBaseline(w.missionDir, w.spec, resolveAdoption(w.spec, []), w.io, []);
    const pre = capturePhaseSnapshot(w.missionDir, "plan-new", w.spec, attr, w.io, []);
    w.io.write(NEWF, Buffer.from("should-not-keep\n"));
    let quarantined = false;
    const r = enforcePhaseDelta({
      missionDir: w.missionDir, key: "plan-new", preFiles: pre, spec: w.spec, io: w.io,
      porcelainNow: [{ xy: "??", path: NEWF, untracked: true }], writesApp: false, attribution: attr,
      quarantineNewFile: () => { quarantined = true; },
    });
    check("17 read-only phase creation of NEW FILE is reverted/quarantined", r.readOnlyViolation && quarantined && !w.io.exists(NEWF));
  }

  {
    const w = attrWorld({ id: "attr-repair", adoptDirtyPaths: [FOO] });
    w.seed(FOO, "V1\n");
    const porcelain = [{ xy: " M", path: FOO, untracked: false }];
    const attr = captureBaseline(w.missionDir, w.spec, resolveAdoption(w.spec, porcelain), w.io, porcelain);
    const preEdit = capturePhaseSnapshot(w.missionDir, "edit-r", w.spec, attr, w.io, porcelain);
    w.io.write(FOO, Buffer.from("V2\n"));
    enforcePhaseDelta({
      missionDir: w.missionDir, key: "edit-r", preFiles: preEdit, spec: w.spec, io: w.io,
      porcelainNow: porcelain, writesApp: true, attribution: attr,
    });
    const preRepair = capturePhaseSnapshot(w.missionDir, "repair", w.spec, attr, w.io, porcelain);
    w.io.write(FOO, Buffer.from("V3-repair\n"));
    const r = enforcePhaseDelta({
      missionDir: w.missionDir, key: "repair", preFiles: preRepair, spec: w.spec, io: w.io,
      porcelainNow: porcelain, writesApp: true, attribution: attr,
    });
    check("18 repair phase may alter a previously edited mission-owned file", r.ok && w.io.read(FOO).toString() === "V3-repair\n" && attr.missionOwned.includes(FOO));
  }

  {
    const world = mkdtempSync(join(tmpdir(), "kc-plan-ro-"));
    const io = createFsIo(world);
    io.write(FOO, Buffer.from("OWNED-LIVE\n"));
    const specMd = join(world, "mission.md");
    writeFileSync(specMd, `---
{
  "id": "plan-restore-owned",
  "title": "t",
  "goal": "g",
  "level": 2,
  "allowedPaths": ["src/components/FireCommand/Foo.tsx"],
  "adoptDirtyPaths": ["src/components/FireCommand/Foo.tsx"],
  "corpus": "never",
  "maxModelCalls": 20
}
---
`, "utf8");
    const planRun = await runMission({
      specPath: specMd,
      dryRun: true,
      stopAfter: "PLAN_REVIEW",
      dataRoot: join(world, "data"),
      log: () => {},
      deps: {
        ...liveDeps,
        createIo: () => io,
        gitPorcelain: () => [{ xy: " M", path: FOO, untracked: false }],
        gitDiffCheck: () => ({ ok: true, output: "", args: [] }),
        gitAllowedAppDiffStat: () => ({ files: [FOO], insertions: 1, deletions: 0, patch: "diff" }),
        runOpenCode: async ({ prompt, outPath }) => {
          if (String(prompt).includes("CURRENT PASS: PLAN")) {
            io.write(FOO, Buffer.from("PLAN-WROTE-THIS\n"));
          }
          const text = String(prompt).includes("CURRENT PASS: PLAN")
            ? "PLAN: inspect Foo.tsx only"
            : "investigation of Foo";
          return fakeInvoke(text)({ outPath });
        },
      },
    });
    check(
      "4b runner PLANNING restore of adopted dirty file",
      planRun.state === "PLAN_REVIEW" && io.read(FOO).toString() === "OWNED-LIVE\n" && (planRun.readOnlyViolations || 0) >= 1,
      `state=${planRun.state} bytes=${io.read(FOO)?.toString()} violations=${planRun.readOnlyViolations}`,
    );
  }

  const TARGET = "src/components/FireCommand/PatternSelect.tsx";
  const VALID_TSX = "export function PatternSelect() {\n  return <div data-testid=\"pattern-select-ready\">hi</div>;\n}\n";
  const BROKEN_TSX = "export function PatternSelect() {\n  return <div><span>hi</div>;\n}\n";
  const BROKEN2_TSX = "export function PatternSelect() {\n  return <div><span><b>hi</div>;\n}\n";
  const MALFORMED_PROP = "export function PatternSelect() {\n  return <div className=\"x\" foo= ></div>;\n}\n";
  const SEED_TSX = "export function PatternSelect() {\n  return <div>hi</div>;\n}\n";

  const validSyn = checkTsSyntax("a.tsx", VALID_TSX);
  const unclosedSyn = checkTsSyntax("a.tsx", BROKEN_TSX);
  const propSyn = checkTsSyntax("a.tsx", MALFORMED_PROP);
  check("7 valid TSX passes syntax gate", validSyn.ok, JSON.stringify(validSyn.diagnostics));
  check("8 unclosed JSX fails syntax gate", !unclosedSyn.ok && unclosedSyn.diagnostics.length >= 1, JSON.stringify(unclosedSyn.diagnostics));
  check("9 malformed prop JSX fails syntax gate", !propSyn.ok && propSyn.diagnostics.length >= 1, JSON.stringify(propSyn.diagnostics));

  check("mutation tool recognizes edit/write without exact vendor name", isMutationTool("edit") && isMutationTool("apply_patch") && isMutationTool("strreplace"));
  check("prose-only tools are not mutation", !isMutationTool("killchain_search") && !isMutationTool("read") && !usedMutationTool(["killchain_search", "read"]));

  const emptySpec = parseMissionMarkdown(`---
${JSON.stringify({
    id: "empty-gate-spec",
    title: "t",
    goal: "g",
    level: 2,
    allowedPaths: [TARGET],
    corpus: "never",
  }, null, 2)}
---
`).spec;
  const namedProposal = `File: ${TARGET}\nSymbol: PatternSelect\nIntended modification: add data-testid on the root element.\nBEFORE: <div>\nAFTER: <div data-testid="x">\n`.repeat(4);
  const expectFiles = expectedEditFiles(namedProposal, emptySpec);
  check("proposal names authorized edit files", expectFiles.includes(TARGET), expectFiles.join(","));
  const inspectOnlyProposal = `File: ${TARGET}\nSymbol: PatternSelect\nIntended modification: inspect-only — already correct, no change needed.\nWhy: current banner is authoritative. Diff class: none.\n`.repeat(5);
  check("inspect-only proposal is not an expected edit", expectedEditFiles(inspectOnlyProposal, emptySpec).length === 0);

  const emptyClass = classifyEditOutcome({
    expected: true,
    expectedFiles: [TARGET],
    allowed: [],
    deltaDirty: [],
    tools: ["killchain_search"],
    invokeOk: true,
  });
  check("1 proposed edit + zero delta → EMPTY_EDIT/DESCRIBED", emptyClass.empty && (emptyClass.kind === "DESCRIBED_BUT_DID_NOT_APPLY" || emptyClass.kind === "EMPTY_EDIT"), emptyClass.kind);

  const mutEmpty = classifyEditOutcome({
    expected: true,
    expectedFiles: [TARGET],
    allowed: [],
    deltaDirty: [],
    tools: ["killchain_search", "edit"],
    invokeOk: true,
  });
  check("5 mutation tool + zero delta is still empty", mutEmpty.empty && mutEmpty.kind === "EMPTY_EDIT", mutEmpty.kind);

  const proseOnly = classifyEditOutcome({
    expected: true,
    expectedFiles: [TARGET],
    allowed: [],
    deltaDirty: [],
    tools: ["killchain_search"],
    invokeOk: true,
  });
  check("6 prose-only output cannot count as edit", proseOnly.kind === "DESCRIBED_BUT_DID_NOT_APPLY");

  check("empty-edit policy retries then blocks", emptyEditPolicy(1).action === "RETRY" && emptyEditPolicy(2).action === "RETRY" && emptyEditPolicy(2).stronger && emptyEditPolicy(3).action === "BLOCK");
  check("EDITING may retry without leaving the edit loop", ALLOWED_TRANSITIONS.EDITING.includes("EDITING") && ALLOWED_TRANSITIONS.DIFF_REVIEW.includes("EDITING"));
  check("REPAIRING may apply then return to DIFF_REVIEW", ALLOWED_TRANSITIONS.REPAIRING.includes("DIFF_REVIEW"));
  check("repair-diagnose is not a write phase", phaseWritesApp("repair-diagnose") === false);
  check("repair-apply and edit are write phases", phaseWritesApp("repair-apply") && phaseWritesApp("edit-apply") && phaseWritesApp("edit"));

  function padReport(label, file = TARGET) {
    const lines = [
      `INSPECTED: ${file}`,
      "RISK: a later UI edit could change click semantics on pattern controls",
      "EVIDENCE: this change is presentation-only; no onClick or store writes are proposed",
      `VERDICT: ${label}`,
      `- checked ${file} exists and handlers stay the same`,
      "Also verified no AudioEngine, DSP, or persistence edits are requested.",
    ];
    return `${lines.join("\n")}\n${"grounded critic padding. ".repeat(30)}`;
  }

  function proposalText(file = TARGET) {
    return `File: ${file}
Symbol: PatternSelect
Intended modification: add data-testid="pattern-select-ready" on the root element only.
BEFORE: return <div>
AFTER:  return <div data-testid="pattern-select-ready">
Why: glanceable test hook. Invariants: same onClick, no store writes, no AudioEngine, no sequencer timing.
Diff class: small UI-only. No Option B. No operator choice.
`.repeat(5);
  }

  function planText(file = TARGET) {
    return `PLAN for ${file}. Files expected to change: ${file}. Files inspected: ${file}. Current behavior: root div has no test id. Target: add data-testid only. Phases: 1. Acceptance: presentation-only. Risk: JSX syntax. Validation: typecheck. Invariants: no store writes. What I will NOT change: AudioEngine, DSP, persistence, sequencer timing.
`.repeat(6);
  }

  async function runScriptedEdit({
    id,
    onEdit,
    onRepairApply,
    onRepairDiagnose,
    editTools = ["killchain_search"],
    preserveToggle = false,
    maxRetriesPerPhase = 3,
    validation,
  }) {
    const world = mkdtempSync(join(tmpdir(), `kc-${id}-`));
    const io = createFsIo(world);
    io.write(TARGET, Buffer.from(SEED_TSX));
    const parked = Buffer.from("PARKED-TOGGLE-BYTES\n");
    if (preserveToggle) io.write(TOGGLE, parked);
    const specMd = join(world, "mission.md");
    writeFileSync(specMd, `---
${JSON.stringify({
    id,
    title: "t",
    goal: "Add a presentation-only test id on PatternSelect",
    level: 2,
    allowedPaths: [TARGET],
    preserveDirtyPaths: preserveToggle ? [TOGGLE] : [],
    readOnlyPaths: ["src/state/**"],
    corpus: "never",
    maxModelCalls: 40,
    maxPhases: 1,
    maxRetriesPerPhase,
    proposalRounds: 1,
    validation: { required: ["typecheck"] },
    acceptance: ["presentation only", "no store writes"],
  }, null, 2)}
---
`, "utf8");
    let validationCalls = 0;
    const validationSnapshots = [];
    let targetDirty = false;
    const porcelain = () => {
      const rows = [];
      if (preserveToggle) rows.push({ xy: " M", path: TOGGLE, untracked: false });
      if (targetDirty || (io.read(TARGET) && io.read(TARGET).toString() !== SEED_TSX)) {
        rows.push({ xy: " M", path: TARGET, untracked: false });
      }
      return rows;
    };
    const result = await runMission({
      specPath: specMd,
      dryRun: false,
      dataRoot: join(world, "data"),
      log: () => {},
      deps: {
        ...liveDeps,
        createIo: () => io,
        gitPorcelain: porcelain,
        gitDiffCheck: () => ({ ok: true, output: "", args: [] }),
        gitAllowedAppDiffStat: () => ({
          files: io.read(TARGET)?.toString() !== SEED_TSX ? [TARGET] : [],
          insertions: 1,
          deletions: 0,
          patch: io.read(TARGET)?.toString() !== SEED_TSX ? "diff --git a/x b/x\n" : "",
        }),
        runValidation: async () => {
          validationCalls += 1;
          validationSnapshots.push(io.read(TARGET)?.toString() || "");
          if (typeof validation === "function") return validation();
          return { ok: true, results: [{ name: "typecheck", ok: true, code: 0, stdout: "", stderr: "", durationMs: 1 }] };
        },
        runOpenCode: async ({ prompt, outPath }) => {
          const p = String(prompt);
          if (p.includes("CURRENT PASS: INVESTIGATE")) {
            return fakeInvoke(`investigation of ${TARGET} current root div and callers.`)({ outPath });
          }
          if (p.includes("CURRENT PASS: PLAN")) {
            return fakeInvoke(planText())({ outPath });
          }
          if (p.includes("CURRENT PASS: CRITIC")) {
            return fakeInvoke(padReport("PASS"))({ outPath });
          }
          if (p.includes("PROPOSAL-BEFORE-WRITE")) {
            return fakeInvoke(proposalText())({ outPath });
          }
          if (p.includes("CURRENT PASS: REPAIR DIAGNOSIS")) {
            if (onRepairDiagnose) onRepairDiagnose(io);
            return fakeInvoke("HYPOTHESIS: unclosed JSX\nFAULT LOCATION: PatternSelect.tsx return\nMINIMAL REPAIR: close the span or drop it.\n")({ outPath });
          }
          if (p.includes("CURRENT PASS: APPLY REPAIR") || p.includes("APPLY REPAIR")) {
            if (onRepairApply) onRepairApply(io);
            targetDirty = true;
            return fakeInvoke("applied repair to PatternSelect.tsx", ["killchain_search", "edit"])({ outPath });
          }
          if (p.includes("THE PROPOSAL IS ALREADY APPROVED")
            || p.includes("CURRENT PASS: EDIT")
            || p.includes("CURRENT PASS: EXECUTION")) {
            const tools = p.includes("STRONGER APPLY") ? ["killchain_search", "edit"] : editTools;
            if (onEdit) onEdit(io, p);
            if (io.read(TARGET)?.toString() !== SEED_TSX) targetDirty = true;
            return fakeInvoke("edit pass on PatternSelect.tsx", tools)({ outPath });
          }
          if (p.includes("FINAL REVIEW")) {
            return fakeInvoke(padReport("READY"))({ outPath });
          }
          return fakeInvoke("ok")({ outPath });
        },
      },
    });
    return {
      result,
      io,
      parked,
      validationCalls,
      validationSnapshots,
      missionDir: join(world, "data", id),
      world,
    };
  }

  {
    let edits = 0;
    const r = await runScriptedEdit({
      id: "empty-retry-ok",
      onEdit: (io) => {
        edits += 1;
        if (edits >= 2) io.write(TARGET, Buffer.from(VALID_TSX));
      },
    });
    check("2 one empty edit → retry", r.result.state === "COMPLETE" && edits >= 2 && r.result.emptyEdits >= 1 && r.result.emptyEditRetriesSucceeded >= 1, `state=${r.result.state} edits=${edits} empty=${r.result.emptyEdits}`);
    check("4 zero delta does not run pointless build", r.validationSnapshots.length >= 1 && r.validationSnapshots.every((s) => s !== SEED_TSX), `snaps=${JSON.stringify(r.validationSnapshots)}`);
  }

  {
    let edits = 0;
    const r = await runScriptedEdit({
      id: "empty-block",
      onEdit: () => { edits += 1; },
    });
    check("3 repeated empty edits → BLOCK", r.result.state === "BLOCKED" && /EMPTY_EDIT/.test(r.result.blockedReason || "") && edits >= 3 && r.validationCalls === 0, `state=${r.result.state} reason=${r.result.blockedReason} edits=${edits} val=${r.validationCalls}`);
  }

  {
    const r = await runScriptedEdit({
      id: "syntax-repair-ok",
      onEdit: (io) => io.write(TARGET, Buffer.from(BROKEN_TSX)),
      onRepairApply: (io) => io.write(TARGET, Buffer.from(VALID_TSX)),
      editTools: ["killchain_search", "edit"],
    });
    check("10 syntax failure enters REPAIR", (r.result.syntaxFailures || 0) >= 1 && r.result.state === "COMPLETE", `state=${r.result.state} synFail=${r.result.syntaxFailures} repairs=${r.result.syntaxRepairs}`);
    check("12 repair may revisit already mission-owned file", r.io.read(TARGET).toString() === VALID_TSX && r.result.state === "COMPLETE");
  }

  {
    let diagnoseWrote = false;
    const r = await runScriptedEdit({
      id: "repair-ro-restore",
      onEdit: (io) => io.write(TARGET, Buffer.from(BROKEN_TSX)),
      onRepairDiagnose: (io) => {
        diagnoseWrote = true;
        io.write(TARGET, Buffer.from("export function PatternSelect() { return <div>DIAGNOSE-MUTATION</div>; }\n"));
      },
      onRepairApply: (io) => io.write(TARGET, Buffer.from(VALID_TSX)),
      editTools: ["killchain_search", "edit"],
    });
    check(
      "11 failed repair restores pre-repair snapshot",
      diagnoseWrote && r.io.read(TARGET).toString() === VALID_TSX && (r.result.readOnlyViolations || 0) >= 1 && r.result.state === "COMPLETE",
      `state=${r.result.state} viol=${r.result.readOnlyViolations} bytes=${r.io.read(TARGET)?.toString().slice(0, 80)}`,
    );
  }

  {
    let edits = 0;
    const r = await runScriptedEdit({
      id: "txn-retry",
      maxRetriesPerPhase: 1,
      onEdit: (io, prompt) => {
        edits += 1;
        if (String(prompt).includes("THE PROPOSAL IS ALREADY APPROVED") && edits > 1) {
          io.write(TARGET, Buffer.from(VALID_TSX));
        } else {
          io.write(TARGET, Buffer.from(BROKEN_TSX));
        }
      },
      onRepairApply: (io) => io.write(TARGET, Buffer.from(BROKEN2_TSX)),
      editTools: ["killchain_search", "edit"],
    });
    const restorePath = join(r.missionDir, "transactional-restore.json");
    const restored = existsSync(restorePath) ? readFileSync(restorePath, "utf8") : "";
    const attrPath = join(r.missionDir, "attribution", "mission-diff.json");
    const attr = existsSync(attrPath) ? JSON.parse(readFileSync(attrPath, "utf8")) : { dirty: [], hashes: {} };
    check("13 transactional failed edit restores PRE_EDIT", (r.result.transactionalRollbacks || 0) >= 1 && restored.includes("true"), `rollbacks=${r.result.transactionalRollbacks} state=${r.result.state} reason=${r.result.blockedReason || ""}`);
    check("14 second fresh application attempt works", r.result.state === "COMPLETE" && r.io.read(TARGET).toString() === VALID_TSX, `state=${r.result.state} bytes=${r.io.read(TARGET)?.toString()}`);
    check("17 phase delta remains accurate after rollback", Array.isArray(JSON.parse(readFileSync(join(r.missionDir, "attribution.json"), "utf8")).phaseDeltas), "no phaseDeltas");
    check("18 total mission diff remains accurate after rollback/resume", attr.dirty.includes(TARGET) && attr.hashes[TARGET].after === sha256(Buffer.from(VALID_TSX)), JSON.stringify(attr.hashes?.[TARGET] || attr));
  }

  {
    const r = await runScriptedEdit({
      id: "parked-preserve",
      preserveToggle: true,
      onEdit: (io) => io.write(TARGET, Buffer.from(VALID_TSX)),
      editTools: ["killchain_search", "edit"],
    });
    check(
      "16 parked preserved dirt remains untouched",
      r.result.state === "COMPLETE" && r.io.read(TOGGLE).equals(r.parked) && r.io.read(TARGET).toString() === VALID_TSX,
      `state=${r.result.state} toggle=${r.io.read(TOGGLE)?.toString()}`,
    );
  }

  check("15 read-only state still cannot write", phaseWritesApp("repair-diagnose") === false && phaseWritesApp("plan") === false && phaseWritesApp("proposal") === false);

  const scan = (await import("../audioLab/scanInvariants.mjs")).writeOvernightScan();
  check("claimSource scanner finds callers", scan.claimSource.count >= 6);
  check("rewireFront front-gains stay inside rewireFront", scan.rewireFront.ok);
  check("store-engine coupling scan lists fireCommandStore", (scan.storeEngineCoupling || []).some((h) => String(h.path).includes("fireCommandStore")));
  check("playerStore getEngine sites are line-mapped", (scan.storeEngineCoupling || []).some((h) => h.path.includes("playerStore") && (h.getEngineLines || []).length >= 5));
  check("presentation-only store list is separate from engine-coupled stores", Array.isArray(scan.presentationOnlyStores));
  check(
    "reactorStore is an audioStore bridge with a 30 Hz preview tick",
    (scan.audioStoreBridges || []).some((h) => h.path.includes("reactorStore") && h.previewParams >= 2 && h.highRateTick),
  );
  check(
    "missionStateStore is an audioStore bridge via dynamic import",
    (scan.audioStoreBridges || []).some((h) => h.path.includes("missionStateStore") && h.dynamicImport),
  );
  check(
    "reactorStore is not presentation-only after bridge scan",
    !(scan.presentationOnlyStores || []).some((p) => String(p).includes("reactorStore")),
  );
  check(
    "repairStore remains presentation-heuristic",
    (scan.presentationOnlyStores || []).some((p) => String(p).includes("repairStore")),
  );
  check(
    "autoFlatten is defined in AutoFlatten.ts and called from missionStateStore",
    scan.autoFlatten?.definition?.path?.includes("AutoFlatten.ts")
      && (scan.autoFlatten?.callers || []).some((c) => String(c.path).includes("missionStateStore")),
  );
  check(
    "autoLockScan is defined in tractorAutoLock.ts and called from missionStateStore",
    scan.autoLockScan?.definition?.path?.includes("tractorAutoLock.ts")
      && (scan.autoLockScan?.callers || []).some((c) => String(c.path).includes("missionStateStore"))
      && (scan.autoLockScan?.callers || []).length === 1,
  );
  check(
    "applyChain is defined in chainSnapshot.ts with at least four callers",
    scan.applyChain?.definition?.path?.includes("chainSnapshot.ts")
      && (scan.applyChain?.callers || []).length >= 4
      && (scan.applyChain?.callers || []).some((c) => String(c.path).includes("missionStateStore"))
      && (scan.applyChain?.callers || []).some((c) => String(c.path).includes("audioStore")),
  );
  check(
    "measureLive is defined in tractorLive.ts with Auto-Lock and Tractor UI callers",
    scan.measureLive?.definition?.path?.includes("tractorLive.ts")
      && (scan.measureLive?.callers || []).length >= 4
      && (scan.measureLive?.callers || []).some((c) => String(c.path).includes("tractorAutoLock"))
      && (scan.measureLive?.callers || []).some((c) => String(c.path).includes("TractorBeamView")),
  );
  check(
    "initMissionState is called from App.tsx and stopMissionState has no src callers",
    (scan.initStopMissionState?.initCallers || []).some((c) => String(c.path).includes("App.tsx"))
      && scan.initStopMissionState?.stopCount === 0,
  );
  check(
    "startStageVizLoop has many Fire Command StageViz callers",
    scan.startStageVizLoop?.definition?.path?.includes("stageVizRaf.ts")
      && (scan.startStageVizLoop?.count || 0) >= 30
      && (scan.startStageVizLoop?.callers || []).every((c) => String(c.path).includes("FireCommand")),
  );

  const fireMap = (await import("../ui/scanFireCommand.mjs")).scanFireCommandPanels();
  check("Fire Command map finds many UI files", fireMap.count >= 80);
  check(
    "DrivePanel is inner FireCommandView, not a sibling file",
    fireMap.innerPanelsWithoutSiblingFile.includes("DrivePanel") && fireMap.fireCommandViewInnerFunctions.includes("DrivePanel"),
  );
  check(
    "WidthPanel.tsx helper shadows inner WidthPanel()",
    (fireMap.helperNamesShadowingInner || []).includes("WidthPanel") && (fireMap.extractedPanelHelpers || []).includes("WidthPanel.tsx"),
  );
  check(
    "HarmonyPanel helper imports HarmonyStageViz",
    (fireMap.panelVizPairs || []).some((p) => p.helper.includes("HarmonyPanel") && p.viz.some((v) => v.includes("HarmonyStageViz"))),
  );
  check(
    "fireStudio live recorders detach in finally",
    scan.fireStudioTaps?.ok === true
      && scan.fireStudioTaps?.realtimeHasFinallyDetach === true
      && scan.fireStudioTaps?.stemsHasFinallyDetach === true,
  );
  check(
    "bounceExport destinationTap disconnects in finally",
    scan.bounceExportTaps?.ok === true && scan.bounceExportTaps?.finallyDisconnect === true,
  );
  check(
    "bounceExport tap lifetime is finally; Scope is effect-cleanup; visualIntel is start-stop",
    (scan.tapLifetimes || []).some((h) => String(h.path).includes("bounceExport.ts") && h.kind === "finally")
      && (scan.tapLifetimes || []).some((h) => String(h.path).includes("ScopeView.tsx") && h.kind === "effect-cleanup")
      && (scan.tapLifetimes || []).some((h) => String(h.path).includes("visualIntel.ts") && h.kind === "start-stop"),
  );

  // ---- deterministic TSX structural analysis (jsxStructure.mjs) ----------
  const balancedTsx = `export function A() {\n  return (\n    <div className="x">\n      {cond && (\n        <span>hi</span>\n      )}\n    </div>\n  );\n}\n`;
  check("scanner: balanced TSX is balanced", scanStructure(balancedTsx, { jsx: true }).ok === true);

  // The archived DrumMachine shape: a duplicated `)}` closing nothing.
  const surplusTsx = `export function A() {\n  return (\n    <div>\n      {cond && (\n        <span>hi</span>\n      )}\n      )}\n    </div>\n  );\n}\n`;
  const surplusScan = scanStructure(surplusTsx, { jsx: true });
  check(
    "scanner: surplus JSX closer is localized to its exact line",
    surplusScan.ok === false
      && surplusScan.firstDivergence?.line === 7
      && surplusScan.unclosed.length === 0,
  );

  const missingCloser = `export function A() {\n  return (\n    <div>\n      <span>hi</span>\n  );\n}\n`;
  const missingScan = scanStructure(missingCloser, { jsx: true });
  check(
    "scanner: unclosed opener is reported as missing, not surplus",
    missingScan.ok === false && missingScan.unclosed.some((u) => u.name === "div"),
  );

  const swapped = `export function A() {\n  return (\n    <div>\n      <section>\n        <span>hi</span>\n      </div>\n    </section>\n  );\n}\n`;
  const swappedScan = scanStructure(swapped, { jsx: true });
  check(
    "scanner: transposed closing tags are detected as a pair",
    (swappedScan.swappedClosers || []).length === 1
      && swappedScan.tagMismatches[0].openedAtLine === 4,
  );

  // Constructs that must NOT be mistaken for JSX or for stray delimiters.
  check(
    "scanner: template literal containing // is not a comment",
    scanStructure("const u = `proto:///load?p=${encodeURIComponent(x)}`;\n", { jsx: false }).ok === true,
  );
  check(
    "scanner: regex literal containing quotes and brackets is skipped",
    scanStructure('const s = String(v).replace(/"/g, "%22");\nconst r = /^A \\((?:[^,]+,)?([^,]+)\\)$/.exec(s);\n', { jsx: false }).ok === true,
  );
  check(
    "scanner: generic type parameter list is not a JSX element",
    scanStructure("type P = { onChange: <K extends keyof T>(k: K) => void };\n", { jsx: true }).ok === true,
  );
  check(
    "scanner: JSX element with explicit type arguments is balanced",
    scanStructure("const A = () => (\n  <Strip<Mode> eyebrow=\"x\" value={m} />\n);\n", { jsx: true }).ok === true,
  );
  check(
    "scanner: fragment after a block comment is recognized",
    scanStructure("const A = cond ? (\n  /* note */\n  <>\n    <b>x</b>\n  </>\n) : null;\n", { jsx: true }).ok === true,
  );
  check(
    "scanner: fragment as an attribute value is recognized",
    scanStructure("const A = (\n  <Shell right={\n    <>\n      <b>x</b>\n    </>\n  } />\n);\n", { jsx: true }).ok === true,
  );
  check(
    "scanner: comparison operators are not JSX",
    scanStructure("const ok = a < b && c > d;\nconst n = total / count;\n", { jsx: false }).ok === true,
  );

  const packet = jsxRepairPacket({ fileName: "x.tsx", source: surplusTsx, diagnostics: [] });
  check(
    "structural packet names the fault line, the shape, and the expected closers",
    /FIRST STRUCTURAL DIVERGENCE: line 7/.test(packet.markdown)
      && /TOO MANY closers/.test(packet.markdown)
      && /EXPECTED CLOSER SEQUENCE/.test(packet.markdown)
      && /OPEN FRAME STACK/.test(packet.markdown),
  );
  check(
    "fingerprint delta reports a repair that only removed the surplus closer",
    fingerprintDelta(surplusTsx, balancedTsx, { jsx: true }).nowBalanced === true,
  );

  // ---- identifier scope gate (identifierGate.mjs) ------------------------
  const scopedOk = "import { useStore } from './s';\nexport function A() {\n  const v = useStore();\n  return v;\n}\n";
  check("scope gate: fully resolved file is clean", checkIdentifiers("a.ts", scopedOk).ok === true);

  // The exact archived failure: store name used where the hook was imported.
  const invented = "import { useFireSequencerStore } from './s';\nexport function A() {\n  setActiveSectionId('x');\n  return fireSequencerStore.getState();\n}\n";
  const identRes = checkIdentifiers("a.ts", invented);
  check(
    "scope gate: identifiers declared nowhere are reported",
    identRes.ok === false
      && identRes.unresolved.map((u) => u.name).sort().join(",") === "fireSequencerStore,setActiveSectionId",
  );
  check(
    "scope gate: suggests the real in-scope hook for a bare store name",
    (identRes.unresolved.find((u) => u.name === "fireSequencerStore")?.candidates || [])
      .includes("useFireSequencerStore"),
  );
  check(
    "scope gate: destructured, catch, and type-param bindings all count as declared",
    checkIdentifiers(
      "a.ts",
      "export function A<T>(input: T) {\n  const { a, b: [c] } = obj();\n  try { a(); } catch (e) { c(e); }\n  return input;\n}\nfunction obj() { return { a: () => 0, b: [() => 0] }; }\n",
    ).unresolved.length === 0,
  );
  check(
    "scope gate: lowercase JSX tags and attribute names are not references",
    checkIdentifiers("a.tsx", "export const A = () => <div className=\"x\" data-y=\"1\" />;\n").ok === true,
  );
  check(
    "scope gate packet tells the model to use existing names",
    /DECLARED NOWHERE/.test(formatIdentifierPacket([identRes]))
      && /Do not introduce new identifiers/.test(formatIdentifierPacket([identRes])),
  );

  // ---- failure classification + escalation (failureClass.mjs) ------------
  const mech = classifyFailure({
    syntax: { ok: false, structures: [{ file: "a.tsx", balanced: false, faultLine: 372, surplus: 1, unclosed: 0, mismatches: 2 }] },
  });
  check("classifier: broken delimiters classify as MECHANICAL_SYNTAX", mech.failureClass === "MECHANICAL_SYNTAX");
  check(
    "escalation: a repeated mechanical failure restores pre-edit instead of mutating again",
    escalate(mech, { attemptsForClass: 0 }).action === ACTIONS.STRUCTURAL_REPAIR
      && escalate(mech, { attemptsForClass: 1 }).action === ACTIONS.RESTORE_AND_REAPPLY,
  );

  const invClass = classifyFailure({ validation: "error TS2552: Cannot find name 'fireSequencerStore'. Did you mean 'useFireSequencerStore'?" });
  check(
    "classifier: TS2552 classifies as INVENTED_SYMBOL and extracts both names",
    invClass.failureClass === "INVENTED_SYMBOL"
      && invClass.detail.names.includes("fireSequencerStore")
      && invClass.detail.suggested.includes("useFireSequencerStore"),
  );

  check(
    "classifier: zero delta plus a 'no changes required' proposal is PRODUCT_AMBIGUITY, not an apply retry",
    classifyFailure({
      editOutcome: { empty: true, kind: "DESCRIBED_BUT_DID_NOT_APPLY" },
      proposalText: "PROPOSAL: NO CHANGES REQUIRED\nThe UI ambiguity does not exist.",
    }).action === ACTIONS.BLOCK,
  );
  check(
    "classifier: plain zero delta is an apply-discipline retry that blocks on the third",
    (() => {
      const c = classifyFailure({ editOutcome: { empty: true, kind: "EMPTY_EDIT" }, proposalText: "change borderColor to 0.30" });
      return c.failureClass === "APPLY_EMPTY"
        && escalate(c, { attemptsForClass: 0 }).action === ACTIONS.STRONG_APPLY
        && escalate(c, { attemptsForClass: 2 }).action === ACTIONS.BLOCK;
    })(),
  );
  check(
    "classifier: a missing-verdict critic is a REPORTING_FAILURE, not a replan",
    (() => {
      const c = classifyFailure({ criticErrors: ["missing-verdict"] });
      return c.failureClass === "REPORTING_FAILURE" && c.action === ACTIONS.REEMIT_REPORT;
    })(),
  );
  check(
    "classifier: substantive critic errors force a replan",
    classifyFailure({ criticErrors: ["invented-files:src/x.tsx"], inventedFiles: [] }).failureClass === "CRITIC_SUBSTANTIVE",
  );
  check(
    "classifier: writing outside allowedPaths always blocks",
    classifyFailure({ unauthorized: ["src/audio/AudioEngine.ts"] }).action === ACTIONS.BLOCK,
  );
  check(
    "escalation: audio-level missions never get blind local retries",
    escalate(classifyFailure({ validation: "boom" }), { attemptsForClass: 2, level: 4, teacherAvailable: false }).action === ACTIONS.BLOCK,
  );

  // ---- teacher packet + response contract (teacherPacket.mjs) -----------
  const tSpec = {
    id: "t1",
    title: "toggle contrast",
    level: 1,
    levelInfo: { name: "single-file UI" },
    goal: "raise disabled contrast",
    acceptance: ["disabled tokens are more legible"],
    allowedPaths: ["src/components/FireCommand/ModuleEnableToggle.tsx"],
  };
  const tDir = mkdtempSync(join(tmpdir(), "kc-teacher-"));
  const brokenFixture = "export function A() {\n  return (\n    <div>\n      {c && (\n        <span>x</span>\n      )}\n      )}\n    </div>\n  );\n}\n";
  const tPacket = buildTeacherPacket({
    missionDir: tDir,
    spec: tSpec,
    status: { state: "REPAIRING", modelCalls: 9, failureClassCounts: { MECHANICAL_SYNTAX: 2 } },
    classification: { failureClass: "MECHANICAL_SYNTAX", evidence: ["surplus closer"] },
    files: ["src/components/FireCommand/ModuleEnableToggle.tsx"],
    readRepo: () => brokenFixture,
  });
  check(
    "teacher packet carries task, invariants, questions and the structural analysis",
    Boolean(tPacket.sections["TASK.md"] && tPacket.sections["INVARIANTS.md"]
      && tPacket.sections["QUESTIONS.md"] && tPacket.sections["STRUCTURE.md"]),
  );
  check(
    "teacher packet stays inside its size budget and never dumps whole files",
    tPacket.withinBudget === true && tPacket.totalChars < PACKET_BUDGET.totalChars,
  );
  check(
    "teacher packet asks failure-class-specific questions",
    /DELETE a surplus closer or to RESTORE a deleted opener/.test(tPacket.sections["QUESTIONS.md"]),
  );
  check(
    "teacher packet selects UI invariants for a components path, not audio ones",
    /interaction behaviour or focus order/.test(tPacket.sections["INVARIANTS.md"])
      && !/claimSource/.test(tPacket.sections["INVARIANTS.md"]),
  );

  const goodTeacher = [
    "DIAGNOSIS: A duplicated JSX expression closer was left behind by an earlier edit.",
    "EVIDENCE: The scanner reports surplus=1 unclosed=0 with the first divergence at line 7.",
    "ROOT_CAUSE: The apply pass re-emitted a closer that already existed.",
    "FAILED_STUDENT_ASSUMPTION: That the parser error line was the line to rewrite.",
    "RECOMMENDED_REPAIR: Delete the surplus closer line; change nothing else.",
    "FILES: src/components/FireCommand/ModuleEnableToggle.tsx",
    "SYMBOLS: NONE",
    "RISKS: Deleting the wrong closer would unbalance the element stack.",
    "VALIDATION: syntax gate, then typecheck.",
    "CONFIDENCE: HIGH",
  ].join("\n");
  const okTeacher = validateTeacherResponse(goodTeacher, { spec: tSpec, readRepo: () => brokenFixture });
  check("teacher contract: a complete, in-scope response validates", okTeacher.ok === true && okTeacher.confidence === "HIGH");
  check("teacher output is always marked advisory", okTeacher.advisory === true);

  check(
    "teacher contract: an unstructured prose answer is rejected",
    validateTeacherResponse("Just delete the extra paren, should be fine.", { spec: tSpec, readRepo: () => brokenFixture })
      .errors.some((e) => e.startsWith("missing-fields")),
  );
  check(
    "teacher contract: a confident answer citing a non-existent file is rejected",
    validateTeacherResponse(
      goodTeacher.replace("FILES: src/components/FireCommand/ModuleEnableToggle.tsx", "FILES: src/components/FireCommand/ModuleEnableToggleBase.tsx"),
      { spec: tSpec, readRepo: (rel) => (rel.includes("Base") ? null : brokenFixture) },
    ).errors.some((e) => e.startsWith("invented-files")),
  );
  check(
    "teacher contract: a recommendation outside allowedPaths is rejected",
    validateTeacherResponse(
      goodTeacher.replace("FILES: src/components/FireCommand/ModuleEnableToggle.tsx", "FILES: src/audio/AudioEngine.ts"),
      { spec: tSpec, readRepo: () => brokenFixture },
    ).errors.some((e) => e.startsWith("outside-allowed")),
  );
  check(
    "teacher contract: symbols that do not appear in the cited files are rejected",
    validateTeacherResponse(
      goodTeacher.replace("SYMBOLS: NONE", "SYMBOLS: useNonExistentHook"),
      { spec: tSpec, readRepo: () => brokenFixture },
    ).errors.some((e) => e.startsWith("symbols-not-found")),
  );

  // ================= tutoring gates: detect -> localize -> explain =========

  // ---- failure-kind routing ----
  check("kindForError: missing-verdict is a format failure", kindForError("missing-verdict") === TUTOR.CRITIC_FORMAT);
  check("kindForError: invented-files is a reference failure", kindForError("invented-files:src/x.tsx") === TUTOR.INVALID_REFERENCE);
  check("kindForError: outside-allowed is a scope failure", kindForError("outside-allowed:src/y.tsx") === TUTOR.SCOPE);
  check("kindForError: unresolved-design is product ambiguity", kindForError("unresolved-design") === TUTOR.PRODUCT_AMBIGUITY);

  const fmtOnly = classifyGateFailure({ errors: ["missing-verdict"], modelVerdict: "PASS" });
  check("format-only failure is classified format-only", fmtOnly.formatOnly && fmtOnly.kind === TUTOR.CRITIC_FORMAT);
  check("format-only failure names the exact missing field", fmtOnly.missingFields.includes("VERDICT"));

  const refWins = classifyGateFailure({ errors: ["missing-verdict", "invented-files:src/nope.tsx"], modelVerdict: "PASS" });
  check(
    "an invented reference outranks a formatting problem",
    refWins.kind === TUTOR.INVALID_REFERENCE && !refWins.formatOnly,
  );

  const negative = classifyGateFailure({ errors: [], modelVerdict: "FAIL" });
  check(
    "a clean negative verdict is substantive, not a contract failure",
    negative.kind === TUTOR.CRITIC_SUBSTANTIVE && !negative.formatOnly,
  );

  const ambiguity = classifyGateFailure({ errors: ["unresolved-design", "missing-verdict"], modelVerdict: "PASS" });
  check("product ambiguity outranks every other class", ambiguity.kind === TUTOR.PRODUCT_AMBIGUITY);

  // ---- substance detection decides whether a cheap reshape is even safe ----
  const richCritic = [
    "I inspected src/components/FireCommand/ModuleEnableToggle.tsx around line 110.",
    "The contrast change could break the enabled styling, which would be a regression.",
    "I verified onClick still calls setModuleEnable because the handler is untouched.",
    "I recommend we proceed.",
  ].join("\n");
  check("substance detected for INSPECTED when a real path is cited", hasSubstanceFor("INSPECTED", richCritic));
  check("substance detected for RISK when a regression is discussed", hasSubstanceFor("RISK", richCritic));
  check("substance detected for VERDICT when a recommendation is stated", hasSubstanceFor("VERDICT", richCritic));

  const emptyish = "Complete. Let me now emit the report.";
  check("no substance claimed for a stub output", !hasSubstanceFor("RISK", emptyish) && !hasSubstanceFor("VERDICT", emptyish));

  // ---- critic format packet: reshape only, never fabricate ----
  const fmtPacket = criticFormatPacket({
    gate: { errors: ["missing-verdict"] },
    criticText: richCritic,
    missingFields: ["VERDICT"],
  });
  check("critic format packet names the missing field", /EXACT_MISSING_FIELDS: VERDICT/.test(fmtPacket));
  check("critic format packet forbids re-investigation", /Do not re-investigate/.test(fmtPacket));
  check("critic format packet forbids inventing evidence", /Do not invent evidence/.test(fmtPacket));
  check("critic format packet returns the model's own output to reshape", fmtPacket.includes("I inspected src/components/FireCommand/ModuleEnableToggle.tsx"));
  check("critic format packet carries a retry budget", /RETRY_BUDGET: 0 of 1 used/.test(fmtPacket));

  const noSubstancePacket = criticFormatPacket({
    gate: { errors: ["no-risk"] },
    criticText: emptyish,
    missingFields: ["RISK"],
  });
  check(
    "format repair demands MISSING rather than a fabricated field",
    /write the label followed by MISSING/i.test(noSubstancePacket),
  );

  // ---- grounded vs ungrounded zero-tool critics ----
  const l1 = { level: 1, allowedPaths: ["src/components/FireCommand/ModuleEnableToggle.tsx"] };
  const citing = "INSPECTED: src/components/FireCommand/ModuleEnableToggle.tsx\nRISK: contrast\nEVIDENCE: diff shows only style values changed\nVERDICT: PASS";
  const groundedNoTools = criticGroundingOk({
    criticText: citing,
    tools: [],
    spec: l1,
    suppliedEvidence: "diff --git a/src/components/FireCommand/ModuleEnableToggle.tsx b/src/components/FireCommand/ModuleEnableToggle.tsx\n+ borderColor",
  });
  check(
    "zero-tool critic is grounded when the diff it cites was supplied",
    groundedNoTools.ok && groundedNoTools.via === "supplied-evidence",
  );

  const ungroundedNoTools = criticGroundingOk({ criticText: citing, tools: [], spec: l1, suppliedEvidence: "" });
  check(
    "zero-tool critic with no supplied evidence is ungrounded",
    !ungroundedNoTools.ok && ungroundedNoTools.reason === "critic-no-tools",
  );

  const partlyGrounded = criticGroundingOk({
    criticText: `${citing}\nAlso inspected src/components/FireCommand/Invented.tsx`,
    tools: [],
    spec: l1,
    suppliedEvidence: "diff --git a/src/components/FireCommand/ModuleEnableToggle.tsx b/src/components/FireCommand/ModuleEnableToggle.tsx",
  });
  check(
    "citing a path absent from the supplied evidence is still ungrounded",
    !partlyGrounded.ok,
  );

  check(
    "tool count is not required when the level does not demand it",
    criticGroundingOk({ criticText: citing, tools: [], spec: { level: 0 } }).ok,
  );

  // ---- the archived colonless verdict must parse ----
  const colonless = parseCritic("## INSPECTED\n- src/state/coverStore.ts\n\n## VERDICT READY");
  check("`## VERDICT READY` parses as a verdict", !colonless.missingVerdict && colonless.verdict === "READY");
  check("`VERDICT - PASS` parses as a verdict", parseCritic("VERDICT - PASS").verdict === "PASS");
  check(
    "a bare mention of the word verdict is not a verdict",
    parseCritic("I will now produce the verdict for this mission.").missingVerdict,
  );

  // ---- reference tutoring uses verified alternatives, never guesses ----
  const near = nearestValidReferences("src/components/FireCommand/ModuleEnableToggleBase.tsx", {
    candidates: ["src/components/FireCommand/ModuleEnableToggle.tsx", "src/components/FireCommand/fcChip.tsx"],
  });
  check(
    "nearest-reference finds the real sibling for an invented name",
    near.some((n) => n.path === "src/components/FireCommand/ModuleEnableToggle.tsx"),
  );
  check(
    "nearest-reference offers nothing when no candidate is close",
    nearestValidReferences("src/totally/Unrelated.tsx", { candidates: ["src/components/FireCommand/fcChip.tsx"] }).length === 0,
  );
  check(
    "nearest-reference never proposes a path that does not exist",
    nearestValidReferences("src/components/FireCommand/DrivePanel.tsx", {
      candidates: ["src/components/FireCommand/DrivePanelXYZ.tsx"],
    }).length === 0,
  );

  const refPack = referencePacket({
    invalid: ["src/components/FireCommand/HomeBandContent.tsx"],
    nearest: [{ path: "src/components/FireCommand/fcChip.tsx", why: "sibling with related name" }],
    symbols: [{ symbol: "FireBandLabel", path: "src/components/FireCommand/FireSegTabs.tsx" }],
    allowedPaths: ["src/components/FireCommand/fcChip.tsx"],
  });
  check("reference packet lists the invalid path", refPack.includes("HomeBandContent.tsx"));
  check("reference packet names the verified symbol location", /FireBandLabel is defined in src\/components\/FireCommand\/FireSegTabs\.tsx/.test(refPack));
  check("reference packet forbids inventing a replacement", /Do not invent a replacement path/.test(refPack));
  check("reference packet explains a real symbol implies no file", /does not imply a same-named file/.test(refPack));

  // ---- scope tutoring never widens the allowlist ----
  const scopePack = scopePacket({
    unauthorized: ["src/components/FireCommand/WidthPanel.tsx"],
    allowedPaths: ["src/components/FireCommand/GatePanel.tsx"],
    delta: "M src/components/FireCommand/WidthPanel.tsx",
  });
  check("scope packet shows the unauthorized path", scopePack.includes("WidthPanel.tsx"));
  check("scope packet shows the authorized paths", scopePack.includes("GatePanel.tsx"));
  check("scope packet forbids editing outside scope", /Do not edit any path not listed/.test(scopePack));
  check(
    "scope packet blocks rather than expanding when the goal needs more",
    /requires additional authorization and stop/.test(scopePacket({ unauthorized: ["a"], goalRequiresExpansion: true })),
  );

  // ---- empty-edit tutoring is execution-only ----
  const emptyPack = emptyEditPacket({
    proposalSummary: "raise disabled contrast values",
    expectedFiles: ["src/components/FireCommand/ModuleEnableToggle.tsx"],
  });
  check("empty-edit packet states the delta was zero", /ACTUAL DELTA: ZERO BYTES/.test(emptyPack));
  check("empty-edit packet demands a mutation tool", /Do not finish without calling a mutation tool/.test(emptyPack));
  check("empty-edit packet forbids writing plan files", /Do not write a PLAN, PROPOSAL, or summary file/.test(emptyPack));
  check("empty-edit packet forbids re-deriving the change", /already approved/.test(emptyPack));

  // ---- validation tutoring is localized, not a build dump ----
  const valPack = validationPacket({
    primary: "SequencerPanel.tsx(486,15): error TS2552",
    related: Array.from({ length: 40 }, (_, i) => `diag ${i}`),
    files: ["src/components/FireCommand/SequencerPanel.tsx"],
    windows: "484 |   const x = 1;",
    repairScope: ["src/components/FireCommand/SequencerPanel.tsx"],
  });
  check("validation packet leads with the primary failure", /PRIMARY FAILURE:\s*\n?SequencerPanel\.tsx\(486,15\)/.test(valPack));
  check("validation packet caps related diagnostics", /showing 8/.test(valPack) && !valPack.includes("diag 20"));
  check("validation packet forbids refactoring", /Do not refactor/.test(valPack));

  const subPack = substantivePacket({ verdict: "FAIL", findings: ["focus ring removed"], acceptanceGaps: ["keyboard nav unproven"] });
  check("substantive packet carries the findings", subPack.includes("focus ring removed"));
  check("substantive packet requires evidence to dismiss a finding", /Do not dismiss a finding without evidence/.test(subPack));
  check(
    "substantive packet is not treated as a format problem",
    /FAILURE_CLASS: CRITIC_SUBSTANTIVE/.test(subPack),
  );

  // ---- lesson store: evidence-gated, phase-scoped, never over-injected ----
  check(
    "every eligible lesson has corroborating support",
    eligibleLessons().every((l) => l.supportCount >= MIN_SUPPORT && l.evidenceCases.length >= MIN_SUPPORT),
  );
  check(
    "no lesson claims more support than it lists evidence for",
    LESSONS.every((l) => l.supportCount <= l.evidenceCases.length),
  );
  check(
    "every lesson targets at least one real mission phase",
    LESSONS.every((l) => l.promptTargets.length > 0 && l.promptTargets.every((p) => PHASES.includes(p))),
  );

  const editLessons = selectLessons({ phase: "edit" });
  check(
    "edit phase gets apply-discipline lessons",
    editLessons.some((l) => l.id === "execution-is-mutation"),
  );
  check(
    "edit phase is not given critic-contract lessons",
    !editLessons.some((l) => l.id === "one-verdict-line"),
  );

  const criticLessons = selectLessons({ phase: "plan-critic" });
  check(
    "critic phase gets the verdict-contract lesson",
    criticLessons.some((l) => l.id === "one-verdict-line"),
  );

  const repairLessons = selectLessons({ phase: "repair", failureClass: "REPAIR_DEGRADATION" });
  check(
    "a known failure class ranks its own lesson first",
    repairLessons[0]?.id === "restore-before-reapply",
  );

  check("lesson selection is capped to keep context lean", selectLessons({ phase: "repair", max: 2 }).length <= 2);
  check("selecting for an unused phase injects nothing", formatLessons(selectLessons({ phase: "investigate", max: 0 })) === "");
  check(
    "formatted lessons state the corroboration bar",
    /corroborated by at least 2 recorded cases/.test(formatLessons(selectLessons({ phase: "repair" }))),
  );

  // ---- stripped execution contract ----
  const execSpec = {
    id: "x", title: "t", level: 1, levelInfo: { name: "one-file" },
    goal: "GOAL_SENTINEL should never reach the executor",
    brief: "BRIEF_SENTINEL should never reach the executor",
    acceptance: ["ACCEPTANCE_SENTINEL should never reach the executor"],
    allowedPaths: ["src/components/FireCommand/ModuleEnableToggle.tsx"],
  };
  const execP = executePrompt(execSpec, { dryRun: false }, {
    proposal: "Raise the disabled-state contrast values.",
    expectedFiles: ["src/components/FireCommand/ModuleEnableToggle.tsx"],
  });
  check("execution prompt names the target file", execP.includes("src/components/FireCommand/ModuleEnableToggle.tsx"));
  check("execution prompt carries the approved change", execP.includes("Raise the disabled-state contrast values."));
  check("execution prompt withholds the goal", !execP.includes("GOAL_SENTINEL"));
  check("execution prompt withholds the brief", !execP.includes("BRIEF_SENTINEL"));
  check("execution prompt withholds acceptance criteria", !execP.includes("ACCEPTANCE_SENTINEL"));
  check("execution prompt forbids re-planning", /Do not re-plan/.test(execP));
  check("execution prompt forbids writing plan files", /Do not create PLAN\.md/.test(execP));
  check("execution prompt demands a written file", /Do not finish without having written a file/.test(execP));
  const wideP = editPrompt(execSpec, { dryRun: false }, { proposal: "p", plan: "q" });
  check("stripped execution prompt is smaller than the wide edit prompt", execP.length < wideP.length);

  // ---- restore-on-regression fault counting ----
  const cleanTsx = "export function A() {\n  return <div><span>x</span></div>;\n}\n";
  const brokenTsx = "export function A() {\n  return <div><span>x</div>;\n}\n";
  check("fault count is zero for a clean component", countFaults("a.tsx", cleanTsx) === 0);
  check("fault count is positive for a broken component", countFaults("a.tsx", brokenTsx) > 0);
  check(
    "a worse buffer counts more faults than the original",
    countFaults("a.tsx", `${brokenTsx}</div>\n`) > countFaults("a.tsx", brokenTsx),
  );

  // ---- hunk mining: the patcher must be exact or its exercises are junk ----
  const sampleDiff = [
    "@@ -10,5 +10,6 @@",
    " const a = 1;",
    " const b = 2;",
    "-const c = 3;",
    "+const c = 4;",
    "+const d = 5;",
    " const e = 6;",
    " const f = 7;",
  ].join("\n");
  const hs = parseHunks(sampleDiff);
  check("parseHunks finds one hunk", hs.length === 1);
  check("parseHunks reads the new-side start and count", hs[0].newStart === 10 && hs[0].newCount === 6);

  const afterText = [
    ...Array.from({ length: 9 }, (_, i) => `line${i + 1}`),
    "const a = 1;", "const b = 2;", "const c = 4;", "const d = 5;", "const e = 6;", "const f = 7;",
    "tail",
  ].join("\n");
  const undone = reverseApplyHunk(afterText, hs[0]);
  check("reverseApplyHunk restores the removed line", undone?.includes("const c = 3;"));
  check("reverseApplyHunk drops the added lines", undone && !undone.includes("const c = 4;") && !undone.includes("const d = 5;"));
  check("reverseApplyHunk preserves surrounding context", undone?.startsWith("line1") && undone?.endsWith("tail"));
  check(
    "reverseApplyHunk refuses to splice when the new side does not match",
    reverseApplyHunk(afterText.replace("const b = 2;", "const b = 99;"), hs[0]) === null,
  );

  check(
    "classifyHunk routes an import change to mechanical correction",
    classifyHunk({ lines: ["+import { x } from \"./y\";"] }, "a.tsx") === FAMILIES.MECHANICAL_IMPORT,
  );
  check(
    "classifyHunk routes a tailwind gap change to UI layout",
    classifyHunk({ lines: ["-  <div className=\"gap-1\">", "+  <div className=\"gap-[0.3rem]\">"] }, "a.tsx") === FAMILIES.UI_LAYOUT,
  );

  // Live invariant: undoing every hunk of a file must reproduce its parent
  // blob byte-for-byte. If this ever fails, every mined exercise is suspect.
  const hunkSelfTest = selfTest({ commits: 3 });
  check(
    `hunk patcher reproduces the parent blob exactly (${hunkSelfTest.exact}/${hunkSelfTest.checked} files)`,
    hunkSelfTest.checked > 0 && hunkSelfTest.mismatched.length === 0,
    JSON.stringify(hunkSelfTest.mismatched.slice(0, 3)),
  );

  // ---- regression guard: the analyzers must stay quiet on real sources ----
  const repoScan = scanRepoFiles(join(repoRoot, "src"));
  check(
    `structural scanner has no false positives across ${repoScan.total} repo sources`,
    repoScan.offenders.length === 0,
  );

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
  return { passed, failed };
}
