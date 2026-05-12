# Soapbox Architecture

**Document version**: v0.5.0
**Last updated**: 2026-05-12

This is the live source-of-truth for how soapbox.media is built. It's
maintained on every non-trivial commit; anything material that changes
in the system should be reflected here in the same PR.

---

## What it is

Soapbox listens to a hand-curated set of alt-media political voices —
podcasts and YouTube channels — ingests their content nightly, transcribes
it, classifies each substantive issue mention into a defined taxonomy,
scores those mentions on sentiment and intensity, and surfaces the
aggregate as a single signed number (the **Soapbox Index**) plus
drill-downs by issue and channel.

The headline value is intentionally simple ("alt-media is leaning L+1.2
right now"); the page beneath the headline shows every step of the math.

---

## Pipeline diagram

```
              YouTube Data API ─┐
                                ├──> [ingest module] ──> episodes table
              PodScan API ──────┘
                                                              │
                                                              ▼
              PodScan transcripts (inline) ─┐
                                            ├──> [transcribe module] ──> transcripts table
              youtube-transcript scrape ────┘
                                                              │
                                                              ▼
                          Claude Sonnet 4.6 ──> [classify module] ──> classifications table
                                                              │
                                                              ▼
                          Claude Haiku 4.5  ──> [score module] ────> sentiment_scores table
                                                              │
                                                              ▼
                       [aggregate library] ──> getDashboardData, getIndexBreakdown,
                                                getIssueDrillDown, getChannelDrillDown
                                                              │
                                                              ▼
                          Next.js App Router server components render dashboard pages
```

A single Vercel Cron invocation at 10:00 UTC daily runs all four pipeline
stages sequentially. Each stage is idempotent — re-running picks up only
work that wasn't completed in prior runs.

---

## Tech stack

| Concern | Choice | Notes |
|---|---|---|
| Framework | Next.js 14 (app router) + TypeScript | Server components throughout |
| Hosting | Vercel | Pro plan required for cron's 300s function timeout |
| UI | Tailwind + lucide-react icons + Geist sans (via `geist` package) | No shadcn primitives yet — added if/when needed |
| DB | Supabase Postgres | RLS off; service-role client used server-side |
| Cron | Vercel Cron (`vercel.json`) | Daily at 10:00 UTC; auth via `CRON_SECRET` |
| LLM classify | Claude Sonnet 4.6 | One call per transcript, JSON-array output |
| LLM score | Claude Haiku 4.5 | One call per classification, JSON-object output |
| Podcast transcripts | PodScan.fm | Transcripts arrive inline with episode metadata |
| YouTube transcripts | youtube-transcript npm pkg | Scrapes YT's internal caption endpoint |
| Channel discovery | RSS (podcasts) + YouTube Data API v3 (videos) | |
| Analytics | (planned) PostHog | Env vars wired; not yet active |
| Scripts | tsx + dotenv | CLI runners under `scripts/` use the same lib code as the cron endpoint |

---

## Module layout

```
soapbox/
├── ARCHITECTURE.md              ← this file
├── CHANGELOG.md                 ← release notes per version
├── PRD.md                       ← original product spec
├── CHANNELS.md                  ← human-readable channel list v2 (42→49)
├── package.json                 ← version source of truth (currently 0.5.0)
├── vercel.json                  ← cron schedule
├── supabase/migrations/         ← DDL migrations (one per release, ideally)
├── scripts/                     ← CLI runners; one per pipeline stage
│   ├── _load-env.ts             ← dotenv side-effect import for tsx scripts
│   ├── seed-channels.ts
│   ├── ingest.ts
│   ├── transcribe.ts
│   ├── classify.ts
│   └── score.ts
└── src/
    ├── app/                     ← Next.js routes
    │   ├── page.tsx             ← home (dashboard)
    │   ├── issues/              ← issue taxonomy + drill-down
    │   ├── channels/            ← channel list + drill-down
    │   ├── methodology/         ← public methodology + live contribution chart
    │   ├── log/                 ← public daily ingest log
    │   └── api/cron/pipeline/   ← Vercel cron endpoint
    ├── components/              ← presentational React components
    ├── lib/                     ← server-side libraries (DB, APIs, math)
    └── modules/                 ← pipeline stages (classify, score)
```

**Architectural principle**: modules never call each other directly. Every
stage reads its inputs from the DB and writes its outputs to the DB. This
makes each stage independently swappable — we could replace PodScan with
self-hosted Whisper, or Haiku with a custom fine-tune, by editing one file.

---

## Database schema (Supabase Postgres)

Schema defined in `supabase/migrations/20260511000000_initial_schema.sql`.
Mermaid view:

```
channels (49 rows)
  ├─ id uuid PK
  ├─ name text
  ├─ platform: 'youtube' | 'podcast'
  ├─ platform_id text          (UCxxx for YT, pd_xxx for PodScan)
  ├─ political_lean: 'L' | 'M' | 'R'
  ├─ reach bigint              (snapshot at seed time — needs periodic refresh)
  ├─ active boolean
  ├─ classification_rationale text
  └─ unique (platform, platform_id)

issues (16 rows, including iran-conflict)
  ├─ slug PK
  ├─ name, definition
  ├─ left_position, right_position   ← editorial L/R definitions
  └─ active boolean

episodes
  ├─ id uuid PK
  ├─ channel_id → channels
  ├─ title, published_at, source_url, duration_sec
  ├─ transcript_status: 'pending' | 'fetched' | 'failed' | 'skipped'
  └─ unique (channel_id, source_url)

transcripts
  ├─ episode_id PK → episodes
  ├─ text
  ├─ provider: 'podscan' | 'youtube_captions' | 'whisper'
  └─ ingested_at

classifications
  ├─ id uuid PK
  ├─ episode_id → episodes
  ├─ issue_slug → issues
  └─ supporting_quote text

sentiment_scores
  ├─ id uuid PK
  ├─ classification_id → classifications
  ├─ sentiment numeric(3,1)    (-5..+5; negative = L-aligned)
  ├─ intensity numeric(3,1)    (1..5)
  ├─ supporting_quote, model, model_version
  └─ created_at

weekly_index
  └─ (reserved; not yet populated — aggregation currently computed on read)
```

---

## Pipeline stages in detail

### 1. Ingest (`src/app/api/cron/pipeline/route.ts` → `runIngest`)

For each active channel:

- **YouTube path** — `getRecentUploads(uploadsPlaylistId, n)` calls
  `playlistItems.list` + `videos.list` (for duration). Filters episodes
  shorter than 180s (Shorts). Upserts into episodes with
  `transcript_status` defaulting to `'pending'`.
- **Podcast path** — `getPodcastEpisodes(podcastId, n)` returns episodes
  with transcripts inline as `episode_transcript`. Upserts into episodes
  with duration; if transcript text is non-empty, also writes a row to
  transcripts and updates the episode's `transcript_status` to `'fetched'`.

Idempotent: upsert on `(channel_id, source_url)`. Reach is NOT updated
here — needs periodic re-fetch (vNext).

### 2. Transcribe (`runTranscribe`)

For each episode with `transcript_status = 'pending'`:

- **YouTube** — extracts video ID from `source_url`, calls
  `youtube-transcript`, writes to transcripts table and flips status to
  `'fetched'`. Fails to `'failed'` if no captions available.
- **Podcast pending** — shouldn't happen often (ingest writes transcripts
  inline). When it does, marks `'failed'`; PodScan didn't have it ready.

