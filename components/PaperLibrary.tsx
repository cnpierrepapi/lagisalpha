"use client";

import Link from "next/link";
import { PAPERS } from "@/lib/papers";

// The thesis, stated honestly: what the literature says AND what our own 4-match TxLINE
// captures actually showed. These numbers are the deduped in-play goals-market signals.
const FINDINGS = [
  {
    tag: "primary edge",
    stat: "89% hold",
    tone: "gain",
    title: "Follow the move",
    body:
      "A flagged move held 89% of the time (54% extended further). Markets are efficient to goal arrival and momentum persists, so a real move carries; a lagging book is the stale price a sharp lifts. This is the oracle's core job.",
    cite: "Croxson & Reade 2014 · Moskowitz 2021 · Gandar et al. 2001",
  },
  {
    tag: "rare exception",
    stat: "18% revert",
    tone: "loss",
    title: "Fade only on surprise",
    body:
      "Only ~18% of flagged overreactions genuinely reverted; 82% were efficient reprices that stuck. Bettors overreact only to SURPRISING goals, and magnitude does not predict reversion (big moves are decisive). So fade is gated on surprise, never on size.",
    cite: "Choi & Hui 2014 · De Bondt–Thaler",
  },
  {
    tag: "anticipation",
    stat: "pre-goal",
    tone: "amber",
    title: "The line moves first",
    body:
      "Markets partially anticipate goals: odds drift on dangerous-attack and shot pressure seconds BEFORE the goal. The momentum tape (high_danger_possession / PossibleEvent.Goal) fires the suspend warning before your in-play line goes stale.",
    cite: "Wunderlich et al. (Bundesliga) 2025 · arXiv 2505.21275",
  },
];

export default function PaperLibrary() {
  return (
    <div className="mx-auto max-w-7xl px-5 py-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="label">the methodology</p>
          <h1 className="serif mt-1 text-3xl">The research behind the signals</h1>
          <p className="mt-2 max-w-xl text-sm text-muted">
            Linescout doesn&apos;t guess. Every call is grounded in a published result AND re-checked
            against our own captures. The headline finding: <span className="text-fg">follow</span>, not
            fade, is the primary edge. A book that lags a real move gets picked off far more often than a
            line overshoots and reverts.
          </p>
        </div>
        <div className="card flex items-center gap-2 px-3 py-2 text-sm">
          <span className="amber">◆</span>
          <span className="tabular-nums">{PAPERS.length}</span>
          <span className="label">papers</span>
        </div>
      </header>

      {/* WHAT WE WATCH: the thesis, grounded in the literature + our own 4-match data */}
      <section className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-3">
        {FINDINGS.map((f) => (
          <div key={f.title} className="panel p-5">
            <div className="flex items-baseline justify-between">
              <p className="label">{f.tag}</p>
              <span className={`text-sm tabular-nums ${f.tone}`}>{f.stat}</span>
            </div>
            <h3 className="serif mt-1 text-lg text-paper">{f.title}</h3>
            <p className="mt-2 text-sm text-muted">{f.body}</p>
            <p className="mt-2 text-xs text-faint">{f.cite}</p>
          </div>
        ))}
      </section>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {PAPERS.map((p) => (
          <article key={p.id} className="card flex flex-col p-5">
            <div className="flex items-center justify-between">
              <span className="label tabular-nums text-faint">{p.doi}</span>
              <span className="label rounded border border-ink-600 px-1.5 py-0.5">{p.edgeKind}</span>
            </div>

            <h2 className="serif mt-2 text-lg leading-snug text-paper">{p.title}</h2>
            <p className="mt-1 text-xs text-faint">
              {p.authors} · {p.year}
            </p>

            <p className="mt-3 flex-1 text-sm text-muted">{p.abstract}</p>

            <div className="mt-3 flex flex-wrap gap-1.5">
              {p.tags.map((t) => (
                <span key={t} className="text-xs text-faint">
                  #{t}
                </span>
              ))}
            </div>

            <div className="mt-4 flex items-center justify-between border-t border-ink-600 pt-3">
              <span className="text-xs gain">✓ grounds a live signal</span>
              <Link href="/desk" className="prompt text-sm text-amber hover:text-fg">
                See it fire →
              </Link>
            </div>
          </article>
        ))}
      </div>

      <p className="mt-6 max-w-2xl text-xs text-faint">
        Each paper maps to one detector behaviour: Croxson &amp; Reade (markets price goal arrival
        efficiently) and Moskowitz (momentum persists) ground <span className="text-muted">steam → follow</span>,
        the primary edge; Choi &amp; Hui (only <em>surprising</em> goals overshoot and revert) grounds the
        rare, surprise-gated <span className="text-muted">overreaction → fade</span>; the momentum tape grounds
        the pre-goal <span className="text-muted">suspend</span> warning. The signal is never more than the
        research, and our own data, says it is.
      </p>
    </div>
  );
}
