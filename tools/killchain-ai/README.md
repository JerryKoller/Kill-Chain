# Kill Chain AI tooling (Phase 1)

Isolated under `tools/killchain-ai/`. **Does not import or modify the Kill Chain application.** Does not train a model.

Canonical constitution: `C:\Users\Zero\Desktop\Sony_Project\Kill-Chain-AI\AGENTS.md`
Snapshot copy: `constitution/AGENTS.md`

Requires the repo-root `npm install` (TypeScript compiler API). No extra packages are added to the application `package.json`.

## Windows (PowerShell)

```powershell
Set-Location <repo-root>
node tools/killchain-ai/src/cli.mjs status
node tools/killchain-ai/src/cli.mjs corpus
node tools/killchain-ai/src/cli.mjs search "claimSource"
node tools/killchain-ai/src/cli.mjs symbol rewireFront
node tools/killchain-ai/src/cli.mjs callers claimSource
node tools/killchain-ai/src/cli.mjs callees claimSource
node tools/killchain-ai/src/cli.mjs tests-for missionStateStore
node tools/killchain-ai/src/cli.mjs invariants "Mission State"
node tools/killchain-ai/src/cli.mjs context-pack "stale bypass toast"
node tools/killchain-ai/src/cli.mjs sft generate
node tools/killchain-ai/src/cli.mjs sft validate --self-test
node tools/killchain-ai/src/cli.mjs eval --mode retrieval
```

Or: `.\tools\killchain-ai\kc-ai.cmd corpus`

## OpenCode MCP

See `student/opencode.json.example`. Stdio server:

```powershell
node tools/killchain-ai/src/cli.mjs mcp
```

Optional embeddings (corpus still works without them):

```powershell
node tools/killchain-ai/src/cli.mjs corpus --embed
```

Uses local Ollama `nomic-embed-text` if present.

## Mission runner (local Qwen)

Long-horizon **mission runner** around Ollama + OpenCode + Kill Chain MCP. Fresh bounded OpenCode sessions; durable state on disk.

```powershell
.\tools\killchain-ai\kc-ai.ps1 mission test
.\tools\killchain-ai\kc-ai.ps1 mission run .\tools\killchain-ai\missions\pilot-fire-ux-plan.md --dry-run
.\tools\killchain-ai\kc-ai.ps1 mission status
```

See `missions/README.md`. Does not modify the application unless a mission (not dry-run) explicitly allows paths.

## Outputs (gitignored)

- `data/corpus/chunks.jsonl` — structured chunks with provenance + git commit
- `data/sft/*.jsonl` — protocol SFT records
- `data/eval/latest.json` — Phase 1 retrieval-only metrics
- `data/eval/phase2/` — Phase 2 A/B JSON + REPORT.md (gitignored)

## Phase 2 A/B (no training)

```powershell
node tools/killchain-ai/src/cli.mjs eval --ab --model qwen3.5:9b
```

## Training (not in this phase)

`train/README.md` is a stub. Do not install Unsloth or run fine-tuning yet.
