// SIGNAL CLASSIFIER — the read-only core of Agenthesis (LOCKED framing, Jul 2 2026).
//
// Agenthesis is a *provable line-integrity oracle*: it benchmarks an operator's price
// against TxLINE's vig-free (demargined) consensus, warns when a line is stale enough to
// get picked off, and never touches the book. This module is the pure transform from the
// engine's reference-line dynamics (an `edge`) — plus, optionally, the operator's own
// watched price — into a read-only SIGNAL the operator's rule-set can act on.
//
// It is intentionally plain JS with NO I/O and NO clock reads (mirrors agent-core.mjs):
// every function is a pure mapping, so signals are deterministic and unit-testable.
//
// ───────────────────────────────────────────────────────────────────────────
// THE SIGNAL (locked shape)
//   { fixtureId, market, line, ts, minute, pRef, pWatched, gapBps, kind, action,
//     confidence, firedBy, revertLikely, pickoffRisk, direction, note }
//
//   kind    ∈ steam | overreaction | pregoal_warning
//   action  ∈ follow | hold | fade | suspend-suggested      (the OPERATOR acts, not us)
//
//   pRef      = TxLINE demargined fair prob (the truth we benchmark against)
//   pWatched  = the operator's / a watched book's implied prob at the same instant (optional)
//   gapBps    = signed (pWatched − pRef) in basis points  → the pickoff surface (null if no book)
//
// WHY these actions (grounded in the research AND re-checked against our own captures):
//   • steam         (Croxson & Reade 2014, EJ; Moskowitz 2021, JFE) — the market prices real
//                    news efficiently and momentum PERSISTS. A clean move is TRUE and carries →
//                    FOLLOW / tighten. THIS IS THE PRIMARY EDGE: in our 4-match data a flagged
//                    move HELD 89% of the time (54% extended further); a lagging book following
//                    late is exactly the stale price a sharp lifts. The oracle's core job is
//                    catching the real move fast so the operator isn't picked off on it.
//   • overreaction  (Choi & Hui 2014; De Bondt–Thaler) — bettors UNDERREACT to most goals and
//                    OVERREACT only to *surprising* ones, so only a MINORITY of goal-moves
//                    overshoot-and-revert. Our data: just ~18% of flagged overreactions genuinely
//                    reverted; 82% were efficient reprices that STUCK. And magnitude does NOT
//                    predict reversion (big goal-moves are usually decisive → they stick). So the
//                    default is HOLD (don't chase the volatile overshoot, don't blindly fade
//                    either), and we escalate to FADE only when the move is SURPRISE-driven
//                    (Choi–Hui's condition) — never on size alone.
//   • pregoal_warning — the momentum tape (high_danger_possession / PossibleEvent.Goal) fires
//                    seconds BEFORE the line jumps → SUSPEND-SUGGESTED. Validated by Wunderlich/
//                    Bundesliga 2025 (arXiv 2505.21275): markets partially ANTICIPATE goals from
//                    attacking-pressure signals. Near-exclusive to TxLINE's granular feed.
//
// NOTE: the engine also fires a low-conviction "quote" (micro-drift) edge. That is not part of
// the line-integrity product — classifyEdge() returns null for it.

const THRESH = { steam: 0.04, overreaction: 0.08 }; // pp move that defines each kind (mirrors engine DEFAULTS)
const FADE_CONF = 0.7;      // escalate hold → fade only above this confidence (default-to-safe below)
const SURPRISE_NORM = 0.15; // a ~15pp scoreline-prob jump at the event = maximal "surprise" (proxy)
const PICKOFF_BPS = { high: 150, med: 60 }; // |gap| in bps → pickoff-risk tiers

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

// "line=2.5" → 2.5 ; null when the market carries no line.
export function parseLine(marketParameters) {
  const m = /line=(-?\d+(?:\.\d+)?)/.exec(String(marketParameters || ""));
  return m ? Number(m[1]) : null;
}

// Compact human label for a market (fixture-agnostic): "OVERUNDER_PARTICIPANT_GOALS line=2.5 over".
function marketLabel(meta) {
  return `${meta.superOddsType} ${meta.marketParameters} ${meta.side}`.trim();
}

// Confidence ∈ [0,1] from the raw move magnitude, refined by SURPRISE when we know the
// pre-event fair prob. Magnitude alone is the honest fallback (firedBy:'magnitude'); the
// surprise-conditioned path (firedBy:'surprise') is the principled Choi–Hui upgrade.
function scoreConfidence(kind, edgeMeasure, fairProb, preEventProb) {
  const thr = THRESH[kind] ?? 0.04;
  const mag = clamp01(edgeMeasure / (2 * thr)); // 0.5 at threshold, 1.0 at 2× threshold
  if (preEventProb == null) return { confidence: mag, firedBy: "magnitude", surprise: null };
  const surprise = clamp01(Math.abs(fairProb - preEventProb) / SURPRISE_NORM);
  return { confidence: clamp01(0.5 * mag + 0.5 * surprise), firedBy: "surprise", surprise };
}

function pickoffTier(gapBps) {
  const g = Math.abs(gapBps);
  return g >= PICKOFF_BPS.high ? "high" : g >= PICKOFF_BPS.med ? "med" : "low";
}

