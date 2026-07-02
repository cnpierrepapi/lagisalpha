// FRAME ARCHIVER — persists each LIVE match's raw odds/scores frames so it
// becomes re-playable after it ends (TxLINE gates odds history, so an unrecorded
// live match is gone forever). Taps lib/feed's live raw-frame stream, gates
// in-play on the authoritative scores clock, and on match-close writes a
// captures/{fid}.json-shaped blob to the public `desk-archives` Storage bucket +
// indexes it in desk_archived. Mirrors Spikelines' "seen finished → persist"
// archive, but persists the raw ODDS frames (Spikelines re-fetches scores).
//
// Same slim shape the replay feed (lib/feed startReplay) already consumes, so an
// archived match drops straight back into replays.json / the replay path.

import { onRawFrame } from "../lib/feed";
import { txlineCreds } from "../lib/txline/stream";
import { uploadStorage, upsert } from "./supabase.mjs";

const BUCKET = "desk-archives";
const SESSION = process.env.DESK_SESSION || "live";
const CLUSTER = process.env.TXLINE_CLUSTER || "mainnet";
const DEMARGINED = "TXLineStablePriceDemargined";
// A market goes QUIET at kickoff/FT/suspension; once the whole book is silent
// this long (WALL time — mainnet is real-time) the match is over → finalize.
const IDLE_END_MS = Number(process.env.ARCHIVE_IDLE_MS) || 8 * 60_000;
const MIN_ODDS = Number(process.env.ARCHIVE_MIN_ODDS) || 150; // don't archive a stub book
const SWEEP_MS = 30_000;
const CHECKPOINT_MS = Number(process.env.ARCHIVE_CHECKPOINT_MS) || 5 * 60_000; // crash-safe blob flush
const NAMES_MS = 4 * 60_000; // refresh fixture names periodically

const nowIso = () => new Date().toISOString();
const log = (...a: unknown[]) => console.log(nowIso(), "[archiver]", ...a);

// Keep only the fields the edge engine / replay feed consume (== record_odds.mjs).
const slimOdds = (r: Record<string, unknown>) => ({
  FixtureId: r.FixtureId, Ts: r.Ts, Bookmaker: r.Bookmaker, SuperOddsType: r.SuperOddsType,
  MarketParameters: r.MarketParameters, MarketPeriod: r.MarketPeriod, InRunning: r.InRunning,
  PriceNames: r.PriceNames, Prices: r.Prices,
});
const slimScore = (r: Record<string, unknown>) => ({
  FixtureId: r.FixtureId, Ts: r.Ts, Clock: r.Clock, GameState: r.GameState, Score: r.Score, Action: r.Action,
});

interface Buf {
  fid: string;
  p1: string;
  p2: string;
  odds: ReturnType<typeof slimOdds>[];
  scores: ReturnType<typeof slimScore>[];
  inPlay: boolean;
  firstTs: number;
  lastTs: number;
  lastFrameAt: number; // wall-clock ms of the last frame (idle detection)
  lastCheckpointAt: number;
  archived: boolean;
}

const bufs = new Map<string, Buf>();
const names = new Map<string, { p1: string; p2: string }>();

function labelFor(fid: string): { p1: string; p2: string } {
  return names.get(fid) ?? { p1: `#${fid}`, p2: "" };
}

function getBuf(fid: string): Buf {
  let b = bufs.get(fid);
  if (!b) {
    const n = labelFor(fid);
    b = { fid, p1: n.p1, p2: n.p2, odds: [], scores: [], inPlay: false, firstTs: 0, lastTs: 0, lastFrameAt: 0, lastCheckpointAt: 0, archived: false };
    bufs.set(fid, b);
  } else if (b.p1.startsWith("#") && !labelFor(fid).p1.startsWith("#")) {
    const n = labelFor(fid); // upgrade #fid → real names once the snapshot resolves them
    b.p1 = n.p1;
    b.p2 = n.p2;
  }
  return b;
}

// Best-effort fixture-name resolution from the fixtures snapshot (same source
// record_odds.mjs uses). Names aren't on the odds stream, so without this the
// archive would store bare "#fid".
async function refreshNames(): Promise<void> {
  const creds = txlineCreds();
  if (!creds) return;
  try {
    const res = await fetch(`${creds.apiBase}/api/fixtures/snapshot`, {
      headers: { Authorization: `Bearer ${creds.jwt}`, "X-Api-Token": creds.apiToken },
    });
    if (!res.ok) return;
    const snap = await res.json();
    const arr = Array.isArray(snap) ? snap : snap.fixtures ?? [];
    for (const f of arr) {
      const fid = String(f.FixtureId);
      if (f.Participant1 && f.Participant2) names.set(fid, { p1: String(f.Participant1), p2: String(f.Participant2) });
    }
  } catch {
    /* best-effort */
  }
}