### 3. Classify (`runClassify`)

For each transcript whose episode lacks any classifications:

- Loads issue taxonomy from `issues` table at request time.
- Calls Claude Sonnet 4.6 with full transcript + taxonomy. Prompt asks
  for substantive issue mentions only.
- Returns JSON array of `{issue_slug, supporting_quote}`. Caller
  filters to valid issue_slugs (defends against hallucination).
- Inserts mentions into `classifications` table.

Conservative batch: `CLASSIFY_LIMIT = 2` per cron run to fit in the 300s
function timeout. Backfill of large datasets uses the CLI script
(`npm run classify -- 200`) without timeout constraints.

### 4. Score (`runScore`)

For each classification without a `sentiment_scores` row:

- Loads classification + its issue's L/R positions + channel metadata.
- Calls Claude Haiku 4.5 with the quote + L/R context.
- Returns JSON object `{sentiment: -5..+5, intensity: 1..5}`.
- Inserts to `sentiment_scores` table.

Conservative batch: `SCORE_LIMIT = 30` per cron run. ~$0.0006 per row.

### 5. Aggregate (`src/lib/aggregate.ts`)

Read-only library exposing:

- `getDashboardData(windowDays=7)` — home page data; trailing 7-day
  rolling window. Returns Index, delta vs prior 7 days, 30-point
  daily-rolling sparkline, top issues, biggest movers.
- `getIndexBreakdown(windowDays=30)` — methodology page contribution
  chart. Per-issue contribution magnitudes ordered by abs(magnitude).
- `getIssueDrillDown(slug)` — channel leaderboard for one issue, 30-day
  window.
- `getChannelDrillDown(id)` — issue breakdown for one channel, 30-day
  window.
