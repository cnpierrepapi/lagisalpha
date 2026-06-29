// FEED — the single upstream that powers the engine.
//
// Two sources:
//   • "live"  — the real TxLINE odds + scores SSE streams (token held in env).
//   • "synth" — a deterministic, seeded generator that produces drifting odds,
//               steam jumps, and a scripted goal so the autonomous runner is
//               demoable with NO live match (matches end before judging).
//
// Default is synth unless FEED_MODE=live AND a token is present. One engine per
// process, stashed on globalThis so Next's HMR / route re-entry reuse it.

import { EdgeEngine } from "./edge/engine.mjs";
import { openStream, txlineCreds } from "./txline/stream";
import type { Edge } from "./edge/types";

export type FeedMode = "synth" | "live";
export type FeedStatus = "idle" | "starting" | "live" | "error";

export interface EngineLike {
  on(ev: "edge" | "edgeClosed", cb: (e: Edge) => void): void;
  on(ev: "matchEvent", cb: (e: { fixtureId: string | number; label: string; ts: number }) => void): void;
  ingestOdds(rec: Record<string, unknown>): void;
  ingestScores(rec: Record<string, unknown>): void;
  stake(id: string, amt: number): { ok: boolean; accepted?: number; remaining?: number; reason?: string };
  openEdges(): Edge[];
  fairProbForMarket(meta: unknown): number | null;
  matchMinute(fid: string | number): number | null;
}

export interface FeedHandle {
  engine: EngineLike;
  mode: FeedMode;
  status: FeedStatus;
  startedAt: number;
  error?: string;
  labels: Map<string, string>; // fixtureId -> "P1 v P2"
}

const SYNTH_OPTS = {
  steamThreshold: 0.04,
  steamWindowMs: 8_000,
  overreactionThreshold: 0.08,
  overreactionWindowMs: 25_000,
  historyMs: 60_000,
  edgeTtlMs: 25_000,
  edgeCooldownMs: 12_000,
};

// ---- deterministic PRNG (mulberry32) -----------------------------------
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface SynthFixture {
  id: string;
  p1: string;
  p2: string;
  pOver: number;
  seconds: number;
  goals1: number;
  goals2: number;
  reds1: number;
  reds2: number;
  momDir: number; // steam continuation: +1/-1 for a few ticks after a jump
  momTicks: number;
  revPer: number; // event reversion: per-tick drift back after an overshoot
  revTicks: number;
}

function emitOdds(engine: EngineLike, f: SynthFixture) {
  engine.ingestOdds({
    Ts: Date.now(),
    FixtureId: f.id,
    SuperOddsType: "OVERUNDER",
    MarketParameters: "2.5",
    MarketPeriod: "FT",
    InRunning: true,
    PriceNames: ["Over", "Under"],
    Prices: [Math.round(1000 / f.pOver), Math.round(1000 / (1 - f.pOver))],
  });
}

function emitScores(engine: EngineLike, f: SynthFixture, action: string) {
  engine.ingestScores({
    Ts: Date.now(),
    FixtureId: f.id,
    Action: action,
    Clock: { Seconds: f.seconds },
    GameState: "InPlay",
    Score: {
      Participant1: { Total: { Goals: f.goals1, RedCards: f.reds1 } },
      Participant2: { Total: { Goals: f.goals2, RedCards: f.reds2 } },
    },
  });
}

