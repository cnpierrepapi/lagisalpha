// POST /api/keys/claim — redeem a USDC payment for an API key.
//   body: { txId, tier: "month" | "lifetime", chain: "svm" | "evm", wallet? }
//   $97.99 USDC = 30-day key, $699.99 USDC = lifetime key. Returns the raw key exactly once.
import { NextResponse } from "next/server";
import { verifyPayment, type Chain } from "@/lib/payments";
import { issueKey, txAlreadyRedeemed, type Tier } from "@/lib/api-keys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Per-IP limiter: each claim attempt costs up to 5 upstream RPC calls, so cap the hot loop.
// In-memory, so per compute instance — instances are shared across concurrent requests, which
// covers the realistic single-client abuse case; a distributed attacker is out of scope here.
const WINDOW_MS = 3_600_000;
const MAX_PER_WINDOW = 10;
const attempts = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const hits = (attempts.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  if (hits.length >= MAX_PER_WINDOW) { attempts.set(ip, hits); return true; }
  hits.push(now);
  attempts.set(ip, hits);
  if (attempts.size > 5000) attempts.clear(); // bound the map under address churn
  return false;
}

export async function POST(req: Request) {
  const ip = (req.headers.get("x-forwarded-for") || "unknown").split(",")[0].trim();
  if (rateLimited(ip)) {
    return NextResponse.json({ error: "too many claim attempts — try again later" }, { status: 429 });
  }
  const body = await req.json().catch(() => ({}));
  const txId = String(body.txId || body.txSig || "").trim();
  const tier = body.tier as Tier;
  const chain = body.chain as Chain;
  const wallet = body.wallet ? String(body.wallet) : undefined;

  if (!txId || (tier !== "month" && tier !== "lifetime") || (chain !== "svm" && chain !== "evm")) {
    return NextResponse.json({ error: "txId, tier ('month' | 'lifetime') and chain ('svm' | 'evm') are required" }, { status: 400 });
  }
  if (await txAlreadyRedeemed(txId)) {
    return NextResponse.json({ error: "this transaction has already been redeemed" }, { status: 409 });
  }
  const v = await verifyPayment(chain, txId, tier);
  if (!v.ok) {
    return NextResponse.json({ error: v.error || "payment could not be verified" }, { status: 402 });
  }
  try {
    const { key, rec } = await issueKey(tier, txId, wallet, chain);
    return NextResponse.json({ key, tier, expiresAt: rec.expiresAt, chain: v.chain });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
