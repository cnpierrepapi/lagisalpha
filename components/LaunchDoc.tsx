import Link from "next/link";

// /launch is the pro-trader flagship: a paper-trading terminal for the lead-lag edge. You load your
// key, set a bankroll, pick live or replay, and watch each divergence play out as a paper trade,
// Kelly-sized, taken at the market and exited at TxLINE fair, with the PnL. No real money moves.
// NOTE: the live terminal engine lands in a later phase; this page frames the product and shows the
// exact command flow. Keep the narrative on the lag: catch it, take the cheap side, size by Kelly.

function Cmd({ children }: { children: React.ReactNode }) {
  return <span className="text-amber">{children}</span>;
}

export default function LaunchDoc() {
  return (
    <div className="mx-auto max-w-4xl px-5 py-10">
      <header className="mb-10 border-b border-ink-600 pb-8">
        <p className="label">the pro-trader terminal · built on TxLINE</p>
        <h1 className="serif mt-2 text-4xl leading-tight text-paper">
          Paper-trade the lag before you risk a dollar.
        </h1>
        <p className="mt-4 max-w-2xl text-sm leading-relaxed text-muted">
          The edge is simple: a prediction market trades a step behind TxLINE&apos;s vig-free fair, so the
          cheap side is underpriced until it catches up. Lagisalpha streams every divergence, takes the cheap
          side on a fake bankroll, sizes it by Kelly, and exits at fair so you watch the convergence turn into
          PnL. No wallet, no real fills, no risk. Just the edge, played out on real matches.
        </p>
        <div className="mt-5 flex flex-wrap gap-3 text-sm">
          <Link href="/api" className="rounded border border-amber-dim bg-amber/10 px-4 py-2 text-amber hover:bg-amber/20">
            Get an API key →
          </Link>
          <Link href="/proof" className="card px-4 py-2 text-muted hover:text-fg">
            See the track record
          </Link>
        </div>
      </header>

      {/* THE COMMAND FLOW */}
      <section className="mb-12">
        <p className="label mb-3">how it runs</p>
        <h2 className="serif mb-4 text-2xl text-paper">Four commands, then you watch.</h2>
        <div className="panel overflow-hidden">
          <header className="flex items-center justify-between border-b border-ink-600 px-4 py-2.5">
            <span className="label">lagisalpha · paper terminal</span>
            <span className="text-xs text-faint">preview</span>
          </header>
          <div className="px-4 py-3 font-mono text-xs leading-relaxed">
            <p><span className="prompt">lagisalpha&gt;</span> <Cmd>load</Cmd> key las_•••• env live</p>
            <p className="text-faint">✓ signal feed connected · TxLINE fair streaming</p>
            <p className="mt-1"><span className="prompt">lagisalpha&gt;</span> <Cmd>bankroll</Cmd> 10000</p>
            <p className="text-faint">✓ bankroll $10,000 · sizing: Kelly (default)</p>
            <p className="mt-1"><span className="prompt">lagisalpha&gt;</span> <Cmd>live</Cmd></p>
            <p className="text-faint">… scanning for a live match</p>
            <p className="mt-2 text-fg">▶ Brazil v Norway — buy NO @ 0.82 · fair 0.90 · <span className="amber">+8pp</span></p>
            <p className="text-faint">&nbsp;&nbsp;paper fill 1,240 @ 0.82 · size $1,020 (Kelly)</p>
            <p className="text-faint">&nbsp;&nbsp;… market converging to fair …</p>
            <p className="text-faint">&nbsp;&nbsp;exit @ fair 0.90 · <span className="amber">+9.8%</span> · PnL <span className="amber">+$99.60</span> · bankroll $10,099.60</p>
            <p className="mt-2 prompt"><span className="blink amber">_</span></p>
          </div>
        </div>
        <p className="mt-3 text-xs text-faint">
          Bankroll is fake and no order is ever placed. Sizing is Kelly by default. Live only runs when a match
          is in play; otherwise use <span className="text-muted">replay</span> on a recorded match.
        </p>
      </section>

      {/* TWO WAYS TO RUN */}
      <section className="mb-12">
        <p className="label mb-3">two ways to run it</p>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <div className="card p-5">
            <h3 className="text-paper">Web terminal</h3>
            <p className="mt-2 text-sm text-muted">
              Open it here in the browser, paste your key, and go. Nothing to install.
            </p>
          </div>
          <div className="card p-5">
            <h3 className="text-paper">Your own terminal</h3>
            <p className="mt-2 text-sm text-muted">
              The same commands run as a CLI in PowerShell, cmd, or any shell:
            </p>
            <pre className="mt-3 overflow-x-auto rounded bg-ink-900 px-3 py-2 font-mono text-xs text-amber">npx lagisalpha</pre>
          </div>
        </div>
      </section>

      {/* WHAT YOU GET */}
      <section className="mb-12">
        <p className="label mb-3">what you get</p>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
          <div className="card p-5">
            <h3 className="text-paper">The fair, fed to you</h3>
            <p className="mt-2 text-sm text-muted">
              We hold the TxLINE token and stream the de-vig fair through the API. You do not need your own
              TxLINE access.
            </p>
          </div>
          <div className="card p-5">
            <h3 className="text-paper">Paper trades, Kelly-sized</h3>
            <p className="mt-2 text-sm text-muted">
              Every divergence becomes a paper trade on your bankroll, taken at the market and exited at fair,
              with the PnL the same math the track record uses.
            </p>
          </div>
          <div className="card p-5">
            <h3 className="text-paper">Telegram alerts</h3>
            <p className="mt-2 text-sm text-muted">
              Get the signals pushed to Telegram, alerts only or as paper trades on a bankroll you set.
            </p>
          </div>
        </div>
      </section>

      <footer className="mt-6 border-t border-ink-600 pt-6 text-xs text-faint">
        Paper trading only. Nothing here is an order, a position, or financial advice. Sizing and slippage on
        any real trade are your own. Built on TxLINE ·{" "}
        <Link href="/proof" className="text-amber hover:text-fg">see the track record →</Link>
      </footer>
    </div>
  );
}
