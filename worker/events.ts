// LIVE-SESSION EVENT LOG — append a milestone to desk_events (and echo to the
// worker log). Best-effort: a logging failure must never break the worker. Keeps
// a clean chronological record a later session can query to see exactly what
// happened during a live match (feed up → ingesting → kickoff → agent deployed →
// first call → archived).
import { insert } from "./supabase.mjs";

const SESSION = process.env.DESK_SESSION || "live";
const nowIso = () => new Date().toISOString();

export interface EventFields {
  fixtureId?: string | number | null;
  match?: string | null;
  agent?: string | null;
  detail?: unknown;
}

export async function logEvent(kind: string, f: EventFields = {}): Promise<void> {
  const row = {
    session: SESSION,
    kind,
    fixture_id: f.fixtureId != null ? String(f.fixtureId) : null,
    match: f.match ?? null,
    agent: f.agent ?? null,
    detail: f.detail ?? null,
  };
  // Always echo to the box log too, so ~/desk_worker.log carries the same story.
  console.log(nowIso(), "[event]", kind, JSON.stringify({ fixtureId: row.fixture_id, match: row.match, agent: row.agent, detail: f.detail }));
  try {
    await insert("desk_events", [row]);
  } catch (e) {
    console.log(nowIso(), "[event] persist failed:", (e as Error).message);
  }
}
