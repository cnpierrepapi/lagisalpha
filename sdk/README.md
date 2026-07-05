# Lagisalpha SDK

The product is the **signal API** (`GET /api/v1/signals`). This package is the
**optional in-process wrapper** around the identical pure functions, for
latency-sensitive consumers that run the classifier next to their own book
rather than over a network hop. You bring your own TxLINE feed and your own
prices; the SDK turns the demargined price book into typed, **read-only
line-integrity signals** — a clean move to follow, an overreaction to fade, a
goal about to make your line stale. You act on the signal; Lagisalpha never
places a bet, moves a price, or holds funds.

It is the exact code the API serves (SDK↔API parity) — pure functions, no I/O,
no clock reads, deterministic, and unit-tested. That is what makes it safe to
put next to a live book.

## What it gives you

| Primitive | Function | What it does |
| --- | --- | --- |
| **Detection** | `EdgeEngine` | Ingest the demargined book → emit typed, scored edges: `steam` (sharp fair-prob move), `overreaction` (post-goal overshoot), `quote` (micro-drift baseline). |
| **Classification** | `classifyEdge(edge, ctx)` / `goalImminent(scoreRec, ctx)` | Map an edge → a read-only signal: `steam` → follow, `overreaction` → hold/fade, plus `goal_imminent` off the momentum tape → suspend (with a quantified `goalProb`). Confidence, pickoffRisk, gapBps vs your price. |
| **Grading** | FCV-held · `scoreCLV(...)` (aux) | Follow/hold is graded on **Fair Close Value** holding within ±10pp of entry at the +180s close; fade on reversion; `goal_imminent` on goal-arrival lift. `scoreCLV` ships as the auxiliary CLV diagnostic. Resolves from odds alone, **no match outcome required**. |

You keep ownership of the two things an operator should own: the **feed** (you
push records in) and the **book** (your rule-set acts on the signal). The SDK is
the read-only benchmark in between.

## Quickstart

```js
import { EdgeEngine, classifyEdge, goalImminent } from "lagisalpha/sdk";

const engine = new EdgeEngine();                       // detection thresholds

engine.on("edge", (edge) => {
  const minute      = engine.matchMinute(edge.market.fixtureId);
  const watchedProb = myBook.impliedProbFor(edge.market); // YOUR price (optional)
  const signal = classifyEdge(edge, { minute, watchedProb });
  if (!signal) return;                                 // out-of-scope / no signal
  // signal.action in follow | hold | fade ; signal.pickoffRisk ; signal.gapBps
  myRuleSet.apply(signal);                             // YOUR book takes the action
});

engine.on("matchEvent", (rec) => {
  const imminent = goalImminent(rec, { minute: engine.matchMinute(rec.FixtureId) });
  if (imminent) myRuleSet.apply(imminent);             // suspend/widen before the line goes stale
});

engine.ingestOdds(txlineOddsRecord);                   // feed YOUR TxLINE stream
engine.ingestScores(txlineScoreRecord);
```

A runnable end-to-end walk over real captured TxLINE frames lives in
`examples/desk_quickstart.mjs`.

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
fractional Kelly capped at `KELLY_CAP`. The auxiliary CLV diagnostic is `back: r
= (p_close − p_entry)/p_entry = p_close·O_entry − 1` (`scoreCLV`), derived in
`lib/agent-core.mjs`. The **headline verdict**, though, is **Fair Close Value**:
because a follow enters at fair value its expected CLV is ~0, so a follow/hold is
scored as *right* when the line held within ±10pp of entry at the +180s close
(`lib/signals/`, served by `/api/v1/calibration`), and a fade on reversion.

## Determinism & deployment

Every function above is pure: same inputs → same outputs, no wall-clock, no
randomness. Run the engine as a **persistent worker** alongside your feed (the
edge lifecycle uses wall-time for TTL/cooldown, so it expects a continuous,
real-time stream — not a serverless request/response). Score, attribute, and
risk-check entirely from the returned values.
