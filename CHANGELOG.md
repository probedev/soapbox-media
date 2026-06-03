# Changelog

All notable changes to soapbox.media are tracked here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versioning follows [SemVer](https://semver.org/spec/v2.0.0.html).

Pre-1.0 minor versions correspond roughly to development phases of the
pre-launch build leading into the November 2026 US midterms.

## v0.6.81 · 2026-06-03

### Changed

- **Tighter pipeline cadence for a fresher site.** Now that transcribe/classify/
  score run through concurrency pools, processing latency — not cost — is the
  thing to cut (cost tracks episode *volume*, which is unchanged). Transcribe +
  classify go from every 4h → **every 2h**; score from every 6h → **every 3h**
  (score also refreshes the home snapshot, so the needle now updates 8×/day
  instead of 4×). Capacity check: score 8×240=1,920 mentions/day vs ~1,400
  steady-state; classify 12×60=720 episodes/day vs ~230. Ingest stays 1×/day —
  its 3-episode cap is per-run, so more frequent ingest would over-sample
  high-volume channels past the 3/day "stance per audience" cap.

## v0.6.80 · 2026-06-03

### Added

- **Cohort dropdown on admin add-channel.** The `/admin/channels` form now has
  an Independent / Legacy selector (defaults to Independent), so a channel's
  cohort is set at add-time instead of defaulting to independent and being
  fixed up afterward (as 60 Minutes + Real Time had to be). Threaded through
  `AddChannelInput.cohort` → the insert in `addYouTubeChannel`.

## v0.6.79 · 2026-06-03

### Added

- **Admin add-channel now auto-drafts the description.** A new "Resolve & draft"
  step on `/admin/channels` resolves the handle, reports floor/dup status, and
  generates a one-sentence rationale in the site's house voice (Haiku, grounded
  on the channel's own YouTube description + recent video titles + assigned
  lean) — pre-filling the editable field so the admin *edits* rather than
  *writes from scratch*. `previewYouTubeChannel()` / `generateChannelRationale()`
  in `src/lib/channels.ts`; generation never blocks the add (falls back to a
  template on error).

## v0.6.78 · 2026-06-03

### Fixed

- **Transcribe no longer strands episodes on a transient blip.** `runTranscribe`
  previously marked *every* failure `transcript_status='failed'` and only ever
  re-queried `'pending'`, so a one-off Supadata outage (2026-06-02, ~95 episodes
  failed in a single run) permanently abandoned episodes whose captions were
  perfectly fetchable. `getVideoTranscript` now returns a discriminated result
  distinguishing a terminal "no captions" (206 / empty / bad video) from a
  transient error (5xx / 429 / network). Transient failures leave the episode
  `pending` and bump a new `episodes.transcript_attempts` counter, retrying up
  to `MAX_TRANSCRIPT_ATTEMPTS` (3) before giving up — so blips self-heal while a
  genuinely-broken video still terminates. Backfilled the 89 stranded episodes.

## v0.6.77 · 2026-06-01

### Changed

- Cohort badge (mic/tv) now uses the same styled shadcn tooltip as the L/M/R
  lean badge instead of the native browser `title`, so hover tooltips look
  consistent on /log and /channels. Added a `TooltipProvider` (150ms delay,
  matching /log) around the /channels list to host it. Also swapped the em
  dash in the cohort tooltip labels for a middle dot.

## v0.6.76 · 2026-06-01

### Changed

- /log legend row: lean + cohort legends left-justified, status-dot legend
  right-justified, to visually separate the category legends from the
  pipeline-status legend.

## v0.6.75 · 2026-06-01

### Changed

- Consolidated the /log table legends: the L/M/R lean legend, the cohort
  (mic=independent / tv=legacy) legend, and the status-dot legend now sit
  together in one right-aligned row directly above the episode table. The
  cohort legend moved out of the "Episode receipts" heading.

## v0.6.74 · 2026-06-01

### Added

- **Cohort legend** (`<CohortLegend>`) on `/channels` and `/log` — defines the
  mic = independent / tv = legacy icons next to the channel list + episode
  table.
- **Cohort breakdown on the panel cards:**
  - **Panel balance** gains two stacked bars — shows-by-cohort and reach-by-
    cohort (independent vs legacy) — alongside the existing L/M/R bars.
    `StackedBar` generalized to per-segment colors.
  - **Panel scale** gains a "By cohort" line with the icons + each cohort's show
    count and combined reach (`getPanelStats` now returns `channelsByCohort` /
    `audienceReachByCohort`).
  - Both gated on legacy actually being present.

### Changed

- Home subheadline: "legacy institutions" → "legacy media"; em dash → comma.

## v0.6.73 · 2026-06-01

### Added — LEGACY COHORT LAUNCH 🚀

- **Legacy media is now live alongside independent.** Flipped
  `PUBLIC_COHORTS` to `['independent', 'legacy']`, which simultaneously:
  - **Blends the master Soapbox Index** across both cohorts (≈L+0.1, reach-
    weighted, volume-capped).
  - **Reveals the two sub-needles** under the master — Independent (≈L+0.5) vs
    Legacy (≈R+1.5) — with the caption "same issues, same scoring."
  - **Shows the cohort icon** (mic = independent, tv = legacy) on `/channels`
    and `/log`, and surfaces the 9 legacy channels + their episodes.
- **Copy reframe.** Home headline → "Where is online political media leaning
  right now?"; subheadline introduces the independent-creators vs legacy-
  institutions split. Site title, social meta, footer, and OG image updated
  from "alternative media discourse" → "online political media, quantified."
- **Methodology** gains a "Cohorts: independent vs legacy" section.

## v0.6.72 · 2026-06-01

### Added (gated — invisible)

- **Independent vs Legacy sub-needles** under the master Soapbox Index on the
  home page. Two compact needles (`<SubNeedle>`, reusing `SoapboxNeedle` at a
  smaller size) showing each cohort's Index — so the blended master headline
  arrives with the split that explains it. Gated on `PUBLIC_COHORTS.length > 1`,
  invisible until the flip.
- The home snapshot (`writeHomeSnapshot`) now also computes and stores
  per-cohort indices (`HomeSnapshot.cohorts`), so the sub-needles read from the
  precomputed row — no extra per-request work. Field is optional for backward
  compatibility with older snapshots.

## v0.6.71 · 2026-06-01

### Added (gated — invisible)

- **Cohort badge** (`<CohortBadge>`): a small icon + hover label marking a
  channel/episode as independent (mic) or legacy (tv), placed next to the L/M/R
  lean badge on `/channels` and `/log`. Gated on `PUBLIC_COHORTS.length > 1`, so
  it renders nothing while the site is independent-only and appears
  automatically when legacy is exposed at launch. Threaded `cohort` through the
  channels query and the `EpisodeTableRow` (the view already exposes it).

## v0.6.70 · 2026-06-01

### Changed

- **Taxonomy + methodology copy refresh.** Dropped the "alt-media" abbreviation
  from the `/issues` taxonomy page (intro + activity-card header) and the
  `/methodology` page; reframed around the platform (YouTube + podcasts).
  De-dried the taxonomy intro and removed the "(not yet bucketed)" TODO leaking
  into the "Political figures & parties" group.
- **Methodology now documents volume normalization.** The `/methodology` Index
  section explains the two deliberate choices — audience-reach weighting and the
  **3-episodes/day per-channel cap** — framing the Index as "stance per unit of
  audience" rather than who posts most. (Previously only the reach-weighting
  formula was disclosed; the cap was undocumented.)

### Fixed

- **`scripts/drain.ts` rides out transient blips** — a stage round now retries
  with backoff (up to 5 consecutive errors) instead of crashing the whole drain
  on a one-off Supadata/Supabase `fetch failed`.

## v0.6.69 · 2026-05-31

### Performance

- **Parallelized transcribe too.** The transcribe stage was still serial (the
  slow part of a full drain). Now runs through the same `mapPool` at concurrency
  8 — each Supadata call is multi-second, so the request rate stays ~2/s, well
  under the 10/s Supadata limit. `TRANSCRIBE_LIMIT` raised 40→100 (the
  wall-clock budget remains the real cap; the pool stops pulling at the
  deadline). Transcribe rounds drop from ~3–6 min to well under a minute.

