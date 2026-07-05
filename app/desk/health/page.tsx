"use client";

// /desk/health: a SELF-CONTAINED worker health check. It reads the EC2 worker's
// live mirror from foil (the worker pushes total_ingested / stalls / updated_at
// every 15s), measures whether ingestion is ADVANCING across polls, and cross-
// references the clock against kickoff to render an explicit verdict + action.
// No agent in the loop: open it whenever (e.g. 17:05 UTC) and it tells the truth.

import { useEffect, useRef, useState } from "react";
import { fetchDeskHealth, remoteConfigured, type DeskHealth } from "@/lib/desk-remote";

// Today's World Cup match windows (devnet replay nominal kickoffs, UTC).
const KICKOFFS = [
  { label: "Ivory Coast v Norway", utc: Date.UTC(2026, 5, 30, 17, 0) },
  { label: "France v Sweden", utc: Date.UTC(2026, 5, 30, 21, 0) },
];
const MATCH_WINDOW_MS = 130 * 60_000; // a match + stoppage/settle tail
const ALIVE_MS = 60_000; // worker considered offline if no push within this

type Level = "ok" | "warn" | "bad" | "idle";
interface Verdict {
  level: Level;
  title: string;
  detail: string;
  action?: string;
}

function fmtDur(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60_000));
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}h ${m % 60}m` : `${m}m`;
}

function computeVerdict(now: number, h: DeskHealth | null, ratePerMin: number | null): Verdict {
  if (!remoteConfigured)
    return { level: "bad", title: "Not configured", detail: "NEXT_PUBLIC_SUPABASE_* is missing on this deployment." };
  if (!h)
    return {
      level: "bad",
      title: "No mirror data",
      detail: "Can't reach foil, or the worker has never pushed a meta row.",
      action: "On the box (54.229.238.5):  sudo systemctl restart linescout-worker",
    };

  const ageMs = now - h.updatedAt;
  if (ageMs >= ALIVE_MS)
    return {
      level: "bad",
      title: "Worker OFFLINE",
      detail: `Last push was ${Math.round(ageMs / 1000)}s ago; the worker process has stopped.`,
      action: "Restart:  ssh …54.229.238.5 → sudo systemctl restart linescout-worker",
    };

  const inWindow = KICKOFFS.find((k) => now >= k.utc && now <= k.utc + MATCH_WINDOW_MS);
  const upcoming = KICKOFFS.filter((k) => now < k.utc).sort((a, b) => a.utc - b.utc)[0];

  if (!inWindow) {
    if (upcoming)
      return {
        level: "idle",
        title: "Pre-game: worker healthy, idle (expected)",
        detail: `Next kickoff: ${upcoming.label} in ${fmtDur(upcoming.utc - now)}. The live book is quiet until the match airs, so 0 frames now is normal.`,
      };
    return {
      level: "idle",
      title: "No live match window: worker healthy",
      detail: `Idle outside match windows. Lifetime: ${h.totalIngested.toLocaleString()} frames, ${h.tradeCount} calls, ${h.stalls} stall cycles.`,
    };
  }

  const sinceKick = now - inWindow.utc;
  if (ratePerMin == null)
    return { level: "warn", title: "Measuring ingest rate…", detail: `In the ${inWindow.label} window, sampling a second reading to confirm frames are advancing.` };

  if (ratePerMin > 0)
    return {
      level: "ok",
      title: `LIVE: ingesting ${inWindow.label}`,
      detail: `${ratePerMin.toFixed(0)} frames/min · ${h.totalIngested.toLocaleString()} frames total · ${h.tradeCount} calls · ${h.agentsRunning}/${h.agentsTotal} agents running. Healthy.`,
    };

  if (sinceKick < 3 * 60_000)
    return {
      level: "warn",
      title: "Kickoff just happened, waiting for frames",
      detail: `${Math.round(sinceKick / 1000)}s since ${inWindow.label} kickoff and no frames yet. The book is bursty; a short lag is normal.`,
    };

  return {
    level: "bad",
    title: "ACTION NEEDED: worker alive but 0 live frames",
    detail: `${Math.round(sinceKick / 60_000)} min into ${inWindow.label} and ingestion is flat (total ${h.totalIngested.toLocaleString()}). The devnet TxLINE token is almost certainly stale/expired.`,
    action: "Refresh TXLINE_API_TOKEN in ~/linescout/worker/.env, then:  sudo systemctl restart linescout-worker",
  };
}

const STYLE: Record<Level, { ring: string; dot: string; word: string }> = {
  ok: { ring: "border-amber", dot: "bg-amber blink", word: "text-amber" },
  warn: { ring: "border-amber/50", dot: "bg-amber", word: "text-amber" },
  bad: { ring: "border-loss", dot: "bg-loss blink", word: "loss" },
  idle: { ring: "border-ink-600", dot: "bg-ink-500", word: "text-muted" },
};

export default function DeskHealth() {
  const [health, setHealth] = useState<DeskHealth | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [rate, setRate] = useState<number | null>(null);
  const [now, setNow] = useState<number>(() => 0);
  const prev = useRef<{ total: number; t: number } | null>(null);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      const h = await fetchDeskHealth();
      if (!alive) return;
      const t = Date.now();
      setNow(t);
      if (h) {
        if (prev.current && t > prev.current.t) {
          const dtMin = (t - prev.current.t) / 60_000;
          setRate(dtMin > 0 ? (h.totalIngested - prev.current.total) / dtMin : null);
        }
        prev.current = { total: h.totalIngested, t };
      }
      setHealth(h);
      setLoaded(true);
    };
    poll();
    const iv = setInterval(poll, 5000);
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      alive = false;
      clearInterval(iv);
      clearInterval(clock);
    };
  }, []);

  const v = computeVerdict(now || Date.now(), health, rate);
  const s = STYLE[v.level];
  const ageS = health ? Math.max(0, Math.round(((now || Date.now()) - health.updatedAt) / 1000)) : null;

  return (
    <div className="mx-auto max-w-3xl px-5 py-10">
      <div className="mb-6 flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">Worker health</h1>
        <a href="/desk" className="text-sm text-muted underline underline-offset-2 hover:text-fg">← desk</a>
      </div>

      {!loaded ? (
        <p className="card px-5 py-6 text-faint">checking…</p>
      ) : (
        <>
          {/* verdict banner */}
          <div className={`card border ${s.ring} px-5 py-5`}>
            <p className="flex items-center gap-2 text-xs uppercase tracking-wide">
              <span className={`inline-block h-2 w-2 rounded-full ${s.dot}`} />
              <span className={s.word}>{v.level === "ok" ? "healthy" : v.level === "idle" ? "idle" : v.level === "warn" ? "watch" : "attention"}</span>
            </p>
            <p className="mt-2 text-lg font-semibold">{v.title}</p>
            <p className="mt-1 text-sm text-muted">{v.detail}</p>
            {v.action && (
              <pre className="mt-3 overflow-x-auto rounded border border-ink-600 bg-ink-900/40 px-3 py-2 font-mono text-xs text-amber">
                {v.action}
              </pre>
            )}
          </div>

          {/* raw facts */}
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Fact label="last push" value={ageS == null ? "-" : `${ageS}s ago`} tone={ageS != null && ageS < 60 ? "gain" : "loss"} />
            <Fact label="ingest rate" value={rate == null ? "measuring…" : `${rate.toFixed(0)}/min`} tone={rate && rate > 0 ? "gain" : undefined} />
            <Fact label="frames ingested" value={health ? health.totalIngested.toLocaleString() : "-"} />
            <Fact label="calls" value={health ? String(health.tradeCount) : "-"} />
            <Fact label="stall cycles" value={health ? String(health.stalls) : "-"} />
            <Fact label="agents running" value={health ? `${health.agentsRunning}/${health.agentsTotal}` : "-"} />
          </div>

          <p className="mt-4 text-xs text-faint">
            source: EC2 worker → foil Supabase (read direct) · mode {health?.mode ?? "?"} · auto-refresh 5s · checked {new Date(now || Date.now()).toISOString().slice(11, 19)} UTC
          </p>
          <div className="mt-3 text-xs text-faint">
            <span className="label">kickoffs (UTC)</span>{" "}
            {KICKOFFS.map((k) => `${k.label} ${new Date(k.utc).toISOString().slice(11, 16)}`).join(" · ")}
          </div>
        </>
      )}
    </div>
  );
}

function Fact({ label, value, tone }: { label: string; value: string; tone?: "gain" | "loss" }) {
  return (
    <div className="card px-4 py-3">
      <p className="label">{label}</p>
      <p className={`mt-0.5 tabular-nums ${tone ?? ""}`}>{value}</p>
    </div>
  );
}
