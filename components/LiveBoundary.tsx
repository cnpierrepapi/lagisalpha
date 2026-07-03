"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { classifyEdge } from "@/lib/signals/classify.mjs";
import { evaluatePolicy, describeAction } from "@/lib/signals/policy.mjs";

// LIVE LINE-INTEGRITY SANDBOX — the demo, made interactive.
//
// You DEPLOY a naive book (set how stale it is), you EDIT the operator's policy, and you
// watch OUR real classifier catch the discrepancies against THAT book with THAT policy.
// Nothing here is faked: classifyEdge + evaluatePolicy are the exact pure functions the
// production engine and /api/v1 routes run — lifted into React state so a slider drag
// changes the very numbers an operator would see. The deployed app can't hold an SSE open,
// so the browser polls the live snapshot and holds the per-market history itself.

const POLL_MS = 4000;
const STEAM = 0.04; // pp move over the window = steam (mirrors engine DEFAULTS)
const OVERREACTION = 0.08; // pp swing near a goal = overreaction
const WINDOW_MS = 90_000; // look-back window for a move
const GOAL_WINDOW_MS = 150_000; // a move this soon after a goal is an overreaction
const COOLDOWN_MS = 90_000; // don't re-fire the same market+kind
const HIST_MS = 300_000;

// naive-book controls (deployable)
const LAG_MIN = 2_000;
const LAG_MAX = 30_000;
const LAG_DEFAULT = 8_000;
const SPREAD_MAX = 300; // bps of simulated soft-book vig, on top of the stale price

interface FrameOut {
  market: string;
  line: string;
  period: string;
  priceNames: string[];
  fairProbs: number[];
  ts: number;
  ageSec: number;
}
interface FixtureOut {
  fid: number | string;
  label: string;
  minute: number | null;
  goals: { p1: number; p2: number };
  latestAgeSec: number;
  frames: FrameOut[];
}
// the classifier's output shape (subset we render)
interface Sig {
  market: string;
  kind: string;
  action: string;
  confidence: number;
  pRef: number;
  pWatched: number | null;
  gapBps: number | null;
  pickoffRisk: string;
  note: string;
}
interface StoredSig {
  ts: number;
  match: string;
  minute: number | null;
  sig: Sig;
}

// one editable policy rule in the UI
interface UiRule {
  id: number;
  kind: string; // "" = any
  minConfidence: string; // "" = none
  pickoffRisk: string; // "" = any
  minGapBps: string; // "" = none
  do: "widen_margin" | "cut_limit" | "suspend" | "none";
  pct: string; // marginPct / limitPct
}

const KIND_COLOR: Record<string, string> = { overreaction: "loss", steam: "amber", pregoal_warning: "text-muted" };
function actionColor(a: string): string {
  return a === "fade" ? "loss" : a === "follow" ? "amber" : "text-muted";
}
function riskColor(r: string): string {
  return r === "high" ? "loss" : r === "med" ? "amber" : "text-faint";
}
function shortMarket(m: string, line?: string): string {
  const s = m.replace("OVERUNDER_PARTICIPANT_GOALS", "O/U").replace("ASIANHANDICAP_PARTICIPANT_GOALS", "AH");
  return line ? `${s} ${String(line).replace("line=", "")}` : s;
}
function clock(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour12: false });
}
function valueAt(buf: { ts: number; prob: number }[], target: number): number | null {
  let best: number | null = null;
  for (const e of buf) {
    if (e.ts <= target) best = e.prob;
    else break;
  }
  return best;
}

// the demo policy, expressed as editable UI rules (starting point; user mutates it)
let RID = 0;
const rid = () => ++RID;
function defaultRules(): UiRule[] {
  return [
    { id: rid(), kind: "overreaction", minConfidence: "0.7", pickoffRisk: "", minGapBps: "", do: "widen_margin", pct: "4" },
    { id: rid(), kind: "overreaction", minConfidence: "", pickoffRisk: "", minGapBps: "", do: "cut_limit", pct: "50" },
    { id: rid(), kind: "steam", minConfidence: "", pickoffRisk: "high", minGapBps: "", do: "cut_limit", pct: "60" },
  ];
}