## v0.6.68 · 2026-05-31

### Performance

- **Parallelized classify + score (cron throughput).** Both stages processed
  episodes/mentions one-at-a-time; the classify cron's ~90/day capacity was the
  pipeline bottleneck. They now run through a bounded-concurrency worker pool
  (`src/lib/concurrency.ts` → `mapPool`): classify at concurrency 10, score at
  15, sized for an Anthropic Max-tier account. Per-run limits raised
  accordingly (CLASSIFY_LIMIT 15→60, SCORE_LIMIT 80→240); the per-stage
  wall-clock budget is still the real cap, so runs finish under the 300s
  function limit (the pool stops pulling new work at the deadline).
  - Net: classify throughput ~5–6× per run (~90/day → ~500+/day at the same
    cron cadence), bounded now by the Anthropic tier rather than the serial
    loop. Counters are mutated inside the pool, which is safe (single-threaded).
  - New `npm run drain` (`scripts/drain.ts`): loops the parallelized stages
    until the backlog clears — used to drain the legacy seed immediately rather
    than waiting ~1–3 days for the crons.

## v0.6.67 · 2026-05-31

### Added (foundation — invisible)

- **Channel cohorts: `independent` vs `legacy`.** Groundwork for an
  independent-vs-legacy comparison and a blended master Index. New
  `channels.cohort` column (default `independent`, indexed); all 86 existing
  channels backfilled to `independent`. `episode_pipeline_summary` view gains
  `cohort`.
- **All public reads are now cohort-aware**, gated by a single control point
  (`src/lib/cohort.ts` → `PUBLIC_COHORTS = ['independent']`). The Index
  (`fetchScoreRows`), issue/topic drill-downs, channel list, panel/system
  stats (shows, episodes, hours), and the `/log` feed all filter to the public
  cohort. This lets legacy channels be seeded and ingested **invisibly** —
  legacy data accumulates but never surfaces until we flip `PUBLIC_COHORTS` and
  ship the comparison UX. Zero behavior change now (every channel is
  `independent`). Non-political legacy content stays a non-issue: it classifies
  to `no-signal` and never enters scoring/weighting.
  - Known follow-up: the secondary scale totals (transcripts/classifications
    counts in SystemStats) are still whole-pipeline; tighten at launch.

## v0.6.66 · 2026-05-31

### Performance

- **Drill-down pages (`/channels/[id]`, `/issues/[slug]`, `/topics/[slug]`)
  were ~7s — now DB-filtered.** Each called `fetchScoreRows()` — the full
  ~17K-row sentiment_scores deep join — then filtered in JS for the one
  channel/issue/topic. They pulled the entire table to show a single slice
  (the same problem the home page had, never fixed for the drill-downs).
  - New `fetchScoreRowsFiltered()` anchors on `classifications` and filters at
    the DB via the indexed `issue_slug` / `episode_id` columns, returning only
    the rows in scope (e.g. iran-conflict 2,137 rows, a channel ~700, vs 17,673
    every time). Same ScoreRow shape and scored-only semantics as
    `fetchScoreRows`; paginated for hot issues that exceed 1,000 rows.
  - `getIssueDrillDown` filters by `issue_slug`; `getTopicDrillDown` resolves
    the topic's child issues then filters by their slugs; `getChannelDrillDown`
    resolves the channel's episode ids then filters by them. The downstream JS
    filters become no-ops on the already-scoped set, so the numbers are
    unchanged — only faster. Stays live (no snapshot/staleness).

## v0.6.65 · 2026-05-31

### Performance

- **`/log` now server-paginates its episode table.** The page was loading the
  entire ~2,000-row archive every request to power client-side
  search/sort/paginate — ~1.3s TTFB that grows with the archive. (Measured: the
  underlying `episode_pipeline_summary` view runs in ~64ms — the DB was never
  the bottleneck; the cost was fetching + serializing the full row set.)
  - New `GET /api/episodes` endpoint: sort, search, and pagination run in
    Postgres (`getEpisodeTablePage` — `.range()` + `count: 'exact'`), returning
    only the ~25 rows a page shows plus the total count. Search is sanitized
    before the PostgREST `or()` filter; stage columns sort by their underlying
    status field.
  - `EpisodeDataTable` gained a `serverSide` mode (TanStack manual
    sorting/filtering/pagination + debounced search + abortable fetch). `/log`
    uses it; the per-channel table keeps client mode (small, preloaded sets).
    Expandable per-episode receipts (v0.6.64) work unchanged.
  - `/log` TTFB no longer scales with the episode count — it fetches one page
    regardless of archive size. Trade-off: the table now hydrates client-side
    (a brief "Loading episodes…") rather than being in the initial HTML.

## v0.6.64 · 2026-05-31

### Added

- **Expandable per-episode receipts on `/log`.** Each scored episode row now
  expands to show exactly what the pipeline classified and scored: every issue
  mention with its sentiment chip (L+/R+, the home Index convention), a 1–5
  intensity meter, and the supporting quote the model flagged — plus an episode
  net-lean summary. Delivers on the page's "receipts, in the open" promise and
  gives the operator a fast lens to spot mis-scores or bad issue-mappings before
  scaling the channel set.
  - Lazy-loaded on expand via a new `GET /api/episodes/[id]/mentions` route
    (one episode at a time), so the table never eager-loads the full
    classifications join. Mentions are sorted strongest-first
    (|sentiment| × intensity).
  - Built on the existing shadcn data table (shadcn `<Table>` primitives +
    TanStack `getExpandedRowModel`); a caret appears only on episodes that
    produced classifications. New `<EpisodeMentions>` sub-row component.
  - Quotes are excerpts only, never full transcripts.

## v0.6.63 · 2026-05-31

### Fixed

- **Cron classify silently stalled — `transcripts.id` doesn't exist.** The
  scheduled classify stage reported `pendingFound=0` on every run for >24h
  while 68 transcribed episodes sat ready. Root cause: `runClassify` did
  `.select("id, …")` / `.order("id")` on the `transcripts` table, whose PK is
  `episode_id` — there is no `id` column. The query 400'd every run, the error
  was swallowed (`const { data } =` with no error check), the loop broke, and
  the empty result read as "queue empty." Broken since v0.6.47 (the "add ORDER
  BY" fix used the wrong column name); masked because the CLI catchup
  (`scripts/classify.ts`, episode-first since v0.6.48) did the real draining.
- **Fix: cron classify is now episode-first, mirroring the CLI.** Query the
  `episodes` table for `classify_status='pending' AND transcript_status=
  'fetched'` (cheap — no text), then load each transcript's `text` on demand
  inside the loop. This eliminates the ≈80MB "pull every transcript" payload
  that also caused the response-size/timeout fragility, and the pending-episode
  query now **checks its error and throws** instead of silently reporting an
  empty queue — so this class of stall fails loud, not silent.
- Drained the 68-episode backlog (classify + score) so the Index reflects
  current data.

## v0.6.62 · 2026-05-30

### Added

- **"What alt-media is talking about" card on `/issues`.** The issues page was
  the only main page with no data card above its list — a static taxonomy
  reference with no live signal. Added a topic-level attention rollup above the
  taxonomy: the 23 issues' mention volume aggregated into the same 11 topics the
  list is grouped by, ranked by mention count, each with a volume bar, the
  topic's volume-weighted lean tint, and a deep link to its `/topics/[slug]`
  page.
  - Reads per-issue volume/lean from the existing `dashboard_snapshot` (one
    row, no heavy join) via `readHomeSnapshot()`, with a live `getDashboardData`
    fallback when the snapshot is absent. So the page stays fast and adds no new
    DB aggregation.
  - New `<IssueActivityByTopic>` component (pure presentational, prop-driven —
    same pattern as `PanelBalance` / `PanelScale`). Bars + headline use raw
    mention count ("how much is this discussed"); lean tint uses volume-weighted
    lean so the direction matches the Index basis.
  - Deliberately distinct from the home page's "Biggest movers" (a lean-swing
    leaderboard) — this is an attention-volume *distribution*, answering the
    `/issues` reader's question "which areas are hot, which should I open?"

## v0.6.61 · 2026-05-30

### Performance

