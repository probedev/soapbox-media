-- Enforce one sentiment score per classification.
-- Date: 2026-05-24
--
-- Background: the score step did a plain INSERT after reading the
-- already-scored set at start. With multiple score processes overlapping
-- (CLI runs + the cron's score stage + the daily cron), two could each read
-- a classification as unscored and both insert — producing duplicate scores
-- that double-count in the Index and per-issue/channel aggregations. A
-- one-time dedup removed 257 duplicate rows across 172 classifications; this
-- constraint makes the condition structurally impossible going forward.
--
-- The application now upserts with onConflict=classification_id
-- (ignoreDuplicates), so overlapping runs no-op instead of erroring.

alter table sentiment_scores
  add constraint sentiment_scores_classification_id_key unique (classification_id);
