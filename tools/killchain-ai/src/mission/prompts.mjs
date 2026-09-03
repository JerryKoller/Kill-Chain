/** Prompt-only. Never use for checkpoint/recovery artifacts — those must be lossless. */
export function clip(text, n = 12000) {
  const s = String(text || "");
  if (s.length <= n) return s;
  return `${s.slice(0, n)}\n\n[truncated ${s.length - n} chars; full text is on disk in mission state]`;
}

export const DISCIPLINE = `WINDOWS + DISCIPLINE (deterministic; do not "remember" later):
- This machine is Windows. Use PowerShell-native commands if you must use a shell (Get-ChildItem, Select-String, Get-Content). Never grep/sed/awk/head/tail/Unix find/bash.
- Prefer Kill Chain MCP tools over shell: killchain search, symbol, callers, callees, tests_for, invariants, context_pack.
- FIRST tool call MUST be a Kill Chain MCP tool. Do not start with bash, grep, glob, or listing the whole repo.
- Do not create junk files (findings.md, output.txt, random dumps) in the repo.
- Put the user-visible answer in the assistant TEXT / final message. Do not bury the only report in hidden reasoning.
- Do not git push, merge, rebase, reset --hard, or commit.
- Do not install packages or change package.json.
- Do not modify files outside the mission allowed paths. If this pass is read-only / dry-run, do not edit production files at all.`;

export function missionHeader(spec, status) {
  return `KILL CHAIN LOCAL MISSION
id: ${spec.id}
title: ${spec.title}
level: ${spec.level} (${spec.levelInfo?.name || "?"})
dryRun: ${Boolean(status.dryRun)}
goal: ${spec.goal}

allowedPaths: ${(spec.allowedPaths || []).join(", ") || "(none — no production edits)"}
readOnlyPaths: ${(spec.readOnlyPaths || []).join(", ") || "(none extra)"}
forbiddenPaths: ${(spec.forbiddenPaths || []).join(", ") || "(defaults apply: AudioEngine/DSP/electron/deps)"}

acceptance:
${(spec.acceptance || []).map((a) => `- ${a}`).join("\n") || "- (none listed)"}

${spec.brief ? `additional brief:\n${clip(spec.brief, 6000)}` : ""}`;
}

export function investigatePrompt(spec, status) {
  return `${DISCIPLINE}

${missionHeader(spec, status)}

CURRENT PASS: INVESTIGATE (read-only). Fresh conversation. Mission memory is on disk, not in this context.

Use MCP first. Inspect current code. Map the relevant UI/state/interactions. Do not invent files.

Write a structured investigation in the visible final answer with:
1. Components / files inspected (paths that exist)
2. Current behavior (evidence)
3. One coherent workflow the mission should target
4. State stores involved
5. Risks / invariants
6. Unresolved questions
7. Do not propose production edits in this pass beyond naming candidate files.

This is not a trivial glance. Be concrete. Cite paths and symbols.`;
}

export function planPrompt(spec, status, investigation) {
  return `${DISCIPLINE}

${missionHeader(spec, status)}

CURRENT PASS: PLAN (read-only). Fresh conversation. Do not edit files.

Prior investigation (from mission disk):
${clip(investigation, 9000)}

Write PLAN.md in the visible final answer with:
- files expected to change (empty list if dry-run / read-only)
- files inspected
- current behavior
- target behavior
- phases (bounded)
- acceptance criteria mapping
- risk areas
- validation strategy
- explicit AGENTS.md invariants involved
- unresolved questions
- what you will NOT change

No production edits this pass.`;
}

export function criticPrompt(spec, status, { plan, proposal, extra }) {
  return `${DISCIPLINE}

${missionHeader(spec, status)}

CURRENT PASS: CRITIC (read-only). You are not the executor. Do not praise. Do not edit files.
Look for: unmet acceptance, unsupported claims, missing callers/files, invented paths, scope creep, unsafe architecture, invariant violations, missing validation, unrelated diff.

You MUST inspect real repository evidence via Kill Chain MCP or by reading source.

Required visible fields (exact labels):
INSPECTED: <existing paths/symbols>
RISK: <one concrete regression you checked>
EVIDENCE: <why that risk is acceptable or why the plan fails>
VERDICT: PASS
or
VERDICT: FAIL
or
VERDICT: BLOCK

Write the verdict on its own line as VERDICT: PASS (or FAIL/BLOCK) with no backticks around the word.

A PASS without INSPECTED, RISK, and EVIDENCE is invalid.
A PASS that only says the plan looks good / is comprehensive is invalid.
If a referenced src/ file does not exist and is not labeled NEW FILE, VERDICT must be FAIL.

PLAN:
${clip(plan, 9000)}

${proposal ? `PROPOSAL:\n${clip(proposal, 8000)}\n` : ""}
${extra ? `EXTRA:\n${clip(extra, 4000)}\n` : ""}`;
}

