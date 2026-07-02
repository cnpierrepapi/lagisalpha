"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import AgentBuilder from "@/components/AgentBuilder";
import {
  fetchRemoteSnapshot,
  fetchArchived,
  sendRemoteControl,
  remoteConfigured,
  type RemoteSnapshot,
  type ArchivedMatch,
} from "@/lib/desk-remote";

interface Activity {
  type: "trade" | "settle" | "matchEvent";
  ts: number;
  agentId?: string;
  agentName?: string;
  text: string;
  pnl?: number;
}

interface AgentView {
  id: string;
  name: string;
  title: string;
  edgeKinds: string[];
  status: "running" | "paused" | "stopped";
  bankroll: number;
  startBankroll: number;
  dayPnl: number;
  bets: number;
  wins: number;
  losses: number;
  openPositions: number;
  unrealized: number;
}

interface Proof {
  signedOnSolana: boolean;
  cluster: string;
  signupTx: string | null;
  explorerUrl: string | null;
}

interface MatchProv {
  fid: string;
  label: string;
  oddsFrames: number;
  scoreFrames: number;
  ingested: number;
}

interface Trade {
  ts: number;
  agentId: string;
  agent: string;
  kind: string;
  match: string;
  side: string;
  direction: string;
  odds: number;
  stake: number;
  proofHash: string;
  status: string;
  clvReturn: number;
  pnl: number;
  exitOdds?: number | null;
  exitProofHash?: string | null;
}

interface Snapshot {
  mode: string;
  status: string;
  proof?: Proof;
  provenance?: MatchProv[];
  totalIngested?: number;
  trades?: Trade[];
  agents: AgentView[];
}

// ---- live TxLINE frames (current match) --------------------------------
interface LiveFrame {
  market: string;
  line: string;
  priceNames: string[];
  fairProbs: number[];
  ageSec: number;
}
interface LiveFixture {
  fid: number | string;
  label: string;
  latestAgeSec: number;
  frames: LiveFrame[];
}
interface LiveData {
  configured: boolean;
  liveCount?: number;
  totalFrames?: number;
  fixtures?: LiveFixture[];
  note?: string;
}

function tradeToActivity(t: Trade): Activity {
  if (t.status === "settled") {
    const move = t.exitOdds != null ? ` — ${Number(t.odds).toFixed(2)}→${Number(t.exitOdds).toFixed(2)}` : "";
    return {
      type: "settle",
      ts: t.ts,
      agentId: t.agentId,
      agentName: t.agent,
      pnl: t.pnl,
      text: `${t.agent} graded ${t.side} at close${move} · CLV ${(t.clvReturn * 100).toFixed(1)}%`,
    };
  }
  return {
    type: "trade",
    ts: t.ts,
    agentId: t.agentId,
    agentName: t.agent,
    text: `${t.agent} flagged ${t.side} mispriced @ ${Number(t.odds).toFixed(2)} on ${t.match} (${t.kind}) · frame ${t.proofHash}`,
  };
}

function clock(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour12: false });
}
function glyph(a: Activity): string {
  if (a.type === "trade") return "⚡";
  if (a.type === "matchEvent") return "⚽";
  return (a.pnl ?? 0) >= 0 ? "✓" : "✕";
}
function lineColor(a: Activity): string {
  if (a.type === "trade") return "text-amber";
  if (a.type === "matchEvent") return "text-muted";
  return (a.pnl ?? 0) >= 0 ? "gain" : "loss";
}

