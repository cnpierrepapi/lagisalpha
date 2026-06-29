"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { PAPERS, getPaper, type AgentLevers, type Paper } from "@/lib/papers";
import { getOwnedPapers } from "@/lib/store";

function previewSentence(name: string, paper: Paper, L: AgentLevers): string {
  const who = name.trim() || "This agent";
  const verb = L.direction === "follow" ? "follows" : "fades";
  const pp = (L.minConviction * 100).toFixed(0);
  const phase =
    L.phase === "pre"
      ? "pre-match"
      : L.phase === "inplay"
        ? `in-play${L.minMinute > 0 ? ` after ${L.minMinute}'` : ""}${L.maxMinute < 90 ? ` until ${L.maxMinute}'` : ""}`
        : "any phase";
  const stake = L.stakeMode === "flat" ? `${(L.stakePct * 100).toFixed(0)}% flat stake` : `${L.kellyFraction.toFixed(2)}× Kelly sizing`;
  return `${who} ${verb} the ${paper.edgeKind} signal — entering when the fair price moves ≥${pp}pp, ${phase}, odds ${L.oddsMin.toFixed(2)}–${L.oddsMax.toFixed(2)}, ${stake}, max ${L.maxConcurrent} open.`;
}

export default function AgentBuilder({ initialPaper }: { initialPaper: string | null }) {
  const router = useRouter();
  const [owned, setOwned] = useState<string[]>([]);
  const [paperId, setPaperId] = useState<string>(initialPaper ?? "steam-base");
  const [name, setName] = useState("");
  const [levers, setLevers] = useState<AgentLevers>(() => ({ ...(getPaper(initialPaper ?? "steam-base")?.levers ?? PAPERS[0].levers) }));
  const [deploying, setDeploying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const o = getOwnedPapers();
    setOwned(o);
    // if the preselected paper isn't owned, fall back to the first owned one
    if (!o.includes(paperId) && o.length) {
      setPaperId(o[0]);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const paper = getPaper(paperId)!;

  // when the selected paper changes, reload its default levers
  function selectPaper(id: string) {
    setPaperId(id);
    const p = getPaper(id);
    if (p) setLevers({ ...p.levers });
  }

  function set<K extends keyof AgentLevers>(key: K, val: AgentLevers[K]) {
    setLevers((L) => ({ ...L, [key]: val }));
  }

  const preview = useMemo(() => previewSentence(name, paper, levers), [name, paper, levers]);
  const ownedPapers = PAPERS.filter((p) => owned.includes(p.id));

  async function deploy() {
    setError(null);
    if (!name.trim()) {
      setError("name your agent");
      return;
    }
    setDeploying(true);
    try {
      const res = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create", name: name.trim(), paperId, levers }),
      });
      const j = await res.json();
      if (!res.ok || !j.ok) throw new Error(j.error || "deploy failed");
      router.push("/desk");
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
      setDeploying(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-5 py-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="label">deploy a strategy</p>
          <h1 className="serif mt-1 text-3xl">Build an Agent</h1>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <span className="label">strategy</span>
          <select
            value={paperId}
            onChange={(e) => selectPaper(e.target.value)}
            className="card px-3 py-2 text-sm text-fg"
          >
            {ownedPapers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </label>
      </header>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* strategy summary */}
        <aside className="card p-5 lg:col-span-1">
          <div className="flex items-center justify-between">
            <span className="label tabular-nums text-faint">{paper.doi}</span>
            <span className="label rounded border border-ink-600 px-1.5 py-0.5">{paper.edgeKind}</span>
          </div>
          <h2 className="serif mt-2 text-lg leading-snug text-paper">{paper.title}</h2>
          <p className="mt-1 text-xs text-faint">
            {paper.authors} · {paper.year}
          </p>
          <p className="mt-3 text-sm text-muted">{paper.abstract}</p>
          <p className="label mt-4">defaults loaded — tune at right</p>
        </aside>

        {/* levers */}
        <section className="panel p-5 lg:col-span-2">
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <Range label="Conviction floor" value={levers.minConviction} min={0.01} max={0.2} step={0.01} fmt={(v) => `${(v * 100).toFixed(0)}pp`} onChange={(v) => set("minConviction", v)} />

            <Segment
              label="Sizing"
              value={levers.stakeMode}
              options={[["flat", "Flat"], ["kelly", "Kelly"]]}
              onChange={(v) => set("stakeMode", v as AgentLevers["stakeMode"])}
            />

            {levers.stakeMode === "flat" ? (
              <Range label="Stake % of bankroll" value={levers.stakePct} min={0.01} max={0.25} step={0.01} fmt={(v) => `${(v * 100).toFixed(0)}%`} onChange={(v) => set("stakePct", v)} />
            ) : (
              <Range label="Kelly fraction" value={levers.kellyFraction} min={0.1} max={1} step={0.05} fmt={(v) => `${v.toFixed(2)}×`} onChange={(v) => set("kellyFraction", v)} />
            )}

            <Segment
              label="Phase"
              value={levers.phase}
              options={[["pre", "Pre"], ["inplay", "In-play"], ["both", "Both"]]}
              onChange={(v) => set("phase", v as AgentLevers["phase"])}
            />

            <Pair label="Minute window" lo={levers.minMinute} hi={levers.maxMinute} min={0} max={90} step={1} onLo={(v) => set("minMinute", v)} onHi={(v) => set("maxMinute", v)} />
            <Pair label="Odds band" lo={levers.oddsMin} hi={levers.oddsMax} min={1.1} max={10} step={0.1} onLo={(v) => set("oddsMin", v)} onHi={(v) => set("oddsMax", v)} />

            <Range label="Max concurrent" value={levers.maxConcurrent} min={1} max={10} step={1} fmt={(v) => `${v}`} onChange={(v) => set("maxConcurrent", v)} />

            <Segment
              label="Direction"
              value={levers.direction}
              options={[["follow", "Follow"], ["fade", "Fade"]]}
              onChange={(v) => set("direction", v as AgentLevers["direction"])}
            />
          </div>
        </section>
      </div>

      {/* live preview + deploy */}
      <div className="panel mt-5 p-5">
        <p className="label mb-2">preview</p>
        <p className="prompt serif text-lg leading-snug text-paper">{preview}</p>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name your agent…"
            className="card flex-1 min-w-[200px] px-4 py-2.5 text-fg placeholder:text-faint"
          />
          <button
            onClick={deploy}
            disabled={deploying}
            className="rounded border border-amber-dim bg-amber/10 px-5 py-2.5 font-semibold text-amber hover:bg-amber/20 disabled:opacity-50"
          >
            {deploying ? "Deploying…" : "Deploy agent →"}
          </button>
        </div>
        {error && <p className="mt-2 text-sm loss">{error}</p>}
        <p className="mt-2 text-xs text-faint">
          Deploys to the runner and starts trading immediately. Watch it on the{" "}
          <Link href="/desk" className="amber hover:text-fg">
            Desk
          </Link>
          .
        </p>
      </div>
    </div>
  );
}

function Range({ label, value, min, max, step, fmt, onChange }: { label: string; value: number; min: number; max: number; step: number; fmt: (v: number) => string; onChange: (v: number) => void }) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="label">{label}</span>
        <span className="text-sm tabular-nums amber">{fmt(value)}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="mt-2 w-full accent-amber" />
    </div>
  );
}

