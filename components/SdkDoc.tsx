import Link from "next/link";

const REPO = "https://github.com/cnpierrepapi/agenthesis";

function Code({ children }: { children: string }) {
  return (
    <pre className="card overflow-x-auto p-4 text-[0.8rem] leading-relaxed text-fg">
      <code>{children}</code>
    </pre>
  );
}

const PRIMITIVES = [
  {
    kind: "Signal",
    fn: "EdgeEngine",
    body: "Ingest the demargined book → emit typed, scored edges: steam (sharp fair-prob move), overreaction (post-event overshoot), quote (micro-drift baseline).",
  },
  {
    kind: "Decision",
    fn: "decide(agent, edge, ctx)",
    body: "Pure mapping from an edge + your lever set → a sized call (take / side / direction / stake). Flat or fractional-Kelly.",
  },
  {
    kind: "Scoring",
    fn: "markPosition / scoreCLV",
    body: "Closing-line value — the skill metric. Resolves from odds alone, no match outcome required.",
  },
];

const API = [
  {
    sig: "new EdgeEngine(opts?)",
    desc: "Detection. ingestOdds(rec), ingestScores(rec), on(\"edge\"|\"edgeClosed\"|\"matchEvent\", cb), openEdges(), fairProbForMarket(market), matchMinute(fixtureId), stake(edgeId, amount). opts tune thresholds/windows.",
  },
  {
    sig: "defineStrategy(levers?, { label, edgeKinds }?)",
    desc: "A lever set gated to edge kinds. Levers: minConviction, stakeMode (flat|kelly), stakePct, kellyFraction, phase, minMinute/maxMinute, marketFilter, oddsMin/oddsMax, maxConcurrent, direction (follow|fade).",
  },
  {
    sig: "createAgent({ bankroll, strategies, ... })",
    desc: "An agent runs its strategies in order; the first that greenlights an edge takes it.",
  },
  {
    sig: "decide(agent, edge, { minute, openCount })",
    desc: "→ { take, reason, side, direction, stake, entryProb, entryOdds, ... }. Pure.",
  },
  {
    sig: "markPosition(pos, closeProb) / scoreCLV({ entryProb, direction, stake }, closeProb)",
    desc: "→ { clvReturn, pnl }. Pure. Constants: CONTINUATION_COEFF, KELLY_CAP, CLV_FLOOR, CLV_CEIL.",
  },
];

