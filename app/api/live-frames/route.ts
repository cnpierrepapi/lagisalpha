// /api/live-frames — real-time TxLINE frames for the deployed app.
//
// Vercel serverless can't hold an SSE stream open (the body buffers → 0 bytes),
// so instead of streaming we POLL the odds SNAPSHOT endpoint on each request:
// the browser calls this every few seconds and we return the latest demargined
// book for whatever fixtures are live right now. The token stays server-side.
// This is what lets the PRODUCTION app show genuinely real-time frames.
import { NextResponse } from "next/server";
import { txlineCreds } from "@/lib/txline/stream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LIVE_WINDOW_MS = 3 * 60 * 60 * 1000; // a fixture is a live candidate within 3h of kickoff
const FRESH_MS = 120_000; // a frame counts as "live" if its Ts is within 2 min
const MAX_FIXTURES = 6;
const MAX_MARKETS = 5;

interface FrameOut {
  market: string;
  line: string;
  period: string;
  priceNames: string[];
  prices: number[];
  fairProbs: number[];
  ts: number;
  ageSec: number;
}
interface FixtureOut {
  fid: number | string;
  label: string;
  latestAgeSec: number;
  frames: FrameOut[];
}

async function getJson(url: string, headers: Record<string, string>, timeoutMs = 6000): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers, signal: ctrl.signal, cache: "no-store" });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

export async function GET() {
  const creds = txlineCreds();
  if (!creds) {
    return NextResponse.json({ configured: false, note: "no TxLINE token in env (live frames unavailable)" });
  }
  const headers = { Authorization: `Bearer ${creds.jwt}`, "X-Api-Token": creds.apiToken };
  const now = Date.now();

  // Discover live candidates from the fixtures snapshot (kickoff within the window).
  const snap = await getJson(`${creds.apiBase}/api/fixtures/snapshot`, headers);
  const fixtures = (Array.isArray(snap) ? snap : ((snap as { fixtures?: unknown[] })?.fixtures ?? [])) as Array<
    Record<string, unknown>
  >;
  const candidates = fixtures
    .map((f) => ({
      fid: f.FixtureId as number,
      label: `${f.Participant1 ?? "Home"} v ${f.Participant2 ?? "Away"}`,
      start: Number(f.StartTime) || 0,
    }))
    .filter((f) => f.fid != null && f.start && f.start <= now && now - f.start <= LIVE_WINDOW_MS)
    .slice(0, MAX_FIXTURES + 4);

  // Poll each candidate's odds snapshot in parallel; keep those with fresh frames.
  const results = await Promise.all(
    candidates.map(async (c) => {
      const od = await getJson(`${creds.apiBase}/api/odds/snapshot/${c.fid}`, headers);
      const recs = (Array.isArray(od) ? od : ((od as { records?: unknown[] })?.records ?? [])) as Array<
        Record<string, unknown>
      >;
      // Latest demargined frame per market.
      const byMarket = new Map<string, Record<string, unknown>>();
      for (const r of recs) {
        if (r.Bookmaker !== "TXLineStablePriceDemargined") continue;
        if (!Array.isArray(r.Prices) || !(r.Prices as number[]).some((p) => Number(p) > 0)) continue;
        const key = `${r.SuperOddsType}|${r.MarketParameters ?? ""}`;
        const prev = byMarket.get(key);
        if (!prev || Number(r.Ts) > Number(prev.Ts)) byMarket.set(key, r);
      }
      const frames: FrameOut[] = [...byMarket.values()]
        .sort((a, b) => Number(b.Ts) - Number(a.Ts))
        .slice(0, MAX_MARKETS)
        .map((r) => {
          const prices = r.Prices as number[];
          return {
            market: String(r.SuperOddsType ?? ""),
            line: String(r.MarketParameters ?? ""),
            period: String(r.MarketPeriod ?? ""),
            priceNames: (r.PriceNames as string[]) ?? [],
            prices,
            fairProbs: prices.map((p) => (Number(p) > 0 ? Number((1000 / Number(p)).toFixed(4)) : 0)),
            ts: Number(r.Ts),
            ageSec: Number(((now - Number(r.Ts)) / 1000).toFixed(1)),
          };
        });
      if (!frames.length) return null;
      const latestAgeSec = Math.min(...frames.map((f) => f.ageSec));
      if (latestAgeSec * 1000 > FRESH_MS) return null; // stale ⇒ not actually live
      return { fid: c.fid, label: c.label, latestAgeSec, frames } as FixtureOut;
    }),
  );

  const live = results.filter((r): r is FixtureOut => r != null).slice(0, MAX_FIXTURES);
  const totalFrames = live.reduce((s, f) => s + f.frames.length, 0);

  return NextResponse.json({
    configured: true,
    polledAt: new Date(now).toISOString(),
    source: creds.apiBase,
    liveCount: live.length,
    totalFrames,
    fixtures: live,
    note:
      live.length === 0
        ? "No WC match is in-play right now; odds are live-only, so frames appear when a match kicks off."
        : undefined,
  });
}
