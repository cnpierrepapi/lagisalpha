// /api/verify-csv — download the verification CSV.
//
// One row per real ingested TxLINE frame (original timestamp + prices) with the
// forecaster call tallied inline where one fired. TxLINE's team can reconcile
// (fixture_id, frame_ts_ms, prices) against their own database, and see exactly
// what the autonomous agents did on each frame.
//
// Execution overlay: we ship a CANONICAL recorded ledger (lib/exec-ledger.json —
// real trades from a full replay on these exact frames) so the export is
// complete and reproducible on any instance. If the live runner happens to have
// a richer history (a warm instance serving the /proof feed), we use that.
import { getRunner } from "@/lib/runner";
import { buildVerificationCsv, type VerifyTrade } from "@/lib/verify";
import ledger from "@/lib/exec-ledger.json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const canonical = ledger as unknown as VerifyTrade[];
  const live = ((getRunner().snapshot().trades as unknown as VerifyTrade[]) ?? []).filter((t) => t.fixtureId != null);
  const trades = live.length >= canonical.length ? live : canonical;

  const { csv, frameCount, tradedFrameCount, matchCount } = buildVerificationCsv(trades);

  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="agenthesis-txline-verification-${stamp}.csv"`,
      "Cache-Control": "no-store",
      "X-Frame-Count": String(frameCount),
      "X-Traded-Frames": String(tradedFrameCount),
      "X-Match-Count": String(matchCount),
      "X-Trade-Count": String(trades.length),
    },
  });
}
