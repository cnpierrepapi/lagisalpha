// SIGNAL POLICY — the single rule for which divergence calls count as tradeable signals, and the
// Kelly math used everywhere (site headline, /proof, /edge, the paper engine, the CLI, Telegram).
//
// Derived empirically from the call set (see the filter analysis): full Kelly, and two exclusions that
// BOTH fall on the buy-NO side, because the losses are side-asymmetric (NO calls carry systematically
// negative closing value; the giant lags that convert sit on the YES side, right after a goal):
//   1. GIANT BUY-NO (side "no", gap >= 25pp): an oversized NO lag rarely comes back; the huge YES lags
//      that pay are kept, only the NO giants are cut.
//   2. LATE BUY-NO (side "no", after minute 80): betting a team will NOT win, that late, is a dud
//      (reach drops ~71% -> ~64%, average return goes negative) - one goal or a closed-out favourite kills it.
// Every YES call is included, and any NO call before 80' under 25pp. All are Kelly-sized: f = gap/(1-entry), clamped [0,1].

import type { DivergenceEntry } from "@/lib/pickoff-source";

export const GAP_MAX = 0.25;        // exclude a buy-NO at/above 25pp
export const NO_DUD_MINUTE = 80;    // exclude a buy-NO after this match minute

export type ExclusionReason = "giant_no" | "late_no" | null;

/** Match minute of a call, or null when the kickoff time is unknown. */
export function entryMinute(kick: number | undefined, tSeconds: number): number | null {
  if (!kick) return null;
  return (tSeconds * 1000 - kick) / 60000;
}

/** Why a call is excluded from the signal set, or null if it is a valid signal. Only buy-NO is ever cut. */
export function exclusionReason(e: DivergenceEntry, kick?: number): ExclusionReason {
  if (e.side !== "no") return null; // every YES call is a signal, including giant post-goal lags
  if (Math.abs(e.gap) >= GAP_MAX) return "giant_no";
  const min = entryMinute(kick, e.t);
  if (min != null && min > NO_DUD_MINUTE) return "late_no";
  return null;
}

export function isIncluded(e: DivergenceEntry, kick?: number): boolean {
  return exclusionReason(e, kick) === null;
}

export const REASON_LABEL: Record<Exclude<ExclusionReason, null>, string> = {
  giant_no: "excluded: buy-NO ≥ 25pp — an oversized NO lag rarely converges (the giant lags that pay are the YES side, after a goal)",
  late_no: "excluded: buy-NO after 80’ — a late NO is a dud (reach falls, average return turns negative)",
};

/** Kelly bankroll multiplier for one call, take-profit at fair on reach else marked out at close. */
export function kmultTp(e: DivergenceEntry): number {
  const d = 1 - e.entry;
  const f = d > 0 ? Math.max(0, Math.min(1, Math.abs(e.gap) / d)) : 0;
  const r = e.entry > 0 ? (e.reached ? Math.abs(e.gap) : e.clv ?? 0) / e.entry : 0;
  return 1 + f * r;
}

/** The same Kelly bet held to the final result (the losing contrast for the evidence callout). */
export function kmultRes(e: DivergenceEntry): number {
  const d = 1 - e.entry;
  const f = d > 0 ? Math.max(0, Math.min(1, Math.abs(e.gap) / d)) : 0;
  const r = e.win ? (1 - e.entry) / e.entry : -1;
  return 1 + f * r;
}

/** Pooled stats over the INCLUDED calls of a match set at one theta. */
export function pooledStats(matchDivs: { divs: DivergenceEntry[]; kick?: number }[]) {
  let n = 0, reach = 0, size = 0, kTp = 1, kRes = 1;
  for (const { divs, kick } of matchDivs)
    for (const e of divs) {
      if (!isIncluded(e, kick)) continue;
      n++; reach += e.reached ? 1 : 0; size += e.usd ?? 0;
      kTp *= kmultTp(e); kRes *= kmultRes(e);
    }
  return {
    n,
    reachRate: n ? reach / n : 0,
    kellyRoi: n ? kTp - 1 : 0,
    kellyRoiRes: n ? kRes - 1 : 0,
    usd: size,
  };
}

/** Per-match Kelly ROI over included calls (null when the match has no included calls). */
export function matchKellyRoi(divs: DivergenceEntry[], kick?: number): number | null {
  const inc = divs.filter((e) => isIncluded(e, kick));
  return inc.length ? inc.reduce((p, e) => p * kmultTp(e), 1) - 1 : null;
}