function Pair({ label, lo, hi, min, max, step, onLo, onHi }: { label: string; lo: number; hi: number; min: number; max: number; step: number; onLo: (v: number) => void; onHi: (v: number) => void }) {
  return (
    <div>
      <span className="label">{label}</span>
      <div className="mt-2 flex items-center gap-2">
        <input type="number" min={min} max={max} step={step} value={lo} onChange={(e) => onLo(Number(e.target.value))} className="card w-full px-2 py-1.5 text-sm tabular-nums text-fg" />
        <span className="text-faint">—</span>
        <input type="number" min={min} max={max} step={step} value={hi} onChange={(e) => onHi(Number(e.target.value))} className="card w-full px-2 py-1.5 text-sm tabular-nums text-fg" />
      </div>
    </div>
  );
}

function Segment<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div>
      <span className="label">{label}</span>
      <div className="mt-2 flex gap-1.5">
        {options.map(([v, lbl]) => (
          <button
            key={v}
            onClick={() => onChange(v)}
            className={`flex-1 rounded border px-2 py-1.5 text-sm transition-colors ${
              value === v ? "border-amber-dim bg-amber/10 text-amber" : "border-ink-600 text-muted hover:text-fg"
            }`}
          >
            {lbl}
          </button>
        ))}
      </div>
    </div>
  );
}
