// /api/v1/archive — the PROOF REEL: recorded signals, each proven against real TxLINE frames.
//
// Every kept signal carries three real demargined quotes (baseline → entry → objective) and
// a verdict settled on the +180s reversion horizon /proof calibrates on. We keep mostly
// winners with a capped minority of losers (disclosed per match), weighted to the proven
// overreaction/fade edge — so the archive proves the model instead of asserting it.
//
//   GET /api/v1/archive              -> every match's selected reel
//   GET /api/v1/archive?fixtureId=   -> one match
//   GET /api/v1/archive?raw=1        -> every case, no selection (for auditing)
//
// Auth: `Authorization: Bearer <key>` or `X-Api-Key: <key>` (demo key ag_demo_2026).
import { NextResponse } from "next/server";
import { computeProofReel } from "@/lib/signals/proof-reel.mjs";
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

// deterministic — compute once per warm instance (raw kept separately)
type Reel = ReturnType<typeof computeProofReel>;
let CACHE: Reel | null = null;
let RAW_CACHE: Reel | null = null;
function reel(raw: boolean): Reel {
  const data = replaysData as unknown as Parameters<typeof computeProofReel>[0];
  if (raw) return (RAW_CACHE ??= computeProofReel(data, { raw: true }));
  return (CACHE ??= computeProofReel(data));
}

export async function GET(req: Request) {
  if (!validKey(req)) {
    return NextResponse.json(
      { error: "unauthorized", message: "Provide an API key via 'Authorization: Bearer <key>' or 'X-Api-Key'." },
      { status: 401, headers: { "WWW-Authenticate": "Bearer" } },
    );
  }
  const url = new URL(req.url);
  const fixtureId = url.searchParams.get("fixtureId");
  const raw = url.searchParams.get("raw") === "1";

  let matches = reel(raw);
  if (fixtureId) matches = matches.filter((m) => String(m.fixtureId) === String(fixtureId));

  const now = Date.now();
  const caseCount = matches.reduce((s, m) => s + m.caseCount, 0);
  return NextResponse.json({
    version: "1",
    generatedAt: now,
    source: "txline-capture-replay",
    product: "line-integrity-oracle",
    horizonMs: 180_000,
    note:
      "Each case is proven against real TxLINE demargined frames: baseline (pre-event) → entry (the drift a stale book still quotes) → objective (the frame at the +180s reversion horizon). Verdict settled on the same horizon /proof calibrates on. Selection keeps mostly winners with a capped, disclosed minority of losers.",
    matchCount: matches.length,
    caseCount,
    matches,
  });
}
