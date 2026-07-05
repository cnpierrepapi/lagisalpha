// Linescout SDK — strategy & agent construction (pure JS).
//
// A "strategy" is a lever set gated to certain edge kinds; an "agent" runs one
// or more strategies over a shared bankroll. These are the exact shapes the pure
// decision core (decide / evalStrategy) consumes — no runner, no I/O.

export const DEFAULT_LEVERS = {
  edgeKinds: ["steam", "overreaction", "quote"], // which signals this set trades
  minConviction: 0.01, // edgeMeasure floor (fair-prob move, prob units)
  stakeMode: "flat", // "flat" | "kelly"
  stakePct: 0.05, // flat: fraction of bankroll per bet
  kellyFraction: 0.5, // kelly: fraction of full Kelly
  phase: "both", // "pre" | "inplay" | "both"
  minMinute: 0,
  maxMinute: 90,
  marketFilter: [], // allowed SuperOddsType values; [] = any
  oddsMin: 1.3,
  oddsMax: 6.0,
  maxConcurrent: 3,
  direction: "follow", // "follow" the engine's call, or "fade" (invert)
};

export function defaultLevers(over = {}) {
  return { ...DEFAULT_LEVERS, ...over };
}

// Build one strategy from a (partial) lever set.
export function defineStrategy(levers = {}, { label = "strategy", edgeKinds } = {}) {
  const L = defaultLevers(levers);
  return {
    label,
    source: "custom",
    paperId: null,
    edgeKinds: edgeKinds ?? L.edgeKinds,
    levers: L,
  };
}

// Build an agent the decision core can run. `strategies` are tried in order;
// the first that greenlights an edge takes it (never double-staking one edge).
export function createAgent({ id = "agent", name = "agent", bankroll = 1000, strategies = [], status = "running" } = {}) {
  return {
    id,
    name,
    status, // "running" | "paused" | "stopped"
    bankroll,
    startBankroll: bankroll,
    strategies,
    positions: [],
    bets: 0,
    wins: 0,
    losses: 0,
    dayPnl: 0,
    createdAt: 0,
  };
}