- `getSystemStats()` — channel/episode/transcript/classification/score
  counts + audio hours + estimated word count + last-update timestamp.
- `buildAutoHeadline(breakdown)` — narrative string for the home page's
  WeeklyHeadline component.

**Math** (all in JS, no SQL aggregates yet):

```
reach_factor = log10(max(channel.reach, 10))
weight       = intensity × reach_factor
contribution = sentiment × weight
weighted_lean = Σ contribution / Σ weight   ← in [-5..+5]
soapbox_index = clip(weighted_lean × 2, -10, +10)
```

All aggregation paginates Supabase reads (page size 1000) to clear the
default 1000-row response cap.

---

## External dependencies

| Service | Purpose | Cost driver | Quota / cap |
|---|---|---|---|
| Anthropic API | classify + score LLM calls | tokens; ~$10/mo at current cron cadence | $50/mo cap on key (planned bump to $150) |
| PodScan.fm | podcast metadata + transcripts | per-call; we pay flat plan | plan-dependent |
| YouTube Data API v3 | channel discovery + recent uploads + durations | quota units; ~50/day at cron cadence | 10,000 units/day free |
| youtube-transcript | YT caption scrape | free; scrapes public endpoint | rate-limit risk on heavy fan-out |
| Supabase | Postgres + auth + storage | tiered by row count + transfer | free tier covers MVP |
| Vercel | hosting + cron | Pro plan for 300s function timeout | $20/mo |

---

## Cost model

At v0.5.0 cadence (one cron/day, conservative batch sizes):

- Anthropic — ~$2-3/day (classify dominates; ~$0.06/transcript × 5-15 new transcripts/day)
- Vercel — $20/mo flat (Pro plan)
- Supabase — free tier (will outgrow ~6-12 months from now)
- PodScan — plan-dependent flat
- YouTube — free (well under 10k unit/day quota)

Monthly run-rate at current cadence: ~$80-120/month (Gregg's budget is
$1,000/mo, so headroom for higher LLM use, more channels, or future
infrastructure).

The admin cost dashboard (v0.6.x, planned) will track this in detail
with a `usage_log` table fed by each cron run.

---

## Known limitations

1. **Reach is a snapshot** — channels that grow audience over the build
   period contribute at their early reach figure. Needs periodic
   re-fetch (vNext).
2. **Issue taxonomy is fixed editorial** — emergent topics aren't
   automatically detected. Iran-conflict was the smoking gun on
   launch day. Designed solution: an "off-taxonomy" output channel
   in classify + embedding clustering (vNext, v0.6+).
3. **Bannon's War Room not transcribed** — PodScan catalogs but doesn't
   transcribe. We have metadata only.
4. **Classifier directional accuracy** — ~85-90% per row. Aggregates
   wash out noise; individual quotes can be miscategorized.
5. **No admin tooling** — channel adds/removes via CLI scripts only
   (vNext, v0.6).
6. **No PostHog** — env vars wired, but no events firing yet.
7. **No error monitoring** — only Vercel function logs.
8. **No mobile-specific QA** — pages are responsive but not specifically
   tested on narrow viewports.
9. **Aggregation is computed on read** — fast enough at ~1.3k rows;
   will need materialized views as data grows.

---

## Open questions / pending product decisions

- When channel reach refreshes, do historical scores re-weight
  retroactively (recompute from current reach) or are they timestamp-frozen
  (stored at the reach value when computed)?
- Should the dashboard show daily Index, rolling-weekly Index, or both?
  (Currently: rolling-weekly only.)
- Should the cron split into multiple smaller jobs to fit Vercel Hobby
  60s timeout? (Currently requires Pro plan's 300s.)
- Should the L/R position definitions per issue be revisited quarterly
  by a small editorial board? Right now they're locked to Gregg's
  judgment.

---

## Versioning

Versions tracked in `package.json` and `src/lib/version.ts`.
Release notes in `CHANGELOG.md`. Current version visible in site footer
linking to the GitHub-rendered changelog.

Pre-1.0 minor bumps roughly correspond to feature releases:

- v0.1–v0.5 = the 5-day MVP sprint days (compressed; we shipped everything in one night)
- v0.6 = admin tooling (cost dashboard, channel management)
- v0.7 = transparency surfaces (episode lists, public ingest log) — partial in v0.5; full in v0.7
- v0.8 = emergent-topic detection
- v0.9 = mobile polish + performance hardening
- v1.0 = pre-midterms public launch (Aug-Sept 2026)

Patch bumps (v0.5.1, etc.) for bug fixes and small improvements between
feature releases.
