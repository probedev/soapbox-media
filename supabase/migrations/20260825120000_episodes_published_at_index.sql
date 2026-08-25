-- Standalone index on episodes(published_at). Every aggregate read path now
-- pushes its date window into the query (v0.36.2: fetchScoreRows,
-- fetchScoreRowsFiltered, fetchIssueExcerptRows, figure scans) via
-- `episode.published_at >= cutoff` filters on !inner embeds, but the only
-- existing indexes lead with channel_id / transcript_status, so a bare
-- published_at predicate has no usable leading index. This lets the planner
-- drive those joins from the (small) recent-episode set instead of walking
-- the full sentiment_scores/classifications PK order.
--
-- NOT applied automatically - run via the Supabase SQL editor or CLI.
create index if not exists episodes_published_at_idx
  on episodes (published_at desc);
