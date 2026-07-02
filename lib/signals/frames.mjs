// Shared frame helpers — read one SIDE of one market out of raw TxLINE odds frames.
// Pure. Mirrors engine._fairProbs so the naive-book / control-room see the exact same
// demargined fair prob the classifier does.

export function sideProbFromFrame(rec, side) {
  const names = rec.PriceNames || [];
  const prices = rec.Prices || [];
  const i = names.indexOf(side);
  if (i < 0) return null;
  const p = Number(prices[i]);
  if (!(p > 0)) return null;
  const prob = 1 / (p / 1000);
  if (prob < 0.02 || prob > 0.98) return null; // skip near-settled/suspended
  return prob;
}

export function marketMatches(rec, meta) {
  return (
    rec.SuperOddsType === meta.superOddsType &&
    String(rec.MarketParameters) === String(meta.marketParameters) &&
    String(rec.MarketPeriod) === String(meta.marketPeriod)
  );
}

// Latest side-prob at or before ts (the "what price is showing now" query).
export function probAtOrBefore(frames, meta, ts) {
  let best = null;
  for (const rec of frames) {
    if (rec.Ts > ts) continue;
    if (!marketMatches(rec, meta)) continue;
    const prob = sideProbFromFrame(rec, meta.side);
    if (prob != null) best = prob;
  }
  return best;
}
