-- Precomputed home-page dashboard snapshot.
-- Date: 2026-05-30
--
-- The home page (/) renders getDashboardData() + getIndexBreakdown(), both of
-- which paginate the full ~17K-row sentiment_scores deep join and aggregate in
-- JS. With force-dynamic that ran on every request — direct prod timing showed
-- ~9.5-15s TTFB on / while /channels and /issues were ~0.5s (v0.6.60 only
-- deduped the double call within a single render; it can't cache across
-- requests). The underlying data only changes when the daily pipeline runs, so
-- we precompute the aggregate once at the end of the score cron (the last
-- data-producing stage) and store it here as one JSON row. The home page then
-- reads a single indexed row (~sub-100ms).
--
-- key         — snapshot identity, e.g. 'home:7' for the 7-day home window.
-- payload     — the full { dashboard, breakdown } object as JSON.
-- computed_at — when the snapshot was last refreshed (for staleness display).
--
-- Service-role only — written by the cron / CLI and read by server components
-- via the service-role key. Not granted to anon (mirrors the underlying
-- tables, which are read server-side only).

create table if not exists dashboard_snapshot (
  key         text primary key,
  payload     jsonb not null,
  computed_at timestamptz not null default now()
);

grant select, insert, update on dashboard_snapshot to service_role;

-- Project-wide security model (see CLAUDE.md): RLS ON with no policies, so
-- only the service-role key (which bypasses RLS) can read/write. The app is
-- server-side only and uses the service-role client for this table.
alter table dashboard_snapshot enable row level security;
