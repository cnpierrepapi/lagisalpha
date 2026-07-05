"use client";

import { useState } from "react";
import { Connection, PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL } from "@solana/web3.js";

type PhantomProvider = {
  isPhantom?: boolean;
  publicKey?: { toString(): string };
  connect: () => Promise<{ publicKey: { toString(): string } }>;
  signAndSendTransaction: (tx: Transaction) => Promise<{ signature: string }>;
};
declare global {
  interface Window {
    solana?: PhantomProvider;
  }
}

const RPC = "https://api.mainnet-beta.solana.com";

export default function ApiAccess({ recipient }: { recipient: string }) {
  const [tier, setTier] = useState<"month" | "lifetime">("month");
  const [txSig, setTxSig] = useState("");
  const [wallet, setWallet] = useState("");
  const [busy, setBusy] = useState("");
  const [result, setResult] = useState<{ key?: string; error?: string; expiresAt?: number | null } | null>(null);

  const price = tier === "month" ? 1 : 7;

  const claimWith = async (sig: string, w?: string) => {
    const r = await fetch("/api/keys/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ txSig: sig.trim(), tier, wallet: w || wallet.trim() || undefined }),
    });
    setResult(await r.json());
  };

  const payWithPhantom = async () => {
    const prov = typeof window !== "undefined" ? window.solana : undefined;
    if (!prov?.isPhantom) {
      setResult({ error: "Phantom wallet not found. Install Phantom, or pay manually below." });
      return;
    }
    setBusy("pay");
    setResult(null);
    try {
      const resp = await prov.connect();
      const from = new PublicKey(resp.publicKey.toString());
      const conn = new Connection(RPC, "confirmed");
      const { blockhash } = await conn.getLatestBlockhash();
      const tx = new Transaction({ recentBlockhash: blockhash, feePayer: from });
      tx.add(SystemProgram.transfer({ fromPubkey: from, toPubkey: new PublicKey(recipient), lamports: price * LAMPORTS_PER_SOL }));
      const { signature } = await prov.signAndSendTransaction(tx);
      setBusy("confirm");
      await conn.confirmTransaction(signature, "confirmed");
      await claimWith(signature, resp.publicKey.toString());
    } catch (e) {
      setResult({ error: (e as Error).message || "payment failed" });
    } finally {
      setBusy("");
    }
  };

  const claimManual = async () => {
    setBusy("manual");
    setResult(null);
    try {
      await claimWith(txSig);
    } catch {
      setResult({ error: "network error" });
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="card p-5">
      {/* tier */}
      <div className="flex flex-wrap gap-3">
        {(["month", "lifetime"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTier(t)}
            className={`flex-1 rounded border p-4 text-left ${tier === t ? "border-amber-dim bg-amber/10" : "border-ink-600 hover:border-ink-500"}`}
          >
            <p className="serif text-2xl text-paper">{t === "month" ? "1 SOL" : "7 SOL"}</p>
            <p className="text-xs text-muted">{t === "month" ? "28-day access" : "lifetime access"}</p>
          </button>
        ))}
      </div>

      {/* one-click */}
      <button
        onClick={payWithPhantom}
        disabled={!!busy}
        className="mt-5 w-full rounded border border-amber-dim bg-amber/10 px-4 py-2.5 font-semibold text-amber hover:bg-amber/20 disabled:opacity-40"
      >
        {busy === "pay" ? "approve in Phantom…" : busy === "confirm" ? "confirming on-chain…" : `Connect Phantom & pay ${price} SOL`}
      </button>

      {/* manual fallback */}
      <details className="mt-4">
        <summary className="cursor-pointer text-xs text-faint hover:text-fg">or pay manually (any wallet)</summary>
        <ol className="mt-3 space-y-3 text-sm text-muted">
          <li>
            <span className="text-faint">1.</span> Send <span className="text-amber">{price} SOL</span> to:
            <div className="mt-1 select-all break-all rounded border border-ink-700 bg-ink-900 px-2 py-1.5 font-mono text-xs text-fg">{recipient}</div>
          </li>
          <li>
            <span className="text-faint">2.</span> Paste the transaction signature:
            <input
              value={txSig}
              onChange={(e) => setTxSig(e.target.value)}
              placeholder="the Solana tx signature"
              className="mt-1 w-full rounded border border-ink-600 bg-transparent px-2 py-1.5 font-mono text-xs text-fg"
            />
          </li>
          <li>
            <span className="text-faint">3.</span>{" "}
            <button
              onClick={claimManual}
              disabled={!!busy || !txSig.trim()}
              className="rounded border border-ink-600 px-3 py-1.5 text-muted hover:text-fg disabled:opacity-40"
            >
              {busy === "manual" ? "verifying…" : "Claim my key"}
            </button>
          </li>
        </ol>
      </details>

      {result?.key && (
        <div className="mt-5 rounded border border-amber-dim bg-amber/5 p-4">
          <p className="text-xs text-muted">Your API key (shown once, save it now):</p>
          <p className="mt-1 select-all break-all font-mono text-sm text-amber">{result.key}</p>
          <p className="mt-2 text-xs text-faint">
            {result.expiresAt ? `expires ${new Date(result.expiresAt).toISOString().slice(0, 10)}` : "lifetime access"} · send it as{" "}
            <span className="font-mono">Authorization: Bearer {"<key>"}</span>
          </p>
        </div>
      )}
      {result?.error && <p className="mt-4 text-sm text-loss">{result.error}</p>}
    </div>
  );
}
