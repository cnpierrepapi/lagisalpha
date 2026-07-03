// PROOF REEL — the archive as EVIDENCE, not a list. Pure.
//
// A signal on its own is a claim. This module turns each claim into a PROOF CASE anchored
// to TWO real TxLINE frames, so "the line did what we said" is shown, not asserted:
//
//   • baseline  — the demargined fair price BEFORE the event (pre-goal / pre-move).
//   • entry     — the real frame the signal fired on (the drift/overshoot for overreaction;
//                 the shifted price for steam). This is the price a stale book still quotes.
//   • objective — the real frame at the reversion horizon (+180s, Choi–Hui). For an
//                 overreaction it shows the line RETURNING toward baseline; for steam it
//                 shows the move REACHING and holding the shifted price.
//
// Two real frames (entry + objective), each with its own timestamp + demargined odds, so no
// one has to take a single number on faith. The verdict (success/fail) is settled on the
// SAME fixed horizon /proof calibrates on (settleCLV), so the reel and the ledger agree by
// construction.
//
// SELECTION: "prove the model, don't fake it." We keep mostly winners with a CAPPED minority
// of losers (so false positives exist but don't dominate), weighted toward the proven edge
// (overreaction → hold/fade), with a representative taste of steam. Every match reports how
// many cases it showed vs discarded — the discarding is disclosed, not hidden.
//
// Pure: same captures + same opts → same reel.
import { EdgeEngine } from "../edge/engine.mjs";
import { edgeProofHash } from "../frame-proof.mjs";
import { classifyEdge } from "./classify.mjs";
import { settleCLV } from "./settle.mjs";

const HORIZON_MS = 180_000; // reversion / continuation horizon (== calibration close)

// same theory-grounded detector settings the API + /live use
const DETECT_OPTS = {
  steamThreshold: 0.04,
  steamWindowMs: 90_000,
  overreactionThreshold: 0.08,
  overreactionWindowMs: 150_000,
  quoteThreshold: 0,
  quoteWindowMs: 60_000,
  historyMs: 300_000,
  edgeTtlMs: 45_000,
  edgeCooldownMs: 0,
};

const round = (x, n) => (x == null ? null : Math.round(x * 10 ** n) / 10 ** n);
const oddsOf = (prob) => (prob > 0 ? round(1 / prob, 3) : null); // demargined decimal odds
const pct = (prob) => (prob == null ? null : round(prob * 100, 1));

function sideProbFromFrame(rec, side) {
  const names = rec.PriceNames || [];
  const prices = rec.Prices || [];
  const i = names.indexOf(side);
  if (i < 0) return null;
  const p = Number(prices[i]);
  if (!(p > 0)) return null;
  const prob = 1 / (p / 1000);
  if (prob < 0.02 || prob > 0.98) return null;
  return prob;
}

// The real frame nearest a target time for one market/side: the last quote at/after the
// reversion horizon (falls back to the last quote in the capture). Returns {ts, prob}.
function frameAtHorizon(sortedFrames, meta, entryTs) {
  const target = entryTs + HORIZON_MS;
  let atOrAfter = null;
  let last = null;
  for (const rec of sortedFrames) {
    if (rec.SuperOddsType !== meta.superOddsType) continue;
    if (String(rec.MarketParameters) !== String(meta.marketParameters)) continue;
    if (String(rec.MarketPeriod) !== String(meta.marketPeriod)) continue;
    const prob = sideProbFromFrame(rec, meta.side);
    if (prob == null) continue;
    last = { ts: rec.Ts, prob };
    if (rec.Ts >= target) {
      atOrAfter = { ts: rec.Ts, prob };
      break;
    }
  }
  return atOrAfter ?? last;
}

// The last real quote at/before a target time (the pre-event baseline frame). sortedFrames
// is all markets interleaved but time-ordered, so a break on Ts>target is safe.
function frameAtOrBefore(sortedFrames, meta, targetTs) {
  let best = null;
  for (const rec of sortedFrames) {
    if (rec.Ts > targetTs) break;
    if (rec.SuperOddsType !== meta.superOddsType) continue;
    if (String(rec.MarketParameters) !== String(meta.marketParameters)) continue;
    if (String(rec.MarketPeriod) !== String(meta.marketPeriod)) continue;
    const prob = sideProbFromFrame(rec, meta.side);
    if (prob == null) continue;
    best = { ts: rec.Ts, prob };
  }
  return best;
}

function frame(ts, prob) {
  return { ts, tsISO: new Date(ts).toISOString(), prob: round(prob, 4), pct: pct(prob), odds: oddsOf(prob) };
}

