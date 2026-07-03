// /api/v1/calibration — the PROVABLE track record (C).
//
// The read-only agent grades itself: every signal settled against its market's fair
// line at the reversion horizon (deterministic CLV leg) and, live, against the on-chain
// goals via validateStat (outcome leg, added by the worker). This endpoint serves the
// aggregate ledger — overall + per kind + per action + per-fixture breadth and single-
// match concentration — so the numbers can't hide behind a headline. `?detail=1` also
// returns the settled rows (each with its proofHash).
//
// Auth: `Authorization: Bearer <key>` or `X-Api-Key: <key>` (demo key ag_demo_2026).
import { NextResponse } from "next/server";
import { computeCalibration } from "@/lib/operator-feed.mjs";
import replaysData from "@/lib/replays.json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEMO_KEY = "ag_demo_2026";
function validKey(req: Request): boolean {
  const auth = req.headers.get("authorization");
  const bearer = auth?.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : null;
  const supplied = bearer || req.headers.get("x-api-key")?.trim() || null;
  if (!supplied) return false;
  const keys = new Set((process.env.OPERATOR_API_KEYS || "").split(",").map((k) => k.trim()).filter(Boolean));
  keys.add(DEMO_KEY);
  return keys.has(supplied);
}

let CACHE: ReturnType<typeof computeCalibration> | null = null;
function snapshot() {
  if (!CACHE) CACHE = computeCalibration(replaysData as unknown as Parameters<typeof computeCalibration>[0]);
  return CACHE;
}

export async function GET(req: Request) {
  if (!validKey(req)) {
    return NextResponse.json(
      { error: "unauthorized", message: "Provide an API key via 'Authorization: Bearer <key>' or 'X-Api-Key'." },
      { status: 401, headers: { "WWW-Authenticate": "Bearer" } },
    );
  }
  const detail = new URL(req.url).searchParams.get("detail") === "1";
  const { ledger, settled } = snapshot();
  const now = Date.now();
  return NextResponse.json({
    version: "1",
    generatedAt: now,
    source: "txline-capture-replay",
    method:
      "Verdict by ACTION at the +180s close: follow/hold are correct if the Fair Close Value (FCV) held within ±10pp of entry (the line stayed in its drift region — CLV sign is NOT the test, since a follow is taken at fair value); fade is correct if the overshoot genuinely reverted. goal_imminent settles on GOAL-ARRIVAL within 120s (ledger.imminent — the ~1.92× lift). Deterministic snapshot from real captured frames; the live worker adds the on-chain outcome leg via validateStat.",
    caveat:
      "Deterministic multi-match snapshot — a PILOT. Numbers reproduce from the bundled captures; target ~50–80 matches for a segmented, out-of-sample track record. avg CLV is auxiliary, not the follow/hold pass-fail test.",
    ledger,
    ...(detail ? { settled } : {}),
  });
}
