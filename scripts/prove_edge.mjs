// ── prove_edge.mjs ─────────────────────────────────────────────────────────
// CLEAN the logged signals, then settle the edge question on what's left.
// Raw desk_trades over-states the evidence three ways, so we strip them first:
//   1. multi-agent double-counting — the SAME market move is logged once per
//      agent (identical CLV, different stake), so rows aren't independent.
//      Collapse to one row per unique move (match+market+line+kind+CLV).
//   2. off-scope markets — TxLINE's demargined feed is AH-goals + OU-goals only;
//      1X2 / anything else is dropped (not settleable/verifiable in our scope).
//   3. pre-fix phantom-goal era — keep ts ≥ the goal-detection fix (Jun 30
//      16:36 UTC); overreaction fired on fake goals before that.
//   4. keep only steam / overreaction (quote = the market-making leg we dropped).
// Writes the clean set to data/signals_clean.json and prints the real N,
// robust (heavy-tail-safe) significance, per-match breadth, and how many MORE
// unique moves / matches we'd need to prove each edge.
//
//   SUPABASE_URL=... SUPABASE_KEY=... node scripts/prove_edge.mjs
import { writeFileSync, mkdirSync } from "node:fs";

const URL = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_KEY;
if (!URL || !KEY) { console.error("set SUPABASE_URL + SUPABASE_KEY"); process.exit(1); }
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };

const FIX_CUTOFF = Date.parse("2026-06-30T16:36:00Z");   // goal-detection fix deploy
const KEEP_KINDS = new Set(["steam", "overreaction"]);
const KEEP_MARKETS = new Set(["OU", "AH"]);              // demargined feed scope (goals)

function phi(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp(-z * z / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}
const twoSidedP = (z) => 2 * (1 - phi(Math.abs(z)));
function neededN(p) {
  if (Math.abs(p - 0.5) < 1e-6) return Infinity;
  const za = 1.959964, zb = 0.841621;
  return Math.ceil(((za * 0.5 + zb * Math.sqrt(p * (1 - p))) ** 2) / ((p - 0.5) ** 2));
}
// parse "#fid · OVERUNDER_PARTICIPANT_GOALS line=3.5" → {market, line}
function parseMarket(match) {
  const s = String(match || "");
  const market = /OVERUNDER/.test(s) ? "OU" : /ASIANHANDICAP/.test(s) ? "AH" : /1X2/.test(s) ? "1X2" : "?";
  const m = /line=(-?\d+(?:\.\d+)?)/.exec(s);
  return { market, line: m ? Number(m[1]) : null };
}

async function fetchAll() {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const r = await fetch(`${URL}/rest/v1/desk_trades?select=kind,match,agent_id,ts,clv_return,pnl&clv_return=not.is.null`, {
      headers: { ...H, Range: `${from}-${from + 999}` },
    });
    const chunk = await r.json();
    rows.push(...chunk);
    if (chunk.length < 1000) break;
  }
  return rows;
}

const raw = await fetchAll();
const funnel = { raw: raw.length };

// 1. kind, 2. market scope, 3. post-fix
let step = raw.filter((r) => KEEP_KINDS.has(r.kind));
funnel.after_kind = step.length;
step = step.map((r) => ({ ...r, ...parseMarket(r.match) })).filter((r) => KEEP_MARKETS.has(r.market));
funnel.after_market_scope = step.length;
step = step.filter((r) => Number(r.ts) >= FIX_CUTOFF);
funnel.after_postfix = step.length;

// 4. collapse multi-agent duplicates → unique moves (same match+kind+CLV = same move)
const seen = new Map();
for (const r of step) {
  const key = `${r.match}|${r.kind}|${Number(r.clv_return).toFixed(4)}`;
  if (!seen.has(key)) seen.set(key, { kind: r.kind, match: r.match, market: r.market, line: r.line, ts: Number(r.ts), clv: Number(r.clv_return), pnl: Number(r.pnl) });
}
const clean = [...seen.values()];
funnel.unique_moves = clean.length;

// export the usable clean dataset
mkdirSync("data", { recursive: true });
writeFileSync("data/signals_clean.json", JSON.stringify(clean, null, 2));

// ── analysis on the CLEAN set ──
function analyse(kind) {
  const rows = clean.filter((r) => r.kind === kind);
  const n = rows.length;
  if (!n) return null;
  const clv = rows.map((r) => r.clv);
  const mean = clv.reduce((a, b) => a + b, 0) / n;
  const sd = n > 1 ? Math.sqrt(clv.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : 0;
  const pos = clv.filter((x) => x > 0).length;
  const hit = pos / n;
  const zSign = (hit - 0.5) / Math.sqrt(0.25 / n);
  const byMatch = new Map();
  for (const r of rows) { const a = byMatch.get(r.match) || []; a.push(r.clv); byMatch.set(r.match, a); }
  let netPos = 0; for (const a of byMatch.values()) if (a.reduce((x, y) => x + y, 0) / a.length > 0) netPos++;
  return { kind, n, matches: byMatch.size, perMatch: n / byMatch.size, hit, mean, sd, pos,
           zSign, pSign: twoSidedP(zSign), matchesNetPos: netPos, need: neededN(hit) };
}

console.log("\n── CLEANING FUNNEL ──");
console.log(`  raw settled signals ........ ${funnel.raw}`);
console.log(`  keep steam/overreaction .... ${funnel.after_kind}`);
console.log(`  keep AH/OU goals scope ..... ${funnel.after_market_scope}   (dropped 1X2/off-scope)`);
console.log(`  post-fix (≥Jun30 16:36Z) ... ${funnel.after_postfix}`);
console.log(`  UNIQUE MOVES (dedup agents)  ${funnel.unique_moves}   ← the real, independent N`);

console.log("\n── EDGE TEST on the clean set (robust sign test) ──");
for (const kind of ["overreaction", "steam"]) {
  const a = analyse(kind);
  if (!a) { console.log(`\n■ ${kind}: none after cleaning`); continue; }
  const sig = a.pSign < 0.01 ? "✅ EDGE (robust)" : a.pSign < 0.05 ? "🟡 marginal" : "⚠️ not significant";
  console.log(`\n■ ${kind.toUpperCase()}  ${sig}`);
  console.log(`   unique N = ${a.n} over ${a.matches} matches (${a.perMatch.toFixed(1)}/match)`);
  console.log(`   hit-rate CLV>0 = ${(a.hit * 100).toFixed(1)}%  (${a.pos}/${a.n})  → z=${a.zSign.toFixed(2)}, p=${a.pSign.toExponential(2)}`);
  console.log(`   mean CLV = ${a.mean.toFixed(4)} (sd ${a.sd.toFixed(3)})`);
  console.log(`   breadth  = ${a.matchesNetPos}/${a.matches} matches net-positive`);
  if (a.hit > 0.5 && a.pSign >= 0.05) {
    const more = Math.max(0, a.need - a.n);
    console.log(`   → need ~${a.need} unique moves to prove at this rate = ~${more} more (~${Math.ceil(more / a.perMatch)} more matches)`);
  } else if (a.hit > 0.5) {
    const target = Math.max(a.need * 3, 150);
    console.log(`   → already significant; for a segmented/out-of-sample track record aim ~${target} moves (~${Math.ceil(target / a.perMatch)} matches)`);
  }
}
console.log(`\nClean dataset written → data/signals_clean.json (${clean.length} unique moves)\n`);
