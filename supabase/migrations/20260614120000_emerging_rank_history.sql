-- Emerging-board daily rank snapshots (for up/down movement indicators).
-- Date: 2026-06-14
--
-- The /emerging board is recomputed live on every request (getEmergingBoard),
-- and the underlying discovery_candidates set is fully deleted + re-inserted by
-- the daily discover cron, so candidate UUIDs are NOT stable across days. To show
-- "moved up / down N since the last refresh" we snapshot each day's ranking and
-- diff the live board against the *previous* snapshot.
--
-- Keyed by a normalized theme_key (token-set of the canonical label, see
-- themeKey() in src/lib/discovery.ts) rather than candidate id or raw label, so a
-- continuing issue keeps its movement history even though its UUID is fresh each
-- rebuild and the LLM may slightly reword the label day to day. A reworded theme
-- that no longer matches simply reads as "new" - an acceptable fallback.
--
-- captured_on — UTC date of the rebuild (one snapshot per cohort per day; the
--               unique constraint makes a same-day re-run idempotent via upsert).
-- cohort      — 'all' | 'independent' | 'legacy' (each tab ranks independently).
-- rank        — 1-based rank by weight within that cohort on that day.
--
-- Service-role only - written by the discover cron / admin rebuild and read by
-- the public board's server component. Mirrors the project's RLS-on-no-policies
-- model (CLAUDE.md): only the service-role key (bypasses RLS) touches it.

create table if not exists emerging_rank_history (
  id          uuid primary key default gen_random_uuid(),
  captured_on date not null,
  cohort      text not null check (cohort in ('all', 'independent', 'legacy')),
  theme_key   text not null,
  label       text not null,
  rank        integer not null,
  weight      numeric not null,
  created_at  timestamptz not null default now(),
  unique (captured_on, cohort, theme_key)
);

-- Lookup is "the previous distinct captured_on for this cohort", so index the
-- snapshot keys descending.
create index if not exists emerging_rank_history_cohort_date_idx
  on emerging_rank_history (cohort, captured_on desc);

grant select, insert, update on emerging_rank_history to service_role;

alter table emerging_rank_history enable row level security;
