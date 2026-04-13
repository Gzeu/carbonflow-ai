-- CarbonFlow AI — Supabase schema
-- Rulează o singură dată în Supabase SQL Editor (sau via migration tool)

-- ─── carbon_events ───────────────────────────────────────────────────────────
create table if not exists carbon_events (
  id                   bigserial primary key,
  repo                 text        not null,
  event_type           text        not null check (event_type in ('push','pull_request','workflow_run')),
  additions            integer     not null default 0,
  deletions            integer     not null default 0,
  energy_kwh           numeric(12,8) not null,
  carbon_kg            numeric(12,8) not null,
  tier                 text        not null check (tier in ('green','yellow','red')),
  pr_number            integer,
  commit_sha           text,
  actor                text,
  ci_duration_minutes  numeric(10,2),
  meta                 jsonb,
  created_at           timestamptz not null default now()
);

create index if not exists carbon_events_repo_idx        on carbon_events(repo);
create index if not exists carbon_events_tier_idx        on carbon_events(tier);
create index if not exists carbon_events_created_at_idx  on carbon_events(created_at desc);
create index if not exists carbon_events_repo_tier_idx   on carbon_events(repo, tier);

-- Row Level Security — service role bypasses RLS, anon nu are acces
alter table carbon_events enable row level security;

-- Policy: service role (backend) poate face orice
create policy "service_role_all" on carbon_events
  for all using (auth.role() = 'service_role');

-- ─── Helper view — summary per repo ──────────────────────────────────────────
create or replace view repo_carbon_summary as
select
  repo,
  count(*)                                    as total_events,
  sum(energy_kwh)                             as total_kwh,
  sum(carbon_kg)                              as total_co2_kg,
  avg(energy_kwh)                             as avg_kwh,
  count(*) filter (where tier = 'green')      as green_count,
  count(*) filter (where tier = 'yellow')     as yellow_count,
  count(*) filter (where tier = 'red')        as red_count,
  max(created_at)                             as last_event_at
from carbon_events
group by repo
order by total_kwh desc;
