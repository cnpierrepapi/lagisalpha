// FRAME PROOF — the single fingerprint that ties a signal to the exact real
// TxLINE frame it was derived from. Shared by the autonomous runner (proof of a
// trade) and the operator API (proof of a published edge) so the two agree
// byte-for-byte and an operator can reconcile either against the frame ledger.
//
// FNV-1a over the frame identity (fixture | market | side | fair prob | kind),
// 8 hex chars. Deterministic, no clock, no randomness.
export function edgeProofHash(edge) {
  const s = `${edge.market.fixtureId}|${edge.market.superOddsType}|${edge.market.marketParameters}|${edge.market.side}|${edge.fairProb.toFixed(4)}|${edge.kind}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
