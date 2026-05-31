-- Add channel cohort to episode_pipeline_summary so the /log feed and episode
-- counts can scope to the public cohort (independent) until the legacy
-- comparison UX ships. Date: 2026-05-31.
create or replace view episode_pipeline_summary as
 SELECT e.id,
    e.title,
    e.published_at,
    e.source_url,
    e.duration_sec,
    e.transcript_status,
    e.created_at,
    c.id AS channel_id,
    c.name AS channel_name,
    c.political_lean,
    c.platform,
    count(DISTINCT cl.id) AS classification_count,
    count(DISTINCT s.id) AS scored_count,
    e.classify_status,
    -- appended last: create-or-replace view can't reorder existing columns
    c.cohort
   FROM episodes e
     JOIN channels c ON c.id = e.channel_id
     LEFT JOIN classifications cl ON cl.episode_id = e.id
     LEFT JOIN sentiment_scores s ON s.classification_id = cl.id
  GROUP BY e.id, c.id;

grant select on episode_pipeline_summary to service_role;
