/**
 * Static status card for ROBO PUPPY.
 *
 * Tooling-only. Written to data/overnight/puppy/ (gitignored) and opened in a
 * browser. There is no server, no build step and no framework — it is one
 * self-contained HTML file so it cannot rot or become a frontend project.
 *
 * The avatar is referenced from tools/killchain-ai/assets/robo-puppy.jpg.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { dataDir, repoRoot } from "../paths.mjs";
import { puppyStatus } from "./status.mjs";

export const AVATAR_REL = "tools/killchain-ai/assets/robo-puppy.jpg";

function esc(s) {
  return String(s === null || s === undefined ? "—" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const STATE_COLOR = {
  IDLE: "#5b6b6b",
  INVESTIGATING: "#35d6a4",
  PLANNING: "#35d6a4",
  EDITING: "#4ff0b0",
  VALIDATING: "#d8c65a",
  REPAIRING: "#e0913c",
  CRITIQUING: "#d8c65a",
  CHECKPOINTING: "#35d6a4",
  BLOCKED: "#e05c5c",
  COMPLETE: "#4ff0b0",
  WAITING_FOR_TEACHER: "#7ba7e0",
};

export function renderHtml(s, { avatarDataUri = null, avatarHref = null } = {}) {
  const color = STATE_COLOR[s.state] || "#35d6a4";
  const img = avatarDataUri || avatarHref || "";
  const rows = s.fields.map((f) => `
      <div class="row">
        <span class="k">${esc(f.label)}</span>
        <span class="v"${f.value === null ? ' class="v unknown"' : ""}>${esc(f.value)}</span>
        <span class="src" title="${esc(f.from)}">${f.real ? "real" : "derived"}</span>
      </div>`).join("");

  const flags = [];
  if (s.counters?.emptyEdits) flags.push(`${s.counters.emptyEdits} empty edit(s)`);
  if (s.counters?.syntaxFailures) flags.push(`${s.counters.syntaxFailures} syntax failure(s)`);
  if (s.counters?.unixViolations) flags.push(`${s.counters.unixViolations} unix violation(s)`);
  if (s.counters?.repairRetries) flags.push(`${s.counters.repairRetries} repair retry(ies)`);

  return `<!doctype html>
<meta charset="utf-8">
<title>${esc(s.agent)} — ${esc(s.title)}</title>
<style>
  :root { --ink:#04100e; --panel:#081916; --line:#123; --text:#cfe9e2; --dim:#6f8b84; --accent:${color}; }
  * { box-sizing:border-box; }
  body { margin:0; background:radial-gradient(circle at 50% 20%, #08201c 0%, var(--ink) 70%);
         color:var(--text); font:14px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
         min-height:100vh; display:flex; align-items:center; justify-content:center; padding:32px; }
  .card { width:min(760px,100%); background:var(--panel); border:1px solid #14322c; border-radius:14px;
          box-shadow:0 0 0 1px #0a1f1b, 0 24px 60px rgba(0,0,0,.55); overflow:hidden; }
  header { display:flex; gap:20px; padding:22px 24px; align-items:center; border-bottom:1px solid #0f2a25; }
  .avatar { width:104px; height:104px; border-radius:12px; flex:0 0 auto; object-fit:cover;
            border:1px solid #17423a; background:#03100d; }
  .who h1 { margin:0; font-size:20px; letter-spacing:.18em; color:#eafff8; }
  .who p  { margin:3px 0 0; color:var(--dim); font-size:12px; letter-spacing:.08em; }
  .badge { margin-left:auto; align-self:flex-start; padding:5px 11px; border-radius:999px;
           border:1px solid var(--accent); color:var(--accent); font-size:11px; letter-spacing:.14em; }
  .grid { padding:14px 24px 6px; }
  .row { display:grid; grid-template-columns:130px 1fr 54px; gap:12px; padding:7px 0;
         border-bottom:1px dashed #0e2621; align-items:baseline; }
  .k { color:var(--dim); font-size:11px; letter-spacing:.12em; }
  .v { color:#eafff8; word-break:break-word; }
  .v.unknown { color:#44605a; }
  .src { color:#33534d; font-size:10px; text-align:right; letter-spacing:.08em; cursor:help; }
  .flags { margin:10px 24px 0; padding:9px 12px; border-radius:8px; background:#1a0f0c;
           border:1px solid #40201a; color:#e0913c; font-size:12px; }
  footer { padding:14px 24px 20px; color:var(--dim); font-size:12px; display:flex; gap:10px; align-items:center; }
  .mood { color:var(--accent); }
  .stamp { margin-left:auto; color:#2d4a45; font-size:10px; }
</style>
<div class="card">
  <header>
    ${img ? `<img class="avatar" src="${img}" alt="Robo Puppy">` : `<div class="avatar"></div>`}
    <div class="who">
      <h1>${esc(s.agent)}</h1>
      <p>${esc(s.title)}</p>
      <p>model · ${esc(s.fields.find((f) => f.label === "MODEL")?.value || "ollama/qwen3.5:9b")}</p>
    </div>
    <span class="badge">${esc(s.state)}</span>
  </header>
  <div class="grid">${rows}
  </div>
  ${flags.length ? `<div class="flags">flags · ${esc(flags.join(" · "))}</div>` : ""}
  ${s.blockedReason ? `<div class="flags">reason · ${esc(s.blockedReason)}</div>` : ""}
  <footer>
    <span class="mood">${esc(s.mood)}</span>
    <span class="stamp">${esc(s.missionId || "no mission")} · ${esc(s.updatedAt || "")}</span>
  </footer>
</div>
`;
}

/** Write the card. Inlines the avatar so the file can be moved or emailed. */
export function writeCard({ missionId = null, inlineAvatar = true, outDir = null } = {}) {
  const s = puppyStatus({ missionId });
  const dir = outDir || join(dataDir, "overnight", "puppy");
  mkdirSync(dir, { recursive: true });

  const avatarAbs = join(repoRoot, AVATAR_REL);
  let avatarDataUri = null;
  let avatarHref = null;
  if (existsSync(avatarAbs)) {
    if (inlineAvatar) {
      avatarDataUri = `data:image/jpeg;base64,${readFileSync(avatarAbs).toString("base64")}`;
    } else {
      avatarHref = relative(dir, avatarAbs).split(/[\\/]/).join("/");
    }
  }

  const html = renderHtml(s, { avatarDataUri, avatarHref });
  const out = join(dir, "robo-puppy.html");
  writeFileSync(out, html, "utf8");
  writeFileSync(join(dir, "status.json"), JSON.stringify(s, null, 2), "utf8");
  return { out, status: s, avatarFound: existsSync(avatarAbs) };
}
