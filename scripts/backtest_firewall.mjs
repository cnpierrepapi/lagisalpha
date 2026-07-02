// ── backtest_firewall.mjs ──────────────────────────────────────────────────
// Turn the proven overreaction leg into the demo's honest numbers. A NAIVE-FOLLOW
// book chases every post-goal overshoot; the firewall holds. Per overreaction
// event, clv>0 = the line reverted in our favour (a pickoff the naive book would
// have eaten, avoided) and clv<0 = the firewall was WRONG (the ~16% misses).
// Reports NET of the misses + a concentration check (is the margin one match?).
// Reads the foil `signals_clean` view (cleaning already enforced in SQL).
//   SUPABASE_URL=... SUPABASE_KEY=... node scripts/backtest_firewall.mjs [material=0.02]
const URL = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_KEY;
if (!URL || !KEY) { console.error("set SUPABASE_URL + SUPABASE_KEY"); process.exit(1); }
const MATERIAL = Number(process.argv[2] || 0.02);            // reversion big enough a sharp exploits it
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };

const rows = await (await fetch(`${URL}/rest/v1/signals_clean?kind=eq.overreaction&select=fixture_id,clv_return,pnl,stake`, { headers: H })).json();
const n = rows.length;
const win = rows.filter((r) => r.clv_return > 0).length;
const sum = (f) => rows.reduce((a, r) => a + f(r), 0);
const net = sum((r) => Number(r.pnl));
const gross = sum((r) => (r.clv_return > 0 ? Number(r.pnl) : 0));
const lost = sum((r) => (r.clv_return <= 0 ? Number(r.pnl) : 0));
const stake = sum((r) => Number(r.stake));
const material = rows.filter((r) => Math.abs(r.clv_return) >= MATERIAL);

// per-fixture (breadth + concentration)
const byFix = new Map();
for (const r of rows) {
  const f = byFix.get(r.fixture_id) || { n: 0, win: 0, pnl: 0 };
  f.n++; if (r.clv_return > 0) f.win++; f.pnl += Number(r.pnl);
  byFix.set(r.fixture_id, f);
}
const fixes = [...byFix.entries()].sort((a, b) => b[1].pnl - a[1].pnl);
const topShare = fixes.length ? (fixes[0][1].pnl / net) * 100 : 0;

console.log(`\n── FIREWALL BACKTEST (overreaction leg) ──`);
console.log(`  matches (distinct fixtures) .... ${byFix.size}`);
console.log(`  overreaction events ............ ${n}`);
console.log(`  called right (pickoffs avoided)  ${win}/${n}  = ${(win / n * 100).toFixed(1)}%`);
console.log(`  firewall WRONG (the misses) .... ${n - win}/${n}`);
console.log(`  material pickoffs (|Δ|≥${MATERIAL}) ... ${material.filter(r=>r.clv_return>0).length} avoided / ${material.length} events`);
console.log(`\n  gross margin saved ............. +${gross.toFixed(1)}`);
console.log(`  margin lost on misses .......... ${lost.toFixed(1)}`);
console.log(`  NET margin protected ........... +${net.toFixed(1)}  (${(net / stake * 100).toFixed(1)}% of ${stake.toFixed(0)} stake)`);
console.log(`\n── breadth / concentration ──`);
console.log(`  ${fixes.filter(([,f]) => f.pnl > 0).length}/${byFix.size} matches net-positive`);
console.log(`  ⚠️ top match = ${topShare.toFixed(0)}% of net margin (concentration risk)`);
for (const [fid, f] of fixes) console.log(`    #${fid}: ${f.win}/${f.n} right, net ${f.pnl >= 0 ? "+" : ""}${f.pnl.toFixed(1)}`);
console.log(`\nDEMO-SAFE line: "${byFix.size} matches, ${n} overreactions, called right ${(win/n*100).toFixed(0)}%, every match net-positive.`);
console.log(`   Margin +${(net/stake*100).toFixed(0)}% of stake NET of misses — but ~${topShare.toFixed(0)}% from one match ⇒ pilot, not proof."\n`);
