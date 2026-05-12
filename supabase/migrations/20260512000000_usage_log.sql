-- Soapbox.media v0.6 migration: usage_log table for cost/operations tracking.
-- One row per pipeline invocation (cron or manual). Drives /admin/costs.

create table usage_log (
  id                          uuid primary key default gen_random_uuid(),
  ran_at                      timestamptz not null default now(),
  -- pipeline-level
  duration_ms                 integer not null,
  source                      text not null check (source in ('cron', 'cli', 'manual')),
  -- per-stage results
  ingest_episodes_fetched     integer not null default 0,
  ingest_episodes_new         integer not null default 0,
  ingest_failures             integer not null default 0,
  transcribe_succeeded        integer not null default 0,
  transcribe_failed           integer not null default 0,
  classify_processed          integer not null default 0,
  classify_mentions           integer not null default 0,
  classify_failures           integer not null default 0,
  score_succeeded             integer not null default 0,
  score_failed                integer not null default 0,
  -- LLM token usage + cost estimate
  anthropic_input_tokens      integer not null default 0,
  anthropic_output_tokens     integer not null default 0,
  anthropic_cost_usd          numeric(10, 4) not null default 0,
  -- raw response payload for forensics
  raw_summary                 jsonb,
  -- error message if the pipeline failed at the top level
  error_message               text
);

create index on usage_log (ran_at desc);
create index on usage_log (source);
