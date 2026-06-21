-- Per-video engagement snapshots (Phase 0: collection only).
-- Date: 2026-06-20
--
-- Today "reach" is a per-CHANNEL subscriber proxy (YouTube) or editorial
-- estimate (podcast), applied uniformly to every episode. Subscriber count is a
-- blunt approximation: a dormant 5M-sub channel whose videos get 50k views is
-- over-weighted, a 200k-sub channel that goes viral is under-weighted. To decide
-- whether (and how) to fold realized per-video views into the reach weighting,
-- we first need the data - specifically each video's view-GROWTH CURVE, since
-- views are a cumulative curve, not a fixed number.
--
-- This table banks that curve: one snapshot row per episode per UTC day, so we
-- can later choose a maturity window (e.g. "views at t+7d") empirically instead
-- of guessing. YOUTUBE-ONLY: podcasts expose no reliable per-episode metric
-- (PodScan audience_size/reach_score are broken, see [[podcast-reach-editorial]]).
--
-- PURELY ADDITIVE / DECOUPLED: nothing in src/lib/aggregate.ts reads this table.
-- The reach algorithm is untouched, so the published Index does not move. This
-- is a write-only producer (ingest + the new `metrics` cron), consistent with
-- the "stages read/write the DB, never call each other" architecture.
--
-- FORWARD-ONLY: a one-time backfill records each existing video's CURRENT
-- cumulative views at its (heterogeneous) current age - useful as a baseline,
-- but "views at t+7d" can only be reconstructed going forward. age_hours is
-- stored on every row precisely so heterogeneous-age readings stay interpretable
-- (align snapshots on a "hours since publish" axis for the curve analysis).
--
-- view_count/like_count/comment_count are nullable: YouTube hides like counts on
-- some videos and disables comments on others, and a private/deleted video drops
-- out of videos.list entirely (we just skip it).

create table if not exists episode_metrics (
  id            uuid primary key default gen_random_uuid(),
  episode_id    uuid not null references episodes (id) on delete cascade,
  -- One snapshot per episode per UTC day. Defaulted (not passed by the writer)
  -- so the unique key is computed server-side; the writers upsert on it.
  captured_on   date not null default (now() at time zone 'utc')::date,
  captured_at   timestamptz not null default now(),
  age_hours     integer not null,           -- floor((now - published_at)/1h) at capture
  view_count    bigint,
  like_count    bigint,
  comment_count bigint,
  source        text not null default 'youtube_data_api',
  unique (episode_id, captured_on)
);

-- Curve analysis reads all snapshots for an episode ordered by time.
create index if not exists episode_metrics_episode_idx
  on episode_metrics (episode_id, captured_at);
-- The metrics stage skips episodes already snapshotted today (one read by day).
create index if not exists episode_metrics_captured_on_idx
  on episode_metrics (captured_on);

-- Service-role only, matching the project's RLS-on-no-policies model (CLAUDE.md):
-- written by the ingest + metrics crons, never exposed to the anon key.
grant select, insert, update on episode_metrics to service_role;

alter table episode_metrics enable row level security;
