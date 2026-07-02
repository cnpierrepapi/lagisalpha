"use client";

import { useEffect, useRef, useState } from "react";

// The hero tape shows the PRODUCT: real line-integrity signals from the control-room
// endpoint (deterministic snapshot over real captured TxLINE frames) — each one a
// signal, the stale-book gap, and the action the operator's policy chose. We reveal
// them one at a time so a static snapshot reads like a live desk.
interface CREvent {
  ts: number;
  minute: number | null;
  market: string;
  kind: "steam" | "overreaction" | "pregoal_warning";
  gapBps: number | null;
  pickoffRisk: string;
  signalAction: string;
  operatorAction: string;
}

const KIND_COLOR: Record<string, string> = {
  overreaction: "loss",
  steam: "amber",
  pregoal_warning: "text-muted",
};
function actionColor(a: string): string {
  if (a === "fade") return "loss";
  if (a === "follow") return "amber";
  return "text-muted"; // hold / suspend-suggested
}
function shortMarket(m: string): string {
  return m
    .replace("OVERUNDER_PARTICIPANT_GOALS", "O/U")
    .replace("ASIANHANDICAP_PARTICIPANT_GOALS", "AH")
    .replace("line=", "");
}

export default function HeroTerminal() {
  const [events, setEvents] = useState<CREvent[]>([]);
  const [shown, setShown] = useState<CREvent[]>([]);
  const [loaded, setLoaded] = useState(false);
  const idx = useRef(0);

  useEffect(() => {
    let alive = true;
    fetch("/api/v1/control-room", { headers: { "X-Api-Key": "ag_demo_2026" } })
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        const evs: CREvent[] = (j.events ?? []).filter((e: CREvent) => e.kind === "overreaction" || e.pickoffRisk === "high");
        setEvents(evs.length ? evs : (j.events ?? []));
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
    return () => {
      alive = false;
    };
  }, []);

  // reveal one signal at a time, looping
  useEffect(() => {
    if (!events.length) return;
    const iv = setInterval(() => {
      const e = events[idx.current % events.length];
      idx.current += 1;
      setShown((prev) => [e, ...prev].slice(0, 7));
    }, 1400);
    return () => clearInterval(iv);
  }, [events]);

  return (
    <div className="panel overflow-hidden">
      <header className="flex items-center justify-between border-b border-ink-600 px-4 py-2.5">
        <span className="label">signals.log · Brazil v Japan</span>
        <span className="flex items-center gap-2 text-xs text-faint">
          <span className={`inline-block h-2 w-2 rounded-full ${loaded ? "bg-amber blink" : "bg-ink-500"}`} />
          {loaded ? "REPLAY" : "loading"}
        </span>
      </header>
      <div className="min-h-[240px] px-4 py-3 font-mono text-xs">
        {shown.length === 0 && <p className="text-faint">benchmarking against the demargined consensus…</p>}
        <ul className="space-y-2">
          {shown.map((e, i) => (
            <li key={`${e.ts}-${i}`} className="leading-relaxed">
              <span className="text-faint tabular-nums">{e.minute != null ? `${e.minute}'` : "—"}</span>{" "}
              <span className="text-muted">{shortMarket(e.market)}</span>{" "}
              <span className={KIND_COLOR[e.kind] ?? "text-muted"}>{e.kind}</span>{" "}
              <span className="text-faint">→</span>{" "}
              <span className={actionColor(e.signalAction)}>{e.signalAction}</span>
              {e.gapBps != null && (
                <span className="text-faint"> · book {e.gapBps > 0 ? "+" : ""}{e.gapBps}bps stale</span>
              )}
              <br />
              <span className="text-faint">└ operator:</span>{" "}
              <span className="text-fg">{e.operatorAction}</span>
            </li>
          ))}
        </ul>
        <p className="prompt mt-2 text-faint">
          <span className="blink amber">_</span>
        </p>
      </div>
    </div>
  );
}
