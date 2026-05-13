# Changelog

All notable changes to soapbox.media are tracked here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versioning follows [SemVer](https://semver.org/spec/v2.0.0.html).

Pre-1.0 minor versions correspond roughly to development phases of the
pre-launch build leading into the November 2026 US midterms.

## v0.6.4 · 2026-05-13

Transcribe reliability fix. Cron's transcribe stage was burning its
TRANSCRIBE_LIMIT on the freshest YouTube uploads of the day, which
typically don't have auto-captions generated yet. Those failed and got
marked permanently failed (no retry logic). Older pending episodes —
which actually do have captions ready — were starved.

### Fixed

- **Transcribe order flipped to oldest-pending-first.** Both
  `src/app/api/cron/pipeline/route.ts` and `scripts/transcribe.ts` were
  ordering by `published_at DESC` (newest first), exactly the worst order
  given YouTube's caption-generation latency. Flipped to ASC. Trade-off:
  ~24h latency between an episode being published and being transcribed,
  which is fine for a trailing 7-day Index aggregate.
- **YT transcript errors now logged.** `getVideoTranscript` was using
  bare `catch { return null }` which made every failure invisible. Now
  logs error class + message so Vercel logs tell us *why* a fetch fails.

### Known followup (v0.7)

Failed transcripts are still permanently failed — no retry. When
`transcript_attempts` + `transcript_last_attempted_at` columns are added,
"failed" becomes retryable until N attempts spread over M hours. Tracked
in memory under v0.7 queue.

## v0.6.3 · 2026-05-12

Critical data-correctness fix: `fetchScoreRows()` pagination was silently
dropping ~46% of sentiment_score rows in production, causing channel
drill-down pages to show 0 mentions when the underlying data was present.

### Fixed

- **`fetchScoreRows()` pagination bug**. The terminator condition
  `if (data.length < pageSize) break` interpreted any short Supabase page
  as end-of-data. Vercel's edge→Supabase route was returning short pages
  (response-size cap hitting before the row cap, due to the deep nested
  join), causing premature termination. On the live site this manifested
  as the prod Soapbox Index reading from 1,314 of 2,444 scores while
  local dev saw the full set. Channel drill-downs for recently-classified
  channels showed empty.
  Fix: terminate only on empty responses (not short ones); add explicit
  `order("id")` so pagination is deterministic; cut pageSize from 1000
  to 500 to keep individual responses comfortably under any size cap;
  add a 50-page safety bound to prevent runaway loops.

## v0.6.2 · 2026-05-12

Operational tuning: cron batch limits raised so we actually keep up with
the daily ingest backlog.

### Changed

- **Cron batch limits raised** — `CLASSIFY_LIMIT` 2 → 15, `SCORE_LIMIT`
  30 → 80. Original limits would have taken ~75 days to burn down a
  single day's 150-episode ingest backlog. New limits target a 1-week
  catch-up rate while staying ~45s clear of the 300s function timeout.
  Stage timing observations documented inline in
  `src/app/api/cron/pipeline/route.ts`.

## v0.6.1 · 2026-05-12

Same-day branding + transparency-surface polish on top of v0.6.0.

### Added

- **Brand identity** — wooden-crate logo + red/blue `soapbox` wordmark
  (red `#C8202F` on "soap", blue `#114A8A` on "box") replacing the plain
  text mark. Logo source-of-truth at `src/assets/logo-crate.png`, served
  through `next/image` with priority + blur placeholder (~5KB delivered
  at retina). Favicon auto-detected from `src/app/icon.png` (256×256).

### Changed

- **Activity moved to footer** — the `/log` link lives in the footer
  alongside Issues / Channels / Methodology rather than the top nav.
  Activity is a transparency surface, not a primary destination.
- **Trust strip totals aligned** with `/channels` SystemStats — both now
  report cumulative channel + episode counts rather than mixing in-window
  counts with all-time. "Episodes in window" → "Episodes tracked".
- **`.media` removed from header** — top-of-page brand mark is now the
  wordmark alone; the `.media` TLD was redundant next to the logo.

## v0.6.0 · 2026-05-12

Post-MVP foundations release. Same-day as v0.5.0; bundled because all of
this work shipped in a single extended session.

### Added

- **Admin tooling** (Basic Auth gated via middleware against ADMIN_PASSWORD):
  - `/admin/costs` — Anthropic spend dashboard. Daily/weekly/monthly burn vs
    $1k budget cap, 30-day daily bar chart, recent-runs table. Backed by a
    new `usage_log` table written from the cron pipeline.
  - `/admin/channels-audit` — three views to guide channel curation:
    publishing cadence per show (last 14 days), L/M/R coverage gaps by issue,
    and "mentioned but not tracked" report scanning supporting quotes for
    candidate voices.
- **PostHog product analytics** — client-side init + manual pageview capture
  for the App Router. Autocapture / heatmaps / web vitals on; session
  recordings off.
- **Public `/changelog` page** — renders `CHANGELOG.md` directly via
  react-markdown so the file remains the single source of truth. Footer
  version pill links here.
- **Public `/log` activity feed** — paginated 50/page; every episode the
  pipeline has ingested with status badges + link to source. Receipts for
  transparency.
- **Per-channel episode list** on channel drill-down pages — last 25
  episodes for that show with publish date, duration, transcript status,
  source link.
- **External-link affordance per channel** — every channel card on
  `/channels` and the drill-down page links out to YouTube or Apple Podcasts.
- **Shared `Header` + `Footer` components** — DRYed out the inline JSX
  across all pages; nav changes are now a one-line edit.
- **Version surface** — `v0.x.y` pill in every page footer linking to the
  on-site changelog. `src/lib/version.ts` is the single source of truth.

### Channel curation

- Added 9 channels: Shawn Ryan Show (R), Real America's Voice / RAV (R),
  The Rubin Report (R), Hodgetwins (R), More Perfect Union (L),
  Democracy Now! (L), Heather Cox Richardson (L), Aaron Parnas (L, below
  500k YT threshold but flagged for cross-platform reach),
  Call Me Back with Dan Senor (M).
- **Pinned PodScan IDs** for Joe Rogan and Ben Shapiro to fix stale-feed
  resolution that was returning episodes from 4-10 months ago. New
  `podscanPodcastId` field on the SeedChannel schema bypasses search-based
  resolution for high-importance shows.
- Total channel rows: 60 (40 unique shows after grouping; ratio reflects
  shows tracked on both YouTube + podcast).

### Changed

- **Daily-cadence framing** site-wide. Replaced "this week" / "weekly"
  copy with trailing-7-day-window language; Soapbox Index methodology
  refactored to use a rolling 7-day window updated daily by the cron.
- **Auto-generated headline** on home page below the needle, driven by
  the same per-issue contribution data shown on `/methodology`. Headline
  links to the contribution chart for "see why" drill-down.
- **Em-dash sweep** across all user-facing text. Replaced with appropriate
  punctuation (colons before lists, parens for asides, commas in flow).
  Per Gregg's site-wide style choice.
- **Channels list grouped by show** — same name across YouTube + podcast
  collapses to one card with platform indicators, eliminating the visual
  "duplicate channel" problem.
- **Status badge clarity** on activity log — "pending" renamed to
  "awaiting transcript" so casual visitors understand it as expected
  latency, not a bug.
- **Hero subtext rewritten** — sharper framing of why soapbox exists
  (alt-media now shapes US political discourse; not measured at scale;
  Soapbox listens above your personal algorithms).
- **Issue contribution chart** added to `/methodology` with auto-generated
  narrative explaining which issues are pulling left vs right.

### Technical

- Vercel Cron `/api/cron/pipeline` endpoint runs the full pipeline at
  10:00 UTC daily (6 AM ET). Writes a `usage_log` row at completion.
- `src/middleware.ts` enforces HTTP Basic Auth on `/admin/*`.
- Added `react-markdown`, `@tailwindcss/typography`, `posthog-js`.
- ARCHITECTURE.md — comprehensive live source-of-truth document. Maintained
  per non-trivial commit.

### Vexes documented for vNext

- **Cross-platform same-content duplicates**: shows that publish identical
  content to both YouTube and podcast feeds get ingested twice. Future fix:
  dedup by (show + date + duration).
- **Stale-feed PodScan resolution**: name-search resolution can pick wrong
  feed when a show has changed feeds. Workaround in v0.6.0: explicit
  `podscanPodcastId` field on SeedChannel. Future fix: smart resolver that
  prefers the feed with most recent episodes.
- **Reach is a snapshot at ingest time** — need periodic re-fetch.
- **Issue taxonomy fixed editorial** — emergent-topic detection deferred.
- **Twitch streamer ingestion** still deferred.

## v0.5.0 · 2026-05-12

Initial public release after the 5-day MVP sprint.

### Added

- 49 hand-curated alt-media channels balanced across Left, Middle, and Right
  political-publishing posture.
- End-to-end pipeline: ingest (RSS + YouTube Data API), transcribe (PodScan
  inline + youtube-transcript for YT), classify (Claude Sonnet 4.6),
  score (Claude Haiku 4.5), aggregate.
- **Soapbox Index**: single L/R number for the trailing 7-day window of
  alt-media political discourse. Updated daily via Vercel Cron at 10:00 UTC
  (6 AM ET).
- 16-issue taxonomy with explicit left and right positions per issue
  (Iran-conflict added on launch day after Israel-Gaza and Trump/GOP were
  absorbing related content).
- Dashboard pages: home (Soapbox Index + sparkline + biggest movers + top
  issues), issue drill-downs, channel drill-downs.
- Methodology page with live "Why is the Index where it is?" per-issue
  contribution chart linkable from the home page.
- Auto-generated narrative headline below the needle driven by the same
  contribution data.
- System-scale stats banner on /channels showing hours of audio analyzed,
  words transcribed, issue mentions classified, etc.
- External "Visit on YouTube" / "Find on Apple Podcasts" link out per channel.
- Vercel Cron: full pipeline runs daily, idempotent against re-runs.

### Technical foundation

- Next.js 14 (app router) + TypeScript + Tailwind + Geist sans on Vercel.
- Supabase Postgres backend with paginated reads + service-role server client.
- Claude Sonnet 4.6 for classification, Claude Haiku 4.5 for scoring.
- PodScan.fm for podcast transcripts (inline with episode metadata).
- YouTube Data API v3 + youtube-transcript npm package for YT.

### Methodology disclosures

- Filter: YouTube videos under 3 minutes excluded from ingest (filters Shorts).
- Known gap: Bannon's War Room and Charlie Kirk Show (podcast feed) aren't
  transcribed by PodScan; metadata only.
- Classifier directional accuracy: ~85–90% at the per-row level.
- L/R position assignments per issue are editorial and reviewed quarterly.

### Known limitations / vNext queue

- Channel reach is a snapshot at ingest time; needs periodic re-fetch.
- Issue taxonomy is fixed-editorial; emergent-topic detection is a v0.6+
  design challenge.
- No admin tooling yet (cost dashboard, channel management); planned next.
- Episode-level transparency surfaces (per-channel episode list, public
  daily ingest log); planned next.