export default function Desk() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [feed, setFeed] = useState<Activity[]>([]);
  const [connected, setConnected] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [remote, setRemote] = useState<RemoteSnapshot | null>(null);
  const [live, setLive] = useState<LiveData | null>(null);
  const [archived, setArchived] = useState<ArchivedMatch[]>([]);
  const [paper, setPaper] = useState<string | null>(null);
  const [justDeployed, setJustDeployed] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const remoteLiveRef = useRef(false);

  // Pre-attach a paper if arriving from /papers ("Build agent →" → /desk?paper=id).
  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get("paper");
    if (p) setPaper(p);
  }, []);

  // EC2 worker mirror (foil Supabase, read direct).
  useEffect(() => {
    if (!remoteConfigured) return;
    let alive = true;
    const poll = async () => {
      const r = await fetchRemoteSnapshot();
      if (alive) setRemote(r);
    };
    poll();
    const iv = setInterval(poll, 5000);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, []);

  // Current match — real-time TxLINE frames, polled server-side (works on Vercel).
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const r = await fetch("/api/live-frames", { cache: "no-store" });
        const j = (await r.json()) as LiveData;
        if (alive) setLive(j);
      } catch {
        /* keep last */
      }
    };
    poll();
    const iv = setInterval(poll, 5000);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, []);

  // Archived matches — the corpus behind the "no match → history" view.
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      const a = await fetchArchived(50);
      if (alive) setArchived(a);
    };
    poll();
    const iv = setInterval(poll, 30000);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, []);

  useEffect(() => {
    const es = new EventSource("/api/feed");
    esRef.current = es;
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.addEventListener("snapshot", (e) => {
      try {
        const s = JSON.parse((e as MessageEvent).data) as Snapshot;
        setSnap(s);
        setFeed((prev) => {
          if (prev.length || !s.trades?.length) return prev;
          return s.trades.slice(0, 100).map(tradeToActivity);
        });
      } catch {
        /* ignore */
      }
    });
    es.addEventListener("activity", (e) => {
      try {
        const a = JSON.parse((e as MessageEvent).data) as Activity;
        setFeed((prev) => [a, ...prev].slice(0, 100));
      } catch {
        /* ignore */
      }
    });
    return () => es.close();
  }, []);

  async function control(id: string, op: "pause" | "resume" | "stop") {
    const next = op === "pause" ? "paused" : op === "resume" ? "running" : "stopped";
    setSnap((prev) =>
      prev
        ? { ...prev, agents: prev.agents.map((a) => (a.id === id ? { ...a, status: next as AgentView["status"] } : a)) }
        : prev,
    );
    setRemote((prev) =>
      prev
        ? { ...prev, agents: prev.agents.map((a) => (a.id === id ? { ...a, status: next as AgentView["status"] } : a)) }
        : prev,
    );
    try {
      if (remoteLiveRef.current) {
        await sendRemoteControl(id, op);
      } else {
        await fetch("/api/agents", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "control", id, op }),
        });
      }
    } catch {
      /* the next snapshot/poll will restore the true state */
    }
  }

  const remoteLive = !!remote?.fresh;
  const useRemote = !!remote && (remote.agents.length > 0 || remote.trades.length > 0);
  remoteLiveRef.current = remoteLive;

  const agents: AgentView[] = useRemote ? remote!.agents : snap?.agents ?? [];
  const baseFeed: Activity[] = useRemote ? remote!.trades.map(tradeToActivity) : feed;
  const proof = (useRemote ? remote!.proof : snap?.proof) as Snapshot["proof"];

  // Is a World Cup match actually in-play right now? The live-frames poll hits the
  // TxLINE snapshot server-side, so this is the authoritative "match on" signal —
  // it drives the whole page's live-vs-history branch.
  const liveFixtures = live?.fixtures ?? [];
  const liveMatchOn = (live?.liveCount ?? 0) > 0;
  const liveFrameCount = live?.totalFrames ?? 0;

  const selectedName = selected ? agents.find((a) => a.id === selected)?.name ?? null : null;
  const shownFeed = selected ? baseFeed.filter((a) => a.agentId === selected || a.type === "matchEvent") : baseFeed;

  // CLV scorecard (absorbs the retired Tournament): rank forecasters by average
  // CLV over settled calls, hit-rate as tie-break.
  const rawTrades = remoteLive ? remote!.trades : snap?.trades ?? [];
  const settled = rawTrades.filter((t) => t.status === "settled");
  const clvByAgent = new Map<string, { sum: number; n: number }>();
  for (const t of settled) {
    const e = clvByAgent.get(t.agentId) ?? { sum: 0, n: 0 };
    e.sum += t.clvReturn;
    e.n += 1;
    clvByAgent.set(t.agentId, e);
  }
  const avgClvAll = settled.length ? settled.reduce((s, t) => s + t.clvReturn, 0) / settled.length : 0;
  const totWins = agents.reduce((s, a) => s + a.wins, 0);
  const totLosses = agents.reduce((s, a) => s + a.losses, 0);
  const hitRateAll = totWins + totLosses ? totWins / (totWins + totLosses) : 0;
  const running = agents.filter((a) => a.status === "running").length;
  const open = agents.reduce((s, a) => s + a.openPositions, 0);

  const ranked = useMemo(() => {
    return [...agents]
      .map((a) => {
        const c = clvByAgent.get(a.id);
        const avgClv = c && c.n ? c.sum / c.n : 0;
        const n = a.wins + a.losses;
        return { ...a, avgClv, hitRate: n ? a.wins / n : 0, sampleN: c?.n ?? n };
      })
      .sort((x, y) => y.avgClv - x.avgClv || y.hitRate - x.hitRate || y.sampleN - x.sampleN);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agents, settled.length]);

  return (
    <div className="mx-auto max-w-7xl px-5 py-6">
      {/* aggregate strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="avg clv" value={`${(avgClvAll * 100).toFixed(1)}%`} tone={avgClvAll >= 0 ? "gain" : "loss"} />
        <Stat label="clv hit-rate" value={`${(hitRateAll * 100).toFixed(0)}%`} />
        <Stat label="agents" value={`${running} running`} />
        <Stat label="open calls" value={`${open}`} />
        <div className="card flex items-center justify-between px-4 py-3">
          <span className="label">match</span>
          <span className="flex items-center gap-2 text-sm">
            <span className={`inline-block h-2 w-2 rounded-full ${liveMatchOn ? "bg-amber blink" : "bg-ink-500"}`} />
            {liveMatchOn ? "live" : "none"}
          </span>
        </div>
      </div>

      {/* CURRENT MATCH — the live book being ingested in real time */}
      <section className="panel mt-5">
        <header className="flex items-center justify-between border-b border-ink-600 px-5 py-3">
          <div>
            <p className="label">current match</p>
            <p className="text-sm text-muted">
              {liveMatchOn
                ? `${liveFixtures.length} match${liveFixtures.length > 1 ? "es" : ""} in-play · ${liveFrameCount} live market frame${liveFrameCount === 1 ? "" : "s"} ingesting`
                : "no World Cup match is in-play right now"}
            </p>
          </div>
          <span className="flex items-center gap-2 text-xs">
            <span className={`inline-block h-2 w-2 rounded-full ${liveMatchOn ? "bg-amber blink" : "bg-ink-500"}`} />
            {liveMatchOn ? "INGESTING · TxLINE" : "idle"}
          </span>
        </header>

        {live && !live.configured ? (
          <p className="px-5 py-4 text-sm text-faint">Live frames unavailable — no TxLINE token configured in this environment.</p>
        ) : liveMatchOn ? (
          <div className="grid grid-cols-1 gap-3 p-4 lg:grid-cols-2">
            {liveFixtures.map((f) => (
              <div key={f.fid} className="card p-4">
                <div className="flex items-center justify-between">
                  <p className="serif text-paper">{f.label}</p>
                  <span className={`text-xs tabular-nums ${f.latestAgeSec < 10 ? "gain" : "text-faint"}`}>
                    {f.latestAgeSec < 10 ? "● " : ""}freshest {f.latestAgeSec}s ago
                  </span>
                </div>
                <table className="mt-3 w-full text-left text-xs">
                  <tbody className="font-mono">
                    {f.frames.map((fr, i) => (
                      <tr key={i} className="border-t border-ink-700">
                        <td className="py-1 pr-2 text-muted">
                          {fr.market}
                          {fr.line ? <span className="text-faint"> {fr.line}</span> : null}
                        </td>
                        <td className="py-1 pr-2 text-fg">
                          {fr.priceNames.map((n, j) => (
                            <span key={j} className="mr-2 whitespace-nowrap">
                              <span className="text-faint">{n}</span> {fr.fairProbs[j]?.toFixed(3)}
                            </span>
                          ))}
                        </td>
                        <td className={`py-1 text-right tabular-nums ${fr.ageSec < 10 ? "gain" : "text-faint"}`}>{fr.ageSec}s</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        ) : (
          <div className="px-5 py-6">
            <p className="text-sm text-muted">
              {live?.note ?? "Odds are live-only, so frames appear the moment a match kicks off."} When a match is on, its
              book streams here in real time and you can deploy a forecaster to trade it live.
            </p>
            {archived.length > 0 && (
              <div className="mt-4">
                <p className="label mb-2">recorded matches — archived for replay</p>
                <div className="flex flex-wrap gap-2">
                  {archived.map((m) => (
                    <span
                      key={m.fixtureId}
                      className="card flex items-center gap-2 px-3 py-1.5 text-xs"
                      title={`${m.oddsFrames} odds + ${m.scoreFrames} score frames archived${m.cluster ? ` · ${m.cluster}` : ""}`}
                    >
                      <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber" />
                      <span className="text-fg">{m.label}</span>
                      <span className="text-faint tabular-nums">{m.oddsFrames.toLocaleString()} odds</span>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {/* DEPLOY — build a forecaster for the live match, right here */}
      <section className="panel mt-5">
        <header className="flex items-center justify-between border-b border-ink-600 px-5 py-3">
          <div>
            <p className="label">deploy a forecaster</p>
            <p className="text-sm text-muted">
              {liveMatchOn
                ? "Build one and deploy it against the match on now — watch it call the live book below."
                : "Build one now; it deploys to the runner and starts forecasting the moment a match kicks off."}
            </p>
          </div>
          {justDeployed && (
            <span className="text-xs gain">✓ deployed {justDeployed} — appearing below</span>
          )}
        </header>
        <div className="p-5">
          <AgentBuilder initialPaper={paper} embedded onDeployed={(n) => setJustDeployed(n)} />
        </div>
      </section>

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-12">
        {/* HERO — live activity / call history */}
        <section className="panel order-2 flex min-h-[55vh] flex-col lg:order-1 lg:col-span-8">
          <header className="flex items-center justify-between border-b border-ink-600 px-5 py-3">
            <div>
              <p className="label">{liveMatchOn ? "live activity" : "call history"}</p>
              <p className="text-sm text-muted">
                {selectedName ? (
                  <>
                    filtered to <span className="text-fg">{selectedName}</span> —{" "}
                    <button onClick={() => setSelected(null)} className="amber underline underline-offset-2 hover:text-fg">
                      show all
                    </button>
                  </>
                ) : liveMatchOn ? (
                  "forecasters calling the live match autonomously — no human in the loop"
                ) : (
                  "past forecasts from the recorded matches — deploy a forecaster to add to the record"
                )}
              </p>
            </div>
            <span className="flex items-center gap-2 text-xs">
              <span className={`inline-block h-2 w-2 rounded-full ${liveMatchOn ? "bg-amber blink" : "bg-ink-500"}`} />
              {liveMatchOn ? "LIVE" : useRemote ? "RECORDED" : connected ? "REPLAY" : "connecting"}
            </span>
          </header>

          <div className="min-w-0 flex-1 overflow-y-auto px-5 py-4 font-mono text-sm">
            <p className="prompt mb-3 text-faint">
              tail -f {selectedName ? `desk.log | grep '${selectedName}'` : "desk.log"}
              <span className="blink ml-1 amber">_</span>
            </p>
            {shownFeed.length === 0 && (
              <p className="text-faint">
                {selected
                  ? "no activity for this agent yet…"
                  : liveMatchOn
                    ? "waiting for the first edge to fire…"
                    : "no calls yet — deploy a forecaster to start the record."}
              </p>
            )}
            <ul className="space-y-1.5">
              {shownFeed.map((a, i) => (
                <li key={`${a.ts}-${i}`} className="flex gap-3">
                  <span className="shrink-0 text-faint tabular-nums">{clock(a.ts)}</span>
                  <span className={`shrink-0 ${lineColor(a)}`}>{glyph(a)}</span>
                  <span className={a.type === "matchEvent" ? "text-muted" : "text-fg"}>{a.text}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* SIDEBAR — forecasters ranked by CLV */}
        <aside className="order-1 space-y-3 lg:order-2 lg:col-span-4">
          <div className="flex items-center justify-between px-1">
            <p className="label">forecasters · by clv</p>
            {proof?.signedOnSolana && (
              <a
                href={proof.explorerUrl ?? "#"}
                target="_blank"
                rel="noreferrer"
                className="text-xs amber underline decoration-ink-500 underline-offset-2 hover:text-fg"
                title={`access signed on Solana (${proof.cluster})`}
              >
                ✓ on-chain
              </a>
            )}
          </div>
          {ranked.length === 0 && (
            <p className="card px-4 py-3 text-sm text-faint">
              no forecasters yet — deploy one above and it appears here.
            </p>
          )}
          {ranked.map((a, rank) => {
            const cs = clvByAgent.get(a.id);
            const avgClv = cs && cs.n ? cs.sum / cs.n : 0;
            const settledN = a.wins + a.losses;
            const hitRate = settledN ? a.wins / settledN : 0;
            return (
              <div
                key={a.id}
                onClick={() => setSelected((cur) => (cur === a.id ? null : a.id))}
                className={`card cursor-pointer p-4 transition-colors ${
                  selected === a.id ? "ring-1 ring-amber" : "hover:border-ink-500"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 font-semibold">
                      <span className={`font-mono text-xs ${rank === 0 ? "amber" : "text-faint"}`}>#{rank + 1}</span>
                      <span
                        className={`inline-block h-2 w-2 rounded-full ${
                          a.status === "running" ? "bg-amber" : a.status === "paused" ? "bg-ink-500" : "bg-loss"
                        }`}
                      />
                      {a.name}
                    </p>
                    <p className="serif mt-0.5 truncate text-sm text-muted">{a.title}</p>
                  </div>
                  <span className="label shrink-0 rounded border border-ink-600 px-1.5 py-0.5">
                    {(a.edgeKinds ?? []).join("·")}
                  </span>
                </div>

                <div className="mt-3 flex items-end justify-between">
                  <div>
                    <p className="label">avg clv</p>
                    <p className={`text-lg tabular-nums ${avgClv >= 0 ? "gain" : "loss"}`}>
                      {cs && cs.n ? `${(avgClv * 100).toFixed(1)}%` : "—"}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="label">hit-rate</p>
                    <p className="tabular-nums">{settledN ? `${(hitRate * 100).toFixed(0)}%` : "—"}</p>
                  </div>
                </div>

                <div className="mt-2 flex items-center justify-between text-xs text-faint">
                  <span>
                    {a.wins} hit / {a.losses} miss · {a.bets} calls
                  </span>
                  <span>open {a.openPositions}</span>
                </div>

                <div className="mt-3 flex gap-2">
                  {a.status === "running" ? (
                    <button onClick={(e) => { e.stopPropagation(); control(a.id, "pause"); }} className="flex-1 rounded border border-ink-600 py-1 text-xs text-muted hover:text-fg">
                      pause
                    </button>
                  ) : a.status === "paused" ? (
                    <button onClick={(e) => { e.stopPropagation(); control(a.id, "resume"); }} className="flex-1 rounded border border-ink-600 py-1 text-xs text-amber hover:text-fg">
                      resume
                    </button>
                  ) : (
                    <span className="flex-1 py-1 text-center text-xs text-faint">stopped</span>
                  )}
                  {a.status !== "stopped" && (
                    <button onClick={(e) => { e.stopPropagation(); control(a.id, "stop"); }} className="rounded border border-ink-600 px-3 py-1 text-xs text-muted hover:text-loss">
                      stop
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </aside>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "gain" | "loss" }) {
  return (
    <div className="card px-4 py-3">
      <p className="label">{label}</p>
      <p className={`mt-0.5 text-lg tabular-nums ${tone ?? ""}`}>{value}</p>
    </div>
  );
}
