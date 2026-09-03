import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { evalDir, sftDir } from "../paths.mjs";
import { gitCapture } from "../git.mjs";
import { seedRecords } from "./seeds.mjs";
import { validateRecords } from "./validate.mjs";

export function generateSft({ log = console.log } = {}) {
  const git = gitCapture();
  const records = seedRecords().map((r) => ({
    ...r,
    gitCommit: git.commit,
    generatedAt: new Date().toISOString(),
  }));

  mkdirSync(sftDir, { recursive: true });
  mkdirSync(evalDir, { recursive: true });

  const report = validateRecords(records);
  const valid = records.filter((r, i) => report.results[i].ok);
  const invalid = report.results.filter((r) => !r.ok);

  const train = valid.filter((r) => r.split !== "holdout");
  const holdout = valid.filter((r) => r.split === "holdout");

  writeFileSync(
    join(sftDir, "killchain-sft.jsonl"),
    valid.map((r) => JSON.stringify(r)).join("\n") + "\n",
    "utf8",
  );
  writeFileSync(
    join(sftDir, "train.jsonl"),
    train.map((r) => JSON.stringify(r)).join("\n") + "\n",
    "utf8",
  );
  writeFileSync(
    join(sftDir, "holdout.jsonl"),
    holdout.map((r) => JSON.stringify(r)).join("\n") + "\n",
    "utf8",
  );
  writeFileSync(
    join(evalDir, "sft-holdout.jsonl"),
    holdout.map((r) => JSON.stringify(r)).join("\n") + "\n",
    "utf8",
  );
  writeFileSync(
    join(sftDir, "validation-report.json"),
    JSON.stringify(report, null, 2),
    "utf8",
  );

  log(`SFT records: ${records.length} generated, ${valid.length} valid, ${invalid.length} rejected`);
  log(`train=${train.length} holdout=${holdout.length} git=${git.commit}`);
  if (invalid.length) {
    for (const f of invalid) log(`  FAIL ${f.id}: ${f.errors.join("; ")}`);
  }
  return { git, report, train, holdout, valid };
}