export default function SdkDoc() {
  return (
    <div className="mx-auto max-w-5xl px-5 py-10">
      <header className="mb-8">
        <p className="label">developer access</p>
        <h1 className="serif mt-1 text-4xl text-paper">Agenthesis SDK</h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted">
          Embed the edge-detection engine and the CLV decision core directly in your own stack.
          This is the integration path for a quantitative forecasting desk: you bring your own TxLINE
          feed and your own strategies; the SDK turns the demargined price book into typed, scored
          signals and grades every call on closing-line value.
        </p>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-faint">
          It is the exact code the deployed product runs — pure functions, no I/O, no clock reads,
          deterministic, and unit-tested (26 assertions). That is what makes it safe to put next to
          real execution.
        </p>
        <div className="mt-5 flex flex-wrap gap-3 text-sm">
          <Link
            href={`${REPO}/tree/master/sdk`}
            className="rounded border border-amber-dim bg-amber/10 px-4 py-2 text-amber hover:bg-amber/20"
          >
            ◆ Source on GitHub ↗
          </Link>
          <Link
            href={`${REPO}/blob/master/examples/desk_quickstart.mjs`}
            className="card px-4 py-2 text-muted hover:text-fg"
          >
            Runnable example ↗
          </Link>
        </div>
      </header>

      {/* What it gives you */}
      <section className="mb-10">
        <p className="label mb-3">what it gives you</p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {PRIMITIVES.map((p) => (
            <div key={p.kind} className="card p-4">
              <p className="amber text-sm font-semibold">{p.kind}</p>
              <p className="mt-1 font-mono text-xs text-info">{p.fn}</p>
              <p className="mt-2 text-xs leading-relaxed text-muted">{p.body}</p>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-faint">
          You keep ownership of the two things a desk should own: the feed (you push records in) and
          the execution (you route the orders out). The SDK is the quantitative layer in between.
        </p>
      </section>

      {/* Install */}
      <section className="mb-10">
        <p className="label mb-3">install</p>
        <Code>{`# install straight from the repo
npm install github:cnpierrepapi/agenthesis

# the public surface is the self-contained "agenthesis/sdk" entry
import { EdgeEngine, defineStrategy, createAgent, decide, markPosition }
  from "agenthesis/sdk";`}</Code>
        <p className="mt-2 text-xs text-faint">
          The package exposes only the pure quant layer (engine + decision core + strategies). It
          pulls in no runtime dependencies beyond Node&apos;s built-in <code className="text-info">events</code>.
        </p>
      </section>

      {/* Quickstart */}
      <section className="mb-10">
        <p className="label mb-3">quickstart</p>
        <Code>{`import { EdgeEngine, defineStrategy, createAgent, decide } from "agenthesis/sdk";

const engine = new EdgeEngine();                       // detection thresholds
const strat  = defineStrategy({ stakeMode: "kelly" }, { label: "my-desk" });
const agent  = createAgent({ bankroll: 100_000, strategies: [strat] });

engine.on("edge", (edge) => {
  const minute = engine.matchMinute(edge.market.fixtureId);
  const open   = agent.positions.filter((p) => p.status === "open").length;
  const d = decide(agent, edge, { minute, openCount: open });
  if (d.take) execution.place(d);                      // YOU route the order
});

engine.ingestOdds(txlineOddsRecord);                   // feed YOUR stream
engine.ingestScores(txlineScoreRecord);`}</Code>
        <p className="mt-3 text-xs text-muted">
          A complete, runnable end-to-end backtest on real captured TxLINE frames:
        </p>
        <Code>{`node examples/desk_quickstart.mjs
# Feeding Brazil v Japan — 13319 odds + 971 score frames…
# 18149 edges -> 11 calls · hit-rate 91% · avg CLV +49.54%`}</Code>
        <p className="mt-2 text-xs text-faint">
          One captured match with loose demo levers — a tiny sample (11 settled calls) and CLV runs
          hot because the frames are a pre-match run-up that drifts hard into kickoff. Production
          levers settle far tighter (~3% avg CLV over the full exec ledger); the example is here for
          the wiring, not the return.
        </p>
      </section>

      {/* API */}
      <section className="mb-10">
        <p className="label mb-3">api reference</p>
        <div className="panel divide-y divide-ink-600">
          {API.map((a) => (
            <div key={a.sig} className="p-4">
              <p className="font-mono text-xs text-amber">{a.sig}</p>
              <p className="mt-1.5 text-xs leading-relaxed text-muted">{a.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* The model */}
      <section className="mb-10">
        <p className="label mb-3">the model</p>
        <div className="card p-5 text-sm leading-relaxed text-muted">
          <p>
            TxLINE publishes a de-margined (no-vig) book, so for side <em className="text-fg">S</em>:{" "}
            <code className="text-info">p = 1 / (price/1000)</code>,{" "}
            <code className="text-info">O = 1/p</code>, <code className="text-info">b = O − 1</code>.
            An edge of magnitude <em className="text-fg">m</em> implies expected captured move{" "}
            <code className="text-info">ê = κ·m</code> (κ = CONTINUATION_COEFF), expected return{" "}
            <code className="text-info">e = ê / p_entry</code>, and Kelly fraction{" "}
            <code className="text-info">f* = e / b</code>, applied as fractional Kelly capped at
            KELLY_CAP.
          </p>
          <p className="mt-3">
            Settlement is <span className="amber">CLV</span> (closing-line value):{" "}
            <code className="text-info">back: r = (p_close − p_entry)/p_entry</code>. It resolves
            from odds alone — no match outcome required — which is what makes it a clean,
            fast-settling skill metric. The full derivation lives in{" "}
            <code className="text-info">lib/agent-core.mjs</code>.
          </p>
        </div>
      </section>

      {/* Determinism */}
      <section className="mb-4">
        <p className="label mb-3">determinism &amp; deployment</p>
        <p className="max-w-2xl text-sm leading-relaxed text-muted">
          Every function is pure: same inputs → same outputs, no wall-clock, no randomness. Run the
          engine as a persistent worker alongside your feed (the edge lifecycle uses wall-time for
          TTL/cooldown, so it expects a continuous, real-time stream — not a serverless
          request/response). Score, attribute, and risk-check entirely from the returned values.
        </p>
      </section>

      {/* ─── Operator API ─────────────────────────────────────────────── */}
      <section className="mb-10 border-t border-ink-600 pt-10">
        <p className="label">market operators</p>
        <h2 className="serif mt-1 text-3xl text-paper">Operator API</h2>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted">
          The desk embeds the SDK; a market operator or B2B intermediary consumes the{" "}
          <span className="text-fg">HTTP API</span> instead. It is a clean, versioned, authenticated
          poll endpoint returning typed, scored edges per fixture — every edge carries the{" "}
          <code className="text-info">proofHash</code> that reconciles it against the frame ledger,
          so you can verify each signal came from real, on-chain-authorized TxLINE data.
        </p>

        <div className="mt-5 card p-4">
          <p className="label mb-1">endpoint</p>
          <p className="font-mono text-sm text-amber">GET /api/v1/signals</p>
          <p className="mt-2 text-xs text-faint">
            Alias: <code className="text-info">/api/v1/edges</code> (identical payload — kept for back-compat).
            Auth: <code className="text-info">Authorization: Bearer &lt;key&gt;</code> or{" "}
            <code className="text-info">X-Api-Key: &lt;key&gt;</code>. Public demo key:{" "}
            <code className="text-amber">ag_demo_2026</code> (production deployments set
            OPERATOR_API_KEYS and rotate per consumer).
          </p>
        </div>

        <p className="label mb-2 mt-6">try it</p>
        <Code>{`curl -s https://agenthesis-eta.vercel.app/api/v1/signals \\
  -H "Authorization: Bearer ag_demo_2026"

# filter to one fixture, only high-conviction steam, cap per fixture
curl -s "https://agenthesis-eta.vercel.app/api/v1/signals?kind=steam&conviction=High&limit=10" \\
  -H "X-Api-Key: ag_demo_2026"`}</Code>

        <p className="label mb-2 mt-6">query params</p>
        <div className="panel divide-y divide-ink-600">
          {[
            ["fixtureId", "restrict to a single fixture"],
            ["kind", "steam | overreaction | quote"],
            ["conviction", "minimum tier: High | Medium | Low"],
            ["limit", "max edges per fixture (1–200, default 25)"],
          ].map(([k, d]) => (
            <div key={k} className="flex gap-3 p-3">
              <span className="font-mono text-xs text-amber">{k}</span>
              <span className="text-xs text-muted">{d}</span>
            </div>
          ))}
        </div>

        <p className="label mb-2 mt-6">response (abridged)</p>
        <Code>{`{
  "version": "1",
  "source": "txline-capture-replay",
  "proof": { "signedOnSolana": true, "explorerUrl": "https://explorer.solana.com/tx/…" },
  "edgeCount": 247,
  "fixtures": [
    {
      "fixtureId": "18172469",
      "label": "Brazil v Japan",
      "edges": [
        {
          "kind": "overreaction",
          "direction": "lay",
          "conviction": "High",
          "market": { "superOddsType": "OVERUNDER_PARTICIPANT_GOALS",
                      "marketParameters": "3.5", "side": "over", "sideIndex": 0 },
          "fairProb": 0.2959,
          "impliedOdds": 3.379,
          "edgeMeasure": 0.162,
          "note": "GOAL (Participant2): 13.4%→29.6% — fade the overreaction",
          "frameTsISO": "2026-06-…T…Z",
          "proofHash": "3e740a2f"
        }
      ]
    }
  ]
}`}</Code>

        <p className="label mb-2 mt-6">webhook contract (push)</p>
        <p className="max-w-2xl text-sm leading-relaxed text-muted">
          In production the same Edge object is delivered by push instead of poll. Register a URL and
          a persistent worker watching the live TxLINE stream POSTs each new edge to it:
        </p>
        <Code>{`POST https://your-endpoint.example/agenthesis-signals
X-Agenthesis-Signature: sha256=<hmac of body with your secret>
Content-Type: application/json

{ "event": "signal.opened", "signal": { /* identical shape to the poll response */ } }`}</Code>
        <p className="mt-2 max-w-2xl text-xs text-faint">
          The poll endpoint above is the deterministic, always-available implementation (it replays
          the bundled real captures, since serverless throttles a live engine). The webhook is the
          production deployment of the identical contract over a persistent worker — same Edge, same
          proofHash, push instead of pull.
        </p>
      </section>

      <footer className="mt-10 border-t border-ink-600 pt-5 text-xs text-faint">
        Read the full thesis in the{" "}
        <Link href="/litepaper" className="prompt text-amber hover:text-fg">
          litepaper
        </Link>
        , or watch forecasters run it live on the{" "}
        <Link href="/desk" className="text-amber hover:text-fg">
          Signal Desk
        </Link>
        .
      </footer>
    </div>
  );
}
