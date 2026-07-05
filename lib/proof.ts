// PROOF OF ACCESS — the Solana touchpoint.
//
// Lagisalpha ingests TxLINE's data layer, which is itself anchored on Solana.
// Access to that feed is minted by a real on-chain SUBSCRIBE transaction signed
// with a Solana wallet ("sign up through Solana"): that transaction's signature
// is a public, verifiable hash. We surface it so anyone can confirm the data the
// agents trade comes from the genuine, on-chain-authorised TxLINE stream.

export interface Proof {
  signedOnSolana: boolean;
  cluster: string;
  signupTx: string | null;
  apiBase: string | null;
  explorerUrl: string | null;
}

export function getProof(): Proof {
  const cluster = process.env.TXLINE_CLUSTER || "devnet";
  const signupTx = process.env.TXLINE_SIGNUP_TX || null;
  const apiBase = process.env.TXLINE_API_BASE || null;
  const explorerCluster = cluster === "mainnet" ? "mainnet-beta" : "devnet";
  const explorerUrl = signupTx
    ? `https://explorer.solana.com/tx/${signupTx}?cluster=${explorerCluster}`
    : null;
  return { signedOnSolana: !!signupTx, cluster, signupTx, apiBase, explorerUrl };
}