// UI rules → the policy object evaluatePolicy() consumes (drops empty clauses).
function toPolicy(rules: UiRule[]) {
  return {
    rules: rules.map((r) => {
      const when: Record<string, unknown> = {};
      if (r.kind) when.kind = r.kind;
      if (r.minConfidence !== "") when.minConfidence = Number(r.minConfidence);
      if (r.pickoffRisk) when.pickoffRisk = r.pickoffRisk;
      if (r.minGapBps !== "") when.minGapBps = Number(r.minGapBps);
      const then: Record<string, unknown> = { do: r.do };
      if (r.do === "widen_margin") then.marginPct = Number(r.pct) || 0;
      if (r.do === "cut_limit") then.limitPct = Number(r.pct) || 0;
      return { when, then };
    }),
    default: { do: "none" },
  };
}

export default function LiveBoundary() {
  const [fixtures, setFixtures] = useState<FixtureOut[]>([]);
  const [configured, setConfigured] = useState(true);
  const [connected, setConnected] = useState(false);
  const [signals, setSignals] = useState<StoredSig[]>([]);

  // deployable naive book + editable policy (the sandbox controls)
  const [lagMs, setLagMs] = useState(LAG_DEFAULT);
  const [spreadBps, setSpreadBps] = useState(0);
  const [rules, setRules] = useState<UiRule[]>(defaultRules);

  // refs so the poll closure always reads the latest book settings
  const lagRef = useRef(lagMs);
  const spreadRef = useRef(spreadBps);
  useEffect(() => void (lagRef.current = lagMs), [lagMs]);
  useEffect(() => void (spreadRef.current = spreadBps), [spreadBps]);

  const hist = useRef(new Map<string, { ts: number; prob: number }[]>());
  const lastGoals = useRef(new Map<string, { p1: number; p2: number }>());
  const goalAt = useRef(new Map<string, number>());
  const cooldown = useRef(new Map<string, number>());

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const r = await fetch("/api/live-signals", { cache: "no-store" });
        const j = await r.json();
        if (!alive) return;
        setConfigured(j.configured !== false);
        setConnected(true);
        const fx: FixtureOut[] = j.fixtures ?? [];
        setFixtures(fx);
        detect(fx);
      } catch {
        setConnected(false);
      }
    };
    poll();
    const iv = setInterval(poll, POLL_MS);
    return () => {
      alive = false;
      clearInterval(iv);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // the naive book's shown prob = the fair line `lag` ago, shaded away from fair by `spread`.
  function bookProb(buf: { ts: number; prob: number }[], now: number, pRef: number): number | null {
    const lagged = valueAt(buf, now - lagRef.current);
    if (lagged == null) return null;
    if (spreadRef.current <= 0) return lagged;
    // a soft book with margin sits further from fair — amplify the existing staleness.
    const dir = lagged >= pRef ? 1 : -1;
    return lagged + (dir * spreadRef.current) / 10000;
  }

  function detect(fx: FixtureOut[]) {
    const fresh: StoredSig[] = [];
    for (const f of fx) {
      const fid = String(f.fid);
      // goal change → mark an overreaction window
      const prev = lastGoals.current.get(fid);
      if (prev && (f.goals.p1 > prev.p1 || f.goals.p2 > prev.p2)) goalAt.current.set(fid, Date.now());
      lastGoals.current.set(fid, f.goals);
      const goalRecent = (goalAt.current.get(fid) ?? 0) > 0 && Date.now() - (goalAt.current.get(fid) ?? 0) <= GOAL_WINDOW_MS;

      for (const fr of f.frames) {
        if (!/PARTICIPANT_GOALS/.test(fr.market)) continue; // on-chain-settleable scope only
        fr.priceNames.forEach((side, j) => {
          const prob = fr.fairProbs[j];
          if (!(prob > 0.02 && prob < 0.98)) return;
          const key = `${fid}|${fr.market}|${fr.line}|${fr.period}|${side}`;
          const buf = hist.current.get(key) ?? [];
          if (!buf.length || buf[buf.length - 1].ts !== fr.ts) buf.push({ ts: fr.ts, prob });
          while (buf.length && buf[0].ts < fr.ts - HIST_MS) buf.shift();
          hist.current.set(key, buf);

          const now = fr.ts;
          const probThen = valueAt(buf, now - WINDOW_MS);
          if (probThen == null) return;
          const delta = prob - probThen;
          const kind = goalRecent && Math.abs(delta) >= OVERREACTION ? "overreaction" : !goalRecent && Math.abs(delta) >= STEAM ? "steam" : null;
          if (!kind) return;
          const ck = `${key}|${kind}`;
          if (now - (cooldown.current.get(ck) ?? 0) < COOLDOWN_MS) return;
          cooldown.current.set(ck, now);

          const edge = {
            kind,
            market: { fixtureId: fid, superOddsType: fr.market, marketParameters: fr.line, marketPeriod: fr.period, side, inRunning: true },
            edgeMeasure: Math.abs(delta),
            fairProb: prob,
            preEventProb: probThen,
            direction: kind === "steam" ? (delta > 0 ? "back" : "lay") : delta > 0 ? "lay" : "back",
            openedAt: now,
            note: `${(probThen * 100).toFixed(1)}%→${(prob * 100).toFixed(1)}%${goalRecent ? " (post-goal)" : ""}`,
            trigger: goalRecent ? "GOAL" : undefined,
          };
          const watchedProb = bookProb(buf, now, prob);
          const sig = classifyEdge(edge, { minute: f.minute, watchedProb, preEventProb: probThen }) as Sig | null;
          if (!sig) return;
          fresh.push({ ts: now, match: f.label, minute: f.minute, sig });
        });
      }
    }
    if (fresh.length) setSignals((prev) => [...fresh.reverse(), ...prev].slice(0, 80));
  }

  // POLICY re-evaluates reactively: edit a rule and the whole tape re-decides instantly.
  // (Lag/spread feed the classifier at detect time, so they apply to signals from here on.)
  const policy = useMemo(() => toPolicy(rules), [rules]);
  const decided = useMemo(
    () => signals.map((s) => ({ ...s, pol: evaluatePolicy(policy, s.sig) })),
    [signals, policy],
  );
  const tallies = useMemo(() => {
    let pickoffs = 0;
    let actions = 0;
    let marginPct = 0;
    let limitsCut = 0;
    let suspends = 0;
    for (const d of decided) {
      if (d.sig.pickoffRisk === "high") pickoffs++;
      const act = d.pol.action as { do?: string; marginPct?: number };
      if (d.pol.matched && act.do && act.do !== "none") actions++;
      if (act.do === "widen_margin") marginPct += Number(act.marginPct) || 0;
      if (act.do === "cut_limit") limitsCut++;
      if (act.do === "suspend") suspends++;
    }
    return { pickoffs, actions, marginPct, limitsCut, suspends };
  }, [decided]);

  const liveOn = fixtures.length > 0;

  return (
    <div className="mx-auto max-w-7xl px-5 py-6">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="label">live line-integrity sandbox — deploy a book, write a policy, watch the pickoff</p>
          <h1 className="serif mt-1 text-2xl">Watch the pickoff, live.</h1>
          <p className="mt-1 text-sm text-muted">
            The real classifier runs on the in-play book. You set how stale your naive book is and what your policy
            does; we benchmark it against TxLINE&apos;s demargined consensus and warn. We warn, your policy acts.
          </p>
        </div>
        <span className="flex items-center gap-2 text-xs">
          <span className={`inline-block h-2 w-2 rounded-full ${liveOn ? "bg-amber blink" : "bg-ink-500"}`} />
          {!configured ? "no token" : liveOn ? "LIVE · TxLINE" : connected ? "idle — no match in-play" : "connecting"}
        </span>
      </header>

      {/* TALLIES — driven by YOUR book + policy */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tally label="signals" value={`${decided.length}`} />
        <Tally label="pickoffs caught" value={`${tallies.pickoffs}`} tone="loss" />
        <Tally label="actions fired" value={`${tallies.actions}`} tone="amber" />
        <Tally label="margin protected" value={`+${tallies.marginPct}%`} tone="gain" hint={`${tallies.limitsCut} limits cut · ${tallies.suspends} suspends`} />
      </div>

      {!configured ? (
        <p className="panel px-5 py-4 text-sm text-faint">
          Live feed unavailable — no TxLINE token configured in this environment. Use the Archive to replay recorded
          matches through your book + policy.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
          {/* LEFT: the sandbox controls */}
          <aside className="order-1 space-y-4 lg:col-span-4">
            {/* naive-book configurator */}
            <div className="panel p-4">
              <p className="label">deploy a naive book</p>
              <p className="mt-1 text-xs text-faint">The soft book you&apos;re protecting: how far behind the fair line it quotes.</p>
              <div className="mt-3">
                <div className="flex items-baseline justify-between">
                  <span className="text-xs text-muted">staleness (lag)</span>
                  <span className="tabular-nums text-sm text-amber">{(lagMs / 1000).toFixed(0)}s</span>
                </div>
                <input
                  type="range"
                  min={LAG_MIN}
                  max={LAG_MAX}
                  step={1000}
                  value={lagMs}
                  onChange={(e) => setLagMs(Number(e.target.value))}
                  className="mt-1 w-full accent-amber"
                />
              </div>
              <div className="mt-3">
                <div className="flex items-baseline justify-between">
                  <span className="text-xs text-muted">soft-book vig (spread)</span>
                  <span className="tabular-nums text-sm text-amber">{spreadBps}bps</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={SPREAD_MAX}
                  step={10}
                  value={spreadBps}
                  onChange={(e) => setSpreadBps(Number(e.target.value))}
                  className="mt-1 w-full accent-amber"
                />
              </div>
              <p className="mt-3 text-xs text-faint">
                A stale book still quotes the pre-move price — the exact surface a sharp lifts. Applies to new signals.
              </p>
            </div>

            {/* policy editor */}
            <div className="panel p-4">
              <div className="flex items-center justify-between">
                <p className="label">your policy (the rule-set YOU control)</p>
                <button
                  onClick={() => setRules((rs) => [...rs, { id: rid(), kind: "", minConfidence: "", pickoffRisk: "", minGapBps: "", do: "cut_limit", pct: "50" }])}
                  className="rounded border border-ink-600 px-2 py-0.5 text-xs text-muted hover:text-fg"
                >
                  + rule
                </button>
              </div>
              <p className="mt-1 text-xs text-faint">First matching rule wins. We report which fired; your book acts.</p>
              <div className="mt-3 space-y-3">
                {rules.map((r, i) => (
                  <RuleEditor
                    key={r.id}
                    rule={r}
                    index={i}
                    onChange={(patch) => setRules((rs) => rs.map((x) => (x.id === r.id ? { ...x, ...patch } : x)))}
                    onRemove={() => setRules((rs) => rs.filter((x) => x.id !== r.id))}
                  />
                ))}
                {rules.length === 0 && <p className="text-xs text-faint">No rules — every signal falls through to &quot;no action&quot;.</p>}
              </div>
              <div className="mt-3 flex items-center gap-3">
                <button onClick={() => setRules(defaultRules())} className="text-xs text-faint hover:text-fg">
                  reset to demo policy
                </button>
                <button onClick={() => setSignals([])} className="text-xs text-faint hover:text-fg">
                  clear tape
                </button>
              </div>
              <p className="mt-3 text-xs text-faint">Read-only: no bet placed, no price moved, no funds held.</p>
            </div>
          </aside>

          {/* RIGHT: live book + the boundary tape */}
          <section className="order-2 space-y-4 lg:col-span-8">
            {!liveOn ? (
              <p className="panel px-5 py-6 text-sm text-muted">
                No World Cup match is in-play right now. Odds are live-only, so the book and its signals appear the
                moment a match kicks off — keep this page open through kickoff, or replay a recorded match from the{" "}
                <a href="/desk" className="amber hover:text-fg">
                  Archive
                </a>
                .
              </p>
            ) : (
              <>
                {/* live book per fixture */}
                <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                  {fixtures.map((f) => (
                    <div key={f.fid} className="card p-4">
                      <div className="flex items-center justify-between">
                        <p className="serif text-paper">
                          {f.label} <span className="text-faint">· {f.goals.p1}-{f.goals.p2}</span>
                          {f.minute != null && <span className="text-faint"> · {f.minute}&apos;</span>}
                        </p>
                        <span className={`text-xs tabular-nums ${f.latestAgeSec < 10 ? "gain" : "text-faint"}`}>
                          {f.latestAgeSec < 10 ? "● " : ""}freshest {f.latestAgeSec}s
                        </span>
                      </div>
                      <table className="mt-3 w-full text-left text-xs">
                        <tbody className="font-mono">
                          {f.frames.filter((fr) => /PARTICIPANT_GOALS/.test(fr.market)).slice(0, 5).map((fr, i) => (
                            <tr key={i} className="border-t border-ink-700">
                              <td className="py-1 pr-2 text-muted">{shortMarket(fr.market, fr.line)}</td>
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

                {/* the boundary tape */}
                <Boundary decided={decided} lagMs={lagMs} />
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

// ── the boundary tape (shared by live + replay) ──────────────────────────────
function Boundary({ decided, lagMs }: { decided: (StoredSig & { pol: { matched: boolean; action: { do?: string; marginPct?: number; limitPct?: number } } })[]; lagMs: number }) {
  return (
    <section className="panel flex min-h-[45vh] flex-col">
      <header className="flex items-center justify-between border-b border-ink-600 px-5 py-3">
        <div>
          <p className="label">the read-only boundary — live</p>
          <p className="text-sm text-muted">
            signal (ours) → the naive book&apos;s stale gap ({(lagMs / 1000).toFixed(0)}s) → the action YOUR policy chose
          </p>
        </div>
        <span className="text-xs text-faint tabular-nums">{decided.length} signals</span>
      </header>
      <div className="min-w-0 flex-1 overflow-x-auto overflow-y-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead>
            <tr className="border-b border-ink-600 text-xs text-faint">
              <Th>time</Th>
              <Th>market</Th>
              <Th>signal</Th>
              <Th right>ref</Th>
              <Th right>book gap</Th>
              <Th>pickoff</Th>
              <Th>policy action</Th>
            </tr>
          </thead>
          <tbody className="font-mono text-xs">
            {decided.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-faint">
                  benchmarking the live book against the demargined consensus…
                </td>
              </tr>
            )}
            {decided.map((d, i) => {
              const s = d.sig;
              const fired = d.pol.matched && d.pol.action?.do && d.pol.action.do !== "none";
              return (
                <tr key={`${d.ts}-${i}`} className="border-b border-ink-700 last:border-0">
                  <td className="px-3 py-2 text-faint tabular-nums">{clock(d.ts)}</td>
                  <td className="px-3 py-2 text-muted">{shortMarket(s.market)}</td>
                  <td className="px-3 py-2">
                    <span className={KIND_COLOR[s.kind] ?? "text-muted"}>{s.kind}</span>{" "}
                    <span className="text-faint">→</span> <span className={actionColor(s.action)}>{s.action}</span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted">{s.pRef?.toFixed(3)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {s.gapBps != null ? (
                      <span className={Math.abs(s.gapBps) >= 60 ? "loss" : "text-faint"}>
                        {s.gapBps > 0 ? "+" : ""}
                        {s.gapBps}bps
                      </span>
                    ) : (
                      <span className="text-faint">—</span>
                    )}
                  </td>
                  <td className={`px-3 py-2 ${riskColor(s.pickoffRisk)}`}>{s.pickoffRisk}</td>
                  <td className={`px-3 py-2 ${fired ? "text-fg" : "text-faint"}`}>{describeAction(d.pol.action)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function RuleEditor({
  rule,
  index,
  onChange,
  onRemove,
}: {
  rule: UiRule;
  index: number;
  onChange: (patch: Partial<UiRule>) => void;
  onRemove: () => void;
}) {
  const sel = "rounded border border-ink-600 bg-ink-800 px-1.5 py-1 text-xs text-fg";
  const num = "w-14 rounded border border-ink-600 bg-ink-800 px-1.5 py-1 text-xs text-fg tabular-nums";
  return (
    <div className="card p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="label">rule {index + 1}</span>
        <button onClick={onRemove} className="text-xs text-faint hover:text-loss">
          remove
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="text-faint">when</span>
        <select value={rule.kind} onChange={(e) => onChange({ kind: e.target.value })} className={sel}>
          <option value="">any kind</option>
          <option value="overreaction">overreaction</option>
          <option value="steam">steam</option>
          <option value="pregoal_warning">pregoal_warning</option>
        </select>
        <span className="text-faint">conf≥</span>
        <input
          value={rule.minConfidence}
          onChange={(e) => onChange({ minConfidence: e.target.value.replace(/[^0-9.]/g, "") })}
          placeholder="—"
          className={num}
        />
        <select value={rule.pickoffRisk} onChange={(e) => onChange({ pickoffRisk: e.target.value })} className={sel}>
          <option value="">any risk</option>
          <option value="med">risk≥med</option>
          <option value="high">risk≥high</option>
        </select>
        <span className="text-faint">gap≥</span>
        <input
          value={rule.minGapBps}
          onChange={(e) => onChange({ minGapBps: e.target.value.replace(/[^0-9]/g, "") })}
          placeholder="—"
          className={num}
        />
        <span className="text-faint">bps</span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
        <span className="text-faint">then</span>
        <select
          value={rule.do}
          onChange={(e) => onChange({ do: e.target.value as UiRule["do"] })}
          className={sel}
        >
          <option value="widen_margin">widen margin</option>
          <option value="cut_limit">cut limit</option>
          <option value="suspend">suspend</option>
          <option value="none">no action</option>
        </select>
        {(rule.do === "widen_margin" || rule.do === "cut_limit") && (
          <>
            <input
              value={rule.pct}
              onChange={(e) => onChange({ pct: e.target.value.replace(/[^0-9]/g, "") })}
              className={num}
            />
            <span className="text-faint">{rule.do === "widen_margin" ? "% margin" : "% limit"}</span>
          </>
        )}
      </div>
    </div>
  );
}

function Tally({ label, value, tone, hint }: { label: string; value: string; tone?: "gain" | "loss" | "amber"; hint?: string }) {
  const cls = tone === "gain" ? "gain" : tone === "loss" ? "loss" : tone === "amber" ? "amber" : "";
  return (
    <div className="card px-4 py-3">
      <p className="label">{label}</p>
      <p className={`mt-0.5 text-xl tabular-nums ${cls}`}>{value}</p>
      {hint && <p className="mt-0.5 text-[0.66rem] text-faint">{hint}</p>}
    </div>
  );
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return <th className={`px-3 py-2 font-normal ${right ? "text-right" : ""}`}>{children}</th>;
}
