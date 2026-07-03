// FRAME PROOF — the single fingerprint that ties a signal to the exact real
// TxLINE frame it was derived from. Shared by the autonomous runner (proof of a
// trade) and the operator API (proof of a published edge) so the two agree
// byte-for-byte and an operator can reconcile either against the frame ledger.
//
// FNV-1a over the frame identity (fixture | market | side | fair prob | kind),
// 8 hex chars. Deterministic, no clock, no randomness.
function fnv1a(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

// ENTRY leg — fingerprint of the frame the edge (and thus the trade) was taken on.
export function edgeProofHash(edge) {
  return fnv1a(
    `${edge.market.fixtureId}|${edge.market.superOddsType}|${edge.market.marketParameters}|${edge.market.side}|${edge.fairProb.toFixed(4)}|${edge.kind}`,
  );
}

// EXIT leg — same identity space as the entry hash, computed on the exit frame's
// fair prob. So the closing leg is fingerprinted and reconcilable exactly like
// the entry: both join to a real frame in the verification ledger.
export function markProofHash(market, prob, kind) {
  return fnv1a(
    `${market.fixtureId}|${market.superOddsType}|${market.marketParameters}|${market.side}|${prob.toFixed(4)}|${kind}`,
  );
}

// GOAL-IMMINENT leg — a goal_imminent signal fires off the SCORE tape, not a priced
// market, so it has no fair prob/side. Fingerprint its own identity space (fixture |
// score-frame ts | trigger | kind) so it still joins to a real TxLINE frame in the ledger.
export function scoreProofHash(sig) {
  return fnv1a(`${sig.fixtureId}|${sig.ts}|${sig.trigger}|${sig.kind}`);
}