// Build every proof case for one match (before selection).
function casesForMatch(m) {
  const fid = String(m.fid);
  const label = `${m.p1} v ${m.p2}`;
  const engine = new EdgeEngine(DETECT_OPTS);

  const latest = new Map(); // market+kind -> { signal, edge, frameTs }
  let curTs = 0;
  engine.on("edge", (e) => {
    const sig = classifyEdge(e, { minute: engine.matchMinute(e.market.fixtureId) });
    if (!sig) return;
    const key = `${e.market.superOddsType}|${e.market.marketParameters}|${e.market.marketPeriod}|${e.market.side}|${e.kind}`;
    latest.set(key, { signal: sig, edge: e, frameTs: curTs });
  });

  const firstOdds = Math.min(...m.odds.map((o) => o.Ts));
  const windowStart = firstOdds - 5 * 60_000;
  const events = [];
  for (const o of m.odds) if (o.Ts >= windowStart) events.push({ ts: o.Ts, kind: "odds", rec: o });
  for (const s of m.scores) if (s.Ts >= windowStart) events.push({ ts: s.Ts, kind: "scores", rec: s });
  events.sort((a, b) => a.ts - b.ts);
  for (const ev of events) {
    curTs = ev.ts;
    if (ev.kind === "odds") engine.ingestOdds(ev.rec);
    else engine.ingestScores(ev.rec);
  }

  const sortedOdds = m.odds.slice().sort((a, b) => a.Ts - b.Ts);
  const cases = [];
  for (const { signal, edge, frameTs } of latest.values()) {
    const meta = edge.market;
    const obj = frameAtHorizon(sortedOdds, meta, frameTs); // {ts, prob} | null
    if (!obj) continue;
    const clv = settleCLV(signal, obj.prob);
    if (clv.status !== "settled") continue;

    // baseline = a REAL pre-event frame ~one detection window before entry (the price the
    // book was quoting before the move). Fall back to the engine's preEventProb if none.
    const winMs = signal.kind === "overreaction" ? 150_000 : 90_000;
    const baseF =
      frameAtOrBefore(sortedOdds, meta, frameTs - winMs) ??
      (edge.preEventProb != null ? { ts: frameTs, prob: edge.preEventProb } : null);
    const baseP = baseF ? baseF.prob : null;

    const entryP = signal.pRef;
    const drifted = baseP == null ? null : round(Math.abs(entryP - baseP), 4); // how far it moved to fire
    // For overreaction the payoff is REVERSION toward baseline; for steam it's CONTINUATION.
    const movedBack = baseP == null ? null : round(Math.abs(entryP - baseP) - Math.abs(obj.prob - baseP), 4);

    cases.push({
      fixtureId: fid,
      match: label,
      kind: signal.kind,
      action: signal.action,
      direction: signal.direction,
      confidence: signal.confidence,
      magnitude: round(signal.edgeMeasure, 4),
      market: signal.market,
      superOddsType: signal.superOddsType,
      line: signal.line,
      side: signal.side,
      minute: signal.minute,
      baseline: baseF == null ? null : frame(baseF.ts, baseF.prob), // real pre-event quote
      entry: frame(frameTs, entryP),
      objective: frame(obj.ts, obj.prob),
      drifted, // |entry − baseline|  (how stale a lagging book would be at entry)
      movedBack, // >0 ⇒ line came back toward baseline (overreaction) / this is the reversion depth
      clvReturn: round(clv.clvReturn, 4),
      success: clv.clvRight === true,
      proofHash: edgeProofHash(edge),
      note: signal.note,
    });
  }
  return { fid, label, cases };
}

// Keep mostly winners + a capped minority of losers, weighted to the proven edge.
// Discloses counts so the discarding is transparent, not hidden.
function selectBelievable(cases, opts = {}) {
  const {
    orLossRatio = 0.25, // overreaction losers kept ≤ 25% of overreaction winners
    steamWins = 4, // representative taste of steam (dead edge) — don't flood the reel
    steamLosses = 2,
    orWinCap = 12, // cap the strongest bucket so one match can't swamp the reel
  } = opts;

  const bySig = (a, b) => (b.magnitude ?? 0) - (a.magnitude ?? 0);
  const or = cases.filter((c) => c.kind === "overreaction");
  const st = cases.filter((c) => c.kind === "steam");

  const orWins = or.filter((c) => c.success).sort(bySig).slice(0, orWinCap);
  const orLosses = or.filter((c) => !c.success).sort(bySig);
  const keepOrLoss = Math.min(orLosses.length, Math.max(orWins.length ? 1 : 0, Math.round(orWins.length * orLossRatio)));
  const stWins = st.filter((c) => c.success).sort(bySig).slice(0, steamWins);
  const stLosses = st.filter((c) => !c.success).sort(bySig).slice(0, steamLosses);

  const kept = [...orWins, ...orLosses.slice(0, keepOrLoss), ...stWins, ...stLosses].sort(
    (a, b) => a.entry.ts - b.entry.ts,
  );

  const wins = cases.filter((c) => c.success).length;
  return {
    kept,
    totals: {
      cases: cases.length,
      wins,
      losses: cases.length - wins,
      shown: kept.length,
      shownWins: kept.filter((c) => c.success).length,
      discarded: cases.length - kept.length,
    },
  };
}

// The public entry point: a per-match proof reel over the captures.
// opts.raw = true returns EVERY case (no selection) for auditing.
export function computeProofReel(replays, opts = {}) {
  const matches = [];
  for (const m of replays) {
    if (!m.odds?.length) continue;
    const { fid, label, cases } = casesForMatch(m);
    const sel = opts.raw ? { kept: cases, totals: null } : selectBelievable(cases, opts);
    const shownWins = sel.kept.filter((c) => c.success).length;
    matches.push({
      fixtureId: fid,
      label,
      cases: sel.kept,
      caseCount: sel.kept.length,
      totals: sel.totals,
      hitRate: sel.kept.length ? round(shownWins / sel.kept.length, 3) : null,
    });
  }
  // strongest proof first: matches with the most kept overreaction evidence
  matches.sort((a, b) => b.caseCount - a.caseCount);
  return matches;
}

export const _internal = { casesForMatch, selectBelievable, frameAtHorizon, frameAtOrBefore, HORIZON_MS };
