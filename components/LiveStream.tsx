"use client";

// LIVE / REPLAY dual stream — one row per tick, showing BOTH the TxLINE fair and the market price
// side by side so the discrepancy is obvious. A row appears whenever either stream moves; the row
// glows orange in proportion to the gap.
//   LIVE   — reads the box blob (desk-archives/live-stream.json): two timestamped tick arrays.
//   REPLAY — plays back a settled match's 1s tape on a virtual clock.

import { useEffect, useMemo, useRef, useState } from "react";
import type { PickoffMatch } from "@/lib/pickoff-source";

const THETA = 0.05;
// a fixture is "live" only while its ticks are fresh; a settled match's last tick is hours old, so
// past this staleness window we drop it from Live mode (it stays available under Replay).
const LIVE_MAX_AGE = 10 * 60 * 1000;
// Poll the same-origin, Vercel-cached proxy, NOT Supabase directly. Fetching the ~52KB blob straight
// off Supabase every 3s with a cache-buster blew the storage egress budget; /api/live-stream caps it.
const STREAM_BLOB = "/api/live-stream";

interface StreamFix { fid: string; teams: string; txline: [number, number][]; market: [number, number][] }
interface Row { key: string; label: string; fair: number | null; pm: number | null }

const lastTick = (f: StreamFix) =>
  Math.max(f.txline.length ? f.txline[f.txline.length - 1][0] : 0, f.market.length ? f.market[f.market.length - 1][0] : 0);

// The stream's raw values are in the SECOND-named team's frame: P(participant 2 wins). The table shows
// BOTH sides by team name so a reader never has to know that convention: side 1 = 1 - value.
const teamNames = (teams: string): [string, string] => {
  const p = (teams || "").split(/\s+v\s+/i).map((t) => t.trim());
  return p.length === 2 ? [p[0], p[1]] : [teams || "side 1", "side 2"];
};
const code = (name: string) => name.slice(0, 3).toUpperCase();

function stepAt(arr: [number, number][], ts: number): number | null {
  let v: number | null = null;
  for (const [t, val] of arr) {
    if (t <= ts) v = val;
    else break;
  }
  return v;
}
const hhmmss = (ms: number) => new Date(ms).toISOString().slice(11, 19);