export function proposalPrompt(spec, status, { plan, critic, round }) {
  return `${DISCIPLINE}

${missionHeader(spec, status)}

CURRENT PASS: PROPOSAL-BEFORE-WRITE (round ${round}). Fresh conversation.
${status.dryRun || !spec.levelInfo?.edits ? "DRY-RUN / READ-ONLY: propose only. Do not edit production files." : "Do not edit yet. Runner will invoke a separate EDIT pass only if this proposal passes scope checks."}

PLAN:
${clip(plan, 8000)}

${critic ? `CRITIC (address substantiated findings):\n${clip(critic, 5000)}\n` : ""}

Produce a file-by-file proposal in the visible answer:
For each file:
- path
- symbol/component
- intended modification (or "inspect-only")
- why
- invariants
- expected diff class (small/medium/large, UI-only vs state vs engine)

For tiny patches also include exact BEFORE / AFTER snippets.

Pick exactly ONE concrete edit. Do not present Option A/B/C for the operator to choose. Human visual review happens after the live diff, not as a design-choice gate. Unresolved product questions fail this gate.

Mark brand-new files as **NEW FILE** on the same line as the path.
Do not invent files. If a path does not exist and is not NEW FILE, the runner will reject the proposal.
Do not change AudioEngine/DSP unless this is an authorized level-4 mission.
Windows only. MCP first.`;
}

export function editPrompt(spec, status, { proposal, plan }) {
  return `${DISCIPLINE}

${missionHeader(spec, status)}

CURRENT PASS: EDIT. Apply ONLY the approved proposal. MCP first before touching code.
This is an EXECUTION PHASE. USE the edit/write tool on authorized source files.
Do not only describe the patch. Do not create PLAN.md / findings.md.
Do not "improve" unrelated files. Do not normalize EOL. Do not add comments unless required.
Use the existing code style. Prefer the smallest correct change.
WINDOWS ENVIRONMENT. USE POWERSHELL OR MCP. Do not retry failed Unix grep/sed/awk/bash.

APPROVED PROPOSAL:
${clip(proposal, 10000)}

PLAN (context):
${clip(plan, 4000)}

WHEN COMPLETE, REPORT WHAT YOU ACTUALLY CHANGED (paths that were written).`;
}

export function emptyEditRetryPrompt(spec, status, { proposal, expectedFiles, stronger = false }) {
  const extra = stronger
    ? `
STRONGER APPLY RETRY:
Previous consecutive EDITING passes produced ZERO file delta.
A prose description of a patch is not an application.
You MUST invoke a mutation tool (edit/write/apply_patch or equivalent) against the authorized files NOW.
If a tool fails, stop repeating it; switch to OpenCode edit/write or PowerShell Set-Content on the exact path.`
    : "";
  return `${DISCIPLINE}

${missionHeader(spec, status)}

THE PROPOSAL IS ALREADY APPROVED.
THIS IS AN EXECUTION PHASE.
DO NOT EXPLAIN THE PATCH.
DO NOT CREATE PLAN FILES.
USE THE EDIT/WRITE TOOL NOW.
APPLY THE APPROVED CHANGE TO THE AUTHORIZED SOURCE FILES.
WHEN COMPLETE, REPORT WHAT YOU ACTUALLY CHANGED.

Expected files (authorized):
${(expectedFiles || []).map((p) => `- ${p}`).join("\n") || "(see proposal)"}
${extra}

APPROVED PROPOSAL:
${clip(proposal, 10000)}`;
}