// ── the main transform ──────────────────────────────────────────────────────
// edge : an engine-emitted edge (see lib/edge/engine.mjs — kind/market/edgeMeasure/fairProb/
//        direction/note, + optional preEventProb we surface for surprise).
// ctx  : { minute?, watchedProb?, preEventProb? }
//        watchedProb = the operator's / a naive-follow book's implied prob for THIS side, now.
// returns a read-only Signal, or null for kinds outside the line-integrity product.
export function classifyEdge(edge, ctx = {}) {
  if (!edge || (edge.kind !== "steam" && edge.kind !== "overreaction")) return null;

  const meta = edge.market;
  // DATA SCOPE (locked): only the two demargined goals markets are on-chain-settleable
  // via validate_stat (AH-goals + O/U-goals). 1X2 / anything else is out of scope — it
  // can't be Merkle-verified, so we never emit a signal we can't later prove.
  if (!/PARTICIPANT_GOALS/.test(String(meta.superOddsType))) return null;
  const pRef = edge.fairProb;
  const preEventProb = ctx.preEventProb ?? edge.preEventProb ?? null;
  const { confidence, firedBy, surprise } = scoreConfidence(edge.kind, edge.edgeMeasure, pRef, preEventProb);

  // action: steam → follow (the move is real and carries — the primary edge).
  // overreaction → HOLD by default; escalate to FADE only on the SURPRISE path (Choi–Hui:
  // overreactions come from surprising goals). We refuse to fade on magnitude alone, because
  // in our data big goal-moves are decisive and STICK — size does not predict reversion.
  const action =
    edge.kind === "steam"
      ? "follow"
      : firedBy === "surprise" && confidence >= FADE_CONF
        ? "fade"
        : "hold";
  // A real overshoot-and-revert is the exception (~18% of goal-moves in our data), and only a
  // fade (surprise-gated) is a positive reversion call; a plain hold is "don't chase / wait".
  const revertLikely = edge.kind === "overreaction" && action === "fade";

  // pickoff surface: only meaningful when we have the operator's price to compare.
  const pWatched = ctx.watchedProb ?? null;
  const gapBps = pWatched == null ? null : Math.round((pWatched - pRef) * 10000);
  // Risk the operator gets picked off:
  //   • overreaction → HIGH regardless — they're exposed to the coming revert whether their line
  //     matched the overshoot (loses on revert) or lags it (sharp hits the rich side). Default-safe.
  //   • steam (a TRUE move) → the exposure IS the gap: tight to the reference = safe, lagging =
  //     picked off. With no book to compare, fall back to how strong the move is.
  const pickoffRisk =
    edge.kind === "overreaction"
      ? "high"
      : gapBps != null
        ? pickoffTier(gapBps)
        : confidence >= FADE_CONF
          ? "med"
          : "low";

  return {
    fixtureId: meta.fixtureId,
    market: marketLabel(meta),
    superOddsType: meta.superOddsType,
    marketPeriod: meta.marketPeriod,
    side: meta.side,
    line: parseLine(meta.marketParameters),
    ts: edge.openedAt,
    minute: ctx.minute ?? null,
    inRunning: !!meta.inRunning,
    pRef,
    pWatched,
    gapBps,
    kind: edge.kind,
    action,               // the RECOMMENDATION — the operator's rule-set decides whether to act
    confidence: Math.round(confidence * 1000) / 1000,
    firedBy,              // 'surprise' (principled) | 'magnitude' (fallback) — honest provenance
    surprise: surprise == null ? null : Math.round(surprise * 1000) / 1000,
    revertLikely,
    pickoffRisk,
    direction: edge.direction, // engine's back/lay call on pRef (for CLV settlement later)
    edgeMeasure: edge.edgeMeasure,
    trigger: edge.trigger ?? null,
    note: edge.note,
  };
}

// ── pre-goal early warning (momentum tape) ──────────────────────────────────
// Fires off the scores stream BEFORE the line moves. Fixture-level (no market/line yet):
// the operator's rule-set uses it to suspend / widen in-play goals markets pre-emptively.
const DANGER_CONF = { high_danger_possession: 0.8, danger_possession: 0.45 };

export function pregoalWarning(scoreRec, ctx = {}) {
  if (!scoreRec) return null;
  const action = String(scoreRec.Action || "");
  const possibleGoal = scoreRec.PossibleEvent?.Goal === true || scoreRec.Data?.PossibleEvent?.Goal === true;
  let confidence = DANGER_CONF[action] ?? 0;
  if (possibleGoal) confidence = Math.max(confidence, 0.9);
  if (confidence <= 0) return null; // not a danger frame

  return {
    fixtureId: scoreRec.FixtureId,
    market: null,
    line: null,
    ts: Number(scoreRec.Ts) || null,
    minute: ctx.minute ?? null,
    inRunning: true,
    pRef: null,
    pWatched: null,
    gapBps: null,
    kind: "pregoal_warning",
    action: "suspend-suggested",
    confidence: Math.round(confidence * 1000) / 1000,
    firedBy: possibleGoal ? "possible_event" : "possession_tier",
    revertLikely: false,
    pickoffRisk: confidence >= 0.8 ? "high" : "med",
    direction: null,
    trigger: possibleGoal ? "PossibleEvent.Goal" : action,
    note: `goal-imminent (${possibleGoal ? "PossibleEvent.Goal" : action}) — in-play line about to go stale`,
  };
}

export const _internal = { THRESH, FADE_CONF, SURPRISE_NORM, PICKOFF_BPS, scoreConfidence, pickoffTier };
