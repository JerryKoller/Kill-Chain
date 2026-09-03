# Kill Chain local missions

The mission runner lets **local Qwen** (Ollama `qwen3.5:9b` via OpenCode) work through a bounded Kill Chain task with **deterministic supervision**. Cursor/Composer should build this runner, not sit in the loop for every edit.

## Quick start

```powershell
Set-Location <repo-root>
.\tools\killchain-ai\kc-ai.ps1 mission test
.\tools\killchain-ai\kc-ai.ps1 mission validate .\tools\killchain-ai\missions\pilot-fire-ux-plan.md
.\tools\killchain-ai\kc-ai.ps1 mission run .\tools\killchain-ai\missions\pilot-fire-ux-plan.md --dry-run
.\tools\killchain-ai\kc-ai.ps1 mission status
.\tools\killchain-ai\kc-ai.ps1 mission resume <id> --dry-run
.\tools\killchain-ai\kc-ai.ps1 mission report <id>
```

`--dry-run` runs preflight → investigate → plan → critic → proposal, then **stops before production edits**. Unexpected `src/` / `electron/` writes are reverted.

## Spec format

Markdown file starting with JSON frontmatter between `---` fences. See `templates/`.

Autonomy levels:

| Level | Name | Edits |
|------:|------|--------|
| 0 | read-only | no |
| 1 | single-patch | one logical patch in `allowedPaths` |
| 2 | bounded-feature | multi-file UI/feature inside `allowedPaths` |
| 3 | multi-phase | several subphases inside mission scope |
| 4 | audio-critical | not auto-enabled; needs `allowAudioEdits` + `--approve-audio-edit` |

## Durable state (gitignored)

`tools/killchain-ai/data/missions/<id>/`

- `mission.json` `status.json`
- `PLAN.md` `JOURNAL.md` `CURRENT_PHASE.md` `LAST_MODEL_OUTPUT.md`
- `INVESTIGATION.md` `PROPOSAL.md` `validation.json` `FINAL_REPORT.md`
- `sessions/*.jsonl` OpenCode transcripts
- `checkpoints/` snapshot copies (no production commits)

## Corpus refresh

- `if-stale` (default): rebuild at mission start when `manifest.gitCommit` ≠ HEAD or corpus missing.
- `start`: always rebuild at start.
- `after-checkpoint`: also rebuild after a checkpoint (for edit missions whose symbols moved).
- `never`: do not rebuild.

Do not rebuild after every tiny edit. A start-of-mission rebuild should not dominate a 1–4 hour mission.

## Context

Each OpenCode invocation is a **fresh** session. Mission files are memory. The 64K window is not the mission log.

## Safety

The runner, not Qwen, enforces: worktree/branch, dirty app tree, allowed paths, proposal-before-write, validation, retries, budgets, Windows command flags, junk-file quarantine. It never `git reset --hard`, never pushes, never auto-commits.
