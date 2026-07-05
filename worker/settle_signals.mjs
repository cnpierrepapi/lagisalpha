// SETTLE SIGNALS — the live on-chain grading leg (Lagisalpha C). Runs on the EC2 worker
// AFTER a fixture finalises. NOT yet wired into desk_worker's loop / not yet run against
// foil (the box is mid-capture; the devnet faucet is dead so the sim payer is unfunded —
// the outcome leg will report `pending`, never a false "wrong", per the reference).
//
//   node worker/settle_signals.mjs <fixtureId>       (SUPABASE_* + TXLINE_* env set)
//
// For each pending signal on the fixture:
//   1. CLV leg  — settle against the market's closing fair line (from the archived odds
//      blob the archiver wrote to the `desk-archives` bucket) via lib/signals/settle.
//   2. outcome leg — validateGoals(fixtureId): final goals from TxLINE's scores snapshot,
//      then the validateStat Merkle proof vs the on-chain daily-scores root. A sim/RPC
//      failure (e.g. unfunded payer) is caught → status `pending`, not `wrong`.
//   3. upsert the settled row back to `signals` (public /proof reads it).
//
// Ground truth: reference_validate_stat_settlement (the funded SOLANA_SIM_PAYER gotcha,
// PDA ["daily_scores_roots", u16LE(epochDay)], stat keys 1/2 = P1/P2 goals).
import { select, upsert } from "./supabase.mjs";
import { settleSignal } from "../lib/signals/settle.mjs";
import { sideProbFromFrame, marketMatches } from "../lib/signals/frames.mjs";

const BASE = process.env.TXLINE_API_BASE || "https://txline.txodds.com";
const AUTH = {
  Authorization: `Bearer ${process.env.TXLINE_JWT || ""}`,
  "X-Api-Token": process.env.TXLINE_API_TOKEN || "",
};

// Final goal counts for a fixture from the scores snapshot (latest per action type;
// the newest record bearing Score.Total self-corrects VAR overturns — see the ref).
async function finalGoals(fixtureId) {
  const res = await fetch(`${BASE}/api/scores/snapshot/${fixtureId}`, { headers: AUTH });
  if (!res.ok) throw new Error(`scores snapshot ${res.status}`);
  const recs = await res.json();
  let best = null;
  for (const r of Array.isArray(recs) ? recs : [recs]) {
    const t = r?.Score?.Total;
    if (t && (best == null || r.Ts >= best.ts)) best = { ts: r.Ts, p1: t.Participant1?.Goals ?? t.Goals ?? null, p2: t.Participant2?.Goals ?? null };
  }
  return best;
}

// validateGoals: outcome + on-chain proof. The proof/.view() is delegated to the shared
// validate_stat helper (same one Bootroom/Spikelines use). Absent that (or an unfunded
// sim payer), we return verified:false → the outcome leg stays `pending`.
async function validateGoals(fixtureId) {
  const g = await finalGoals(fixtureId);
  if (!g || g.p1 == null || g.p2 == null) return null;
  let proof = null;
  let verified = false;
  try {
    // Optional: attach the Merkle proof. Fill from reference_validate_stat_settlement.
    const mod = await import("./validate_stat.mjs").catch(() => null);
    if (mod?.verifyGoals) {
      const v = await mod.verifyGoals(fixtureId, g.p1, g.p2); // { ok, proof }
      verified = !!v?.ok;
      proof = v?.proof ?? null;
    }
  } catch {
    verified = false; // sim payer unfunded / RPC down → pending, never a false verdict
  }
  return { p1: g.p1, p2: g.p2, proof, verified };
}

// Closing fair prob for a signal's market from the archived odds frames.
function closingProbFor(sig, oddsFrames) {
  const meta = { superOddsType: sig.super_odds_type, marketParameters: `line=${sig.line}`, marketPeriod: "null", side: sig.side };
  let best = null;
  for (const rec of oddsFrames) {
    if (!marketMatches(rec, meta)) continue;
    const p = sideProbFromFrame(rec, meta.side);
    if (p != null) best = p; // last quote = the close
  }
  return best;
}

async function loadArchivedOdds(fixtureId) {
  const idx = await select("desk_archived", `fixture_id=eq.${fixtureId}&select=session,fixture_id&limit=1`);
  if (!idx?.length) return [];
  const blobUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/desk-archives/${idx[0].session}/${fixtureId}.json`;
  const res = await fetch(blobUrl);
  if (!res.ok) return [];
  const blob = await res.json();
  return blob.odds || [];
}

export async function settleFixture(fixtureId) {
  const pending = await select("signals", `fixture_id=eq.${fixtureId}&or=(clv_status.eq.pending,outcome_status.eq.pending)&select=*`);
  if (!pending.length) return { fixtureId, settled: 0 };
  const oddsFrames = await loadArchivedOdds(fixtureId);

  const rows = [];
  for (const s of pending) {
    const sig = { fixtureId: s.fixture_id, superOddsType: s.super_odds_type, side: s.side, line: s.line, pRef: s.p_ref, direction: s.direction, kind: s.kind };
    const closing = closingProbFor(sig, oddsFrames);
    const r = await settleSignal(sig, closing, validateGoals);
    rows.push({
      id: s.id,
      clv_status: r.status,
      closing_prob: r.closingProb,
      clv_return: r.clvReturn,
      clv_right: r.clvRight,
      outcome_status: r.outcome.status,
      outcome_p1: r.outcome.p1 ?? null,
      outcome_p2: r.outcome.p2 ?? null,
      outcome_right: r.outcome.outcomeRight ?? null,
      stat_proof: r.outcome.proof ?? null,
      settled_at: new Date().toISOString(),
    });
  }
  await upsert("signals", rows);
  return { fixtureId, settled: rows.length };
}

// CLI entry
if (import.meta.url === `file://${process.argv[1]}`) {
  const fid = process.argv[2];
  if (!fid) { console.error("usage: node worker/settle_signals.mjs <fixtureId>"); process.exit(1); }
  settleFixture(fid).then((r) => console.log("settled", JSON.stringify(r))).catch((e) => { console.error(e); process.exit(1); });
}
