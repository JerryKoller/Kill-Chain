import { mkdirSync, mkdtempSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseMissionMarkdown, pathEditable, matchPath } from "./schema.mjs";
import { assertTransition, ALLOWED_TRANSITIONS } from "./machine.mjs";
import { parseOpenCodeJsonl, visibleReportTooThin, buriedVerdict } from "./opencode.mjs";
import { scanUnixTools } from "./unix.mjs";
import { parseCritic, parseMentionedPaths, proposalScopeCheck, checkReferencedFilesExist, evaluateArtifactGate, evaluateCriticGate, checkProposalConcrete, quarantineFitsDest, findWrongStackPaths, existingMarkedNew } from "./critic.mjs";
import { assertMetrics } from "../ui/metrics.mjs";
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
import { clip } from "./prompts.mjs";

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
  const criticInvented = evaluateCriticGate({
    criticText: "INSPECTED: src/components/FireCommand/DrivePanel.tsx\nRISK: canvas could be mistaken for a meter\nEVIDENCE: DriveStageViz only reads store\nVERDICT: READY\n",
    spec: { level: 0, allowedPaths: [], forbiddenPaths: [], readOnlyPaths: ["src/components/FireCommand/**"] },
    tools: ["killchain_search"],
    phase: "final",
  });
  check("final critic invented DrivePanel is rejected", criticInvented.errors.some((e) => String(e).includes("DrivePanel")));

  const existOk = checkReferencedFilesExist("inspect `src/components/FireCommand/ModuleEnableToggle.tsx`");
  check("valid existing UI file existence", existOk.ok);

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
          if (p.includes("THE PROPOSAL IS ALREADY APPROVED") || p.includes("CURRENT PASS: EDIT")) {
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

  const fireMap = (await import("../ui/scanFireCommand.mjs")).scanFireCommandPanels();
  check("Fire Command map finds many UI files", fireMap.count >= 80);
  check(
    "DrivePanel is inner FireCommandView, not a sibling file",
    fireMap.innerPanelsWithoutSiblingFile.includes("DrivePanel") && fireMap.fireCommandViewInnerFunctions.includes("DrivePanel"),
  );

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
  return { passed, failed };
}
