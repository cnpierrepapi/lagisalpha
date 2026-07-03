// HARVEST ARCHIVES — the automatic "ended match → signals" pipeline.
//
// The EC2 worker's archiver already auto-persists every FINISHED live match to the public
// `desk-archives` Storage bucket and indexes it in the `desk_archived` table. This script
// closes the loop hands-free: discover finished matches, download the new blobs, and fold
// them into lib/replays.json (via import_archived). Once replays.json is pushed, /desk and
// /proof AUTO-SELECT the calls that played out at read time (proof-reel.selectBelievable) —
// so "generate the signals + pick the ones that played out" needs no extra step.
//
//   node scripts/harvest_archives.mjs              discover finished matches, fetch NEW ones, import
//   node scripts/harvest_archives.mjs --fid 18176123   fetch one match by id (public bucket, no key)
//   node scripts/harvest_archives.mjs --all        re-fetch even matches already bundled
//   node scripts/harvest_archives.mjs --limit 20   how many recent finished matches to consider
//   node scripts/harvest_archives.mjs --push       git add+commit+push replays.json when it changes
//
// Discovery needs Supabase creds (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY —
// the anon key is public-safe). Blob download does NOT (the bucket is public). With no creds
// and no --fid, the script just imports whatever is already in captures_live/.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";

// tolerate a local .env.local for creds without adding a dotenv dep
function loadEnvLocal() {
  const p = path.resolve(process.cwd(), ".env.local");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.trim());
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
loadEnvLocal();

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f, d) => {
  const i = args.indexOf(f);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};

const SUPA_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "https://mohbmvajroqizlfaarjk.supabase.co").replace(/\/$/, "");
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "";
const BUCKET = "desk-archives";
const SRC_DIR = path.resolve(process.cwd(), "captures_live");
const REPLAYS = path.resolve(process.cwd(), "lib/replays.json");

const publicBlobUrl = (fidOrPath) =>
  /\//.test(String(fidOrPath))
    ? `${SUPA_URL}/storage/v1/object/public/${BUCKET}/${fidOrPath}`
    : `${SUPA_URL}/storage/v1/object/public/${BUCKET}/live/${fidOrPath}.json`;

function existingFids() {
  try {
    return new Set(JSON.parse(readFileSync(REPLAYS, "utf8")).map((m) => String(m.fid)));
  } catch {
    return new Set();
  }
}

// discover finished matches from desk_archived (needs anon key)
async function discover(limit) {
  if (!ANON) {
    console.log("• no Supabase anon key (NEXT_PUBLIC_SUPABASE_ANON_KEY) — skipping discovery.");
    console.log("  Set it in .env.local (it's public-safe, same key the browser uses), or pass --fid <id>.");
    return [];
  }
  const url = `${SUPA_URL}/rest/v1/desk_archived?select=fixture_id,p1,p2,storage_path,finished_at&order=finished_at.desc&limit=${limit}`;
  const r = await fetch(url, { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` } });
  if (!r.ok) {
    console.log(`• desk_archived query failed: HTTP ${r.status}`);
    return [];
  }
  const rows = await r.json();
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    fid: String(row.fixture_id),
    label: `${row.p1} v ${row.p2}`,
    storagePath: row.storage_path || `live/${row.fixture_id}.json`,
  }));
}

async function fetchBlob(fid, storagePath) {
  const url = publicBlobUrl(storagePath || fid);
  const r = await fetch(url);
  if (!r.ok) {
    console.log(`  ✗ ${fid}: blob HTTP ${r.status}`);
    return false;
  }
  const buf = Buffer.from(await r.arrayBuffer());
  mkdirSync(SRC_DIR, { recursive: true });
  writeFileSync(path.join(SRC_DIR, `${fid}.json`), buf);
  console.log(`  ✓ ${fid}: ${(buf.length / 1e6).toFixed(1)}MB → captures_live/${fid}.json`);
  return true;
}

async function main() {
  const limit = Number(val("--limit", "50"));
  const bundled = existingFids();

  // 1) decide which fixtures to fetch
  let targets = [];
  const fid = val("--fid", null);
  if (fid) {
    targets = [{ fid: String(fid), label: `fixture ${fid}`, storagePath: null }];
  } else {
    const found = await discover(limit);
    console.log(`• discovered ${found.length} finished match(es) in desk_archived.`);
    targets = has("--all") ? found : found.filter((m) => !bundled.has(m.fid));
    console.log(`• ${targets.length} to fetch${has("--all") ? " (--all)" : ` (new — ${found.length - targets.length} already bundled)`}.`);
  }

  // 2) download blobs
  let fetched = 0;
  for (const t of targets) {
    if (await fetchBlob(t.fid, t.storagePath)) fetched++;
  }
  if (!fetched && !existsSync(SRC_DIR)) {
    console.log("nothing to import.");
    return;
  }

  // 3) fold into replays.json (reuses the tested downsample/merge importer)
  console.log("\n— importing —");
  execSync("node scripts/import_archived.mjs", { stdio: "inherit" });

  // 4) did replays.json gain a match?
  const after = existingFids();
  const added = [...after].filter((f) => !bundled.has(f));
  console.log(`\n${added.length ? `＋ added ${added.length} match(es): ${added.join(", ")}` : "no new matches added (already bundled / not viable)."}`);
  console.log("  /desk + /proof auto-select the played-out calls at read time — just deploy the new replays.json.");

  // 5) optional push
  if (has("--push") && added.length) {
    try {
      execSync(`git add lib/replays.json && git commit -q -m "harvest: add ${added.join(", ")} to replay set" && git push origin master`, { stdio: "inherit" });
      console.log("pushed.");
    } catch (e) {
      console.log(`push skipped: ${e.message}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
