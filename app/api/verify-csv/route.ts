// /api/verify-csv — download the verification CSV.
//
// One row per real ingested TxLINE frame (original timestamp + prices) with the
// agent execution tallied inline where a bet fired. TxLINE's team can reconcile
// (fixture_id, frame_ts_ms, prices) against their own database, and see exactly
// what the autonomous agents did on each frame.
import { getRunner } from "@/lib/runner";
import { buildVerificationCsv, type VerifyTrade } from "@/lib/verify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 25;

export async function GET() {
  const runner = getRunner();
  // On a cold serverless instance the runner has just booted with no trades yet.
  // The replay starts firing within a second or two, so wait for a meaningful
  // batch of executions before exporting (frame rows are always complete; this
  // only fills the execution tally). A warm instance — e.g. one already serving
  // the /proof live feed — returns immediately with its full history.
  let snap = runner.snapshot();
  for (let i = 0; i < 40 && (snap.tradeCount ?? 0) < 25; i++) {
    await new Promise((r) => setTimeout(r, 400));
    snap = runner.snapshot();
  }
  const trades = (snap.trades as unknown as VerifyTrade[]) ?? [];
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
    },
  });
}
