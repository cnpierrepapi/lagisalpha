// OPERATOR FEED — the deterministic edge snapshot behind /api/v1/edges.
//
// A market operator polling the API gets typed, scored edges per fixture, each
// carrying the proofHash that ties it to the exact real TxLINE frame it was
// derived from. We build that snapshot by replaying the bundled REAL captures
// through a fresh EdgeEngine (one per fixture, so no cross-match bleed) and
// keeping the LATEST edge per market+kind.
//
// Why replay rather than scrape the live runner: on serverless the runner's
// engine barely gets CPU on a cold instance, so a poll could return nothing.
// Replaying the captures is deterministic and reproducible — every request
// yields the same answer, derived from real data. In production this same
// contract is served by a persistent worker watching the live stream (see the
// API docs: the payload shape is identical, only the source clock differs).
import { EdgeEngine } from "./edge/engine.mjs";
import { edgeProofHash } from "./frame-proof.mjs";

// Detection tuned to real in-play books (mirrors feed.ts REPLAY_OPTS) but with
// cooldown disabled: we want every threshold crossing so we can keep the most
// recent edge per market+kind, not just the first of a burst.
const DETECT_OPTS = {
  steamThreshold: 0.015,
  steamWindowMs: 90_000,
  overreactionThreshold: 0.03,
  overreactionWindowMs: 150_000,
  quoteThreshold: 0.008,
  quoteWindowMs: 60_000,
  historyMs: 300_000,
  edgeTtlMs: 45_000,
  edgeCooldownMs: 0,
};

const round = (x, n) => {
  const f = 10 ** n;
  return Math.round(x * f) / f;
};
const CONV_RANK = { High: 3, Medium: 2, Low: 1 };

// Build the per-fixture edge snapshot from an array of captured matches
// ({ fid, p1, p2, odds[], scores[] }). Pure: same captures -> same output.
export function computeOperatorEdges(replays) {
  const fixtures = [];

  for (const m of replays) {
    if (!m.odds?.length) continue;
    const fid = String(m.fid);
    const label = `${m.p1} v ${m.p2}`;
    const engine = new EdgeEngine(DETECT_OPTS);

    // latest edge per market+kind, tagged with the frame's match timestamp
    const latest = new Map();
    let curTs = 0;
    engine.on("edge", (e) => {
      const key = `${e.market.fixtureId}|${e.market.superOddsType}|${e.market.marketParameters}|${e.market.marketPeriod}|${e.market.side}|${e.kind}`;
      latest.set(key, { edge: e, frameTs: curTs });
    });

    // Anchor to the in-play odds window (drop stale pre-match coverage), then
    // feed odds+scores in real match-time order.
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

    const edges = [...latest.values()].map(({ edge, frameTs }) => ({
      id: edge.id,
      fixtureId: edge.market.fixtureId,
      match: label,
      kind: edge.kind,
      direction: edge.direction,
      conviction: edge.conviction,
      market: {
        superOddsType: edge.market.superOddsType,
        marketParameters: edge.market.marketParameters,
        marketPeriod: edge.market.marketPeriod,
        side: edge.market.side,
        sideIndex: edge.market.sideIndex,
      },
      fairProb: round(edge.fairProb, 4),
      impliedOdds: round(1 / edge.fairProb, 3),
      edgeMeasure: round(edge.edgeMeasure, 4),
      note: edge.note,
      ...(edge.trigger ? { trigger: edge.trigger } : {}),
      frameTs,
      frameTsISO: new Date(frameTs).toISOString(),
      proofHash: edgeProofHash(edge),
    }));

    edges.sort(
      (a, b) => CONV_RANK[b.conviction] - CONV_RANK[a.conviction] || b.frameTs - a.frameTs,
    );
    fixtures.push({ fixtureId: fid, label, edgeCount: edges.length, edges });
  }

  fixtures.sort((a, b) => b.edgeCount - a.edgeCount);
  return fixtures;
}
