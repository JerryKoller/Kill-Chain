import { mkdirSync, mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseMissionMarkdown, pathEditable, matchPath } from "./schema.mjs";
import { assertTransition, ALLOWED_TRANSITIONS } from "./machine.mjs";
import { parseOpenCodeJsonl, visibleReportTooThin, buriedVerdict } from "./opencode.mjs";
import { scanUnixTools } from "./unix.mjs";
import { parseCritic, parseMentionedPaths, proposalScopeCheck, checkReferencedFilesExist, evaluateArtifactGate, evaluateCriticGate, checkProposalConcrete, quarantineFitsDest } from "./critic.mjs";
import { assertSafeMissionId } from "./schema.mjs";
import {
  classifyPorcelain,
  parsePorcelain,
  unauthorizedChanges,
  unexpectedJunk,
  diffCheckArgs,
  appDiffFiles,
} from "./gitops.mjs";
import { runPreflight } from "./preflight.mjs";
import { runValidation, npmSpawnSpec } from "./validate.mjs";
import { createMissionStore, loadMission, transition } from "./store.mjs";
import { runMission } from "./runner.mjs";

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

  const criticFail = parseCritic("some thoughts\nVERDICT: FAIL\n- missing FireCommandView");
  check("critic FAIL parsed", criticFail.verdict === "FAIL" && criticFail.findings.length === 1);

  const mdVerdict = parseCritic("### INSPECTED\n- src/components/FireCommand/ModuleEnableToggle.tsx\n\n### RISK\nclick feel could change if hit area grows\n\n### EVIDENCE\nonClick still calls setModuleEnable\n\n### VERDICT\nPASS\n");
  check("markdown ### VERDICT PASS parses", !mdVerdict.missingVerdict && mdVerdict.verdict === "PASS" && mdVerdict.inspected.includes("ModuleEnableToggle"));

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

  check("quarantine PLAN dump not ingested as proposal", !quarantineFitsDest("1788410059304-PLAN.md", "PROPOSAL.md"));
  check("quarantine PROPOSAL dump matches dest", quarantineFitsDest("PROPOSAL.md", "PROPOSAL.md"));

  const multiOpt = checkProposalConcrete(`
# Proposal
Option A darken disabled
Option B add an icon
Which visual enhancement vector do you prefer? Human review of visual strategy requested before any code edits proceed.
path: src/components/FireCommand/ModuleEnableToggle.tsx
`.repeat(3));
  check("multi-option asks-human proposal fails", !multiOpt.ok && multiOpt.errors.includes("unresolved-design"));

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

  function fakeInvoke(text) {
    return async ({ outPath }) => {
      mkdirSync(join(outPath, ".."), { recursive: true });
      const jsonl = [
        { type: "tool_use", part: { type: "tool", tool: "killchain_search" } },
        { type: "text", part: { type: "text", text } },
      ].map((e) => JSON.stringify(e)).join("\n");
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

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
  return { passed, failed };
}
