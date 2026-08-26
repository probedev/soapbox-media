-- Advertisers v1 (v0.38.0): host-read sponsor detection + the advertiser x lean
-- map at /advertisers. Two-phase like figures: a free regex pass inserts
-- candidate segments as verdict='pending'; a Haiku confirm pass settles each
-- one to 'ad' / 'self_promo' / 'not_ad' and resolves the brand. Only
-- verdict='ad' rows are public. Rejected rows stay as tombstones so the
-- idempotent detect upsert never re-pays to re-judge them.
-- RLS on, no policies (service-role only), per project convention.
-- Applied to prod 2026-08-26 via MCP; recorded here so the repo stays the
-- schema source of truth.

CREATE TABLE IF NOT EXISTS public.advertisers (
  slug       text PRIMARY KEY,           -- canonical brand slug ('quince'), see canonicalAdvertiser()
  name       text NOT NULL,              -- display name ('Quince')
  domain     text,                       -- promoted domain when known ('quince.com')
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ad_segments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id      uuid NOT NULL REFERENCES public.episodes(id) ON DELETE CASCADE,
  char_start      integer NOT NULL,      -- offset of the first anchor hit in the transcript
  char_end        integer NOT NULL,      -- offset of the last anchor hit
  excerpt         text NOT NULL,         -- cleaned context window (never the full transcript)
  start_ts        integer,               -- seconds into the episode, from inline caption markers
  est_seconds     integer,               -- rough read length at ~16 transcript chars/sec
  strong_hits     integer NOT NULL DEFAULT 0,
  weak_hits       integer NOT NULL DEFAULT 0,
  verdict         text NOT NULL DEFAULT 'pending'
                  CHECK (verdict IN ('pending','ad','self_promo','not_ad')),
  advertiser_slug text REFERENCES public.advertisers(slug) ON DELETE SET NULL,
  advertiser_raw  text,                  -- model's raw brand string, pre-canonicalization
  model           text,
  model_version   text,
  confirmed_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (episode_id, char_start)        -- the idempotency key for detect re-runs
);

CREATE INDEX IF NOT EXISTS ad_segments_advertiser_idx
  ON public.ad_segments (advertiser_slug) WHERE verdict = 'ad';
CREATE INDEX IF NOT EXISTS ad_segments_pending_idx
  ON public.ad_segments (id) WHERE verdict = 'pending';
CREATE INDEX IF NOT EXISTS ad_segments_episode_idx
  ON public.ad_segments (episode_id);

ALTER TABLE public.advertisers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ad_segments ENABLE ROW LEVEL SECURITY;