- **Home page TTFB: precompute the dashboard instead of recomputing per
  request.** v0.6.60's `cache()` fix only deduped the double `fetchScoreRows`
  call *within* one render — it can't cache across requests, and `cache()` is
  per-render scope only. Direct prod timing after v0.6.60 still showed ~9.5s
  TTFB on `/` (every visitor recomputed the full ~17K-row deep join from
  scratch), while `/channels` and `/issues` stayed ~0.4s. Root cause is
  structural: the home page re-aggregates all history on every hit, but the
  underlying data only changes when the daily pipeline runs.
  - **New `dashboard_snapshot` table** (migration
    `20260530120000_dashboard_snapshot.sql`): one JSONB row per window key
    (`home:7`) holding the precomputed `{ dashboard, breakdown }`. Service-role
    only.
  - **`writeHomeSnapshot()`** computes `getDashboardData()` + `getIndexBreakdown()`
    once (sharing the per-request `fetchScoreRows` cache → one DB pass) and
    upserts the row. Called at the end of the **score cron** (the last
    data-producing stage) and the manual `/api/cron/pipeline` run; best-effort
    so a snapshot failure never fails the cron. Also runnable ad hoc via
    `npm run refresh:snapshot`.
  - **`readHomeSnapshot()`** + home page now reads that single indexed row
    (~sub-100ms). Falls back to the live computation when the snapshot is
    missing or unavailable (first deploy / before first cron / pre-migration),
    so the page never breaks. `<IssueContributionsChart>` takes the breakdown
    as a prop (live fetch retained as fallback).
  - Net: home `/` TTFB drops to ~0.4s for every visitor, with no cold-miss
    cliff on deploys (unlike a request-level cache). Removes the 17K-row join
    from the request path entirely; scales as the panel grows. Delivers the
    "cached SQL views / materialized aggregates" TODO that was noted in
    `src/app/page.tsx`.

## v0.6.60 · 2026-05-30

### Performance

- **Home page TTFB ~15s → expected ~4s.** Direct prod timing showed 14.6–15.8s
  TTFB on `/`. Root cause: `fetchScoreRows()` was called TWICE per render
  (once by `getDashboardData()` for the dashboard, once by `getIndexBreakdown()`
  via the sibling `<IssueContributionsChart>` server component) — each
  paginating the full 17K-row deep join independently, ~35 round trips to
  Supabase apiece.
  - **Wrapped `fetchScoreRows` with React `cache()`** so all server-component
    callers within one render share the same Promise. Halves the work on
    the home page; no behavior change.
  - **Bumped `fetchScoreRows` pageSize 500 → 1000.** The 500 cap was added
    in v0.6.3 because Vercel's edge→Supabase route returned short pages on
    big response payloads and the old `length < pageSize` terminator
    interpreted that as end-of-data (silent truncation). v0.6.51 fixed the
    terminator to only stop on truly-empty pages, so short pages no longer
    truncate; can safely go back to 1000-row pages. Halves round-trip count
    again (17 pages instead of 34). Per-row payload is small (~300 bytes,
    no text), so a 1000-row page is ~300KB — comfortably under response cap.
- **Combined effect:** home page does ~17 round trips instead of ~70.
  Other pages that call `fetchScoreRows` once each (`/issues/[slug]`,
  `/topics/[slug]`, `/channels/[id]`) get the page-size win (about 50%
  faster) but not the dedup win (they only call it once).
- Re-time after deploy with `curl -o /dev/null -s -w "TTFB %{time_starttransfer}s\n" https://www.soapbox.media/` to verify.

### Notes

- The longer-term play is materializing the rolling-window aggregation in
  Postgres (a view or materialized view computed by cron) so app reads a
  small result set instead of all 17K scored rows. The original `aggregate.ts`
  comment from v0 flagged this as the "v1 will move this" path. v0.6.60
  buys time but doesn't replace it — at 100K+ scored rows the per-render
  scan will still be slow even with dedup + bigger pages.

## v0.6.59 · 2026-05-30

### Fixed

- **`/log` scored status falsely rendered "done" for un-classified episodes.**
  Regression from v0.6.54's status-cascade rewrite. When an episode hadn't
  been classified yet, `classification_count = 0` and `scored_count = 0`,
  so `sc >= cc` evaluated `0 >= 0` → true → "done". The pre-v0.6.54 code
  caught this with a leading `cc === 0 ? "na"` branch; my rewrite only
  caught the cc=0 case when `classify_status='processed'` (mapping to
  "no-signal") and let cc=0 + `classify_status='pending'` fall through.
  Result: 132 episodes were rendering as scored=green on /log when they
  were nowhere near scored. Visible on the activity log as rows with
  transcribed=gray, classified=gray, **scored=green** — a logical
  impossibility the cascade should have prevented.

  Fix: explicit `classified === "pending" ? "pending"` guard before the
  `sc >= cc` check in `getEpisodeTableRows`. The score column now
  faithfully cascades: can't be scored before classified, can't be
  classified before transcribed.

## v0.6.58 · 2026-05-30

### Fixed

- **Podcast reach auto-refresh removed — PodScan's `audience_size` is
  unreliable for the panel's purposes.** v0.6.57's reach-refresh pass
  attempted to hit PodScan's `/podcasts/{id}` endpoint and pull
  `pickPodscanReach` from the response, but the immediate post-deploy
  refresh exposed the gap: zero of 44 podcasts updated. Probing the
  endpoint directly showed `audience_size` IS exposed — just nested at
  `reach.audience_size` (not top-level where the helper looked) — but
  the values are wildly off from publicly-reported listener estimates:
  - Joe Rogan Experience: DB 14.5M vs PodScan `reach.audience_size`: 4.7M
  - Mark Levin Show: DB 7.0M vs PodScan `reach.audience_size`: **100**

  Our stored numbers align with Edison-style weekly-listener estimates;
  PodScan's appears to be its own internal-tracking metric (a lower bound,
  often missing entirely). Auto-refreshing from PodScan would crash
  podcast reach 50–70% to less-real numbers, so podcasts are now
  intentionally NOT in the refresh path. Removed `getPodcastById` +
  `pickPodscanReach` calls from `runIngest` and `scripts/ingest.ts`; the
  41-channel YouTube refresh (which works perfectly, daily) is the entire
  auto-refresh story now.

### Changed

- **Honest copy on `/channels`.** Intro paragraph: "YouTube subscriber
  counts refresh daily during the ingest pass; podcast audience estimates
  are editorial and reviewed at panel-add time." (Previously: "Reach
  figures refresh daily from the YouTube Data API and PodScan" — half
  wrong.)
- **`<PanelScale>` freshness label**: now reads "YouTube subs refreshed
  Xh ago · podcast reach editorial" — was "Reach refreshed Xh ago," which
  implied podcasts were also auto-refreshed.

### Notes

