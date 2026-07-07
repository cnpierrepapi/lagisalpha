// SIGNAL POLICY — every divergence call counts, and the Kelly math used everywhere (site headline,
// /proof, /edge, the paper engine, the CLI, Telegram).
//
// There is NO exclusion filter: the record rolls on its own. Every call the detector fires — either
// side, any size, any minute — is published and scored. Sizing is the only risk control: full Kelly on
// the gap, f = gap/(1-entry), clamped [0,1], entered at the market and exited at fair on convergence
// (else marked out at the close). An earlier version cut giant and late buy-NO calls; that filter is
// retired — sides are named by team and the full, uncurated set is the track record.

import type { DivergenceEntry } from "@/lib/pickoff-source";

/** Match minute of a call, or null when the kickoff time is unknown. */
export function entryMinute(kick: number | undefined, tSeconds: number): number | null {
  if (!kick) return null;
  return (tSeconds * 1000 - kick) / 60000;
}

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

/** Pooled stats over EVERY call of a match set at one theta. */
export function pooledStats(matchDivs: { divs: DivergenceEntry[]; kick?: number }[]) {
  let n = 0, reach = 0, size = 0, kTp = 1, kRes = 1;
  for (const { divs } of matchDivs)
    for (const e of divs) {
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

/** Per-match Kelly ROI over every call (null when the match has no calls). */
export function matchKellyRoi(divs: DivergenceEntry[]): number | null {
  return divs.length ? divs.reduce((p, e) => p * kmultTp(e), 1) - 1 : null;
}
