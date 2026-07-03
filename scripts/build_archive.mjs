// BUILD / PREVIEW ARCHIVE — show what the proof reel will auto-select from replays.json.
//
// The selection is a deterministic READ-TIME layer (lib/signals/proof-reel.mjs): the moment
// a finished match is imported (scripts/import_archived.mjs) and pushed, /desk + /api/v1/archive
// auto-pick the model-proving cases and trim the dead/coin-flip ones. This CLI previews that
// pick so you can sanity-check "mostly winners, a disclosed few losers" before you push —
// nothing to run in production, the app computes the same reel on demand.
//
//   node scripts/build_archive.mjs           # per-match selection summary
//   node scripts/build_archive.mjs --raw     # every case, no selection (audit)
//   node scripts/build_archive.mjs --json out.json   # write the selected reel to a file
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { computeProofReel } from "../lib/signals/proof-reel.mjs";

const replays = JSON.parse(readFileSync(path.resolve(process.cwd(), "lib/replays.json"), "utf8"));
const raw = process.argv.includes("--raw");
const jsonIdx = process.argv.indexOf("--json");

const reel = computeProofReel(replays, { raw });

let totalShown = 0;
let totalWins = 0;
let totalCases = 0;
console.log(`\nPROOF REEL — ${reel.length} matches${raw ? " (RAW, unselected)" : ""}\n`);
for (const m of reel) {
  const t = m.totals;
  const byKind = {};
  for (const c of m.cases) {
    const k = `${c.kind}/${c.action}`;
    byKind[k] = byKind[k] || { n: 0, ok: 0 };
    byKind[k].n++;
    if (c.success) byKind[k].ok++;
  }
  const kinds = Object.entries(byKind)
    .map(([k, v]) => `${k} ${v.ok}/${v.n}`)
    .join("  ");
  const hr = m.hitRate == null ? "—" : `${Math.round(m.hitRate * 100)}%`;
  console.log(`  ${m.label.padEnd(24)} shown ${String(m.caseCount).padStart(3)}  held ${hr.padStart(4)}`);
  console.log(`    ${kinds}`);
  if (t) console.log(`    (from ${t.cases} cases: ${t.wins}W/${t.losses}L → discarded ${t.discarded})`);
  totalShown += m.caseCount;
  totalWins += m.cases.filter((c) => c.success).length;
  totalCases += t ? t.cases : m.caseCount;
}
console.log(
  `\n  TOTAL: showing ${totalShown} of ${totalCases} cases · ${totalShown ? Math.round((totalWins / totalShown) * 100) : 0}% held up\n`,
);

if (jsonIdx !== -1 && process.argv[jsonIdx + 1]) {
  const out = path.resolve(process.cwd(), process.argv[jsonIdx + 1]);
  writeFileSync(out, JSON.stringify(reel, null, 2));
  console.log(`  wrote reel → ${out}\n`);
}
