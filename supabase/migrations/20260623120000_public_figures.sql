-- Public Figures v1: roster + transcript-level mention detection + favorability.
-- A SEPARATE axis from the Soapbox Index (favorability toward a person, -5..+5,
-- crosses party lines) - these tables never feed the L/R needle. Mirrors
-- sentiment_scores / discovery_topic_scores. RLS on, no policies (service-role
-- only), per project convention. Applied to prod 2026-06-23 via MCP; recorded
-- here so the repo stays the schema source of truth.

CREATE TABLE IF NOT EXISTS public.figures (
  slug         text PRIMARY KEY,
  name         text NOT NULL,
  aliases      text[] NOT NULL DEFAULT '{}',   -- whole-word alias tokens for detection
  kind         text NOT NULL DEFAULT 'person' CHECK (kind IN ('person','org')),
  affiliation  text,                            -- editorial tag (D/R/foreign/tech/media), display only
  blurb        text,
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.figure_mentions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id    uuid NOT NULL REFERENCES public.episodes(id) ON DELETE CASCADE,
  figure_slug   text NOT NULL REFERENCES public.figures(slug) ON DELETE CASCADE,
  quote         text NOT NULL,
  char_offset   integer NOT NULL,
  start_ts      integer,
  matched_alias text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (episode_id, figure_slug, char_offset)
);
CREATE INDEX IF NOT EXISTS figure_mentions_figure_idx  ON public.figure_mentions (figure_slug);
CREATE INDEX IF NOT EXISTS figure_mentions_episode_idx ON public.figure_mentions (episode_id);

CREATE TABLE IF NOT EXISTS public.figure_scores (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  figure_mention_id uuid NOT NULL UNIQUE REFERENCES public.figure_mentions(id) ON DELETE CASCADE,
  favorability      numeric NOT NULL CHECK (favorability >= -5 AND favorability <= 5),
  intensity         numeric NOT NULL CHECK (intensity >= 1 AND intensity <= 5),
  model             text,
  model_version     text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.figures         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.figure_mentions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.figure_scores   ENABLE ROW LEVEL SECURITY;
