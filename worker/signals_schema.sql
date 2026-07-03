-- SIGNALS + CALIBRATION LEDGER (Agenthesis C, on-chain self-grading).
-- Applied to foil Supabase by the worker operator (NOT auto-run). Additive; does not
-- touch the desk_* tables. Anon reads the ledger (public /proof); service_role writes.

create table if not exists signals (
  id            text primary key,            -- edge id + fixture (stable per emitted signal)
  fixture_id    text not null,
  match         text,
  ts            bigint not null,             -- match-time the signal fired (ms)
  minute        int,
  market        text not null,               -- "OVERUNDER_PARTICIPANT_GOALS line=2.5 over"
  super_odds_type text not null,
  line          numeric,
  side          text,
  kind          text not null,               -- steam | overreaction | goal_imminent
  action        text not null,               -- follow | hold | fade | suspend-suggested
  confidence    numeric,
  fired_by      text,                        -- surprise | magnitude | ...
  p_ref         numeric,                     -- demargined fair prob at emit
  direction     text,                        -- back | lay (for CLV settlement)
  proof_hash    text,                        -- ties to the TxLINE frame (/api/verify-csv)
  -- CLV leg (deterministic, settled once the market goes quiet)
  clv_status    text not null default 'pending',   -- pending | settled
  closing_prob  numeric,
  clv_return    numeric,
  clv_right     boolean,
  -- on-chain outcome leg (validateStat vs the daily-scores Merkle root)
  outcome_status text not null default 'pending',  -- pending | settled (pending if sim payer unfunded)
  outcome_p1    int,
  outcome_p2    int,
  outcome_right boolean,
  stat_proof    jsonb,                        -- the validateStat proof payload (audit)
  created_at    timestamptz not null default now(),
  settled_at    timestamptz
);

create index if not exists signals_fixture_idx on signals (fixture_id);
create index if not exists signals_kind_idx    on signals (kind);

alter table signals enable row level security;

-- Public read of the calibration ledger (the /proof track record is meant to be verifiable).
drop policy if exists signals_anon_read on signals;
create policy signals_anon_read on signals for select to anon using (true);

-- Only the worker (service_role) writes. service_role bypasses RLS, so no write policy
-- is granted to anon/authenticated (mirrors the desk_* lockdown).
