// ───────────────────────────────────────────────────────────────────────────
// Linescout SDK
// ───────────────────────────────────────────────────────────────────────────
// The product is the signal API (/api/v1/signals); this package is the OPTIONAL
// in-process wrapper around the identical pure functions, for latency-sensitive
// consumers that run the classifier next to their own book. You bring your own
// TxLINE feed and prices; the SDK turns the demargined book into typed, read-only
// line-integrity signals (steam->follow, overreaction->hold/fade, goal_imminent->
// suspend). Follow/hold is graded on Fair Close Value (the line held within ±10pp
// of entry at the +180s close), fade on reversion; scoreCLV ships as the auxiliary
// CLV diagnostic. Pure, deterministic, no I/O, no clock reads, unit-tested.
//
// The engine and decision core are re-exported from the canonical modules in
// lib/ (single source of truth — the deployed product runs the exact same code).
//
//   import { EdgeEngine, defineStrategy, createAgent, decide, markPosition }
//     from "linescout/sdk";
//
//   const engine = new EdgeEngine();                 // detection thresholds
//   const strat  = defineStrategy({ stakeMode: "kelly" }, { label: "my-desk" });
//   const agent  = createAgent({ bankroll: 100_000, strategies: [strat] });
//
//   engine.on("edge", (edge) => {
//     const minute = engine.matchMinute(edge.market.fixtureId);
//     const open   = agent.positions.filter((p) => p.status === "open").length;
//     const d = decide(agent, edge, { minute, openCount: open });
//     if (d.take) myExecutionLayer.place(d);          // you route the order
//   });
//
//   engine.ingestOdds(txlineOddsRecord);              // feed your stream
//   engine.ingestScores(txlineScoreRecord);
//
// See examples/desk_quickstart.mjs for a runnable end-to-end demo on real
// captured TxLINE frames.

// --- detection: raw book -> typed, scored edges -----------------------------
export { EdgeEngine } from "../lib/edge/engine.mjs";

// --- line-integrity signals: edge -> read-only operator recommendation -------
// The LOCKED product surface. classifyEdge maps an engine edge (+ optionally your
// own watched price) into a read-only signal — kind (steam|overreaction) → action
// (follow|hold|fade), confidence, pickoffRisk, gapBps. goalImminent fires off the
// momentum tape before a goal lands, with a quantified goalProb (P(goal ≤120s)) →
// suspend/widen. You act on the signal; Linescout never touches your book. Identical
// to what /api/v1/signals serves (SDK↔API parity).
export { classifyEdge, goalImminent, parseLine } from "../lib/signals/classify.mjs";

// --- decision + scoring: edge -> bet, position -> CLV -----------------------
export {
  decide,
  evalStrategy,
  markPosition,
  expectedReturn,
  kellyStake,
  CONTINUATION_COEFF,
  KELLY_CAP,
  CLV_FLOOR,
  CLV_CEIL,
} from "../lib/agent-core.mjs";

// --- strategy / agent construction ------------------------------------------
export { DEFAULT_LEVERS, defaultLevers, defineStrategy, createAgent } from "./strategies.mjs";

import { markPosition as _mark } from "../lib/agent-core.mjs";

// Score a single decision to closing-line value without building a Position.
// back: r = (p_close - p_entry) / p_entry ; lay: the negative. Returns
// { clvReturn, pnl } (pnl = stake * clvReturn, clamped). This is the skill
// metric — it resolves from odds alone, no match outcome required.
export function scoreCLV({ entryProb, direction = "back", stake = 1 }, closeProb) {
  return _mark({ entryProb, direction, stake }, closeProb);
}