export default function LiveStream({ matches }: { matches: PickoffMatch[] }) {
  const replayable = matches.filter((m) => (m.series?.length ?? 0) > 2);
  const [mode, setMode] = useState<"live" | "replay">("live");

  // ---- LIVE ----
  const [fixtures, setFixtures] = useState<StreamFix[] | null>(null);
  const [liveFid, setLiveFid] = useState("");
  useEffect(() => {
    if (mode !== "live") return;
    let on = true;
    const load = () =>
      fetch(STREAM_BLOB)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (!on) return;
          const fx: StreamFix[] = d?.fixtures ?? [];
          setFixtures(fx);
          setLiveFid((cur) => cur || fx[0]?.fid || "");
        })
        .catch(() => on && setFixtures([]));
    load();
    const iv = setInterval(load, 10000);
    return () => { on = false; clearInterval(iv); };
  }, [mode]);

  // only fixtures still ticking count as live; settled matches drop out (they live under Replay)
  const liveFixtures = useMemo(() => (fixtures ?? []).filter((f) => Date.now() - lastTick(f) < LIVE_MAX_AGE), [fixtures]);
  const liveFx = liveFixtures.find((f) => f.fid === liveFid) ?? liveFixtures[0];
  const liveRows: Row[] = useMemo(() => {
    if (!liveFx) return [];
    const tsSet = new Set<number>();
    liveFx.txline.forEach(([t]) => tsSet.add(t));
    liveFx.market.forEach(([t]) => tsSet.add(t));
    return [...tsSet]
      .sort((a, b) => b - a)
      .slice(0, 140)
      .map((t) => ({ key: String(t), label: hhmmss(t) + " UTC", fair: stepAt(liveFx.txline, t), pm: stepAt(liveFx.market, t) }));
  }, [liveFx]);

  // ---- REPLAY ----
  const [fid, setFid] = useState(replayable[0]?.fid ?? "");
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(120);
  const [rTicks, setRTicks] = useState<Row[]>([]);
  const rIdx = useRef(0);
  const rm = replayable.find((m) => m.fid === fid) ?? replayable[0];
  useEffect(() => { setRTicks([]); rIdx.current = 0; }, [fid, mode]);
  useEffect(() => {
    if (mode !== "replay" || !rm || !playing) return;
    const series = rm.series;
    const iv = setInterval(() => {
      if (rIdx.current >= series.length) { setPlaying(false); return; }
      const [sec, fair, pm] = series[rIdx.current];
      rIdx.current += 1;
      if (fair == null) return;
      const mm = Math.floor(sec / 60);
      const ss = sec % 60;
      setRTicks((prev) => [{ key: `r${rIdx.current}`, label: `${mm}:${String(ss).padStart(2, "0")}`, fair, pm }, ...prev].slice(0, 140));
    }, speed);
    return () => clearInterval(iv);
  }, [mode, rm, playing, speed]);

  const rows = mode === "live" ? liveRows : rTicks;
  const latest = rows[0];
  const latestGap = latest && latest.fair != null && latest.pm != null ? latest.fair - latest.pm : null;
  const [team1, team2] = teamNames(mode === "live" ? (liveFx?.teams ?? "") : (rm?.teams ?? ""));
  // gap is in team2's frame (fair - market): positive = team2's side cheap, negative = team1's side cheap
  const cheapText = (gap: number | null) =>
    gap == null || Math.abs(gap) < 0.005 ? "—" : `${code(gap > 0 ? team2 : team1)} +${(Math.abs(gap) * 100).toFixed(1)}pp`;

  return (
    <div className="card overflow-hidden p-0">
      <div className="flex flex-wrap items-center gap-3 border-b border-ink-600 px-4 py-3">
        <div className="flex gap-1 text-sm">
          {(["live", "replay"] as const).map((mt) => (
            <button key={mt} onClick={() => setMode(mt)} className={`rounded px-3 py-1 ${mode === mt ? "bg-amber/20 text-amber" : "text-muted hover:text-fg"}`}>
              {mt === "live" ? "● Live" : "Replay"}
            </button>
          ))}
        </div>
        {mode === "replay" ? (
          <div className="flex flex-wrap items-center gap-3">
            <select value={fid} onChange={(e) => setFid(e.target.value)} className="rounded border border-ink-600 bg-transparent px-2 py-1 text-sm text-fg">
              {replayable.map((m) => (<option key={m.fid} value={m.fid} className="bg-ink-800">{m.teams}</option>))}
            </select>
            <button onClick={() => setPlaying((p) => !p)} className="rounded border border-ink-600 px-2 py-1 text-xs text-muted hover:text-fg">{playing ? "❙❙ pause" : "▶ play"}</button>
            <button onClick={() => { setRTicks([]); rIdx.current = 0; setPlaying(true); }} className="rounded border border-ink-600 px-2 py-1 text-xs text-muted hover:text-fg">⟲ restart</button>
            <div className="flex gap-1 text-xs">
              {[240, 120, 40].map((s) => (<button key={s} onClick={() => setSpeed(s)} className={`rounded px-1.5 py-1 ${speed === s ? "text-amber" : "text-faint hover:text-fg"}`}>{s === 240 ? "1x" : s === 120 ? "2x" : "6x"}</button>))}
            </div>
          </div>
        ) : fixtures == null ? (
          <span className="text-xs text-faint">connecting to the detector…</span>
        ) : liveFx ? (
          <div className="flex flex-wrap items-center gap-3 text-xs">
            {liveFixtures.length > 1 && (
              <select value={liveFid} onChange={(e) => setLiveFid(e.target.value)} className="rounded border border-ink-600 bg-transparent px-2 py-1 text-fg">
                {liveFixtures.map((f) => (<option key={f.fid} value={f.fid} className="bg-ink-800">{f.teams}</option>))}
              </select>
            )}
            <span className="serif text-sm text-paper">{liveFx.teams}</span>
            {latest && (
              <span className="font-mono text-faint">
                cheap side:{" "}
                <span className={latestGap != null && Math.abs(latestGap) >= THETA ? "text-amber" : "text-muted"}>
                  {cheapText(latestGap)}
                </span>
              </span>
            )}
          </div>
        ) : (
          <span className="text-xs text-faint">waiting for next match · the feed fills at kickoff</span>
        )}
      </div>

      <div className="max-h-[440px] overflow-y-auto px-4 py-3 font-mono text-xs">
        <div className="mb-1 grid grid-cols-[5rem_1fr_1fr_1fr_1fr_6rem] gap-2 text-faint">
          <span />
          <span className="col-span-2 text-paper">{team1}</span>
          <span className="col-span-2 text-paper">{team2}</span>
          <span />
        </div>
        <div className="mb-2 grid grid-cols-[5rem_1fr_1fr_1fr_1fr_6rem] gap-2 text-faint">
          <span>time</span><span>fair</span><span>market</span><span>fair</span><span>market</span><span className="text-right">cheap side</span>
        </div>
        {rows.length === 0 ? (
          <p className="text-faint">{mode === "live" ? (liveFx ? "waiting for the first tick…" : "waiting for the next match to kick off…") : "press play to stream the match…"}</p>
        ) : (
          <ul>
            {rows.map((r) => {
              const gap = r.fair != null && r.pm != null ? r.fair - r.pm : null; // team2's frame
              const mag = gap != null ? Math.abs(gap) : 0; // either side cheap = a lag worth seeing
              const tint = Math.min(mag / 0.1, 1) * 0.26;
              return (
                <li
                  key={r.key}
                  className="grid grid-cols-[5rem_1fr_1fr_1fr_1fr_6rem] gap-2 border-t border-ink-800 py-1"
                  style={mag >= 0.005 ? { backgroundColor: `rgba(217,119,6,${tint.toFixed(3)})` } : undefined}
                >
                  <span className="text-faint">{r.label}</span>
                  <span className="text-amber">{r.fair != null ? (1 - r.fair).toFixed(3) : "—"}</span>
                  <span className="text-muted">{r.pm != null ? (1 - r.pm).toFixed(3) : "—"}</span>
                  <span className="text-amber">{r.fair != null ? r.fair.toFixed(3) : "—"}</span>
                  <span className="text-muted">{r.pm != null ? r.pm.toFixed(3) : "—"}</span>
                  <span className={`text-right ${mag >= 0.02 ? "text-amber" : "text-faint"}`}>{cheapText(gap)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
