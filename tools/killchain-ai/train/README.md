# Training sidecar (not executed in Phase 1)

Do **not** install Unsloth, PyTorch, or BitsAndBytes yet.

Planned later (WSL2 Ubuntu, RTX 5080 16GB):

1. Consume `../data/sft/train.jsonl` (protocol traces, not code completion).
2. QLoRA on Qwen 3.5 9B (4-bit; bf16 LoRA does not fit 16GB).
3. CPU-merge adapter → GGUF → `ollama create killchain-qwen`.
4. Compare with `node ../src/cli.mjs eval --mode rag --model qwen3.5:9b` vs `--mode ft-rag --model killchain-qwen`.

Holdout eval cases already live in `src/eval/cases.mjs` so fine-tuning can be measured against RAG-only.
