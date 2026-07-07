// USDC payment verification, chain-agnostic. Two recipients: a Solana (SVM) wallet and an EVM
// address. The buyer pays USDC to one of them and pastes the transaction id; we verify the transfer
// amount on-chain. No wallet connection, no KYC. USDC is 6 decimals on every chain.

export type Chain = "svm" | "evm";
export type Tier = "month" | "lifetime";

export const SVM_RECIPIENT = process.env.SVM_RECIPIENT || "vRgXLq8hScnbDzuGG6d6bzC21uVpyRkqNnXh75arVn5";
export const EVM_RECIPIENT = (process.env.EVM_RECIPIENT || "0x77Ff22f9413463e7Bf0EA00Ba1ecfcBbdb012e59").toLowerCase();

// Prices in USDC; MIN_BASE is the on-chain threshold in base units (6dp) with a 2-cent tolerance
// for rounding/fees so a legitimate payment is never rejected.
export const PRICE_USDC: Record<Tier, number> = { month: 97.99, lifetime: 699.99 };
const MIN_BASE: Record<Tier, number> = { month: 97_970_000, lifetime: 699_970_000 };

const SVM_RPC = process.env.SOLANA_RPC || "https://api.mainnet-beta.solana.com";
const USDC_MINT_SVM = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

// Major EVM chains + their native USDC contract (all lowercased for comparison). The default RPCs
// are free public endpoints; each can be pinned to a paid/trusted provider via EVM_RPC_<CHAIN>,
// which matters because the RPC answer is what a key is issued against. `confs` is the confirmation
// depth required before a payment counts (deeper on chains with a real reorg history).
const EVM_CHAINS: { name: string; rpc: string; usdc: string; confs: number }[] = [
  { name: "Ethereum", rpc: process.env.EVM_RPC_ETHEREUM || "https://eth.llamarpc.com", usdc: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", confs: 2 },
  { name: "Base", rpc: process.env.EVM_RPC_BASE || "https://mainnet.base.org", usdc: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", confs: 5 },
  { name: "Polygon", rpc: process.env.EVM_RPC_POLYGON || "https://polygon-rpc.com", usdc: "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359", confs: 15 },
  { name: "Arbitrum", rpc: process.env.EVM_RPC_ARBITRUM || "https://arb1.arbitrum.io/rpc", usdc: "0xaf88d065e77c8cc2239327c5edb3a432268e5831", confs: 5 },
  { name: "Optimism", rpc: process.env.EVM_RPC_OPTIMISM || "https://mainnet.optimism.io", usdc: "0x0b2c639c533813f4aa9d7837caf62653d097ff85", confs: 5 },
];
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

interface SvmBal { owner?: string; mint?: string; uiTokenAmount?: { amount?: string } }
interface SvmTx { meta?: { err?: unknown; preTokenBalances?: SvmBal[]; postTokenBalances?: SvmBal[] } }
interface EvmLog { address?: string; topics?: string[]; data?: string }
interface EvmReceipt { status?: string; blockNumber?: string; logs?: EvmLog[] }

async function rpc(url: string, method: string, params: unknown[]): Promise<unknown> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const j = (await r.json()) as { result?: unknown };
  return j?.result ?? null;
}

async function verifySvm(txSig: string, min: number): Promise<{ ok: boolean; chain?: string; error?: string }> {
  let res: SvmTx | null;
  try {
    // "finalized" (not "confirmed"): a key is irrevocable once issued, so wait for finality (~30s)
    res = (await rpc(SVM_RPC, "getTransaction", [
      txSig,
      { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "finalized" },
    ])) as SvmTx | null;
  } catch {
    return { ok: false, error: "could not reach Solana RPC, try again" };
  }
  if (!res) return { ok: false, error: "transaction not found or not yet finalized — wait ~30s and try again" };
  if (res.meta?.err) return { ok: false, error: "transaction failed on-chain" };
  const sum = (arr: SvmBal[] = []) =>
    arr.filter((b) => b.owner === SVM_RECIPIENT && b.mint === USDC_MINT_SVM).reduce((s, b) => s + Number(b.uiTokenAmount?.amount || 0), 0);
  const delta = sum(res.meta?.postTokenBalances) - sum(res.meta?.preTokenBalances);
  if (delta < min) return { ok: false, error: "no USDC payment of the tier amount to the recipient in this transaction" };
  return { ok: true, chain: "Solana" };
}

async function verifyEvm(txHash: string, min: number): Promise<{ ok: boolean; chain?: string; error?: string }> {
  const target = BigInt(min);
  for (const c of EVM_CHAINS) {
    let receipt: EvmReceipt | null;
    try {
      receipt = (await rpc(c.rpc, "eth_getTransactionReceipt", [txHash])) as EvmReceipt | null;
    } catch {
      continue;
    }
    if (!receipt) continue; // not on this chain
    if (receipt.status !== "0x1") return { ok: false, error: `transaction reverted on ${c.name}` };
    for (const log of receipt.logs || []) {
      if ((log.address || "").toLowerCase() !== c.usdc) continue;
      if ((log.topics?.[0] || "").toLowerCase() !== TRANSFER_TOPIC) continue;
      const to = "0x" + (log.topics?.[2] || "").slice(26).toLowerCase();
      if (to !== EVM_RECIPIENT) continue;
      try {
        if (BigInt(log.data || "0x0") >= target) {
          // a key is irrevocable once issued — require the block to be buried before it counts
          const latest = (await rpc(c.rpc, "eth_blockNumber", [])) as string | null;
          const depth = latest && receipt.blockNumber ? Number(BigInt(latest) - BigInt(receipt.blockNumber)) : 0;
          if (depth < c.confs) {
            return { ok: false, error: `payment found on ${c.name} but only ${depth}/${c.confs} confirmations — wait a moment and try again` };
          }
          return { ok: true, chain: c.name };
        }
      } catch {
        /* unparseable value, keep scanning */
      }
    }
    return { ok: false, error: `no USDC transfer of the tier amount to the recipient found on ${c.name}` };
  }
  return { ok: false, error: "transaction not found on any supported EVM chain (Ethereum, Base, Polygon, Arbitrum, Optimism)" };
}

export async function verifyPayment(chain: Chain, txId: string, tier: Tier): Promise<{ ok: boolean; chain?: string; error?: string }> {
  const min = MIN_BASE[tier];
  return chain === "svm" ? verifySvm(txId, min) : verifyEvm(txId, min);
}
