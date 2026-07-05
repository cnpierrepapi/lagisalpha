# Lagisalpha — Build TODO (🔒 LOCKED framing, Jul 2 2026)

## What Lagisalpha IS (the one sentence — put verbatim in README + litepaper)
> **Lagisalpha is an independent, read-only agent that benchmarks a betting operator's
> prices against TxLINE's vig-free (demargined) consensus, warns them the instant a line
> goes stale enough to get picked off, and settles every warning it makes on-chain — so its
> track record is provable, not asserted.**

Category = **provable line-integrity oracle**. NOT a bookmaker, market-maker, or managed-
trading service. It is the neutral referee Sportradar MTS / Genius Edge structurally cannot
be (they are player + referee at once; their outcomes are asserted, not anchored).

### The boundary that makes it adoptable (do not cross it)
- **Read-only.** The agent EMITS a signal. It never places a bet, never moves a price,
  never holds funds. **The operator's own rule-set takes the action.** That boundary is the
  product — it's why compliance lets it in the door and why it carries no gambling/securities
  reg surface (it's a data/analytics tool). We supply SIGNAL + PROOF; they supply the ACTION.
- **The old "Overreaction Firewall / repricing autopilot" is DEMOTED to "the operator's
  rule-set"** — their side of the boundary, shown in the demo as a policy file, not our product.

### Why we stopped short of repricing (the research, Jul 2 2026)
Sportradar MTS (200+ clients, 87B selections/yr) and Genius **Edge** (dynamic repricing,
+18% margin) already own repricing. A startup repricing engine = walk into their machine gun
AND it's the exact thing operators fear handing an unknown vendor. Neutral, provable
benchmarking is their structural blind spot — and the one thing only TxLINE's on-chain
settlement enables.

---

## PRODUCT SHAPE (decided)
- **The Signal API is the product** — `GET /api/v1/signals` (judge-testable, required). SDK =
  ergonomic in-process wrapper (hot loop can't pay a per-tick network hop). Web app = the
  proof/control-room that carries the 5-min demo. *"Agents are the engine; the feed is the
  product; the app is the proof."*
- **Engine is UNCHANGED** — `lib/edge/engine.mjs` keeps per-market history + fires
  `steam` / `overreaction` + emits `matchEvent` (goals/cards). We ADD the momentum-tape
  pre-goal warning and the on-chain self-grading. Nothing about the core detector is rebuilt.

## ⭐ INFRA-SUPPORT-AFTER-WIN (REQUIRED copy in README + litepaper)
A production line-integrity signal is a **latency game — the warning is only worth money if it
beats the pickoff by milliseconds.** That requires direct / co-located TxLINE feed access and
low-latency infra only TxOdds can provision. **So winning is the START of a continuing TxOdds
partnership (direct-feed + infra support), not the end.** State this explicitly as the reason
we need ongoing support. (README "Why continuous support" section + litepaper infra section.)

## DATA SCOPE — LOCKED (verified: OpenAPI docs.yaml + all live captures)
- Demargined feed streams EXACTLY two goal-settled markets: `ASIANHANDICAP_PARTICIPANT_GOALS`
  + `OVERUNDER_PARTICIPANT_GOALS`. Fair reference = `TXLineStablePriceDemargined` `Pct` (no-vig).
- Momentum tape (scores stream `Action`): `high_danger_possession` / `danger_possession` +
  `PossibleEvent.Goal` = the pre-goal early-warning source (near-exclusive to TxLINE).
- On-chain: 8 stats (goals/yellow/red/corners ×2); `validate_stat` proves goal counts vs the
  daily-scores Merkle root. Odds are LIVE-ONLY (capture as they play); scores backfill.

---

## STATUS (local, UNPUSHED — Jul 2 2026)
A + B + C + D engine layers BUILT, tested, verified against real captures. Nothing committed/
pushed (live worker mid-capture). 79 assertions green (26 agent + 53 signals), tsc + build clean.
- **A** ✅ `lib/signals/classify.mjs` (steam→follow, overreaction→hold/fade, pre-goal warning,
  surprise conditioning, goals-only scope guard). Engine surfaces `preEventProb`.
- **B** ✅ `GET /api/v1/signals` = classified signals (own route; `/edges` kept as raw alias).
  `computeOperatorSignals`. SDK re-exports `classifyEdge`; `lib/signals` added to package `files`.
- **C** ✅ `lib/signals/settle.mjs` + `calibration.mjs` + `computeCalibration` + `GET /api/v1/calibration`.
  Reversion-horizon CLV settlement REPRODUCES the edge from the productized path: overreaction/fade
  18/18 CLV-positive, steam 34%/negative (dead). On-chain leg = `worker/settle_signals.mjs` +
  `worker/signals_schema.sql` (ARTIFACTS, not run — faucet dead, worker busy).
- **D** ✅ `lib/signals/{frames,naive-book,policy}.mjs` + `computeControlRoom` + `GET /api/v1/control-room`.
  Naive-follow book → pWatched/gapBps → operator DEMO_POLICY fires the action. Boundary visible.
- PENDING: UI render (/proof calibration page, /desk control-room view) + live on-chain settle run +
  README/litepaper reframe. Do when we can push.

## BUILD TODAY — ordered

### A. Signal engine → read-only signal shape  (core)
- [ ] `lib/signals/classify.mjs` — pure classifier over engine history. For each divergence emit
      `{fixtureId, market, line, ts, minute, pRef, pWatched, gapBps, kind, action, confidence}`
      where `kind ∈ steam | overreaction | pregoal_warning`, `action ∈ follow | fade | hold |
      suspend-suggested`, and `gapBps` = signed bps vs the demargined `Pct`. Deterministic.
- [ ] **Pre-goal warning:** on `high_danger_possession` / `PossibleEvent.Goal` → emit a
      `pregoal_warning` ("goal-imminent, in-play line about to go stale") BEFORE the line jumps.
- [ ] **Surprise conditioning** (the principled upgrade): compute surprise from the *pre-goal*
      fair prob; surprising goal → overreaction (fade/hold), expected goal → efficient (follow).
      Keep the current magnitude/pattern firing as fallback; log which fired.
- [ ] **DROP the steam-follow *edge claim*** in copy (52%, dead) but KEEP steam as a
      "clean move → tighten, this is real" *classification* (needed so we're not a 1-trick fader).

### B. Signal API — the product
- [ ] `GET /api/v1/signals` returns the live signal list (params: `fixtureId`, `kind`,
      `minConfidence`, `limit`; auth `X-Api-Key`, demo key `ag_demo_2026`). Read-only. Each row
      carries `proofHash` (entry frame) + `pending` settlement status.
- [ ] SSE variant `/api/v1/signals/stream` for real-time consumers.
- [ ] `sdk/` re-exports `classify`, the signal shape, and a `connect()` helper (in-process).

### C. On-chain self-grading → provable calibration ledger  (the moat)
- [ ] `worker/settle_signals.mjs` — on FT, pull final goals via `validate_stat`
      (`/api/scores/stat-validation`, PDA `["daily_scores_roots", u16LE(epochDay)]`) and settle
      EVERY emitted signal two ways: (a) did the fair line revert toward the call (CLV realized)?
      (b) did the goals outcome confirm the market side? Append to a durable ledger.
- [ ] `signals` table (foil Supabase): the emitted signal + settlement + on-chain
      `statValidationProof` / receipt. Anon-read, service-role-write.
- [ ] `/proof` (Verification) — the public calibration ledger: hit-rate, avg CLV, sample n,
      and per-signal "verify on-chain" receipt. **"Don't trust us — verify the chain."**
      ⚠️ `.view()` needs a funded system-owned `SOLANA_SIM_PAYER`; treat sim-fail as `pending`
      not `failed` (see reference_validate_stat_settlement).

### D. The demo control-room (`/desk` or `/launch`)
- [ ] Live ingest panel: demargined ticks + momentum tape for the current fixture.
- [ ] **The pickoff caught:** high_danger → goal → overshoot; agent flags
      `overreaction · pickoff-risk HIGH · revert-likely` before it reverts.
- [ ] **Read-only boundary made visible:** load an operator **policy file** (our JSON rule DSL —
      we define the format) → a rule fires "widen margin 4% / cut limit / suspend" → caption:
      *"the signal is ours, the action is theirs — we never touched the book."*
- [ ] After FT: the calibration ledger row updates with the on-chain receipt (the closing beat).
- [ ] No-match state: show the call history + recorded-match chips.

### E. Docs — reframe to the lock
- [ ] README: the one-sentence definition (top), the read-only boundary, the 5 TxLINE endpoints,
      **the "Why continuous support" (latency/direct-feed) section**, honest evidence note
      (6-match pilot, 84% fade, needs ~50–80 for a segmented track record).
- [ ] Litepaper: same lock + independent-referee positioning vs Sportradar/Genius + the
      infra-support-after-win rationale + the on-chain-proof moat. (We will re-edit everything.)
- [ ] Kill any surviving "repricing engine / firewall as OUR product" language → it's the
      operator's rule-set now.

## SDK / API posture (unchanged decision)
- ONE JS SDK (re-export of `lib/`) + ONE API (REST + SSE). No speculative multi-language SDKs.
- SDK exports: `classify` + signal schema, `markPosition`→CLV (settlement grading), `connect()`.
- DROPPED for good: fill reconciliation, inventory ledger, maker-PnL, take-profit/arena,
  quote()/bid-ask — none of that survives the read-only lock. Signals + on-chain proof only.

## Test plan
- [ ] Golden-frame determinism: fixed captures → byte-identical `classify` output.
- [ ] Property: `gapBps` sign matches direction; confidence ∈ [0,1]; pregoal_warning fires on
      the momentum action and BEFORE the goal frame.
- [ ] Parity: SDK `classify` output == `/api/v1/signals` payload for identical input.
- [ ] Settlement: every settled signal's on-chain receipt re-verifies against the daily root;
      sim-payer-missing → `pending` not `failed`.
- [ ] `npm pack` → install tarball → run README snippet (exports map resolves).

## Honest status
- Edge = **6 clean matches, 84% overreaction/fade** (z=4.52, p=6e-6) = a **pilot, not proof**;
  steam-follow dead (52%). Fix = log live WC matches toward ~50–80. Say this in the pitch.
- Deadline **Jul 19 2026**. Matches end before judging → demo runs on a RECORDED live session;
  capture one clean mainnet in-play session on camera as the proof segment.
