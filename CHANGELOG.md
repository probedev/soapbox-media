# Changelog

All notable changes to soapbox.media are tracked here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versioning follows [SemVer](https://semver.org/spec/v2.0.0.html).

Pre-1.0 minor versions correspond roughly to development phases of the
pre-launch build leading into the November 2026 US midterms.

## v0.6.17 · 2026-05-24

The last link in the cron chain.

### Fixed

- **Cron transcribe failed every YouTube episode without calling Supadata.**
  Once v0.6.16 fixed the key and the cache, the cron could finally *see*
  pending episodes — but it still marked them all `failed` in ~50ms, never
  reaching Supadata. Root cause: the `channel:channels!fk(platform)` embed
  didn't expose `.platform` reliably at runtime, so `row.channel?.platform`
  was undefined and every episode flunked the `=== "youtube"` guard. Replaced
  the embed with a direct `channel_id → platform` map in `runTranscribe`,
  which is embed-shape-proof. (The classify/score stages still use channel
  embeds; auditing those is a separate follow-up.)

## v0.6.16 · 2026-05-24

Pipeline reliability release. Three compounding bugs kept the production
cron from doing useful work while the CLI worked fine; all are fixed here.

### Fixed

- **Stale cached reads (the big one).** Supabase-js issues reads as `fetch`
  GETs, and the Next.js App Router caches `fetch` by default — so every
  server-side read (the cron *and* server components) was frozen at the
  first snapshot taken after each deploy. The cron reported identical
  results across separate runs (`pendingFound: 1504` twice while the live
  table was at 552) and never saw its own writes or the CLI's. `db.ts` now
  forces `cache: "no-store"` on every Supabase request so reads always hit
  the live database. `force-dynamic` on the route did not reliably cover the
  client's fetches; forcing it at the client is the durable fix.
- **classify dedup pagination.** `scripts/classify.ts` built its
  "already classified" set with `.limit(50000)`, which Supabase silently
  caps at the project Max Rows (1000). Once the classifications table grew
  past ~1000 rows the dedup set was incomplete, so episodes were
  re-classified on every pass — catastrophic under a loop (a catch-up run
  reclassified 234 episodes ~95× into 24k duplicate rows before being
  caught). Now paginates via `.range()` and terminates only on an empty
  page. The runaway duplicates were cleaned up out-of-band.

### Added

- **`scripts/catchup.sh`** — full-pipeline drain that runs ingest, then
  loops transcribe/classify/score until each queue empties, with hard
  per-stage iteration caps so a logic bug can't run away unattended.

### Operational (no code)

- Corrected Vercel's `SUPABASE_SERVICE_ROLE_KEY`: it held a legacy **anon**
  JWT, not a service-role key. With RLS enabled on all tables and zero
  policies, an anon key reads/writes nothing — which is why the cron saw an
  empty database while the CLI (real service key) worked. Swapped to the new
  `sb_secret_…` key. (RLS-with-no-policies is a latent landmine to address
  separately.) `CRON_SECRET` rotated.

### Removed

- Temporary transcribe diagnostic logging from the cron route.

## v0.6.14 · 2026-05-14

The actual fix for YouTube transcripts: **swap the unmaintained
scraping library for a managed transcript API.**

### Background

The `youtube-transcript` npm library had two compounding problems:

1. **Library bug.** Returned `"Transcript is disabled on this video"`
   for videos that demonstrably have captions on YouTube. Documented
   issue since mid-2024 — the library does HTML scraping and breaks
   whenever YouTube changes the embedded `ytInitialPlayerResponse`
   shape.
2. **Cloud-IP blocking.** Even when the library worked, YouTube
   throttled responses from Vercel and GitHub Actions egress pools.
   Strip the `captionTracks` field silently, library reports
   "disabled," scraper-aware infrastructure has a bad day.

A half-day of misdiagnosis (v0.6.4 through v0.6.13) chased these two
intertwined issues separately. v0.6.4 flipped ordering to oldest-first
hoping caption-timing would resolve. v0.6.13 moved transcribe to GH
Actions hoping IP rotation would. Neither fixed it because they were
both treating symptoms of two problems as if they were one.

### Changed

- **Transcripts now fetched via Supadata** (https://supadata.ai), a
  managed YouTube transcript API. We hit `GET /v1/transcript` with the
  YouTube watch URL; they handle scraping, proxy rotation, library
  maintenance — everything we were doing badly. ~$17/mo on the Pro
  plan for our ~3000-transcript/month volume. Uses `mode=native` so we
  only fetch existing captions, never pay for AI generation.
- **`youtube-transcript` package removed** from dependencies. Was the
  source of the cascading failures.
- **Transcribe stage re-enabled on Vercel cron.** The reason we moved
  it to GH Actions in v0.6.13 (cloud-IP blocking) doesn't apply when
  we're calling Supadata's API rather than scraping YouTube directly.
  Vercel cron now handles the full pipeline again: ingest → transcribe
  → classify → score in a single 10:00 UTC run.
- **GH Actions transcribe workflow demoted to manual-only.** Kept
  around as an escape-hatch trigger for ad-hoc catch-up runs, but no
  longer scheduled. Now requires `SUPADATA_API_KEY` repo secret.

### Setup steps

1. Add `SUPADATA_API_KEY` to Vercel environment variables
   (Settings → Environment Variables → New).
2. Add `SUPADATA_API_KEY` to GitHub repo secrets (only needed if
   you'll use the manual workflow).
3. Push v0.6.14. Tomorrow's 10:00 UTC Vercel cron will use the new
   path.

## v0.6.13 · 2026-05-14

Architectural fix for the YouTube-on-Vercel transcript problem:
**transcribe stage moves off Vercel onto GitHub Actions.**

### Diagnosed

The `youtube-transcript` library was reporting "Transcript is disabled
on this video" for videos that actually have captions available on
YouTube. Manual spot-check of three failed-from-Vercel videos showed
two with auto-generated captions, one with owner-uploaded captions —
all present and visible on the YT site. Gregg's home network
successfully transcribed the same videos.

Root cause: YouTube's anti-scraping behavior silently degrades the
watch-page response for IPs it flags as suspicious. The page loads,
but the `captionTracks` field in the embedded JSON is stripped out.
The library can't distinguish "captions were never there" from
"captions were hidden from this IP" and reports both as "disabled."
Vercel's egress IP pool is flagged; home networks and CI runners
generally aren't.

### Changed

- **Transcribe disabled on Vercel cron.** Without this, Vercel's
  10:00 UTC run would mark today's pending YT episodes as `failed`,
  poisoning the queue before GH Actions runs at 10:30 UTC. The cron
  now skips the transcribe stage entirely and writes a no-op stage
  record to keep `usage_log` shape stable.
- **New `.github/workflows/transcribe.yml`** runs daily at 10:30 UTC,
  invoking `npm run transcribe -- 100` from GitHub's runner IP pool.
  Also exposes a `workflow_dispatch` trigger so it can be run manually
  from the Actions tab. Requires two repo secrets: `NEXT_PUBLIC_SUPABASE_URL`
  and `SUPABASE_SERVICE_ROLE_KEY`.

### Pipeline architecture, post-v0.6.13

  10:00 UTC (Vercel)        ingest → classify → score
  10:30 UTC (GitHub Actions) transcribe

End-to-end latency from publish → scored:
  - Podcast (PodScan inline transcript): ~24h
  - YouTube (GH transcribe → next-day Vercel classify): ~25h

### Setup steps to activate

1. Push v0.6.13.
2. In the GitHub repo: Settings → Secrets and variables → Actions →
   New repository secret. Add:
     - `NEXT_PUBLIC_SUPABASE_URL`
     - `SUPABASE_SERVICE_ROLE_KEY`
3. Manually trigger once via Actions tab → "Daily transcribe" → Run
   workflow, to validate the runner IPs work for the YouTube scraper.
4. Confirm success rate is high (>80%) before relying on the schedule.

## v0.6.12 · 2026-05-14

Transcribe throughput bump: TRANSCRIBE_LIMIT 10 → 40 per cron run.

### Changed

- **`TRANSCRIBE_LIMIT` raised from 10 to 40.** Diagnostic SQL showed
  ~49 YouTube episodes ingested per 24h vs only 10 transcribe attempts
  per cron — the pending pool was growing by ~90/day with the rest of
  the pipeline starved for fresh content. 40 attempts at ~1s each adds
  ~30s to cron wall time, still well inside the 300s function budget.
  Won't fully close the gap with daily YT ingest, but cuts the daily
  growth rate substantially while the v0.7 retry mechanism is built.

### Known limitation

At ~30-40% transcribe success rate (legitimate disabled-captions
long-tail) and 40 attempts/day, throughput is still loss-making
relative to ~100 YT ingests/day. The real fix is v0.7: retry-after-
N-hours so fresh same-day caption failures get a second chance, and
possibly a hybrid newest+oldest ordering strategy so today's discourse
isn't permanently stuck behind a slow-burning backlog.

## v0.6.11 · 2026-05-14

Root-cause fix for the 81% score-stage failure rate observed on May 13
and May 14 crons. Diagnosed via the logging added in v0.6.9.

### Fixed

- **Haiku's positive-number "+" prefix is now tolerated.** Score output
  was arriving as `{"sentiment": +4.2, "intensity": 3}` — Haiku
  "helpfully" prefixing positive numbers with a plus sign. JSON spec
  doesn't allow a leading `+`, so `JSON.parse` rejected the entire
  response. Added `normalizeLlmJson` helper that strips leading `+` in
  JSON value positions (after `:` `,` or `[`, before a digit). Doesn't
  touch `+` inside string literals.
- **Score prompt updated** to explicitly instruct "no leading + on
  positive numbers" plus three worked examples (negative, positive,
  zero). Prevents the issue at the source; the parser fix is the
  defensive belt to the prompt's suspenders.

### Impact

This was the silent failure path that produced ~13 of 16 failed score
attempts on each of the last two cron runs (~80% loss rate). With
v0.6.11 deployed, the next cron should score at the ~98% success rate
we saw in yesterday's local catch-up run.

## v0.6.10 · 2026-05-14

Sparkline expansion. Adds context to the home page trend line without
changing its visual character.

### Changed

- **Reference lines at ±5** in addition to the existing dashed-zero
  line. Gives the eye a magnitude anchor at a glance — previously
  every value just floated relative to whatever the data range happened
  to be.
- **Endpoint date labels** under the chart. "Apr 20 ───── May 14" so
  the time range is readable without crossing back into the surrounding
  copy. Drives off a new `sparklineDates` field on `DashboardData`,
  populated in parallel with the values themselves.
- **Range summary** beneath the dates: *Range L+0.3 to L+1.4 · rolling
  7-day index*. Replaces the previous "24-day history · rolling 7-day
  Index" label, which only said how many days of data existed without
  saying what was in it. Sorted most-L to most-R for natural reading
  across crossings of zero.

### Technical

- `aggregate.ts` now returns `sparklineDates: string[]` alongside
  `sparkline: number[]` — same length, same order. Days with no data
  are skipped in both arrays so they stay in sync.

## v0.6.9 · 2026-05-14

Score-stage error logging. Mirrors the transcribe-stage logging added in
v0.6.4. Diagnostic for the 81% score failure rate observed in the May
13 and May 14 cron runs.

### Fixed

- **Score errors now surface in logs.** `runScore` was using bare
  `catch {}` and ignoring failed `sentiment_scores` inserts silently.
  Now logs `[score] <ErrorClass> for classification <id>: <message>`
  on any thrown error from `scoreClassification` (Anthropic API errors,
  JSON parse failures, rate limits), and a similar line for Supabase
  insert errors. Next cron run will tell us *why* score has been
  failing 13/16 attempts.

## v0.6.8 · 2026-05-13

Hotfix for v0.6.7: the OG image build failed on Vercel because Satori
(the renderer behind `next/og`) does not support `<text>` SVG elements.
The three gauge endpoint labels (L 10, 0, R 10) have been moved out of
the SVG and rendered as regular HTML below the gauge using flex
positioning. v0.6.7 tagged but did not successfully deploy.

## v0.6.7 · 2026-05-13

OG image visual alignment with the live site.

### Changed

- **OG image now matches the actual home page identity.** Previous
  v0.6.6 render used a flat horizontal gradient bar for the needle and
  omitted the crate logo. Replaced with the same half-circle gauge SVG
  the home page renders (identical geometry, gradient stops, tick marks,
  and needle), and added the wooden-crate logo to the top-left brand
  row. Visiting the live site after seeing a share now feels continuous
  rather than disjoint. The crate is inlined as base64 from the
  256×256 favicon asset (~56KB payload, much smaller than the 1024×1024
  source).

## v0.6.6 · 2026-05-13

Social-share polish and brand attribution.

### Changed

- **Page title rewritten.** Was *"Soapbox: The FiveThirtyEight of
  Alternative Political Media"* — that framing was useful internally
  as a north star but is the wrong thing to put on a tab, invites
  premature comparison, and the product should stand on its own.
  Now: *"Soapbox · Alternative media discourse, quantified"*.
- **Meta description aligned with home page hero.** Identical wording
  so the social-share blurb matches what visitors see on landing.
- **Footer tagline updated** to match: "alternative media discourse,
  quantified" replacing the older "alt-media discourse, updated daily."
- **Built by Breakfastball LLC · © 2026** attribution added as a
  second footer row, gray and small, so it doesn't crowd the nav.

### Added

- **Dynamic Open Graph image** at `src/app/opengraph-image.tsx`. When
  the site URL is shared (iMessage, Twitter/X, Slack, LinkedIn, etc.)
  the preview card now shows the **live Soapbox Index value**, a
  needle bar, channel + episode counts, and the as-of date — generated
  at request time via `next/og`'s `ImageResponse` and cached for an
  hour per URL. Every share becomes a data preview of the current
  state of alt-media discourse. Twitter card configured to use the
  same image via `summary_large_image`.

## v0.6.5 · 2026-05-13

Home page UX polish and scoring-evaluation tooling.

### Changed

- **Home page hero copy tightened.** "alt-media" → "alternative media"
  throughout. Subtext replaced with a sharper one-line explainer:
  "Soapbox is a data platform that uses language models to quantify what
  major alternative media is saying about US policy issues. We ingest
  and process new episodes daily."
- **Logo trimmed.** Crate dropped 36px → 32px with a tighter gap to the
  wordmark; the previous size felt heavy against the wordmark weight.
- **"Why is the Index where it is?" moved to the home page.** The
  per-issue contribution chart now lives directly under the hero
  needle/number so the explanation stays adjacent to the headline it
  explains. Methodology page links back to it. Window aligned to the
  same 7-day rolling period as the Index number above it.

### Added (tooling, not user-facing)

- **Independent scoring validation package.** New `eval/` directory
  with `LABELING_INSTRUCTIONS.md` (a 4-page methodology brief for an
  outside labeler) and `scripts/extract-gold-set.ts` (stratified
  sampler that emits two CSVs — a clean labeler version with channel
  names blinded to lean, and an internal answer key with model scores).
  Run with `npm run eval:extract-gold-set`. Designed to validate the
  Haiku scorer against independent human judgment; output feeds the
  v0.7 prompt audit.

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
