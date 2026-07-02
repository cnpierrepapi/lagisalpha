// Minimal Supabase REST client for the EC2 worker — service_role, no SDK.
// Keeps the box dependency-light (bare Node global fetch + tsx). The worker is
// the only writer; the browser reads/queues via the anon key under RLS.

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function ensure() {
  if (!URL || !KEY) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set");
}
function writeHeaders(prefer) {
  return {
    apikey: KEY,
    Authorization: `Bearer ${KEY}`,
    "Content-Type": "application/json",
    Prefer: prefer,
  };
}

// Upsert rows by primary key (merge-duplicates). No-op on empty input.
export async function upsert(table, rows) {
  ensure();
  if (!rows || !rows.length) return;
  const res = await fetch(`${URL}/rest/v1/${table}`, {
    method: "POST",
    headers: writeHeaders("resolution=merge-duplicates,return=minimal"),
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`upsert ${table} ${res.status}: ${await res.text().catch(() => "")}`);
}

// Append rows (no merge) — for the event log where each row is a new milestone.
export async function insert(table, rows) {
  ensure();
  if (!rows || !rows.length) return;
  const res = await fetch(`${URL}/rest/v1/${table}`, {
    method: "POST",
    headers: writeHeaders("return=minimal"),
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`insert ${table} ${res.status}: ${await res.text().catch(() => "")}`);
}

export async function select(table, query = "") {
  ensure();
  const res = await fetch(`${URL}/rest/v1/${table}?${query}`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
  });
  if (!res.ok) throw new Error(`select ${table} ${res.status}: ${await res.text().catch(() => "")}`);
  return res.json();
}

export async function del(table, query) {
  ensure();
  const res = await fetch(`${URL}/rest/v1/${table}?${query}`, {
    method: "DELETE",
    headers: writeHeaders("return=minimal"),
  });
  if (!res.ok) throw new Error(`delete ${table} ${res.status}: ${await res.text().catch(() => "")}`);
}

// Upload (or overwrite) an object in a Storage bucket. service_role bypasses the
// bucket's RLS, so the worker writes archive blobs with no storage policy needed.
export async function uploadStorage(bucket, objectPath, body, contentType = "application/json") {
  ensure();
  const res = await fetch(`${URL}/storage/v1/object/${bucket}/${objectPath}`, {
    method: "POST",
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      "Content-Type": contentType,
      "x-upsert": "true", // overwrite if the match was archived by an earlier pass
    },
    body,
  });
  if (!res.ok) throw new Error(`storage upload ${bucket}/${objectPath} ${res.status}: ${await res.text().catch(() => "")}`);
}
