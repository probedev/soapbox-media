-- Channel-expansion candidate store.
-- Date: 2026-06-17
--
-- The panel is grown by the consolidated `scripts/channels.ts` CLI, which
-- replaces a series of one-off hardcoded seed scripts. Discovery (YouTube
-- featured-channels, iTunes search, editorial lists) runs repeatedly and needs
-- a durable, re-runnable store that (a) dedups centrally against the live
-- `channels` table, and (b) carries a status lifecycle from raw discovery
-- through human approval to onboarding. A committed JSON/CSV file cannot
-- anti-join against live channels and merge-conflicts on every re-run; this
-- table is the substrate instead.
--
-- Approval is MANUAL: nothing is ever onboarded until a human flips a row to
-- 'approved' (the `channels review` -> `channels approve` step). 'below_floor'
-- applies to YouTube candidates only; podcast reach is editorial and is never
-- floor-gated.

create table if not exists channel_candidates (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null,
  platform             text not null check (platform in ('youtube', 'podcast')),
  -- Resolved provider id (YT channel id / PodScan id); null until resolved.
  platform_id          text,
  -- The raw lookup key from discovery: handle, iTunes collection name, or query.
  source_ref           text,
  -- Stable dedup key: the resolved provider id when known, else the raw lookup
  -- key. A STORED generated column so a plain unique constraint (and the
  -- supabase-js upsert onConflict target) can reference it.
  dedup_key            text generated always as (coalesce(platform_id, source_ref)) stored,
  source               text not null check (source in ('featured', 'itunes', 'socialblade', 'editorial')),
  -- How many existing panel channels feature this candidate (adjacency rank).
  endorsements         integer not null default 0,
  candidate_reach      bigint,
  political_lean       text check (political_lean in ('L', 'M', 'R')),
  cohort               text not null default 'independent' check (cohort in ('independent', 'legacy')),
  latest_episode_at    timestamptz,
  status               text not null default 'new' check (
    status in ('new', 'duplicate', 'below_floor', 'stale', 'vetted', 'approved', 'rejected', 'promoted')
  ),
  dedup_reason         text,
  promoted_channel_id  uuid references channels(id) on delete set null,
  first_seen_at        timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (platform, dedup_key)
);

create index if not exists channel_candidates_status_idx on channel_candidates (status);

-- RLS on, no policies: only the service-role key reads/writes (matches every
-- other table). The app is server-side only.
alter table channel_candidates enable row level security;