function onFrame(kind: "odds" | "scores", rec: Record<string, unknown>): void {
  const fid = String(rec.FixtureId ?? "");
  if (!fid) return;
  const now = Date.now();

  if (kind === "odds") {
    if (rec.Bookmaker !== DEMARGINED) return; // archive only the fair book (== capture format)
    const b = getBuf(fid);
    if (b.archived) return;
    b.odds.push(slimOdds(rec));
    const ts = Number(rec.Ts) || now;
    b.firstTs = b.firstTs ? Math.min(b.firstTs, ts) : ts;
    b.lastTs = Math.max(b.lastTs, ts);
    b.lastFrameAt = now;
  } else {
    const b = getBuf(fid);
    if (b.archived) return;
    b.scores.push(slimScore(rec));
    b.lastFrameAt = now;
    const clock = rec.Clock as { Running?: boolean } | undefined;
    if (clock?.Running === true && !b.inPlay) {
      b.inPlay = true;
      log(`IN-PLAY ${fid} ${b.p1} v ${b.p2} — clock running`);
    }
  }
}

function blob(b: Buf): string {
  return JSON.stringify({ fid: Number(b.fid) || b.fid, p1: b.p1, p2: b.p2, odds: b.odds, scores: b.scores });
}
function objectPath(fid: string): string {
  return `${SESSION}/${fid}.json`;
}

// Write the raw-frame blob to Storage (idempotent overwrite). Used both for
// crash-safe checkpoints (in-play) and on finalize.
async function writeBlob(b: Buf): Promise<void> {
  await uploadStorage(BUCKET, objectPath(b.fid), blob(b));
}

// Finalize: write the blob AND index the match so it appears in history.
async function finalize(b: Buf): Promise<void> {
  await writeBlob(b);
  await upsert("desk_archived", [
    {
      fixture_id: Number(b.fid),
      session: SESSION,
      p1: b.p1,
      p2: b.p2,
      odds_frames: b.odds.length,
      score_frames: b.scores.length,
      first_ts: b.firstTs || null,
      last_ts: b.lastTs || null,
      storage_path: objectPath(b.fid),
      cluster: CLUSTER,
      updated_at: nowIso(), // finished_at defaults on first insert, preserved on merge
    },
  ]);
  b.archived = true;
  log(`ARCHIVED ${b.fid} ${b.p1} v ${b.p2} — ${b.odds.length} odds + ${b.scores.length} scores → ${BUCKET}/${objectPath(b.fid)}`);
}

async function sweep(): Promise<void> {
  const now = Date.now();
  for (const b of bufs.values()) {
    if (b.archived || !b.inPlay || b.odds.length < MIN_ODDS) continue;
    const idle = now - b.lastFrameAt;
    if (idle > IDLE_END_MS) {
      try {
        await finalize(b);
      } catch (e) {
        log("finalize error", b.fid, (e as Error).message);
      }
    } else if (now - b.lastCheckpointAt > CHECKPOINT_MS) {
      // crash-safe: flush the blob mid-match (no index row until finalize)
      b.lastCheckpointAt = now;
      try {
        await writeBlob(b);
        log(`checkpoint ${b.fid} — ${b.odds.length} odds buffered`);
      } catch (e) {
        log("checkpoint error", b.fid, (e as Error).message);
      }
    }
  }
}

let started = false;
export function startArchiver(): void {
  if (started) return;
  started = true;
  onRawFrame(onFrame);
  void refreshNames();
  const n = setInterval(refreshNames, NAMES_MS);
  const s = setInterval(() => void sweep(), SWEEP_MS);
  n.unref?.();
  s.unref?.();
  log(`up — idle_end=${IDLE_END_MS}ms min_odds=${MIN_ODDS} bucket=${BUCKET} session=${SESSION} cluster=${CLUSTER}`);
}

// Flush in-play buffers with enough frames on shutdown so a clean stop doesn't
// drop a match that was still trading.
export async function flushArchiver(): Promise<void> {
  for (const b of bufs.values()) {
    if (!b.archived && b.inPlay && b.odds.length >= MIN_ODDS) {
      try {
        await finalize(b);
      } catch (e) {
        log("flush error", b.fid, (e as Error).message);
      }
    }
  }
}
