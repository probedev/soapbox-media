-- Gold-set labeling: online human-calibration of the sentiment scorer.
-- Date: 2026-05-24
--
-- `gold_items` is the fixed set of mentions multiple independent labelers
-- score (the benchmark / ruler). The model's answer is frozen at seed time
-- (model_sentiment/intensity) so re-scoring the production data later can't
-- move the answer key. `gold_labels` holds one row per labeler per item.
--
-- RLS on with no policies, consistent with the rest of the schema: all access
-- is server-side via the service-role key (the public labeling page submits
-- through a Next.js server action, never directly from the browser).

create table if not exists gold_items (
  id                    uuid primary key default gen_random_uuid(),
  row_num               int not null,
  classification_id     uuid not null references classifications(id) on delete cascade,
  model_sentiment       numeric(3,1) not null,
  model_intensity       numeric(3,1) not null,
  bucket                text,
  quote                 text not null,
  issue_name            text not null,
  issue_left_position   text not null,
  issue_right_position  text not null,
  channel_lean          text not null check (channel_lean in ('L','M','R')),
  episode_date          date,
  created_at            timestamptz not null default now(),
  unique (classification_id)
);
alter table gold_items enable row level security;

create table if not exists gold_labels (
  id            uuid primary key default gen_random_uuid(),
  item_id       uuid not null references gold_items(id) on delete cascade,
  labeler_name  text not null,
  sentiment     int not null check (sentiment between -5 and 5),
  intensity     int not null check (intensity between 1 and 5),
  confidence    int not null check (confidence between 1 and 3),
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (item_id, labeler_name)
);
alter table gold_labels enable row level security;
create index on gold_labels (labeler_name);
