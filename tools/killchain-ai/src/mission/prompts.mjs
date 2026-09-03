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

Mark brand-new files as **NEW FILE** on the same line as the path.
Do not invent files. If a path does not exist and is not NEW FILE, the runner will reject the proposal.
Do not change AudioEngine/DSP unless this is an authorized level-4 mission.
Windows only. MCP first.`;
}

export function editPrompt(spec, status, { proposal, plan }) {
  return `${DISCIPLINE}

${missionHeader(spec, status)}

CURRENT PASS: EDIT. Apply ONLY the approved proposal. MCP first before touching code.
Do not "improve" unrelated files. Do not normalize EOL. Do not add comments unless required.
Use the existing code style. Prefer the smallest correct change.

APPROVED PROPOSAL:
${clip(proposal, 10000)}

PLAN (context):
${clip(plan, 4000)}

After edits, summarize what changed in the visible final answer.`;
}

export function repairPrompt(spec, status, { plan, proposal, validation, diff }) {
  return `${DISCIPLINE}

${missionHeader(spec, status)}

CURRENT PASS: REPAIR DIAGNOSIS. Read-only this invocation. Do not edit yet.
Next runner step will require a repair proposal, then a separate edit.

PLAN:
${clip(plan, 5000)}

CURRENT PROPOSAL:
${clip(proposal, 4000)}

DIFF SUMMARY:
${clip(diff, 5000)}

VALIDATION FAILURE:
${clip(validation, 6000)}

Visible answer must include:
1. HYPOTHESIS
2. EVIDENCE (path/symbol)
3. REPAIR PROPOSAL (file-by-file BEFORE/AFTER if small)
4. What you will not change
MCP first. Windows only.`;
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

Also include: acceptance checklist, remaining uncertainties, recommended commit message (do not commit), what a human must visually verify. Automated typecheck/build is not visual proof.

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
