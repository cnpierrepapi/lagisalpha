// CALIBRATION LEDGER — aggregate settled signals into the /proof track record. Pure.
//
// This is the moat made legible: a public, on-chain-anchored record of how well the
// agent's calls actually held up. We report the HONEST numbers — overall + per kind +
// per action, plus per-fixture breadth and single-match concentration, so a "pilot,
// not proof" pattern (one match carrying the result) can't hide behind a headline.
//
// Input = array of settled signals (see settle.mjs): each has {kind, action, status,
// clvReturn, clvRight, fixtureId, outcome?}. Pure: same input → same ledger.

const round = (x, n = 4) => {
  if (x == null || Number.isNaN(x)) return null;
  const f = 10 ** n;
  return Math.round(x * f) / f;
};

function bucket(rows) {
  const done = rows.filter((r) => r.status === "settled" && r.clvReturn != null);
  const n = done.length;
  const right = done.filter((r) => r.clvRight).length;
  const avgClv = n ? done.reduce((a, r) => a + r.clvReturn, 0) / n : null;
  // on-chain outcome leg (only where present + verified)
  const oc = rows.filter((r) => r.outcome?.status === "settled" && r.outcome.outcomeRight != null);
  const ocRight = oc.filter((r) => r.outcome.outcomeRight).length;
  return {
    n,
    right,
    hitRate: n ? round(right / n, 4) : null,
    avgClv: round(avgClv, 4),
    pending: rows.length - n,
    outcome: oc.length ? { n: oc.length, right: ocRight, hitRate: round(ocRight / oc.length, 4) } : null,
  };
}

// Arrival-based calibration for goal_imminent (NO CLV): reproduces the goal-ARRIVAL lift
// that justifies the signal. rows = [{ arrived, confidence, status, windowMs }]; baseRate =
// P(goal in the same window) under a uniform-arrival null. lift = arrivalRate / baseRate
// (the 1.92× we measured). This is the honest proof for anticipation: not "the line moved"
// (it doesn't, per the drift test) but "the goal came disproportionately often".
export function calibrateArrival(rows, baseRate) {
  const done = (rows || []).filter((r) => r.status === "settled" && r.arrived != null);
  const n = done.length;
  const arrived = done.filter((r) => r.arrived).length;
  const arrivalRate = n ? arrived / n : null;
  const lift = arrivalRate != null && baseRate ? arrivalRate / baseRate : null;
  return {
    n,
    arrived,
    arrivalRate: round(arrivalRate, 4),
    baseRate: round(baseRate, 4),
    lift: round(lift, 2),
    windowMs: done[0]?.windowMs ?? 120_000,
  };
}

export function calibrate(settled) {
  const rows = settled || [];
  const kinds = ["steam", "overreaction"];
  const actions = ["follow", "hold", "fade"];

  const byKind = Object.fromEntries(kinds.map((k) => [k, bucket(rows.filter((r) => r.kind === k))]));
  const byAction = Object.fromEntries(actions.map((a) => [a, bucket(rows.filter((r) => r.action === a))]));

  // breadth + concentration on the settled CLV pnl (guards the "one-match" illusion)
  const done = rows.filter((r) => r.status === "settled" && r.clvReturn != null);
  const byFix = new Map();
  for (const r of done) {
    const f = byFix.get(r.fixtureId) || { n: 0, right: 0, sumClv: 0 };
    f.n++;
    if (r.clvRight) f.right++;
    f.sumClv += r.clvReturn;
    byFix.set(r.fixtureId, f);
  }
  const fixtures = [...byFix.entries()].map(([fixtureId, f]) => ({
    fixtureId,
    n: f.n,
    hitRate: round(f.right / f.n, 3),
    avgClv: round(f.sumClv / f.n, 4),
    netPositive: f.sumClv > 0,
  }));
  const totalNet = fixtures.reduce((a, f) => a + f.avgClv * f.n, 0);
  const topShare = fixtures.length
    ? round(Math.max(...fixtures.map((f) => (f.avgClv * f.n) / (totalNet || 1))) * 100, 1)
    : null;

  return {
    overall: bucket(rows),
    byKind,
    byAction,
    breadth: {
      matches: byFix.size,
      matchesNetPositive: fixtures.filter((f) => f.netPositive).length,
      topMatchShareOfNetPct: topShare, // >~50% ⇒ concentration risk ⇒ "pilot, not proof"
      fixtures: fixtures.sort((a, b) => b.n - a.n),
    },
    // the one-line honest verdict for the /proof header
    headline:
      byKind.overreaction.n > 0
        ? `overreaction/fade ${byKind.overreaction.right}/${byKind.overreaction.n} CLV-positive (${((byKind.overreaction.hitRate ?? 0) * 100).toFixed(0)}%) across ${byFix.size} matches`
        : `${byFix.size} matches settled`,
  };
}
