-- Favorability scores for emerging-topic mentions.
-- Date: 2026-06-16
--
-- The /emerging board surfaces off-taxonomy topics (discovery_topics, clustered
-- into discovery_candidates) with mention counts only - no read on how the
-- conversation is landing. sentiment_scores can't help: it is keyed on a
-- classification row that requires an issue_slug (the fixed taxonomy), and
-- emerging topics live outside it.
--
-- This table holds a per-mention FAVORABILITY score (a distinct axis from the
-- ideological L/R sentiment scale): how critical vs. celebratory a quote is
-- TOWARD its emerging subject. Aggregated per candidate it gives a "how is this
-- landing" gauge on the board, independent of the (more subjective) channel lean.
--
-- KEYED ON discovery_topic_id, NOT candidate_id. buildDiscoveryCandidates()
-- deletes + rebuilds all pending candidates every discover run with fresh UUIDs
-- (on-delete-set-null frees the topics), so candidate ids are ephemeral. A
-- mention's favorability is intrinsic to the quote and must survive reclustering,
-- so it hangs off the stable discovery_topics row. UNIQUE(discovery_topic_id)
-- makes the scoring stage idempotent via upsert (same pattern as
-- sentiment_scores.classification_id - never double-score).
--
-- favorability — -5.0 (hostile/scathing) .. 0 (neutral/descriptive) .. +5.0
--                (celebratory/glowing) toward the topic.
-- intensity    — 1 (passing) .. 5 (passionate/central), mirrors sentiment_scores.
--
-- Service-role only, matching the project's RLS-on-no-policies model (CLAUDE.md):
-- written by the score-emerging cron, read by the public board's server component.

create table if not exists discovery_topic_scores (
  id                 uuid primary key default gen_random_uuid(),
  discovery_topic_id uuid not null unique
                       references discovery_topics (id) on delete cascade,
  favorability       numeric not null,
  intensity          numeric not null,
  model              text,
  model_version      text,
  created_at         timestamptz not null default now()
);

-- The board aggregation fetches scores by member-topic id, so index the FK.
create index if not exists discovery_topic_scores_topic_idx
  on discovery_topic_scores (discovery_topic_id);

grant select, insert, update on discovery_topic_scores to service_role;

alter table discovery_topic_scores enable row level security;