function startSynth(engine: EngineLike, labels: Map<string, string>): void {
  const rng = mulberry32(0x9e3779b9);
  const fx: SynthFixture[] = [
    { id: "SYN-1", p1: "Brazil", p2: "Serbia", pOver: 0.52, seconds: 0, goals1: 0, goals2: 0, reds1: 0, reds2: 0, momDir: 0, momTicks: 0, revPer: 0, revTicks: 0 },
    { id: "SYN-2", p1: "Spain", p2: "Japan", pOver: 0.48, seconds: 0, goals1: 0, goals2: 0, reds1: 0, reds2: 0, momDir: 0, momTicks: 0, revPer: 0, revTicks: 0 },
  ];
  for (const f of fx) {
    labels.set(f.id, `${f.p1} v ${f.p2}`);
    emitScores(engine, f, "kickoff"); // seed prevTotals so deltas are detectable
  }

  // Each fixture demonstrates ONE thesis cleanly so the edges have real,
  // legible expectancy (continuation/reversion span the full 8-tick hold):
  //   • SYN-1 = STEAM — periodic sharp jumps that KEEP GOING → following pays.
  //   • SYN-2 = OVERREACTION — goals/red cards overshoot then REVERT → fading pays.
  const [steamFx, overFx] = fx;
  let tick = 0;
  const iv = setInterval(() => {
    tick++;
    for (const f of fx) {
      f.seconds += 45;
      f.pOver += (rng() - 0.5) * 0.004; // tiny base noise
    }

    // --- SYN-1: steam every 9 ticks (> the 8-tick cooldown), then continue ---
    if (tick % 9 === 0) {
      const dir = rng() < 0.5 ? -1 : 1;
      steamFx.pOver += dir * 0.06; // the jump fires the steam edge
      steamFx.momDir = dir;
      steamFx.momTicks = 8; // continuation spans the whole hold window
    }
    if (steamFx.momTicks > 0) {
      steamFx.pOver += steamFx.momDir * 0.009;
      steamFx.momTicks -= 1;
    }

    // --- SYN-2: recurring goals / red cards, each overshoot then reverts ---
    if (tick >= 8 && (tick - 8) % 16 === 0) {
      overFx.goals1 += 1;
      overFx.pOver = Math.min(0.9, overFx.pOver + 0.13);
      overFx.revPer = -0.013; // revert down → fading the over-spike pays
      overFx.revTicks = 8;
      emitScores(engine, overFx, "goal");
    }
    if (tick >= 16 && (tick - 16) % 16 === 0) {
      overFx.reds2 += 1;
      overFx.pOver = Math.max(0.1, overFx.pOver - 0.12);
      overFx.revPer = 0.012; // revert up → fading the under-spike pays
      overFx.revTicks = 8;
      emitScores(engine, overFx, "red_card");
    }
    if (overFx.revTicks > 0) {
      overFx.pOver += overFx.revPer;
      overFx.revTicks -= 1;
    }

    for (const f of fx) {
      f.pOver = Math.min(0.92, Math.max(0.08, f.pOver));
      emitOdds(engine, f);
      emitScores(engine, f, "tick");
    }
  }, 1500);
  iv.unref?.();
}

function startLive(engine: EngineLike, handle: FeedHandle): void {
  const creds = txlineCreds();
  if (!creds) {
    handle.status = "error";
    handle.error = "no TxLINE token in env (TXLINE_API_BASE/JWT/API_TOKEN)";
    return;
  }
  const run = async (path: string, ingest: (rec: Record<string, unknown>) => void) => {
    for (;;) {
      try {
        await openStream(path, creds, (ev) => {
          if (ev.event === "heartbeat" || !ev.json) return;
          const recs = Array.isArray(ev.json) ? ev.json : [ev.json];
          for (const r of recs) ingest(r as Record<string, unknown>);
        });
      } catch (err) {
        handle.error = String(err);
      }
      await new Promise((r) => setTimeout(r, 2000)); // reconnect
    }
  };
  void run("/api/odds/stream", (r) => engine.ingestOdds(r));
  void run("/api/scores/stream", (r) => engine.ingestScores(r));
}

// ---- singleton ---------------------------------------------------------
const KEY = "__agenthesis_feed__";

export function getFeed(): FeedHandle {
  const g = globalThis as unknown as Record<string, FeedHandle | undefined>;
  if (g[KEY]) return g[KEY]!;

  const wantLive = process.env.FEED_MODE === "live";
  const mode: FeedMode = wantLive && txlineCreds() ? "live" : "synth";
  const engine = new EdgeEngine(mode === "synth" ? SYNTH_OPTS : {}) as unknown as EngineLike;

  const handle: FeedHandle = {
    engine,
    mode,
    status: "starting",
    startedAt: Date.now(),
    labels: new Map(),
  };

  if (mode === "synth") {
    startSynth(engine, handle.labels);
    handle.status = "live";
  } else {
    startLive(engine, handle);
    handle.status = "live";
  }

  g[KEY] = handle;
  return handle;
}