- `getPodcastById` helper stays in `src/lib/podscan.ts` — it's a clean
  by-id lookup that may be useful for other contexts (e.g., verifying a
  candidate matches what's in the panel during admin add-flow); just not
  for reach refresh.
- The 44 podcast rows still have their `reach_updated_at` backfilled to
  `created_at` (17 days old). That's accurate — we genuinely haven't
  refreshed them. The PanelScale label correctly reads off
  `MAX(reach_updated_at)` which is now-today (the YT refresh time), so
  the visible signal is right.
- Memory `[[podcast-reach-editorial]]` written so this gotcha isn't
  re-discovered next time someone tries to wire PodScan to channels.reach.

## v0.6.57 · 2026-05-30

### Fixed

- **`channels.reach` was set-once-at-seed and never refreshed.** Three call
  sites wrote `reach` (`seed-channels.ts`, `channels.ts` add-flow,
  `enrich-legacy-wishlist.ts`); none refreshed it. 84% of the panel was
  carrying 17-day-old subscriber/listener counts. The `/channels` intro
  paragraph claimed reach was "pulled live" — technically true, at seed
  time only. Index math weights by `log10(reach)`, so stale reach = mildly
  wrong weights.

### Added

- **Reach refresh piggybacked on the daily ingest cron.** The ingest pass
  already iterates every active channel; now it also refreshes each
  channel's reach in the same loop. YT is batched via
  `getChannelDetailsBatch` (one API call for up to 50 channels, ~1 quota
  unit each — free tier handles 10,000/day); podcasts are per-row via the
  new `getPodcastById` helper in `src/lib/podscan.ts` (PodScan has no batch
  endpoint). Failures are logged-and-skipped — a transient API blip on one
  channel must not abort the whole ingest pass. Only positive `reach`
  values overwrite the stored stat; a 0 / null response keeps the existing
  number so a lookup miss doesn't zero out a known channel.
- **`channels.reach_updated_at` column.** New `TIMESTAMPTZ` with `now()`
  default. Backfilled to `created_at` for existing rows (conservative "at
  least this stale" floor; the seed scripts didn't track it). Bumped on
  every refresh attempt — even when the number didn't change — so
  staleness-detection isn't misleading.
- **Freshness signal on `<PanelScale>`** — top-right of the card now reads
  "Reach refreshed Xh ago" (MAX(reach_updated_at) across active channels).
  Same `relativeTime` shape as the existing "Latest data" timestamp on
  `<SystemStats>`.
- **`/channels` intro paragraph tightened** — now reads "Reach figures
  refresh daily from the YouTube Data API and PodScan during the ingest
  pass" instead of the previous "pulled live" wording, which is honest
  about cadence.

### Changed

- **CLI `npm run ingest` now also refreshes reach** (mirrors the cron path
  via the same helpers). Per-channel log line includes the before→after
  delta when reach changes (`reach: 5,990,000 → 6,012,000  ↑ 22,000`)
  so manual catchup runs print visible movement.

### Notes

- New migration `add_channels_reach_updated_at` — non-destructive
  `ALTER TABLE … ADD COLUMN`, backfill from `created_at`, set NOT NULL +
  default `now()`.
- `pickPodscanReach` (same field-fallback as `seed-podcasts.ts`'s
  `pickReach`) is now duplicated in three files (`seed-podcasts.ts`,
  `pipeline.ts`, `scripts/ingest.ts`). Worth extracting to `src/lib/podscan.ts`
  in a follow-up cleanup once the dust settles.

## v0.6.56 · 2026-05-30

### Changed

- **Stat cards re-homed by reader question, not by convenience.** /log's
  System Scale was carrying the panel-composition stat ("Combined audience
  reach", added in v0.6.54) which actually answers "is this panel
  representative?" — a /channels question, not a /log question. The /log
  reader is asking "is the pipeline running?". Moved the reach number off
  /log and onto a new `<PanelScale>` card on /channels where it belongs.

### Added

- **`<PanelScale>` card on /channels** — composition stats (shows tracked,
  combined audience, platform rows, largest single show). Same visual
  shape as `<SystemStats>` on /log so the cards rhyme, but the question
  they answer is different. Sits ABOVE `<PanelBalance>` so the page reads
  magnitude (raw numbers) → distribution (stacked bars) → list (per-lean
  show grid).
- **New `getPanelStats()` aggregate helper.** Channels-table only — no
  episode/classification/score queries. Returns shows tracked + L/M/R
  count, audience reach + L/M/R split, platform row count + YT/Pod split,
  and the largest single show by max reach. Mirrors the unique-show
  methodology of `<PanelBalance>` and the old `getSystemStats.audienceReach`
  field so all three surfaces agree on the same number.

### Changed (cont.)

- **`/log` System Scale trimmed to 4 pipeline-only stats** (was 5):
  shows tracked, episodes analyzed, hours of audio, issue mentions. Grid
  shifted from `lg:grid-cols-5` to `md:grid-cols-4` — same breathing
  room per stat. `getSystemStats` still computes `audienceReach` +
  `audienceReachByLean` for any downstream caller; it's just not
  displayed on /log anymore.

## v0.6.55 · 2026-05-30

### Added

- **Panel balance badge on `/channels`.** Two stacked horizontal bars
  (count + reach) show the L/M/R distribution side by side so the
  asymmetry between editorial-intent-balanced counts and what-the-
  landscape-looks-like reach is visible at a glance. Current state:
  shows are 36% L / 14% M / 50% R but reach is 28% L / 15% M / 57% R —
  right-leaning shows carry larger average audiences (2.77M vs 1.93M L),
  so reach skews right. Badge says this plainly rather than letting the
  intro paragraph imply uniform balance. Asymmetry sentence renders
  dynamically — only shown when avg-reach ratio across cohorts ≥ 1.25×,
  so it'll quiet down if the panel rebalances.
- The honest copy explicitly notes that `log10(reach)` weighting in the
  Index dampens the asymmetry but doesn't erase it — a methodology cue
  for readers comparing the published Index to their intuition.

## v0.6.54 · 2026-05-30

### Added

- **"No signal" status on the public activity log.** ~8% of processed
  episodes (161/1941 today) are off-taxonomy — classified successfully but
  produced no political-issue mentions (sports, true crime, celebrity, etc.).
  These previously rendered as the same gray dots as "pending" episodes, with
  the `scored` column tooltip saying "Not applicable" — confusing because
  gray reads as in-progress, and a "complete but empty" episode isn't
  in-progress. New `no-signal` status with a hollow outlined dot
  (border-only, transparent fill — reads as "registered but empty") on both
  the `classified` and `scored` columns when `classify_status='processed'`
  and `classification_count = 0`. Tooltip: "No political signal · issue
  taxonomy didn't match." Added to the visible legend.
- **Combined-audience reach stat on `/log`.** Headline number for "how big
  is this panel?" — sum of unique-show reach (max per show across platform
  rows, so dual-platform shows aren't double-counted; matches the methodology
  for the by-show comparison from yesterday's enrichment script). Sublabel
  breaks reach out by editorial lean (L · M · R), same shape as the existing
  show-count sublabel — surfaces cohort balance on the same surface.

### Changed

- **`episode_pipeline_summary` view: added `classify_status`.** Migration
  `add_classify_status_to_pipeline_summary_view` — non-destructive
  `CREATE OR REPLACE VIEW`. Column had to be appended at the end of the
  SELECT (Postgres can't reorder existing view columns; only append). The
  view's only consumer (`getEpisodeTableRows`) updated to select it.
- **Hours-of-audio stat reformatted.** Was `1.4K` (compact) which read like
  a placeholder; now `1,433` (full number) with sublabel `≈ 60 days
  continuous` instead of the static `Long-form, Shorts filtered`. Confirmed
  100% of episodes have `duration_sec` — the data was always plumbed; just
  the formatter obscured it.
- **Issues-mentions sublabel: dynamic count + folded sentiment-scores stat.**
  Was hardcoded `Across 15 issues` (stale — taxonomy is at 23). Now reads
  the active-issue count from `issues` table and renders `Across N issues,
  all sentiment-scored`. The standalone "Sentiment scores" stat was dropped
  to make room for combined-audience — post-v0.6.53 score == mentions for
  the autonomous-cron steady state, so the standalone number wasn't pulling
  its weight.

## v0.6.53 · 2026-05-30

### Fixed

- **CLI scripts had the same `.range()` family bug** the cron path got fixed
  for in v0.6.51 — the previous audit pass (v0.6.52) only covered
  `src/`, not `scripts/`. Caught by the catchup drain itself: the classify
  stage drained cleanly (393 → 0, added 4,758 new classifications), but
  `scripts/score.ts` told the catchup loop "queue drained" while 5,809
  classifications were actually unscored. Root cause: both pagination loops
  in `score.ts` had no `.order()` AND the `data.length < pageSize` early-out
  — so the script only ever read page 0 of `classifications` and
  `sentiment_scores`, scored the 200-ish overlap in page 0 across 3 catchup
  iterations (600 scored), then page 0 showed "all scored" → "drained"
  sentinel fired. Same dual-bug as the original v0.6.47.
- **`scripts/score.ts`** — added stable `.order("id", asc)` on the
  classifications loop and `.order("classification_id", asc)` on the
  sentiment_scores loop (UNIQUE constraint makes it a valid pagination
  key); removed both `data.length < pageSize` early-outs. Same canonical
  pattern as `aggregate.ts:155-209`.
- **`scripts/classify.ts`** — happened to work in the catchup drain (the
  filtered `pending` set fits in a single page below the response cap), but
  carried both the non-unique-sort-key bug and the short-page early-out.
  Added `id` as a stable tiebreaker after `published_at`; removed the
  short-page early-out. Future-proofs against the panel doubling.

### Notes

- Full audit now extended to `scripts/` directory; both CLI surfaces
  (`classify.ts` + `score.ts`) and one already-correct file (`transcribe.ts`
  uses single `.limit()`, not a paginated loop) conform.
- The 5,809-classification score backlog this leak created will be drained
  separately via `npm run score -- 8000` on the fixed v0.6.53 code (~$4 in
  Haiku, ~30 min wall-clock).

## v0.6.52 · 2026-05-29

### Fixed

- **Audit-pass: remaining `.range()` antipatterns surfaced by the post-
  v0.6.51 `grep -n "range(" src/` sweep.** Three callers had subspecies of
  the same family of pagination bugs. None were currently breaking the cron
  (that was v0.6.51), but each would have bitten silently as the panel keeps
  scaling — so fixing all of them is part of "runs autonomously."
  - `src/lib/audit.ts` `paginatedSelect` — the generic helper used by
    `/admin/channels-audit` had both halves of the v0.6.47/v0.6.51 bug: no
    `.order()` and a `data.length < pageSize` early-out. Hardcoded
    `.order("id", ascending: true)` inside the helper (all three callers
    use tables with an `id` PK; the helper's contract is now unambiguous
    — "I paginate by id") and dropped the short-page break.
  - `src/lib/episodes.ts` `getEpisodeTableRows` — had empty-page-only
    termination ✓ but ordered by `published_at DESC` alone, which isn't
    unique. Two episodes posted in the same second could re-cross page
    boundaries and appear duplicated in the /log table. Added
    `.order("id", descending)` as the stable tiebreaker after the business
    order; UI behavior unchanged when published_at values are distinct
    (the common case), now deterministic when they collide.
  - `src/app/channels/page.tsx` — single-call `.range(0, 999)` silently
    truncates at 1000 active channel rows. We're at 85 today but the
    scale-out target is ~200 unique shows (2–3 platform rows each, easily
    400–600), well within the lifetime of this code. Converted to the
    canonical paginated loop (`.order("id")` + empty-page-only break);
    JS-side `groupByShow → maxReach` already re-sorts so the user-visible
    order is unchanged.

### Notes

- Repo now has 8 `.range()` callers, all conforming to the audit pattern in
  `[[pagination-stable-order]]`: stable `.order(<unique_key>)` AND
  `data.length === 0` as the only loop terminator. The pattern is
  duplicated across 5 files (`aggregate.ts` ×2, `discovery.ts`,
  `pipeline.ts` ×3, `audit.ts`, `episodes.ts`, `channels/page.tsx`) — a
  good candidate for extraction into a shared helper if/when scope allows.

## v0.6.51 · 2026-05-29

### Fixed

- **Cron classify + score short-page early-out → silent backlog stall (round
  two).** Same `pendingFound=0` symptom as v0.6.47, different half of the
  same pagination antipattern. v0.6.47 added the required `ORDER BY` but
  kept `if (data.length < pageSize) break;` as the loop terminator. That
  early-out fires on *any* short page — and Vercel's edge→Supabase route
  hits a response-size cap before the row cap on `runClassify`'s deep-join
  query (each row carries full transcript text). Once `transcripts` grew
  past the response threshold (1,779 rows as of today), the first page came
  back short, the loop exited, the in-memory array only held the oldest
  already-processed rows, and the JS filter to `classify_status='pending'`
  returned `[]`. Result: **3 of every 4 classify cron runs today found 0
  pending despite 393 actually pending** (08:30/12:30/16:30 UTC; only the
  00:34 + 04:34 runs processed work). Fix: terminate on empty page only —
  matches the canonical pattern at `aggregate.ts:155-209` (v0.6.3) and the
  `getSystemStats` pagination at `aggregate.ts:450-461`. Applied to all
  three paginated loops in `pipeline.ts` (`runClassify` transcripts,
  `runScore` classifications, `runScore` sentiment_scores).

## v0.6.50 · 2026-05-29

### Added

- **Mention-volume signal alongside lean in "Biggest movers."** The home card
  now ranks issues on two orthogonal axes — lean swing (L↔R movement) and
  mention-volume swing (attention shift) — and shows both. A row earns its
  spot if `|leanΔ| ≥ 0.5` OR `volumeRatio` crosses `[0.67×, 1.5×]`; both
  numbers display so visitors can see which signal (or both) put it there.
  Ranking uses `max(|leanΔ|/2, |log2(volumeRatio)|)` so a 2-point lean swing
  and a 2× volume swing carry equal weight, and the existing
  `MOVER_MIN_MENTIONS = 25` floor applies on both windows so neither axis
  fires on thin samples. Cap moved into `getDashboardData` (6 rows) — the
  home page just renders `data.movers` directly now. Mobile keeps the
  original 3-column layout for readability; desktop expands to 6 columns
  (adds Last week / Mentions / Volume).
- **Per-issue mention-volume sparkline on `/issues/[slug]`.** New
  `<VolumeAreaChart>` component (neutral gray, non-negative y-axis, no
  zero reference line — counterpart to `<IndexAreaChart>`) renders alongside
  the existing lean trend in a 2-up grid. Answers the question the lean
  chart can't: "is anyone actually talking about this issue right now?"
  Powered by a new `rollingVolumeTrend()` helper in `aggregate.ts` that
  mirrors `rollingLeanTrend`'s windowing but keeps mid-series zero days
  (a stretch of zero is a real "issue went silent" signal — lean is just
  undefined at 0/0, volume isn't); leading-only zero days are trimmed so
  the chart starts at first activity.
- **`IssueMover` extended** with `currentMentions`, `prevMentions`,
  `volumeRatio` (week-over-week mention-count ratio). `IssueDrillDown` gains
  `volumeTrend: { values, dates }`. No new pipeline cost — both surfaces are
  derived from the existing `fetchScoreRows()` data.

## v0.6.49 · 2026-05-29

### Changed

- **`scripts/discover-socialblade.ts` handles markdown + smarter triage.**
  Added a markdown-table parser (auto-detected by extension or content) so
  Social Blade pages saved via a browser markdown-clipper extension work
  directly — previously only HTML was supported. Tightened the bucketing:
  beyond "in panel" / "legacy" / "candidate", the script now flags
  "non-US/non-English" (Cyrillic / Devanagari / Burmese / CJK scripts; known
  Spanish/Bengali/Hindi outlets) and "non-political" (gaming, true-crime,
  finance-tutorial) so the actionable candidate list isn't drowned by 100-row
  globals. Name normalization strips "The X Show" / "X Podcast" boilerplate
  to catch Social Blade ↔ panel mismatches (Ben Shapiro ↔ "The Ben Shapiro
  Show", etc.).

- **`docs/legacy-media-wishlist.md`** — appended a "From Social Blade Top
  100 News (US, 2026-05-29)" section with cable / broadcast, digital-native,
  local-affiliate, and ambiguous-cohort entries surfaced by the scrape.

## v0.6.48 · 2026-05-29

### Changed

- **CLI classify is episodes-first.** The old `scripts/classify.ts` paginated
  the entire `transcripts` table with `text` embedded in the SELECT — a 1700-
  row × ~100KB/row payload that hit Postgres's `statement_timeout` once the
  panel hit ~80 channels. Refactored to query `episodes` (no `text`) filtered
  on `classify_status='pending' AND transcript_status='fetched'`, then load
  each transcript on demand inside the loop. Orders by `published_at DESC` so
  the most-recent backlog drains first. The cron path in `pipeline.ts` may
  benefit from the same treatment if/when it starts timing out at larger
  scale — for now its 300s function budget masks the inefficiency.

### Added

- **`scripts/discover-socialblade.ts`** — one-time parser for saved Social
  Blade "Top by category" HTML pages (politics, news, etc.). Direct fetch is
  blocked by Cloudflare, so you save the page from a browser, point this
  script at the file(s), and it: extracts every `/youtube/channel/UC…` link
  with name + sub count, filters to ≥300K, dedups against the existing panel
  by both channel ID and normalized name, and prints a sorted candidate list.
  Run via `npm run discover:socialblade <file.html> [file2.html] …`.

## v0.6.47 · 2026-05-29

### Fixed

- **Cron `classify` + `score` paginated without `ORDER BY` → silent backlog
  stall.** Two of today's four scheduled classify runs (08:30 and 12:30 UTC)
  reported `pendingFound = 0` despite 564 episodes actually being pending.
  Once the `transcripts` table grew past 1000 rows, PostgREST's `.range()`
  pagination returned non-deterministic pages — some runs got pages where
  every row was already `classify_status='processed'`, so the cron silently
  decided there was nothing to do and exited in 9 s. This is the exact
  pagination gotcha called out in `CLAUDE.md`; the CLI scripts had stable
  `.order("episode_id")` since v0.6.29 but `pipeline.ts` never got the same
  treatment. Fixed in all three paginated reads (transcripts, classifications,
  sentiment_scores) by adding stable PK ordering. Backfill drained manually
  via CLI after the fix shipped.

## v0.6.46 · 2026-05-28

### Fixed

- **Add-channel flow now requires a lean rationale.** The 21 channels seeded
  today (and Sam Harris) were missing `classification_rationale`, so they
  showed up on `/channels` without the one-sentence descriptions every other
  channel has. Backfilled all 22 by hand in the project's editorial voice;
  threaded the field through `addYouTubeChannel` and the `/admin/channels`
  add form (required, validated, with a placeholder example) so the gap
  can't recur.

## v0.6.45 · 2026-05-28

### Added

- **`/admin/channels` — admin flow to add a channel + deep-ingest history.**
  Editor enters a YouTube handle/URL + L/M/R lean; the server action resolves
  via the YT API, enforces the **300K subscriber floor**, inserts, and
  deep-ingests the last 30 episodes. The cron then catches up
  transcribe→classify→score automatically. Shared logic in `src/lib/channels.ts`
  (`addYouTubeChannel`, `extractYouTubeHandle`) so the CLI tool and the admin
  UI go through the same code path. Page also shows the 20 most recently added
  channels. AdminNav adds a new **Channels** tab; the existing audit moves to
  the **Audit** label.
- Per the channel expansion strategy, the existing 8 newly-seeded channels
  (Valuetainment, TPUSA, Knowles, Klavan, Indisputable, Legal AF, Katie Phang,
  Talking Feds) were seeded via SQL + `npm run backfill:channel-history` and
  are catching up via cron. Panel is now **56 unique shows (69 channel rows)**.

## v0.6.44 · 2026-05-28

### Changed

- **Cron stages run multi-times/day to fix the backlog dynamic.** Ingest stayed
  daily (10:00 UTC); **transcribe and classify now run every 4h** (6×/day),
  with classify offset +30 min; **score runs every 6h** (4×/day). Same total
  work per day, smoother throughput — with the v0.6.43 time-budget guard each
  run completes cleanly, so the only knob needed is *frequency*. At 48
  channels this keeps the pipeline caught-up (transcribe 240/day vs ~148
  ingest/day; classify ~90/day vs ~40/day transcribed). Empty runs are free.

### Added

- **Channel expansion strategy draft** (`docs/channel-expansion-strategy.md`)
  for the 48→200 scale-up: curation criteria, sourcing ladder, ~$870/mo cost
  model at 200 channels, throughput requirements (hourly classify), phased
  rollout, and open editorial decisions (reach floor, lean balance target,
  cost ceiling). Not implemented — review artifact.

## v0.6.43 · 2026-05-27

### Fixed

- **Classify cron 504 after the taxonomy grew to 23 issues.** This morning's
  scheduled classify ran the full 300s on a 15-episode batch and was killed
  mid-batch (12 episodes done, no `usage_log` row) — the larger taxonomy makes
  each episode slower and produce more mentions, so a fixed `CLASSIFY_LIMIT`
  can overshoot. Added a **wall-clock budget** (`STAGE_TIME_BUDGET_MS = 240s`):
  the classify loop stops when the budget is hit and always completes cleanly,
  processing as many episodes as fit. `CLASSIFY_LIMIT` stays as an upper bound;
  the run now reports `stoppedAtTimeBudget`. (Adapts automatically as the
  taxonomy keeps growing.)

## v0.6.42 · 2026-05-27

### Added

- **Topic drill-down pages (`/topics/[slug]`)** — the deeper Phase 2 read path.
  `getTopicDrillDown` rolls a parent Topic's child issues into a topic-level
  lean + 30-day trend (same reach×intensity weighting as the Index, so the
  numbers stay consistent across issue/topic/overall). Each topic page shows the
  needle, trend chart, and its child issues ranked by share of voice. The
  `/issues` topic headers now link to them. `ScoreRow` carries `issue_topic_slug`
  (added to `fetchScoreRows`).

## v0.6.41 · 2026-05-26

Two-level taxonomy — Phase 2 (read path) + discovery integration + staged
classify-broadening. (Parent **Topics** contain child **Issues**; see
`docs/taxonomy-v2-design.md`.)

### Added

- **Issue taxonomy page grouped by Topic.** `/issues` now lists issues under
  their parent Topic (Foreign Policy, Health, Rule of Law, …), making the
  two-level structure visible. Index/scoring unchanged.
- **Discovery promote is Topic-aware.** Promoting a candidate now requires
  picking a **parent Topic**; the new child issue is created under it
  (`issues.topic_slug`). `discovery_candidates.assigned_topic_slug` records it.
- **7 gap-filling issues staged (inactive).** Health care, Social Security &
  Medicare, Justice/rule-of-law, Government corruption, Gun policy, Drug policy,
  Race & discrimination — to cover the empty/thin Topics classify is currently
  blind to. **Staged `active=false` with draft L/R anchors**, so they do NOT
  affect classify or the Index until the anchors are reviewed and activated.
- Migrations `taxonomy_v2_topics_layer` and
  `taxonomy_v2_gap_issues_and_discovery_topic` (DB; additive only).

## v0.6.40 · 2026-05-26

### Changed

- **Admin login screen + menu (replaces HTTP Basic Auth).** `/admin/*` is now
  gated by a cookie session instead of the browser Basic Auth dialog. New
  `/admin/login` form checks `ADMIN_PASSWORD` and sets an httpOnly cookie (value
  = SHA-256 of the password, 30-day expiry); middleware redirects there when the
  cookie is missing/invalid. New `/admin` landing menu (Pipeline · Costs ·
  Channels audit · Discovery) and a **Log out** control in `AdminNav`. Same
  password as before; cron auth (`CRON_SECRET`) and the public `/eval/label`
  tool are unaffected. After deploy, existing sessions are logged out and must
  sign in via the new form.

## v0.6.39 · 2026-05-26

Emerging-issue discovery with admin oversight — the fixed 16-issue taxonomy no
longer silently misses new topics (e.g. it would now surface something like a
"Trump anti-weaponization fund" for review).

### Added

- **Harvest** (Phase 1): the classify pass now *also* returns substantive
  political topics that don't fit the taxonomy (`OffTaxonomyTopic` — label +
  quote), stored in the new `discovery_topics` table. Applies to both the cron
  `runClassify` and the CLI. Marginal token cost; no extra LLM pass. Off-taxonomy
  episodes (0 taxonomy mentions) are exactly where new issues hide.
- **Cluster & rank** (Phase 2): `src/lib/discovery.ts` + `src/modules/discover`
  merge recent off-taxonomy labels into candidate themes via one Haiku pass,
  score each by reach × recency × frequency, and rebuild the pending
  `discovery_candidates` set. Triggered by a weekly cron
  (`/api/cron/discover`, Mondays 11:00 UTC) and `npm run discover`.
- **Review queue** (Phase 3): `/admin/discovery` (Basic-Auth) lists ranked
  candidates with example quotes + counts, and offers **Promote** (form → new
  taxonomy issue, with human-written L/R positions), **Merge** (into an existing
  issue), or **Ignore**. Added to AdminNav.
- Migration `discovery_tables` (`discovery_topics`, `discovery_candidates`;
  RLS-on/no-policies per convention).
- One-time harvest-only backfill `npm run discover:backfill` (re-runs classify
  over recent transcripts writing ONLY off-taxonomy topics, never duplicating
  classifications) to populate discovery without waiting for days of cron.
  Initial backfill of 40 episodes harvested 106 topics → 42 candidates.

### Guardrail

- Discovery **proposes, a human disposes** — the system never edits the taxonomy
  on its own; only the admin Promote action (which requires the editor to write
  the L/R positions) creates an issue. Decided candidates' source topics stay
  linked so dismissed themes don't resurface.

## v0.6.38 · 2026-05-26

### Fixed

- **Cross-platform episode duplication.** Shows tracked on both YouTube and a
  podcast feed (e.g. The Rubin Report) publish the same episode to both, which
  was ingested twice and **double-counted in the Index**. New `src/lib/dedup.ts`
  matches a cross-post by show + normalized title + publish date; ingestion
  (both the cron `runIngest` and the CLI `scripts/ingest.ts`) now skips an
  episode already present on a sibling channel. Because channels ingest
  reach-desc, the higher-reach copy is kept and the re-post is skipped.
  Backfill: removed the 18 redundant copies already in the DB (with their
  classifications/scores; transcripts cascaded) — all were lower-reach podcast
  copies; where only one copy was processed, that one was kept regardless of
  reach. No remaining cross-platform dup groups.

## v0.6.37 · 2026-05-26

### Fixed

- **Cron split into per-stage jobs to fix a 300s timeout.** After v0.6.29 made
  classify do real work, the combined nightly pipeline exceeded Vercel's 300s
  function limit — the 2026-05-26 run returned `504`, classified 73 mentions,
  then was killed before `score` (left them unscored) and before writing
  `usage_log`. The four stages now each run as their own cron with a full 300s
  budget: `/api/cron/{ingest,transcribe,classify,score}`, staggered at :00/:15/
  :30/:45 past 10:00 UTC. Stage logic was extracted unchanged into
  `src/lib/pipeline.ts` (stages never call each other, so they split cleanly —
  see ARCHITECTURE.md). The old `/api/cron/pipeline` endpoint is kept for manual
  full runs (logs as source "manual"). Each stage logs its own `usage_log` row.

## v0.6.36 · 2026-05-25

### Changed

- **Methodology page de-hyped toward a lab-notebook voice.** Rewrote the intro
  from marketing framing ("the way you'd want it measured", "source of truth")
  to a factual statement of what the page documents; softened "hand-curated" →
  "curated". The rigorous middle (formulas, channel-skew honesty, known
  limitations) and the bottom "Why this exists" mission section are unchanged —
  the goal was to keep hype away from the method. Per reader feedback that the
  page mixed marketing jargon with the actual methodology.

## v0.6.35 · 2026-05-25

User-feedback clarity pass on two charts (methodology rewrite tracked separately).

### Changed

- **Biggest Movers redesign.** Added column sub-headings (Issue · Last week ·
  This week · Change). Replaced the ambiguous ↑/↓ delta with a neutral ←/→
  arrow showing direction of movement on the left–right axis, decoupled from
  position (which keeps its L/R color). Added a one-line decoder so it's clear
  an issue can move right yet still sit in left territory. Per user feedback
  that the chart was hard to decipher.
- **Index contributions chart caption rewritten in plain language.** Removed
  the inline `Σ(...)` formula (now linked to Methodology) and clearly
  distinguishes the bar ("how much the issue moved the Index") from the number
  ("average lean"), since a reader found the old wording opaque.

## v0.6.34 · 2026-05-25

### Fixed

- **Logo alignment nudge.** Wordmark moved up another 1px (−2px total) to sit
  centered against the crate icon.

## v0.6.33 · 2026-05-25

### Fixed

- **Header on mobile + logo alignment.** The nav row didn't wrap, so on narrow
  screens it overflowed and overlapped the wordmark. The header now wraps
  (nav drops below the logo on mobile) with a tighter mobile gap. Also nudged
  the wordmark up 1px so it sits centered against the crate icon.

## v0.6.32 · 2026-05-25

### Fixed

- **Issue/channel trend charts: width + vertical range.** The chart was capped
  at `max-w-md`, so inside the wide drill-down cards it filled only the left
  half. `IndexAreaChart` now takes a `maxWidthClass` prop (default `max-w-md`
  for the home hero; `""` on the drill-downs so it fills the card). It also
  takes `includeZero` (default `true`): the home Index keeps its 0-anchored
  range, but issue/channel charts now fit to their own data — an entity that
  sits far from neutral (e.g. a channel at L+4.8) uses the full chart height
  instead of squashing the line into a third with dead space above it. The
  zero reference line is hidden when not anchoring to zero.

## v0.6.31 · 2026-05-25

### Changed

- **/log table polish.** Status legend moved from the pagination footer to
  above the table (right-aligned), so it's visible before scrolling. Date
  column now numeric (`MM/DD/YYYY`) instead of spelled-out month. Both changes
  also apply to the "Recent episodes" table on channel pages (shared component).

## v0.6.30 · 2026-05-25

### Added

- **Trend charts on issue and channel pages.** The home-page `IndexAreaChart`
  (Recharts/shadcn) now also appears on `/issues/[slug]` ("How this issue has
  trended") and `/channels/[id]` ("How this channel has trended"), showing the
  entity's rolling lean over the last 30 days. New reusable
  `rollingLeanTrend()` helper in `aggregate.ts` (same daily-rolling, trailing
  7-day-window logic as the home sparkline, scoped to a single issue/channel);
  `getIssueDrillDown` / `getChannelDrillDown` now return a `trend` series. The
  chart is hidden when there are fewer than 2 points.

## v0.6.29 · 2026-05-25

### Fixed

- **Classify reprocessing loop (head-of-line blocking).** The cron + CLI
  classify queue was defined as "transcripts with no classification row." An
  episode that yields **0 mentions** never got a row, so it stayed "pending"
  forever and was re-sent to Sonnet every run. The first 15 pending happened to
  be genuinely off-taxonomy (sports, true crime, celebrity, stale/junk clips),
  so they permanently clogged the `CLASSIFY_LIMIT=15` batch — ~$1/run for **0
  new classifications**, while newer classifiable episodes behind them were
  never reached and the backlog never drained. Diagnosed from live data: 142
  pending, 350K input tokens → 60 output tokens across 15 episodes (model
  correctly returning `[]`).
- **Fix:** new `episodes.classify_status` column (migration
  `add_episode_classify_status`). It's set to `processed` after each classify
  attempt **regardless of mention count**, and the pending queue keys off it.
  0-mention episodes are recorded as done and never re-sent; the batch advances
  and the backlog drains. Backfill marked the 946 episodes that already had
  classifications as `processed`; the never-reached remainder stay `pending` so
  they're classified properly (not skipped). A partial index keeps the
  pending-queue scan cheap. Applied to both `runClassify` (cron) and
  `scripts/classify.ts` (CLI).

## v0.6.28 · 2026-05-25

### Changed

- **"Biggest movers" now requires a minimum sample.** An issue must have at
  least `MOVER_MIN_MENTIONS` (25) classifications in *both* the current and
  prior 7-day window to qualify as a mover. Previously a quiet week could
  produce a large, noisy lean swing and headline the card on a thin sample
  (e.g. an 18-mention week outranking a 400-mention one). The swing is only
  trustworthy once each side of the comparison has enough rows behind it.
  Verified against live data: the change correctly drops a thin-week issue and
  promotes a large-sample swing to #1. Mention counts on the issue drill-down
  (30-day window) were spot-checked against the DB and match exactly.

## v0.6.27 · 2026-05-25

Housekeeping: finish the v0.6.26 dead-code removal and track the dev guide.

### Removed

- **`IndexSparkline.tsx` and `EpisodeList.tsx`** — v0.6.26 emptied these to
  stubs but never `git rm`'d them. Nothing imports either; deleting the files
  completes that release's intent.

### Added

- **`CLAUDE.md`** is now tracked in the repo — the working guide for Claude
  Code (commands, release ritual, guardrails, infra facts). Previously
  untracked/local-only.

## v0.6.26 · 2026-05-25

Pre-beta audit: stale content, dead code, docs.

### Changed

- **Activity is back in the top nav** (it was footer-only) now that /log is a
  real surface.
- **Methodology page refreshed**: removed the stale Bannon transcript-coverage
  limitation; corrected "15 issues" → 16 (incl. the Iran conflict); replaced
  the unvalidated "85–90% accurate" claim with an honest note that scoring is
  model-produced and being calibrated against an independent human gold set.
- **ARCHITECTURE.md + README** brought current: Supadata (not the old
  scraper), RLS-on/no-policies + service-role + no-store fetch, shadcn/TanStack
  UI, real cron batch limits, the `UNIQUE(classification_id)` constraint,
  `episode_pipeline_summary` view, gold-set tables, and the `/admin` surfaces.

### Removed

- **Dead code**: `IndexSparkline` (replaced by `IndexAreaChart`) and
  `EpisodeList` (replaced by `EpisodeDataTable`), plus the now-unused
  `getRecentEpisodes` / `getEpisodesForChannel` / `attachPipeline` helpers in
  `episodes.ts`. (The two component files are emptied here; `git rm` them.)

## v0.6.25 · 2026-05-25

### Fixed

- **/log header sort-arrows overflowing.** A constant sort arrow on every
  column header spilled into the neighbouring header on tight columns. The
  arrow now appears only on the actively-sorted column (standard data-table
  pattern), with `overflow-hidden` on the header cells as a safety. Headers
  fit cleanly.

## v0.6.24 · 2026-05-25

Home-page trend chart + /log header fix.

### Added

- **Interactive Index trend chart** on the home page — a Recharts area chart
  (via shadcn chart primitives, `src/components/ui/chart.tsx`) replacing the
  static SVG sparkline under the needle. Shows the 30-day rolling Soapbox
  Index with hover tooltips (date + L/R value), a neutral zero baseline, an
  L/R-oriented y-axis, and a range caption. Adds the `recharts` dependency.

### Fixed

- **/log table header overlap.** v0.6.22's column percentages fit the cell
  contents but not the header words, so narrow headers ("Category",
  "Transcribed") overflowed and their sort arrows bled into the next column.
  Rebalanced the widths (still summing to 100%) so every header fits cleanly.

## v0.6.22 · 2026-05-24

Online gold-set labeling + /log table polish.

### Added

- **Online scoring-calibration tool** (`/eval/label`) to replace the CSV gold
  set. Multiple independent labelers score the same blinded items (lean-coded
  source only, no channel name / model score / ids) on sentiment (−5…+5),
  intensity (1…5), confidence (1–3), + notes — instructions and the three
  calibration examples are built into the page. Shared link + name to start;
  forward-only and resumable. New `gold_items` / `gold_labels` tables
  (migration `20260524000002`), seeded by `npm run seed:gold-set` (same
  stratified sample as the CSV exporter; model answer frozen per item).
  Submissions go through a server action on the service-role client — no
  client-side DB access; the page is `noindex`.

### Fixed

- **/log table no longer scrolls horizontally.** Switched the fixed-layout
  column widths from pixels (which summed wider than the container and forced
  a scrollbar) to percentages that sum to 100%, so the table always fits.
  Long titles/channels truncate with tooltips. Also aligned the page back to
  the site-standard width, made channel names link to the channel page, and
  swapped native `title` tooltips for Radix tooltips.

## v0.6.21 · 2026-05-24

/log cleanup: admin split, shadcn/ui, real data table.

### Added

- **shadcn/ui** adopted as the component system (the codebase already used
  `cn`, `clsx`, `tailwind-merge` and shadcn-style markup). Added theme tokens
  to `globals.css` + `tailwind.config.ts` (additive — existing literal-gray
  pages unaffected), `components.json`, and `src/components/ui/`:
  button, input, table, badge, dropdown-menu.
- **Episode receipts → a real data table** (`EpisodeDataTable`, TanStack
  Table + shadcn). Columns: category (L/M/R), date, channel, video, type,
  length, and Transcribed / Classified / Scored status (colored dots with
  Radix tooltips) — all sortable, with search, pagination, and a
  column-visibility menu. Channel names link to the channel page. The channel
  drill-down's "Recent episodes" reuses the same table (Category + Channel
  columns hidden).
- **`episode_pipeline_summary` view** (migration `20260524000001`) computes
  per-episode classify/score counts in Postgres, so /log loads one light
  result set instead of thousands of join rows.
- **Admin nav** (`AdminNav`) across the gated `/admin/*` tools.

### Changed

- **Pipeline health moved to `/admin/pipeline`** — it's operational detail
  for internal consumption, not public. The public `/log` is now scale +
  searchable episode receipts only.

## v0.6.20 · 2026-05-24

Data integrity: one score per classification, enforced.

### Fixed

- **Duplicate sentiment scores.** Overlapping score runs (CLI + the cron's
  score stage + the daily cron) raced: each read a classification as unscored
  and inserted, with no unique constraint to stop them. Result was 257
  duplicate score rows across 172 classifications, double-counting in the
  Index and per-issue/channel aggregations. Deduped (kept earliest per
  classification; scores 8,031 → 7,774, now exactly 1:1 with classifications).

### Added

- **`UNIQUE (classification_id)` on `sentiment_scores`** (migration
  `20260524000000`) — duplicate scores are now structurally impossible.

### Changed

- Score insert → **upsert with `onConflict: classification_id`,
  `ignoreDuplicates`** in both `scripts/score.ts` and the cron `runScore`, so
  overlapping runs no-op cleanly instead of erroring against the new
  constraint.

### Note

- Also closed out the failed-YouTube recovery: 369 of 370 episodes that the
  broken cron had marked failed were re-transcribed via Supadata and flowed
  through classify + score. Only 1 was genuinely caption-less.

## v0.6.19 · 2026-05-24

/log reworked into the public pipeline + scale transparency page.

### Added

- **Pipeline health on /log.** New `PipelineHealth` component surfaces the
  `usage_log` data that previously only lived on /admin/costs: four per-stage
  status cards (ingest/transcribe/classify/score) showing each stage's current
  health in plain English plus a small last-7-run trend strip, and a detailed
  recent-runs table with per-stage counts and any error message. Operators can
  see at a glance which stage is broken; users get real transparency. Shows
  **no cost/token data** — that stays on the operator-only /admin/costs.
- **Per-episode pipeline progress in the receipts list.** `EpisodeList` now
  shows each episode's progress through all four stages (Ingested →
  Transcribed → Classified → Scored) with done/failed/pending/partial state,
  instead of a single transcript-status badge. Makes the failed-YouTube
  backlog and where each episode stalled visible at a glance. Applies on both
  /log and the channel drill-down.

### Changed

- **System scale moved from /channels to /log and redesigned.** New lineup:
  shows tracked (with L/M/R split), episodes analyzed (of total ingested),
  hours of audio, issue mentions, sentiment scores, and coverage-since date.
  Dropped "words transcribed" (redundant with hours). Header now shows data
  freshness. Counts are live, so they reflect the post-dedup classification
  total correctly.
- Fixed a latent early-break in the hours-of-audio pagination (same class of
  bug as the classify/aggregate pagination issues): now advances by rows
  returned and stops only on an empty page.

## v0.6.18 · 2026-05-24

Cron is end-to-end. Cleanup + the real root cause.

### Fixed

- **Cron transcribe now succeeds.** The actual blocker was operational, not
  code: `SUPADATA_API_KEY` was missing/empty in the Vercel runtime, so
  `getVideoTranscript` threw and every YouTube episode was marked failed.
  (Masked until now because the v0.6.16 key/cache bugs kept the cron from
  ever reaching the Supadata call.) Set the value in Vercel; a seeded
  episode transcribed cleanly (`succeeded: 1`, ~1.4s round-trip, Supadata
  credit consumed). With this, the full pipeline runs unattended:
  ingest → transcribe → classify → score.

### Changed

- `runTranscribe` no longer swallows errors in a bare `catch {}` — failures
  (missing env var, Supadata outage) are now logged. This is what would have
  surfaced the `SUPADATA_API_KEY` problem on day one.

### Removed

- Temporary transcribe diagnostic logging (served its purpose locating the
  Supadata-key failure).

### Note

- The v0.6.17 platform-by-map change is retained as a robustness improvement,
  but it was not the root cause — the missing env var explained the failure
  on its own. No evidence the channel embed was actually broken.

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