export function repairDiagnosePrompt(spec, status, {
  proposalSummary,
  diagnostics,
  windows,
  delta,
  invariants,
  files,
} = {}) {
  return `${DISCIPLINE}

${missionHeader(spec, status)}

CURRENT PASS: REPAIR DIAGNOSIS. Fresh context. READ-ONLY. Do not edit files.
Do not redesign the feature. For obvious JSX/syntax errors, propose the smallest mechanical fix.

Visible answer MUST start with exactly:
HYPOTHESIS:
FAULT LOCATION:
MINIMAL REPAIR:

Then a short file-by-file BEFORE/AFTER limited to files producing diagnostics (or already-authorized paired files).

MISSION GOAL:
${clip(spec.goal, 2000)}

APPROVED PROPOSAL SUMMARY:
${clip(proposalSummary, 3500)}

CURRENT AFFECTED FILES:
${(files || []).map((p) => `- ${p}`).join("\n") || "(see diagnostics)"}

EXACT COMPILER/PARSER DIAGNOSTICS:
${clip(diagnostics, 5000)}

SOURCE WINDOWS:
${clip(windows, 8000)}

CURRENT PHASE DELTA:
${clip(delta, 2500)}

RELEVANT INVARIANTS:
${clip(invariants, 2000)}

MCP first if you need a caller. Windows only. Do not dump planning conversation.`;
}

export function applyRepairPrompt(spec, status, { diagnosis, files, diagnostics }) {
  return `${DISCIPLINE}

${missionHeader(spec, status)}

CURRENT PASS: APPLY REPAIR. EXECUTION PHASE. Fresh context.
THE DIAGNOSIS IS ALREADY WRITTEN.
DO NOT EXPLAIN THE PATCH.
DO NOT CREATE PLAN FILES.
USE THE EDIT/WRITE TOOL NOW.
Apply ONLY the minimal repair to authorized files that currently fail diagnostics.
Do not redesign the feature. Do not widen scope.
WHEN COMPLETE, REPORT WHAT YOU ACTUALLY CHANGED.

AUTHORIZED FILES:
${(files || []).map((p) => `- ${p}`).join("\n") || "(see diagnosis)"}

DIAGNOSTICS:
${clip(diagnostics, 4000)}

MINIMAL REPAIR DIAGNOSIS:
${clip(diagnosis, 6000)}`;
}

/** @deprecated prefer repairDiagnosePrompt + applyRepairPrompt */
export function repairPrompt(spec, status, { plan, proposal, validation, diff, diagnostics, windows, files, invariants } = {}) {
  return repairDiagnosePrompt(spec, status, {
    proposalSummary: proposal || plan || "",
    diagnostics: diagnostics || validation || "",
    windows: windows || "",
    delta: diff || "",
    invariants: invariants || "",
    files,
  });
}

export function finalPrompt(spec, status, { plan, proposal, critic, investigation, diff }) {
  return `${DISCIPLINE}

${missionHeader(spec, status)}

CURRENT PASS: FINAL REVIEW (read-only). Do not edit.
Inspect the real proposal, any Git diff below, and actual source. Do not praise.

Required visible fields:
INSPECTED: <paths/symbols from the real diff or proposal>
RISK: <one plausible regression you investigated>
EVIDENCE: <why that risk is acceptable, or why NOT_READY>
VERDICT: READY
or
VERDICT: NOT_READY

Write the verdict on its own line as VERDICT: READY or VERDICT: NOT_READY with no backticks around the word.

Also include: acceptance checklist, remaining uncertainties, recommended commit message (do not commit), what a human must visually verify. Automated typecheck/build is not visual proof.

Dry-run READY means the proposal is concrete, in-scope, and ready for a later live edit. NOT_READY if it still asks the user to pick among design options. Human screenshot review is after live edit, not a reason to block a concrete dry-run proposal.

INVESTIGATION:
${clip(investigation, 4000)}

PLAN:
${clip(plan, 5000)}

PROPOSAL:
${clip(proposal, 5000)}

PRIOR CRITIC:
${clip(critic, 3000)}

CURRENT DIFF:
${clip(diff, 8000)}`;
}

export function emptyTextRetryPrompt(previousNote) {
  return `${DISCIPLINE}

Your previous OpenCode pass produced no user-visible final TEXT (the report was missing or only in hidden reasoning). That is a discipline failure.

Re-emit the complete report NOW as the visible assistant message. Do not only think. Do not edit files.

Context:
${clip(previousNote, 4000)}`;
}
