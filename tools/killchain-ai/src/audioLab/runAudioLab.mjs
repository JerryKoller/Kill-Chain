import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "../paths.mjs";
import { ollamaChat } from "../eval/ollama.mjs";
import { contextPack } from "../retrieve/pack.mjs";
import { writeOvernightScan } from "./scanInvariants.mjs";

const INVARIANTS = [
  { id: "rewireFront", q: "Only rewireFront() may mutate front routing gains. Implementation, callers, any other front-gain writers, tests, assertion, failure scenario, smoke/distort-hunt/leak-check coverage. No production edits." },
  { id: "claimSource", q: "Only claimSource() decides playback ownership. Implementation, known callers, gaps, assertion, failure scenario, harness. Do not edit AudioEngine." },
  { id: "missionState", q: "MISSION STATE (missionStateStore) is the sole source-change automation orchestrator. initMissionState, timers, tests, gaps. Read-only." },
  { id: "liveTaps", q: "Live tap nodes should disconnect in finally. preTap/destinationTap connect/disconnect (tractorLive, restoreAnalyze, fireStudio, bounceExport, visualizer). Gaps and assertion. No production edits." },
  { id: "timerCleanup", q: "Intervals and requestAnimationFrame must be cleaned up. Find sites, tests, gaps. Read-only." },
  { id: "storeEngineSync", q: "Store writes and matching AudioEngine calls must happen in the same synchronous action. Examples, tests, failure if async-split. Read-only." },
  { id: "reportStorageFailure", q: "Persistence failures must call reportStorageFailure. Callers that setItem without it. Do not edit production." },
  { id: "oneAudibleSource", q: "One-audible-source rule. How claimSource enforces it. Double-playback failure. Tests. Read-only." },
  { id: "oneFft", q: "One-high-rate-FFT-pipeline design. visualIntel/analyser sites, gaps. Read-only. Do not propose extra FFT pipelines." },
];

export async function runAudioLabQwen({ log = console.log } = {}) {
  const dir = join(dataDir, "overnight", "audio-lab");
  mkdirSync(dir, { recursive: true });
  const scan = writeOvernightScan();
  writeFileSync(join(dir, "scan.json"), `${JSON.stringify(scan, null, 2)}\n`);
  const results = [];
  for (const inv of INVARIANTS) {
    log(`audio lab Qwen: ${inv.id}`);
    const t0 = Date.now();
    let packMd = "";
    try {
      const pack = await contextPack(inv.q, { budget: 3500, mode: "lexical" });
      packMd = pack.markdown || "";
    } catch (e) {
      packMd = `(context pack failed: ${e instanceof Error ? e.message : e})`;
    }
    const res = await ollamaChat({
      model: "qwen3.5:9b",
      user: `READ-ONLY Kill Chain audio invariant investigation.\nCite only paths/symbols in the pack or say unknown.\nDo not invent files. Do not propose production AudioEngine/DSP edits.\n\nQUESTION:\n${inv.q}\n\nCORPUS PACK:\n${packMd}`,
      temperature: 0,
      numPredict: 900,
      timeoutMs: 180000,
    });
    writeFileSync(join(dir, `${inv.id}.md`), res.text || "", "utf8");
    results.push({
      id: inv.id,
      durationMs: Date.now() - t0,
      evalCount: res.evalCount,
      chars: (res.text || "").length,
    });
  }
  writeFileSync(join(dir, "index.json"), `${JSON.stringify({ at: new Date().toISOString(), results }, null, 2)}\n`);
  return results;
}

const isMain = process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("runAudioLab.mjs");
if (isMain) {
  runAudioLabQwen().then((r) => console.log(JSON.stringify(r, null, 2))).catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}
