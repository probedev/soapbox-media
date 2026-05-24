-- Per-episode pipeline summary for the /log data table.
-- Date: 2026-05-24
--
-- Computes classification + scored counts per episode in Postgres so the
-- /log page loads one light row-per-episode result set instead of pulling
-- thousands of classification/score join rows into the app and aggregating
-- there. Read server-side via the service-role key only — NOT granted to
-- anon, since a view would otherwise bypass the underlying tables' RLS.

create or replace view episode_pipeline_summary as
select
  e.id,
  e.title,
  e.published_at,
  e.source_url,
  e.duration_sec,
  e.transcript_status,
  e.created_at,
  c.id            as channel_id,
  c.name          as channel_name,
  c.political_lean,
  c.platform,
  count(distinct cl.id) as classification_count,
  count(distinct s.id)  as scored_count
from episodes e
join channels c on c.id = e.channel_id
left join classifications cl on cl.episode_id = e.id
left join sentiment_scores s on s.classification_id = cl.id
group by e.id, c.id;

grant select on episode_pipeline_summary to service_role;
