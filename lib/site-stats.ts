// SITE STATS — the headline numbers (reach rate, Kelly take-profit ROI, the resolution contrast,
// match count). Recomputed live from the ledger under the SIGNAL POLICY (lib/signals/policy.ts), so the
// homepage, litepaper, and PDF show exactly what /proof shows: the included calls only, giant-gap and
// late-NO duds filtered out. Falls back to last-known values if the blob is briefly unavailable.

import { getPickoffs } from "@/lib/pickoff-source";
import { pooledStats } from "@/lib/signals/policy";

const WORDS = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty",
];
export function numWord(n: number): string {
  return WORDS[n] ?? String(n);
}

export interface SiteStats {
  reachPct: number; // pooled reach rate at >=5pp, whole %
  roiPct: number; // pooled Kelly take-profit ROI at >=5pp, whole %
  roi10Pct: number; // same at >=10pp
  resPct: number; // pooled Kelly ROI of the SAME bets held to resolution at >=5pp (SIGNED, the contrast)
  res10Pct: number; // same at >=10pp
  matchCount: number;
  matchWord: string;
  hasData: boolean;
}

const FALLBACK: SiteStats = {
  reachPct: 80, roiPct: 1160, roi10Pct: 1160, resPct: 83, res10Pct: 83,
  matchCount: 12, matchWord: "twelve", hasData: false,
};

export async function getSiteStats(): Promise<SiteStats> {
  const led = await getPickoffs();
  const matches = led?.matches ?? [];
  const matchCount = led?.matchCount ?? matches.length ?? 0;
  const s5 = pooledStats(matches.map((m) => ({ divs: m.divergences?.["5"] ?? [], kick: m.kick })));
  const s10 = pooledStats(matches.map((m) => ({ divs: m.divergences?.["10"] ?? [], kick: m.kick })));
  if (!led || !s5.n) return { ...FALLBACK, matchCount: matchCount || FALLBACK.matchCount, matchWord: numWord(matchCount || FALLBACK.matchCount) };
  return {
    reachPct: Math.round(s5.reachRate * 100),
    roiPct: Math.round(s5.kellyRoi * 100),
    roi10Pct: s10.n ? Math.round(s10.kellyRoi * 100) : Math.round(s5.kellyRoi * 100),
    resPct: Math.round(s5.kellyRoiRes * 100),
    res10Pct: s10.n ? Math.round(s10.kellyRoiRes * 100) : Math.round(s5.kellyRoiRes * 100),
    matchCount,
    matchWord: numWord(matchCount),
    hasData: true,
  };
}
