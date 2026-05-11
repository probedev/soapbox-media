-- Soapbox.media — initial schema (MVP v0.1)
-- Date: 2026-05-11
-- All tables intentionally narrow; we widen as the pipeline matures.

create extension if not exists "pgcrypto";

-- Hand-curated set of channels we track.
create table channels (
  id                       uuid primary key default gen_random_uuid(),
  name                     text not null,
  platform                 text not null check (platform in ('podcast', 'youtube')),
  platform_id              text not null,
  political_lean           text not null check (political_lean in ('L', 'M', 'R')),
  reach                    bigint not null default 0,
  active                   boolean not null default true,
  classification_rationale text,
  created_at               timestamptz not null default now(),
  unique (platform, platform_id)
);

-- Issue taxonomy. Editorial layer — left/right positions defined explicitly.
create table issues (
  slug            text primary key,
  name            text not null,
  definition      text not null,
  left_position   text not null,
  right_position  text not null,
  active          boolean not null default true,
  created_at      timestamptz not null default now()
);

-- Episodes discovered from each channel.
create table episodes (
  id                uuid primary key default gen_random_uuid(),
  channel_id        uuid not null references channels(id) on delete cascade,
  title             text not null,
  published_at      timestamptz not null,
  source_url        text not null,
  duration_sec      integer,
  transcript_status text not null default 'pending' check (
    transcript_status in ('pending', 'fetched', 'failed', 'skipped')
  ),
  created_at        timestamptz not null default now(),
  unique (channel_id, source_url)
);

create index on episodes (channel_id, published_at desc);
create index on episodes (transcript_status, published_at desc);

-- Full transcripts. One row per episode.
create table transcripts (
  episode_id   uuid primary key references episodes(id) on delete cascade,
  text         text not null,
  provider     text not null check (provider in ('podscan', 'youtube_captions', 'whisper')),
  ingested_at  timestamptz not null default now()
);

-- LLM-detected issue mentions inside an episode.
create table classifications (
  id                uuid primary key default gen_random_uuid(),
  episode_id        uuid not null references episodes(id) on delete cascade,
  issue_slug        text not null references issues(slug),
  supporting_quote  text not null,
  start_ts          integer,
  created_at        timestamptz not null default now()
);

create index on classifications (episode_id);
create index on classifications (issue_slug);

-- Sentiment + intensity per classification.
create table sentiment_scores (
  id                 uuid primary key default gen_random_uuid(),
  classification_id  uuid not null references classifications(id) on delete cascade,
  sentiment          numeric(3, 1) not null check (sentiment between -5 and 5),
  intensity          numeric(3, 1) not null check (intensity between 1 and 5),
  supporting_quote   text,
  model              text not null,
  model_version      text not null,
  created_at         timestamptz not null default now()
);

create index on sentiment_scores (classification_id);

-- Weekly rolled-up Soapbox Index (the headline number).
create table weekly_index (
  week_start          date primary key,
  soapbox_index       numeric(4, 2) not null,
  num_channels        integer not null,
  num_episodes        integer not null,
  num_classifications integer not null,
  computed_at         timestamptz not null default now()
);

-- Seed the issue taxonomy v0.
insert into issues (slug, name, definition, left_position, right_position) values
  ('immigration',         'Immigration & border',           'Policy and rhetoric around US immigration, border enforcement, asylum, and deportation.', 'More permissive immigration and humanitarian framing', 'Stricter enforcement and reduced inflows'),
  ('inflation',           'Inflation & affordability',      'Cost of living, prices, wages, housing affordability.',                                    'Government intervention to lower costs',              'Free-market and reduced regulation'),
  ('israel-gaza',         'Israel–Gaza',                    'The Israel–Hamas war and US posture toward Israel/Palestinians.',                          'Sympathy with Palestinian civilians, criticism of IDF', 'Strong support of Israel and military operations'),
  ('ukraine-russia',      'Ukraine–Russia',                 'The Ukraine war and US/NATO posture.',                                                     'Sustained military aid to Ukraine',                   'Reduce/end US aid, negotiate with Russia'),
  ('china-policy',        'China policy',                   'US–China relations, trade, Taiwan, tech competition.',                                     'Cooperation and engagement',                          'Hawkish containment and decoupling'),
  ('trump-gop',           'Trump / GOP leadership',         'Discussion of Trump, GOP leadership, and party direction.',                                'Critical of Trump and GOP',                           'Supportive of Trump and GOP'),
  ('dem-leadership',      'Democratic Party leadership',    'Discussion of Biden, Harris, and Democratic Party direction.',                             'Supportive of Democratic leadership',                 'Critical of Democratic leadership'),
  ('transgender',         'Transgender / LGBTQ policy',     'Trans rights, gender-affirming care, sports, schools.',                                    'Affirming policies and protections',                  'Restrictive policies, especially for minors'),
  ('crime',               'Crime & public safety',          'Crime rates, policing, prosecution policy.',                                               'Reform-oriented, address root causes',                'Tough-on-crime, more policing'),
  ('election-integrity',  'Election integrity',             'Voting access, ballot security, election administration.',                                 'Expand access, reject fraud claims',                  'Stricter ID/security, take fraud claims seriously'),
  ('ai-tech',             'AI & tech regulation',           'AI safety, regulation, antitrust, platform power.',                                        'Stronger regulation and consumer protection',         'Lighter-touch regulation, innovation-first'),
  ('free-speech',         'Free speech & moderation',       'Platform moderation, censorship, First Amendment debates.',                                'Pro-moderation to limit harm',                        'Anti-moderation, free-speech absolutist'),
  ('education-dei',       'Education & DEI',                'K-12 / higher-ed curriculum, DEI, parental rights.',                                       'DEI-affirming, inclusive curricula',                  'Anti-DEI, parental control, traditional curricula'),
  ('abortion',            'Abortion & reproductive rights', 'Abortion access, reproductive policy.',                                                    'Pro-choice, expand access',                           'Pro-life, restrict access'),
  ('climate-energy',      'Climate & energy',               'Climate policy, fossil fuels, renewables.',                                                'Aggressive climate action, transition off fossils',   'Energy abundance, skeptical of climate mandates');
