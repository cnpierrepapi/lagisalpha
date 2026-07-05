// NAIVE-FOLLOW BOOK — the thing that gets picked off, simulated for the demo. Pure.
//
// A soft book that just tracks the demargined reference but with LATENCY: at time t it
// still shows the reference price from (t − lagMs). That stale price is the entire
// adverse-selection surface — the moment the reference jumps on a goal, the naive book
// is still quoting the pre-goal number and a sharp lifts it. Linescout's job is to see
// that gap and WARN before the pickoff; the operator's rule-set decides what to do.
//
// This is a DEMO stand-in so the control-room has "a book to protect". In production the
// operator connects their real price and pWatched/gapBps come from that instead.
import { probAtOrBefore } from "./frames.mjs";

export const DEFAULT_LAG_MS = 8_000; // a middling soft-book in-play latency (~8s)

// The naive book's shown prob for a market/side at match-time ts.
export function naiveWatchedProb(oddsFrames, meta, ts, lagMs = DEFAULT_LAG_MS) {
  return probAtOrBefore(oddsFrames, meta, ts - lagMs);
}

// Attach the naive book's price + the pickoff gap to a signal (given the raw frames of
// its match and the match-time it fired). Returns a NEW signal — never mutates.
//   gapBps = (pWatched − pRef) × 10000 ; a stale book on a moved reference = large |gap|.
export function withNaiveBook(signal, oddsFrames, frameTs, lagMs = DEFAULT_LAG_MS) {
  const meta = {
    superOddsType: signal.superOddsType,
    marketParameters: `line=${signal.line}`,
    marketPeriod: signal.marketPeriod ?? "null",
    side: signal.side,
  };
  const pWatched = naiveWatchedProb(oddsFrames, meta, frameTs, lagMs);
  if (pWatched == null || signal.pRef == null) return { ...signal, pWatched: null, gapBps: null };
  const gapBps = Math.round((pWatched - signal.pRef) * 10000);
  return { ...signal, pWatched: Math.round(pWatched * 1e4) / 1e4, gapBps };
}
