// BROWSER → foil Supabase (anon, read-only mirror + control queue).
//
// When the EC2 worker is live it mirrors the runner into Supabase; the desk
// reads that here directly (no Vercel function in the data path → near-zero
// Hobby usage). If the env vars are absent, every function no-ops and the desk
// falls back to the in-app SSE replay — so this is safe to ship without keys.

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SESSION = process.env.NEXT_PUBLIC_DESK_SESSION || "live";
const FRESH_MS = 30_000; // mirror older than this ⇒ treat EC2 as offline

export const remoteConfigured = !!(URL && ANON);

function headers(): HeadersInit {
  return { apikey: ANON as string, Authorization: `Bearer ${ANON}` };
}

export interface RemoteAgent {
  id: string;
  name: string;
  title: string;
  edgeKinds: string[];
  status: "running" | "paused" | "stopped";
  bankroll: number;
  startBankroll: number;
  dayPnl: number;
  bets: number;
  wins: number;
  losses: number;
  openPositions: number;
  unrealized: number;
}

export interface RemoteTrade {
  ts: number;
  agentId: string;
  agent: string;
  kind: string;
  match: string;
  side: string;
  direction: string;
  odds: number;
  stake: number;
  proofHash: string;
  status: string;
  clvReturn: number;
  pnl: number;
}

export interface RemoteSnapshot {
  fresh: boolean;
  mode: string;
  status: string;
  totalIngested: number;
  proof?: unknown;
  provenance?: unknown;
  agents: RemoteAgent[];
  trades: RemoteTrade[];
}

async function get(path: string): Promise<unknown[]> {
  const res = await fetch(`${URL}/rest/v1/${path}`, { headers: headers(), cache: "no-store" });
  if (!res.ok) throw new Error(`supabase ${res.status}`);
  return res.json();
}

// Returns the mirror, or null when unconfigured/unreachable. `fresh` is false
// when the worker hasn't pushed within FRESH_MS (EC2 down → caller uses SSE).
export async function fetchRemoteSnapshot(): Promise<RemoteSnapshot | null> {
  if (!remoteConfigured) return null;
  try {
    const [metaRows, agentRows, tradeRows] = await Promise.all([
      get(`desk_meta?id=eq.${SESSION}&select=*`),
      get(`desk_agents?session=eq.${SESSION}&select=*&order=name.asc`),
      get(`desk_trades?session=eq.${SESSION}&select=*&order=ts.desc&limit=100`),
    ]);
    const meta = (metaRows as Record<string, unknown>[])[0];
    if (!meta) return null;
    const updated = Date.parse(String(meta.updated_at));
    const fresh = Number.isFinite(updated) && Date.now() - updated < FRESH_MS;

    const agents: RemoteAgent[] = (agentRows as Record<string, unknown>[]).map((a) => ({
      id: String(a.id),
      name: String(a.name),
      title: String(a.title),
      edgeKinds: (a.edge_kinds as string[]) ?? [],
      status: a.status as RemoteAgent["status"],
      bankroll: Number(a.bankroll),
      startBankroll: Number(a.start_bankroll),
      dayPnl: Number(a.day_pnl),
      bets: Number(a.bets),
      wins: Number(a.wins),
      losses: Number(a.losses),
      openPositions: Number(a.open_positions),
      unrealized: Number(a.unrealized),
    }));
    const trades: RemoteTrade[] = (tradeRows as Record<string, unknown>[]).map((t) => ({
      ts: Number(t.ts),
      agentId: String(t.agent_id),
      agent: String(t.agent),
      kind: String(t.kind),
      match: String(t.match),
      side: String(t.side),
      direction: String(t.direction),
      odds: Number(t.odds),
      stake: Number(t.stake),
      proofHash: String(t.proof_hash),
      status: String(t.status),
      clvReturn: Number(t.clv_return),
      pnl: Number(t.pnl),
    }));

    return {
      fresh,
      mode: String(meta.mode ?? "live"),
      status: String(meta.status ?? ""),
      totalIngested: Number(meta.total_ingested ?? 0),
      proof: meta.proof,
      provenance: meta.provenance,
      agents,
      trades,
    };
  } catch {
    return null;
  }
}

// Queue a pause/stop/resume the EC2 worker will pick up within a few seconds.
export async function sendRemoteControl(agentId: string, op: "pause" | "resume" | "stop"): Promise<boolean> {
  if (!remoteConfigured) return false;
  try {
    const res = await fetch(`${URL}/rest/v1/desk_controls`, {
      method: "POST",
      headers: { ...headers(), "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify([{ session: SESSION, agent_id: agentId, op }]),
    });
    return res.ok;
  } catch {
    return false;
  }
}
