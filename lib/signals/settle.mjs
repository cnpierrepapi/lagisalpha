// SIGNAL SETTLEMENT — grade an emitted signal against ground truth. Pure.
//
// Linethesis grades ITSELF: after a market goes quiet (kickoff / suspension / FT)
// every signal it emitted is settled two ways so the /proof calibration ledger is
// provable, not asserted.
//
//   (1) CLV realization — did the demargined fair line keep moving TOWARD the call
//       to its closing value? This is the skill metric; it resolves from odds alone
//       (deterministic, replayable) and is what an operator cares about: "when this
//       agent said fade, did the overshoot actually revert?"  clvRight = clvReturn>0.
//
//   (2) Outcome (on-chain) — did the goals settle the backed side? Verified against
//       the TxLINE daily-scores Merkle root via validateStat. Optional: only the two
//       goal counts are on-chain, and the check needs a funded sim payer, so in
//       environments without one we return status:"pending" (never a false "wrong").
//
// Pure: no I/O, no clock. The on-chain call is injected by the caller (worker) via
// `validateGoals`; omit it for the CLV-only (deterministic) path.
import { markPosition } from "../agent-core.mjs";

// Settle the CLV leg against the market's closing fair probability.
// signal.direction (back|lay) + signal.pRef (entry) come straight off the signal.
export function settleCLV(signal, closingProb) {
  if (closingProb == null || signal?.pRef == null) {
    return { status: "pending", closingProb: null, clvReturn: null, pnl: null, clvRight: null };
  }
  const { clvReturn, pnl } = markPosition(
    { entryProb: signal.pRef, direction: signal.direction, stake: 1 },
    closingProb,
  );
  return { status: "settled", closingProb, clvReturn, pnl, clvRight: clvReturn > 0 };
}

// Full settlement = CLV leg (+ optional on-chain outcome leg). `validateGoals` is an
// async (fixtureId) => { p1, p2, proof, verified } | null the worker injects; the
// outcome leg is left pending when it's absent or the sim payer is unfunded.
export async function settleSignal(signal, closingProb, validateGoals) {
  const clv = settleCLV(signal, closingProb);
  const settled = { ...signal, ...clv };

  if (typeof validateGoals !== "function" || signal.kind === "goal_imminent") {
    return { ...settled, outcome: { status: "pending", reason: "no on-chain check" } };
  }
  try {
    const g = await validateGoals(signal.fixtureId);
    if (!g || g.verified !== true) {
      return { ...settled, outcome: { status: "pending", reason: "unverified / sim payer unfunded" } };
    }
    // Outcome truth for a goals market: does the backed side win on the final goals?
    const outcomeRight = resolveGoalsOutcome(signal, g.p1, g.p2);
    return {
      ...settled,
      outcome: { status: "settled", p1: g.p1, p2: g.p2, outcomeRight, proof: g.proof ?? null },
    };
  } catch (e) {
    // Per reference_validate_stat_settlement: a sim/RPC failure is PENDING, not wrong.
    return { ...settled, outcome: { status: "pending", reason: String(e?.message || e) } };
  }
}

// Settle a goal_imminent signal on GOAL-ARRIVAL, not CLV. Anticipation has no
// reversion/closing-line to grade — its proven value is the 1.92× arrival lift, so we
// grade it on whether a real goal actually landed within the anticipation window after
// the warning. goalTimes = sorted match-time ms of real goals (running-max increments).
export function settleGoalArrival(signal, goalTimes, windowMs = 120_000) {
  if (signal?.ts == null || !Array.isArray(goalTimes)) {
    return { status: "pending", arrived: null, arrivalMs: null, windowMs };
  }
  const t = signal.ts;
  let arrivalMs = null;
  for (const g of goalTimes) {
    if (g > t && g <= t + windowMs) { arrivalMs = g - t; break; }
  }
  return { status: "settled", arrived: arrivalMs != null, arrivalMs, windowMs };
}

// Did the signal's backed side win on the final goal counts? Handles the two
// on-chain-settleable goals markets. Returns null when we can't resolve (e.g. a
// push, or a market shape we don't decode) so it stays out of the outcome stats.
export function resolveGoalsOutcome(signal, p1, p2) {
  const line = signal.line;
  const type = signal.superOddsType || "";
  if (p1 == null || p2 == null || line == null) return null;
  const total = p1 + p2;

  if (type.includes("OVERUNDER")) {
    if (total === line) return null; // push
    const overWon = total > line;
    const backedOver = /over/i.test(signal.side);
    const sideWon = backedOver ? overWon : !overWon;
    // direction 'back' backs the signal side; 'lay' backs against it.
    return signal.direction === "back" ? sideWon : !sideWon;
  }
  if (type.includes("ASIANHANDICAP")) {
    // side is the handicapped participant; line applies to that participant's goals.
    const backP1 = /1|home|participant1/i.test(signal.side);
    const margin = (backP1 ? p1 - p2 : p2 - p1) + line;
    if (margin === 0) return null; // push
    const sideWon = margin > 0;
    return signal.direction === "back" ? sideWon : !sideWon;
  }
  return null;
}
