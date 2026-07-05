# Linescout EC2 live desk worker

Runs the **same** runner / engine / agents as the web app, but headless on an
always-on box, fed by the **live TxLINE SSE**. Trades happen in real time here;
every `PUSH_MS` it mirrors agents + recent trades + meta into the **foil
Supabase**. The Vercel `/desk` reads that mirror directly (anon key), so Vercel
is only a display — no live stream runs inside a serverless function.

```
EC2 (this worker)                         Vercel /desk (browser)
  live TxLINE SSE ─► engine ─► agents       polls foil Supabase every 5s
        │ every 15s push (deltas)           reads desk_agents/desk_trades/desk_meta
        ▼                                    writes pause/stop → desk_controls
   foil Supabase  ◄──────────────────────────────────┘ (worker drains + applies)
```

Why this shape: the box is always warm, so agent state + pause/stop survive
(no Vercel cold-start reset), and Hobby usage stays ~zero (the browser reads
Supabase directly, not a Vercel function).

## 1. One-time: create the tables

Paste `desk_schema.sql` into the **foil** project SQL editor and run it.
(Least-privilege RLS: anon reads the mirror + may queue a control; the worker
writes everything with the service-role key.)

## 2. One-time: get Node + the worker onto the box

```bash
# from your machine — copy the repo up (or git clone it on the box)
scp -i ~/Downloads/predmkt.pem -r ./linescout ubuntu@63.33.24.157:~/linescout

# on the box — Node is already installed via nvm; install just tsx
ssh -i ~/Downloads/predmkt.pem ubuntu@63.33.24.157
cd ~/linescout/worker && npm install        # installs tsx only (no Next/React)
```

## 3. Env file

Create `~/linescout/worker/.env` on the box (values from your local
`.env.local` for the TxLINE keys, foil dashboard for the service-role key):

```ini
FEED_MODE=live
# --- live TxLINE (devnet World Cup) ---
TXLINE_API_BASE=https://txline-dev.txodds.com
TXLINE_CLUSTER=devnet
TXLINE_JWT=...
TXLINE_API_TOKEN=...
TXLINE_SIGNUP_TX=...            # optional: shows the Solana proof on the desk
# --- push sink (foil project) ---
SUPABASE_URL=https://mohbmvajroqizlfaarjk.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...  # service_role — bypasses RLS, NEVER ship to the browser
# --- tuning (optional) ---
PUSH_MS=15000
CONTROL_MS=4000
DESK_SESSION=live
```

## 4. Run it (around kickoff)

```bash
cd ~/linescout/worker
set -a; source .env; set +a
nohup npx tsx desk_worker.ts > ~/desk_worker.log 2>&1 &
echo $! > ~/desk_worker.pid          # remember the PID so we can stop cleanly
tail -f ~/desk_worker.log            # watch it ingest + push
```

Stop:

```bash
kill -INT "$(cat ~/desk_worker.pid)"
```

The log is also the **post-match assessment**: every push prints the ingested
frame count, and any time the live feed goes quiet it prints
`STALL #n: feed quiet …` / `feed recovered after n stall cycle(s)` — so after
the match you can read exactly what happened across every drop/reconnect.

## 5. Vercel side

Set on the Vercel project (so the browser reads the mirror):

```
NEXT_PUBLIC_SUPABASE_URL=https://mohbmvajroqizlfaarjk.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...   # anon (publishable) key — read-only under RLS
NEXT_PUBLIC_DESK_SESSION=live
```

If these are unset the desk simply uses the in-app SSE replay (safe default).
When the worker is pushing fresh data the desk switches to it automatically and
shows **LIVE · EC2**; if the worker stops, the desk falls back to replay.
