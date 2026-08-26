-- Confirm-attempts counter for ad_segments (v0.38.0). The 120-day backfill
-- surfaced ~32 "poison" segments: back-to-back ad-break excerpts where the
-- model kept returning arrays / multiple JSON objects the parser rejected,
-- and the confirm loop re-bought the same failures 20-45x each. The parser
-- is now tolerant (src/modules/ads parseAdVerdict), and this counter retires
-- any future persistent failure after MAX_AD_CONFIRM_ATTEMPTS (5) instead of
-- retrying daily forever - the episodes.transcript_attempts lesson (v0.6.78).
-- Applied to prod 2026-08-26 via MCP; recorded here so the repo stays the
-- schema source of truth.

ALTER TABLE public.ad_segments
  ADD COLUMN IF NOT EXISTS confirm_attempts integer NOT NULL DEFAULT 0;
