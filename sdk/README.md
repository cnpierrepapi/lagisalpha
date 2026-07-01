# Agenthesis SDK

Embed the edge-detection engine and the CLV decision core directly in your own
stack. This is the integration path for a **quantitative forecasting desk**: you
bring your own TxLINE feed and your own strategies; the SDK turns the demargined
price book into typed, scored signals and grades every call on closing-line
value — the skill metric, settled from odds alone.

It is the exact code the deployed product runs — pure functions, no I/O, no
clock reads, deterministic, and unit-tested (`scripts/agent_test.mjs`, 26
assertions). That is what makes it safe to put next to real execution.

## What it gives you

| Primitive | Function | What it does |
| --- | --- | --- |
| **Signal** | `EdgeEngine` | Ingest the demargined book → emit typed, scored edges: `steam` (sharp fair-prob move), `overreaction` (post-event overshoot), `quote` (micro-drift baseline). |
| **Decision** | `decide(agent, edge, ctx)` | Pure mapping from an edge + your lever set → a sized call (take / side / direction / conviction weight). Flat or fractional-Kelly. |
| **Scoring** | `markPosition(pos, closeProb)` / `scoreCLV(...)` | Closing-line value — the skill metric. Resolves from odds alone, **no match outcome required**. |

You keep ownership of the two things a desk should own: the **feed** (you push
records in) and the **execution** (you route the orders out). The SDK is the
quantitative layer in between.

## Quickstart

```js
import { EdgeEngine, defineStrategy, createAgent, decide, markPosition } from "agenthesis/sdk";

const engine = new EdgeEngine();                                  // detection thresholds
const strat  = defineStrategy({ stakeMode: "kelly" }, { label: "my-desk" });
const agent  = createAgent({ bankroll: 100_000, strategies: [strat] });

engine.on("edge", (edge) => {
  const minute = engine.matchMinute(edge.market.fixtureId);
  const open   = agent.positions.filter((p) => p.status === "open").length;
  const d = decide(agent, edge, { minute, openCount: open });
  if (d.take) execution.place(d);                                 // YOU route the order
});

engine.ingestOdds(txlineOddsRecord);                              // feed YOUR stream
engine.ingestScores(txlineScoreRecord);
```

A complete, runnable end-to-end backtest on real captured TxLINE frames:

```bash
node examples/desk_quickstart.mjs
# Feeding Brazil v Japan — 13319 odds + 971 score frames…
# 18149 edges -> 11 calls · hit-rate 91% · avg CLV +49.54%
```

> This is a single captured match with loose demo levers, so the sample is tiny
> (11 settled calls) and CLV runs hot — the frames are a pre-match run-up where
> the book drifts hard into kickoff. Production levers settle far tighter (~3%
> avg CLV over the full exec ledger); the point of the example is the wiring, not
> the return.

## API

- **`new EdgeEngine(opts?)`** — detection. Methods: `ingestOdds(rec)`,
  `ingestScores(rec)`, `on("edge"|"edgeClosed"|"matchEvent", cb)`,
  `openEdges()`, `fairProbForMarket(market)`, `matchMinute(fixtureId)`,
  `stake(edgeId, amount)`. `opts` tune thresholds/windows (`steamThreshold`,
  `overreactionThreshold`, `quoteThreshold`, `*WindowMs`, `historyMs`,
  `edgeTtlMs`, `edgeCooldownMs`).
- **`defineStrategy(levers?, { label, edgeKinds }?)`** — a lever set gated to
  edge kinds. Levers: `minConviction`, `stakeMode` (`flat`|`kelly`), `stakePct`,
  `kellyFraction`, `phase`, `minMinute`/`maxMinute`, `marketFilter`,
  `oddsMin`/`oddsMax`, `maxConcurrent`, `direction` (`follow`|`fade`).
- **`createAgent({ bankroll, strategies, ... })`** — an agent runs its
  strategies in order; the first that greenlights an edge takes it.
- **`decide(agent, edge, { minute, openCount })`** → `{ take, reason, side,
  direction, stake, entryProb, entryOdds, ... }`. Pure.
- **`markPosition(pos, closeProb)`** / **`scoreCLV({ entryProb, direction,
  stake }, closeProb)`** → `{ clvReturn, pnl }`. Pure.
- Constants: `CONTINUATION_COEFF`, `KELLY_CAP`, `CLV_FLOOR`, `CLV_CEIL`.

## The model

TxLINE publishes a de-margined (no-vig) book, so for side *S*: `p = 1 /
(price/1000)`, `O = 1/p`, `b = O − 1`. An edge of magnitude *m* (probability
units) implies expected captured move `ê = κ·m` (`κ = CONTINUATION_COEFF`),
expected return `e = ê / p_entry`, and Kelly fraction `f* = e / b`, applied as
fractional Kelly capped at `KELLY_CAP`. Settlement is **CLV**: `back: r =
(p_close − p_entry)/p_entry = p_close·O_entry − 1`. The full derivation is in
`lib/agent-core.mjs`.

## Determinism & deployment

Every function above is pure: same inputs → same outputs, no wall-clock, no
randomness. Run the engine as a **persistent worker** alongside your feed (the
edge lifecycle uses wall-time for TTL/cooldown, so it expects a continuous,
real-time stream — not a serverless request/response). Score, attribute, and
risk-check entirely from the returned values.
