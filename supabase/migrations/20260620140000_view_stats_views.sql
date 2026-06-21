-- Read views over episode_metrics for the MCP view-count transparency surface.
-- Date: 2026-06-20 (v0.32.0)
--
-- Phase-0 view-count data (episode_metrics) is exposed read-only through the
-- MCP: per-channel "typical views" vs subscriber reach (the blunt-proxy reveal)
-- and per-channel runaway over/under-performing videos. The Index weighting is
-- still untouched - this is transparency only (see get_methodology).
--
-- Two helper views keep the aggregation in Postgres (a panel-wide median over
-- 45d x ~4k snapshots should not be pulled into the app):
--   episode_view_latest  - the LATEST snapshot per episode (DISTINCT ON), so a
--                          second daily snapshot tomorrow never double-counts.
--   channel_view_stats   - per YouTube channel, the MEDIAN view count over its
--                          MATURE recent videos (published 14-90d ago: ~90% of a
--                          news video's views land by day 14, so this controls
--                          the age confound). Median, not mean - the per-video
--                          view distribution is clip-heavy. Floored at >=5
--                          mature videos; thinner channels (and all podcasts)
--                          simply don't appear and read as null downstream.
--
-- Service-role only, like episode_pipeline_summary: a view granted to anon would
-- bypass the underlying tables' RLS (CLAUDE.md). Read by the MCP server, which
-- uses the service key.

create or replace view episode_view_latest as
select distinct on (m.episode_id)
  m.episode_id,
  e.channel_id,
  e.title,
  e.source_url,
  e.published_at,
  m.view_count,
  m.like_count,
  m.comment_count,
  m.age_hours,
  m.captured_at
from episode_metrics m
join episodes e on e.id = m.episode_id
order by m.episode_id, m.captured_at desc;

grant select on episode_view_latest to service_role;

create or replace view channel_view_stats as
select
  c.id   as channel_id,
  c.name as channel_name,
  c.reach,
  count(*) as sample_size,
  round(percentile_cont(0.5) within group (order by evl.view_count))::bigint as typical_views
from channels c
join episode_view_latest evl on evl.channel_id = c.id
where c.platform = 'youtube'
  and evl.view_count is not null
  and evl.published_at <= now() - interval '14 days'
  and evl.published_at >= now() - interval '90 days'
group by c.id, c.name, c.reach
having count(*) >= 5;

grant select on channel_view_stats to service_role;
