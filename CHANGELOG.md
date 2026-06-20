# Changelog

All notable changes to soapbox.media are tracked here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versioning follows [SemVer](https://semver.org/spec/v2.0.0.html).

Pre-1.0 minor versions correspond roughly to development phases of the
pre-launch build leading into the November 2026 US midterms.

## v0.31.1 · 2026-06-20

### Fixed

- **Intermittent "Couldn't load …" errors on the lazy-load receipt panels** (the
  channel-page per-issue mentions, the episode receipts, the /log episode table)
  that cleared on a hard refresh. Root cause: a transient server-to-Supabase
  blip made the read route 500, and since nothing retried, a single blip
  stranded the panel until the user reloaded. Confirmed not a query bug - the
  failing query is cheap and fully indexed (EXPLAIN: ~1ms). Fix is at the one
  choke point every Supabase request flows through (`db.ts` `noStoreFetch`):
  **idempotent reads (GET/HEAD) now retry** on a network throw or transient
  status (408/429/500/502/503/504) with a short backoff (150ms, 400ms).
  **Writes never retry** (POST/PATCH/DELETE) - the `classifications` insert is
  non-idempotent, so retrying a write whose response was merely lost could
  double-insert. Gating is unit-tested (`db.test.ts`).
- Added error logging to the channel-issue and episode mention routes so any
  residual post-retry failure surfaces in runtime logs with its real message
  (previously the 500 body was returned but never logged).

## v0.31.0 · 2026-06-20

### Added

- **Mention timestamps: jump straight to the moment in the video.** Each
  classified mention now carries a `start_ts` (whole seconds into the episode),
  and the receipts UI renders a "▶ mm:ss" deep link that opens the YouTube video
  at that moment (`&t=<seconds>s`) - in both the activity-log episode receipts
  (`EpisodeMentions`) and the channel-page per-issue receipts
  (`ChannelIssueBreakdown`). Requested by a beta user: makes it far easier to go
  watch the source.
- **Timestamps come from the transcript, not the model.** Supadata native
  captions are now kept as timestamped segments (`transcripts.segments` jsonb;
  the YouTube fetch drops `text=true` so the same 1-credit call returns
  `{ text, offset }` chunks). At classify time we match each mention's
  `supporting_quote` back to a start time deterministically
  (`src/lib/transcript-timing.ts`, unit-tested). The model never emits a
  timestamp, and there is no extra classify cost.
- **MCP `search_mentions` exposes `start_ts` + `timestamp_url`.** The data
  product now returns the quote's start second and a ready-made deep link
  (falls back to the plain episode link for podcasts and unlocated quotes).
  Documented on the public `/mcp` page and in the tool description.

### Notes

- Forward-only: new YouTube episodes get timestamps as they classify; no
  backfill of historical mentions. Empirically ~85% of YouTube mentions locate
  (the model's quote start is reliable; its tail drifts, so we anchor on a short
  normalized prefix). A miss renders the mention as before, just without a
  timestamp. **Podcasts deferred**: PodScan word-level timestamps are
  inconsistently populated and podcasts lack a universal timestamp deep-link.

## v0.30.2 · 2026-06-19

### Added

- **Channel names in the "who's driving it" breakdown link to the channel page.**
  Each show's name (bar label and quote receipt) now links to `/channels/[id]`
  (the lead row for a canonical show). `channelId` is carried through
  `ShowContribution`; guarded so it no-ops on snapshots written before the field.

### Fixed

- **Corrected stale "independent-only" copy** that conflicted with the live
  three-needle design (the headline needle blends both cohorts; independent and
  legacy each get a sub-needle). Updated the MCP tool descriptions
  (`get_index`, `search_mentions`, methodology field), the `cohort.ts` and
  `fetchScoreRows` comments, and the `CohortBadge` note. The methodology page and
  home copy were already correct.

## v0.30.1 · 2026-06-19

### Changed

- **Every "Biggest movers" row is now expandable to its "who's driving it"
  breakdown.** v0.30.0 only showed the breakdown for the single top mover, so the
  motivating example (public-health) vanished from the home page once it fell to
  #3. Each mover row is now a shadcn `Collapsible` that expands in place to the
  per-show contribution chart, with a link out to the full issue page. All movers'
  breakdowns are precomputed into the home snapshot (`HomeSnapshot.moverBreakdowns`)
  so rows expand with no live query; the page falls back to a live compute when the
  snapshot predates the field.

## v0.30.0 · 2026-06-19

### Changed

- **Reach weighting moves from log10 to sqrt, system-wide.** The Index is an
  audience-impact measure, but `log10(reach)` turned a 95x audience gap into a
  ~1.4x weight gap (one notch of intensity outweighed it). `reachFactor` is now
  `7 x sqrt(reach / 1e7)` (anchored so 10M reach still maps to 7, keeping
  displayed weights and the published scale familiar): a 100x larger audience now
  carries ~10x the weight, so a mega-channel genuinely moves the needle without a
  single show running away with it. Single source of truth in `src/lib/scoring.ts`;
  `weightedLean`, the emerging-board weight, and `/admin/homelab` all inherit it.
  Measured impact on the live Index is moderate (overall ~0.2, most issues < 0.7).
- **Dual-platform shows are weighted by their YouTube audience.** For any show
  tracked on both YouTube and as a podcast, the podcast row's reach is synced to
  the measured, daily-refreshed YouTube subscriber count rather than an editorial
  podcast estimate (e.g. Joe Rogan: 14.5M estimate -> 21M subscribers). New
  `scripts/sync-reach.ts` (audit by default, `--apply` to write). This matters
  more under sqrt, which leans harder on reach accuracy.
- **Methodology page updated** to describe sqrt weighting honestly, including that
  reach-estimate error now matters more (a 2x error is ~1.4x weight, not ~5%),
  which is why measured YouTube counts are now preferred.

### Added

- **"Who's driving this issue" breakdown.** A new diverging, reach-weighted
  contribution chart (`IssueMovementBreakdown`) decomposes an issue's weekly lean
  into each show's signed pull - the per-show fractal of the Index contribution
  chart. Shows are canonicalized (a show on both YouTube and podcast collapses to
  one bar), each carries both its editorial L/M/R badge and its stance-colored
  bar (they can diverge - a left show can post a right-coded bar), with the
  audience reach and a representative quote + source link. Renders for the top
  mover on the home page and on every issue page (7-day window). Shared
  `src/lib/canonical-show.ts` helper backs both the chart and reach-favoring.

## v0.29.2 · 2026-06-18

### Fixed

- **OG social card crate now renders on production.** The v0.29.1 attempt (read
  the crate from `public/` via `fs`) still failed on Vercel, where the
  serverless function does not reliably bundle `public/` files for `fs` reads.
  The card now sources both the crate and the wordmark by fetching the deployed
  CDN assets and inlining them as data URIs (which Satori renders reliably),
  removing the `fs`-based loaders entirely.

## v0.29.1 · 2026-06-18

### Changed

- **Higher-fidelity crate everywhere.** Swapped the wooden-crate mark to the
  polished source render across the header, app icon (`src/app/icon.png`), MCP
  icon, the OG card, and the brand download assets (logo PNGs + 256px icon).
  `public/favicon.ico` is left as-is (indistinguishable from the new crate at
  16px without an ICO toolchain locally).

### Fixed

- **OG social card was missing the crate on production.** It read the crate from
  `src/app/icon.png`, which the Vercel serverless function cannot `fs`-read (the
  wordmark, read from `public/`, rendered fine, which is what surfaced it). The
  card now reads the crate from `public/`, so it renders on the live card again.

## v0.29.0 · 2026-06-18

### Changed

- **The wordmark now renders in its real typeface, Protest Strike, everywhere.**
  The "soapbox" logotype was previously set in Geist Black on the live site (a
  mismatch with the actual brand). It is now centralized in a single
  `<Wordmark>` component (self-hosted Protest Strike, the two-color split soap
  `#C8202F` / box `#114A8A`) used by the header, the account and admin login
  screens, the welcome screen, and the brand page, so the font can no longer
  drift. The OG social card embeds the pixel-identical wordmark PNG (avoids
  forcing a display font through Satori). The brand page typography section now
  documents the two-typeface system: Protest Strike for the wordmark, Geist for
  everything else.

### Added

- **Needle + wordmark assets on `/brand`.** The signature Index needle has its
  own section (live gauge) and a downloadable self-contained `soapbox-needle.svg`
  (with a note on rotating it to any value). The wordmark ships as real assets
  rather than something to retype: an outlined vector `soapbox-wordmark.svg`
  (glyphs as paths, no font dependency) and a transparent `soapbox-wordmark.png`
  (2000px).

## v0.28.0 · 2026-06-18

### Added

- **Brand guidelines page** (`/brand`): a public, self-serve brand kit so the
  logo, color, type, and voice stay consistent everywhere Soapbox appears
  (starting with the social channels). Includes downloadable transparent-PNG
  logo assets (1024 / 512 / 256px plus the favicon, served from
  `public/brand/`), the two color systems kept deliberately separate (the
  wordmark colors Soapbox Red `#C8202F` / Soapbox Blue `#114A8A` versus the
  semantic data palette where red is always right and blue always left),
  click-to-copy color swatches, a Geist type specimen, and the voice rules
  (name usage, tagline, the no-em-dash rule, color-meaning lock). Linked from
  the footer.

## v0.27.0 · 2026-06-17

### Added

- **Consolidated channel-expansion CLI** (`npm run channels -- <subcommand>`,
  `scripts/channels.ts`) toward a 250-show panel. One repeatable loop replaces
  the fragmented one-off discovery/seed scripts: `discover` (YouTube
  featured-channels + iTunes search + an `--editorial file.json` curated-list
  path, persisted to the new `channel_candidates` table, deduped centrally vs
  the live panel), `vet` (quality predicates), `relevance` (a cheap batched
  Haiku screen that demotes off-topic / foreign-language candidates, biased to
  keep when uncertain), `review` (ranked CSV + table for manual sign-off),
  `approve`, `promote`
  (onboards only approved candidates; dry-run by default), plus `audit` and
  `prune` for panel cleanup. Approval is manual: nothing reaches the panel
  without a human flipping a candidate to `approved`.
- **`channel_candidates` table** (migration `20260617120000`): durable, re-runnable
  candidate store with a status lifecycle and central dedup key.
- **Podcast onboarding parity**: `addPodcastChannel()` in `src/lib/channels.ts`
  (the podcast counterpart to `addYouTubeChannel`), plus `addYouTubeChannelById()`
  for id-based onboarding from featured-channel discovery. PodScan field
  normalizers consolidated into `src/lib/podscan.ts`.
- **Pure, unit-tested libs**: `src/lib/channel-dedup.ts` (one name matcher,
  replacing four scattered normalizers) and `src/lib/channel-vet.ts`
  (reach/recency/lean predicates), each with a Vitest suite.
- **Curation helpers**: `siblings` (excludes candidates already in the panel on
  the other platform, plus same-platform duplicates the matcher missed),
  `recover` (re-resolves stale/misresolved podcast feeds to their live feed via
  the freshness-anchored resolver, pruning any with no live feed),
  `review --describe` (batched site-voice one-line descriptions to speed manual
  review), and a `--platform` review filter.

### Changed

- **Reach floor 300K -> 200K, YouTube only.** Podcast reach is editorial and is
  never floor-gated. `SUB_FLOOR` now lives in `channel-vet.ts` as the single
  source of truth.
- **Duration floor 180s -> 126s** (`MIN_DURATION_SEC`) to admit curated
  short-form (e.g. NowThis Impact). Methodology + admin copy updated.
- **`INGEST_PER_CHANNEL` 3 -> 2** (cost lever): keeps a ~250-show panel within
  the ~$1k/mo budget before the expansion lands.
- Retired the folded `discover-channels` / `discover-podcasts` scripts (and their
  npm aliases) in favor of `channels discover`.

### Fixed

- **Channel-dedup precision**: `nameMatches` matched on a shared longest token,
  over-matching channels that share only a generic first name or word ("David
  Frum" vs "David Pakman", "Glenn Beck" vs "Glenn Greenwald", "Lincoln Project"
  vs "Chris Cuomo Project"). Replaced with full-substring containment (shorter
  name fully inside the longer, >= 5 chars and multi-word or >= 7 chars). The
  `siblings` sweep also now catches same-platform duplicates the old matcher let
  slip. Locked with tests.
- **Podcast feed resolution**: `addPodcastChannel` now freshness-anchors -
  searches query variants (normalizing curly apostrophes that broke search),
  keeps only title-matching feeds, picks the newest-episode one, and refuses any
  feed whose freshest episode is > 120 days old. The prior "first search hit"
  onboarded dead/abandoned feeds (2018-era Anderson Cooper, empty feeds).
- **Podcast episode filter**: `addPodcastChannel` no longer drops episodes whose
  PodScan duration is missing/0 (podcasts are long-form; the duration floor now
  applies only when a duration is known), so feeds without duration metadata
  still backfill.

## v0.26.0 · 2026-06-16

### Added

- **homelab2: a staging redesign of the home page** at `/admin/homelab2` (admin
  Basic Auth; the public home is untouched). A scrolling, panel-based "enterprise
  analytics dashboard with a realtime feed", built as the experiment ground before
  promoting pieces to the live home. Progressive disclosure: the needle anchor and
  public hooks lead, analyst/B2B depth follows.
  - **Hero**: retains the master Index needle + the two cohort sub-needles, but
    gives EACH needle its own labeled trend (fixing the old ambiguity where one
    sparkline sat under the sub-needles yet plotted the master), plus an
    interactive index chart with a 7/14/30-day horizon toggle and the cohort lines
    overlaid.
  - **Reworks the three inversions**: "why the index is here" now leads with
    mention volume (bold number per diverging bar, `chart-bar-negative` style);
    "top issues" is volume-led (ranked horizontal bars, lean as color).
  - **Elevates the signature slice**: "Two Americas" (independent-vs-legacy trend
    + per-issue divergence), and ties in the v0.25.0 emerging board ("what's
    breaking" with favorability + cohort coverage).
  - Plus reworked depth panels (ownership quadrant, issue heat grid, channel
    momentum, cross-talk) and a clean scale strip + channel landscape.
  - Charts standardize on the shadcn `ChartContainer` system; a `Reveal` wrapper
    (IntersectionObserver) mounts panels on scroll so charts animate into view.
- Cut from the old 14-card lab: polarization strip (exposed the bimodal
  calibration weakness), lit fuses, the standalone receipts tile, audio-vs-video.

### Notes

- Staging queries live, but leans on the precomputed home snapshot
  (`readHomeSnapshot`) for the master/issues/movers/breakdown data and reuses
  `getHomelabData`'s `twoConv` for cohort trends - so it runs ~2 heavy pulls, not
  ~6. Promoting any panel to the public home is a separate step (its aggregates go
  into `writeHomeSnapshot`).

## v0.25.0 · 2026-06-16

### Added

- **Favorability + cohort-coverage signal on the /emerging board.** Emerging
  topics now carry a read on how the conversation is landing, not just mention
  counts. Two deliberately separate axes:
  - **Favorability** (the credibility anchor): a per-mention sentiment score
    toward the topic itself (-5 critical .. +5 favorable + intensity), Haiku,
    aggregated reach x intensity weighted via the existing `weightedLean()`. A
    distinct axis from the L/R needle (events have no left/right poles), so it
    gets its own neutral-to-emerald gauge, never the red/blue needle. Each row
    shows a compact "Reaction" gauge; the expanded panel adds a favorability
    summary and per-receipt favorability chips.
  - **Cohort coverage** (the honest "who's amplifying" overlay): L/M/R share of
    voice, normalized to mentions-per-active-channel so it can't be skewed by
    panel composition, plus a cohort-over-time trend. Uses the blue/red lean
    palette on purpose (this IS the lean axis).
- New `discovery_topic_scores` table (keyed on the stable `discovery_topics.id`,
  not the ephemeral candidate id), a `score-emerging` cron stage (Haiku, gated
  to the top-N board candidates, bounded + idempotent like `score`), and the new
  prompt surfaced read-only at /admin/prompts.

### Notes

- Favorability is a new axis the L/R gold set does not cover. v1 ships validated
  by a manual spot-check (`scripts/check-emerging-favorability.ts`); a dedicated
  favorability gold set gates it before it becomes load-bearing (i.e. before the
  MCP server exposes emerging, deliberately deferred to mature first).

## v0.24.2 · 2026-06-15

### Changed

- **Serve pipeline-scale stats and the social/OG card from the home snapshot
  instead of recomputing them per request** (perf). `<SystemStats>` (on /log)
  now reads the cron-precomputed snapshot rather than running 5 count queries
  plus a full per-episode duration scan on every render, falling back to a live
  read only if the snapshot predates the field. The dynamic Open Graph image
  (`opengraph-image.tsx`) reads the snapshot's dashboard data instead of the
  live ~10-15s deep-join aggregate, so the shared-link preview card generates
  fast on a cache miss. `HomeSnapshot` gains a `systemStats` field, written by
  the score cron / `refresh:snapshot`.

## v0.24.1 · 2026-06-15

### Changed

- **Generalized `scripts/backfill-issues.ts` so any newly-promoted issue can be
  backfilled** without editing the script. New env overrides: `BACKFILL_SLUGS`
  (which slugs to insert), `BACKFILL_KEYWORDS` (a cheap transcript keyword
  pre-filter so only plausibly-relevant episodes get the expensive classify
  call), and `BACKFILL_TARGET_TABLE` (a precomputed `episode_id` allowlist, used
  when the inline keyword scan exceeds the data-API statement timeout on the full
  transcript table). Used to backfill the new "Gerrymandering & redistricting"
  issue (Elections & Democracy) over a 30-day, keyword-targeted window.

## v0.24.0 · 2026-06-15

### Changed

- **Extracted the pure scoring math into testable modules** (`src/lib/scoring.ts`
  and `src/lib/emerging-score.ts`) - no DB, no env, so the product's headline
  numbers can be unit-tested in isolation. `aggregate.ts` and `discovery.ts` now
  import from them. In the process, consolidated three pieces of duplication:
  the Soapbox Index scale (`clamp(lean * 2, -10, 10)`) was inlined **14 times** and
  is now one `toIndexScale()`; the Biggest-Movers eligibility/ranking rules became
  `moverHasEnoughMentions` / `moverIsInteresting` / `moverScore`; and `reachFactor`
  is now single-source (shared by the Index and the emerging score). Verified
  byte-for-byte behavior on the home Index, movers, and drilldowns.

### Added

- **Tests for the math that matters** (`scoring.test.ts`, `emerging-score.test.ts`):
  the reach weighting -> weighted lean -> -10..+10 Index scale, the movers OR-rule
  and `max(|leanΔ|/2, |log2(ratio)|)` ranking, the recency half-life decay, the
  breaking-velocity rule, and the momentum-blended emerging score. 30 tests total
  across the three suites, all green.
- **CI gate** (`.github/workflows/ci.yml`): typecheck + tests + build on every push
  to main and on PRs - making the checks non-optional (Vercel builds on push but
  doesn't run the tests). ESLint isn't configured, so no lint step yet.

## v0.23.1 · 2026-06-15

### Added

- **Vitest test framework (lite) - the first automated tests in the repo.** Node
  environment, tests colocated as `*.test.ts`, `@/` alias mirroring tsconfig, no
  jsdom/testing-library yet (add when we want component tests). Scripts: `npm test`
  (one-shot) and `npm run test:watch`. Chosen over Jest for native ESM/TS + speed;
  the API is Jest-compatible so tests stay portable. First suite locks the L/R
  lean convention (`src/lib/lean.test.ts`, 12 tests): the red=Right/blue=Left
  palette, L+/R+ labels, the 0.05 aggregate-lean neutral band, and the
  sentiment-chip flips-at-exactly-0 rule. Foundation to expand to the aggregation
  + scoring math next.

## v0.23.0 · 2026-06-15

### Changed

- **Foundation: one source of truth for the L/R lean language (P1).** The site's
  signature visual - the L+/R+ sentiment chip, the L/R/M lean chip, the lean
  text-color, and the intensity meter - was copy-pasted across ~12 files
  (`formatLean` x6, `leanColor` x6, `sentimentChip` x2, `leanBadge`/inline lean
  maps x5, `IntensityMeter` x2). Consolidated into `src/lib/lean.ts` (formatLean,
  leanColor, sentimentChipStyle, leanChipStyle, `LEAN_NEUTRAL_BAND`) + shared
  `src/components/Lean.tsx` (`SentimentChip`, `LeanChip`, `IntensityMeter`). Every
  call site now imports the single definition, so the red(=Right)/blue(=Left)
  palette and the lean threshold can never drift. No rendered output changed
  (verified across /channels, /issues, /log, /emerging, channel + issue pages).
- **One app-wide `TooltipProvider`** in the root layout; removed the four
  redundant local providers (channels page, EpisodeDataTable, EmergingIssuesTable,
  FreshnessBadge). Closes a latent gap where `CohortBadge`'s tooltip needed a
  local provider ancestor - the global now covers every surface.
- **Remaining raw `<button>`s → shadcn `Button` (P2):** the /welcome secondary
  link, and EmergingIssuesTable's sort-header + row expander (matching the pattern
  EpisodeDataTable already used). The one intentional exception is
  ChannelIssueBreakdown's full-width expandable issue row - a stacked-content
  layout trigger, not a Button-shaped control - left as a semantic `<button>`.

## v0.22.1 · 2026-06-14

### Fixed

- **/emerging: the "flame" in the intro copy now renders the actual flame icon**
  (it was the literal word, and ran into the next word with no space).
- **/emerging tooltips are now the site shadcn Tooltip, not the native browser
  title** (breaking badge, up/down movement, "Last mentioned", and the receipt
  lean chip), matching the project's no-native-tooltips rule.
- **Footer nav no longer wraps mid-phrase** ("For AI / Agents") after the longer
  tagline shipped earlier today: links are `whitespace-nowrap` and the group
  wraps as whole items, right-aligned.
- **Full sweep of native browser `title=` tooltips -> shadcn.** Every remaining
  native title hint across the site is now the styled shadcn tooltip via a new
  shared `InfoTip` helper and one app-wide `TooltipProvider` in the root layout:
  intensity meters (EpisodeMentions, ChannelIssueBreakdown), the cohort stacked
  bar (PanelBalance), channel platform links + the issue-activity bars, truncated
  cells in the /log table (EpisodeDataTable), the footer links, and the admin
  PipelineHealth / homelab cards. The site is now free of native browser tooltips.
- Copy/metadata that still said the board refreshes "daily" updated to "through
  the day" (it moved to a 3-hourly rebuild in v0.22.0).

## v0.22.0 · 2026-06-14

### Changed

- **/emerging now ranks by momentum, not just decayed volume - the board was
  surfacing big-but-over stories above genuinely emerging ones.** Ranking by
  decayed reach-volume alone kept concluded races and fading stories on top (a
  decided Senate primary at #1 on flat velocity; a fading topic at #2 on 0.25x
  week-over-week), while a story breaking *today* sat at #12. The sort key is now
  `decayed weight x smoothed week-over-week momentum` (`(recent7 + k)/(prior7 + k)`,
  k=3 Laplace smoothing so a tiny topic with a near-empty prior week can't get an
  explosive ratio; magnitude stays the anchor). Validated on the live set: a
  breaking trial goes #4 -> #1, a "happening today" event #12 -> #3, and fading
  high-volume topics sink. Tunable via `EMERGING_MOMENTUM_SMOOTHING`.
- **Dropped the opaque "Weight" column** from the board. It was an internal score
  that, once rank stopped tracking it 1:1, only invited "why is #1 not the highest
  number?" Rank (the momentum-blended order) plus mentions / episodes / channels
  and the breaking badge carry the story; the table now defaults to rank order and
  columns stay click-sortable.
- **The /emerging board now refreshes every 3h instead of once a day** (discover
  cron `0 11 * * *` -> `50 */3 * * *`, just after each 2-hourly classify harvest).
  The board's candidate set was rebuilt only at 11:00 UTC, so off-taxonomy topics
  harvested the rest of the day (often ~180) sat unclustered and off-board until
  the next morning - the freshest YouTube signal was a day late. Re-clustering is
  one cheap Haiku call (~$0.03/run, ~$0.25/day). Note: composition can jitter
  slightly between intraday rebuilds; rank movement is unaffected (day-over-day).

## v0.21.0 · 2026-06-14

### Added

- **"Breaking" signal on /emerging.** A flame badge marks issues whose attention
  roughly doubled week-over-week (mentions aired in the last 7 days vs the prior
  7), or that appeared fresh, off a non-trivial base. This surfaces what's
  *accelerating* now, distinct from the rank-movement arrows (position change)
  and the weight/rank (accumulated size) - a genuinely breaking story can be
  small in total volume but spiking. Thresholds are tunable constants
  (`BREAKING_MIN_RECENT = 8`, `BREAKING_RATIO = 2`) with a recent-count floor so a
  3-on-1-mention blip doesn't flag; validated on the live set it marks the
  accelerating handful (e.g. a fresh trial 35-vs-9, a White House event 12-vs-4)
  and skips the noise. Computed per cohort in `computeBoardRanks`, mirroring the
  home Biggest Movers week-over-week volume idiom. Badge is amber/flame,
  deliberately not red (red = "Right" lean site-wide).

## v0.20.2 · 2026-06-14

### Changed

- **/emerging now suppresses dead news: an issue drops off the public board once
  its most recent mention (in that cohort) is more than 10 days old.** The
  recency decay (v0.20.0) down-weighted stale topics but a high-volume one could
  still linger mid-board; an "emerging" board carrying a month-old outbreak or a
  three-week-old shooting reads as stale. The gate applies only to the public
  board - the /admin/discovery review queue stays comprehensive, so a human can
  still promote a once-big theme that has quieted. Cutoff is a tunable constant
  (`BOARD_MAX_STALE_DAYS`); validated on the live set, 10 days drops the clearly
  dead candidates (6 of 39) while keeping the board full. Copy updated to say so.

## v0.20.1 · 2026-06-14

### Fixed

- **/emerging receipts now lead with the most recent quotes, not the
  highest-reach ones.** The expand panel sorted by channel reach, so a topic
  that was active yesterday could show only 1-2 week-old receipts (its fresh
  mentions came from smaller channels and fell below the 12-row cap), which read
  as a stale, non-credible board. Receipts now sort most-recent-first, tie-broken
  by reach so the most influential quote still leads within a given day.

### Added

- **"Last mentioned" freshness line on each /emerging row.** Because the board
  ranks on decayed volume, each row now shows how recently the issue was actually
  discussed (e.g. "Last mentioned yesterday"), making a row's currency explicit
  instead of implied - and a genuinely stale topic obvious at a glance.

## v0.20.0 · 2026-06-14

### Changed

- **/emerging recency is now a continuous decay, not a binary boost - the board
  was ranking by stale accumulated volume.** Each member topic's reach
  contribution now halves roughly every 7 days of episode age
  (`reachFactor x 2^(-ageDays/7)`), replacing the old "x1.5 if the episode aired
  in the last 7 days, else x1" step. The step barely moved anything: classify
  harvests off-taxonomy topics long after an episode airs, so the boost fired on
  only ~17% of members while member episodes ran to ~180 days old, and the board
  ranked by whatever had the most accumulated mentions - it looked frozen. With
  decay, genuine bursts surface and last month's chatter fades (validated on the
  live pending set: a fresh trial story climbs #10 -> #4, a stale-but-huge
  geopolitics topic settles #1 -> #3). The half-life was tuned against the live
  data, not guessed. The build-time and board-time weights now share one
  `topicWeight()` helper so they can't drift.

### Added

- **Rank movement on /emerging.** Each issue shows how it moved since the last
  daily refresh: a green up arrow, a muted down arrow, "new", or a steady dash.
  Because the daily rebuild regenerates candidate UUIDs, movement is keyed on a
  normalized theme (the same token-set key used to de-fragment labels), so a
  continuing issue keeps its history across rebuilds and minor LLM relabeling.
  Ranks are snapshotted per cohort each rebuild into the new
  `emerging_rank_history` table; the live board diffs against the previous
  refresh (not the latest snapshot, which would read as no movement).
- **Board freshness line on /emerging** showing when the candidate set was last
  rebuilt (relative + absolute US Eastern), plus copy explaining the recency
  weighting and the movement column.

## v0.19.0 · 2026-06-14

### Changed

- **New home hero + site-wide tagline: "Voice, reach, and influence in
  political media, measured."** Replaces "Online political media, quantified"
  as the master positioning line. The hero headline, page `<title>`, OG and
  Twitter cards, the dynamic OG image, and the footer now all read from one
  source of truth (`src/lib/brand.ts`: `SITE_TITLE`, `TAGLINE`,
  `TAGLINE_FOOTER`, `META_DESCRIPTION`) so they can never drift apart again.
- **Hero subtext now carries live scale counters.** Reads "We've analyzed
  *N* hours of political audio from *M* independent and legacy shows and scored
  *K* mentions, and counting." Numbers come from the home snapshot (hours of
  audio and total scored mentions added to `HomeSnapshot.scale`, written by the
  score cron via `getSystemStats`), with a live fallback before the first cron
  populates the field and a number-free fallback if both paths fail.

### Added

- `src/lib/brand.ts` - canonical brand copy constants, mirroring `version.ts`
  as a single source of truth.

## v0.18.3 · 2026-06-14

### Fixed

- **Serve `/favicon.ico` (was 404).** Added a real multi-size `public/favicon.ico`
  (16-256px, built from the crate mark). Beyond fixing the missing site favicon,
  this is the one fetch-verified difference between our MCP connector and a custom
  connector that does render a logo in claude.ai (Higgsfield: its registrable
  domain serves `/favicon.ico` 200; its MCP host 404s; ours 404'd everywhere) -
  evidence that claude.ai resolves a custom connector's icon from the registrable
  domain's favicon, not `serverInfo.icons`. Pairs with the v0.18.2 serverInfo icons.

## v0.18.2 · 2026-06-14

### Added

- **MCP connector now advertises the Soapbox crate logo.** The server's
  `initialize` response (`serverInfo`) now carries the MCP `icons` + `websiteUrl`
  metadata (SDK 1.26.0 `Implementation` schema), pointing at a public, unauthenticated
  asset (`public/mcp-icon.png`, the 256x256 crate mark). MCP clients that read
  server-advertised icons (and claude.ai's connector list, if/when it renders them
  for custom connectors) can show the brand mark instead of a generic globe.
  Note: the icon is read at connection time, so an already-added connector must be
  removed and re-added to pick up the new metadata.

## v0.18.1 · 2026-06-12

### Added

- **/admin/costs now captures manual CLI spend, and reconciles against billing.**
  Every cost-incurring CLI run (classify, score, backfills) writes a `usage_log`
  row via a new `recordScriptRun` helper, tagged `source: cli|manual`. Previously
  only the daily cron was logged, so terminal spend (e.g. a ~$200 backfill) was
  completely invisible - the page showed $134 all-time when real spend was far
  higher. The dashboard now splits the **recurring (cron) run-rate** (what the
  budget gauge tracks) from **one-off / manual** spend (shown separately so a
  backfill can't trip the budget alarm), and tags each run row with its source.
  Optional reconciliation: with an Anthropic Admin key (`ANTHROPIC_ADMIN_KEY`,
  `sk-ant-admin...`, org-only) the page shows **actual billed cost vs our
  estimate** via the Admin `cost_report` API (`src/lib/anthropic-billing.ts`);
  it degrades to a configure hint when the key is unset.

### Changed

- **Centralized Anthropic token pricing.** New `src/lib/pricing.ts`
  (`MODEL_PRICING` + cache-aware `estimateCostUsd`) replaces the per-million
  token rates that were hardcoded in four places (pipeline classify + score,
  `classify.ts`, `score.ts`, `backfill-issues.ts`). Rates verified against
  current Anthropic pricing - no number changed, this is drift-proofing. The
  score CLI also gained a bounded-concurrency pool (matching prod
  `SCORE_CONCURRENCY`) so a large manual score drain finishes in minutes.

## v0.18.0 · 2026-06-12

### Added

- **Taxonomy expansion: 5 new issues + crypto.** Found by bucketing the
  off-taxonomy harvest (`discovery_topics`) by distinct channel breadth over 90
  days - durable categories the event-grained /emerging board structurally can't
  surface (it clusters one-off events like a primary race, not standing themes).
  All nest under existing locked Topics (no new Topic), building out the two
  thinnest: Economy & Work (2 to 5 issues) and Health Care (1 to 2). New issues:
  **Trade & tariffs**, **Housing & homelessness**, **Government spending & debt**
  (Economy), **Public health & medical establishment** (the MAHA / vaccines / FDA
  axis, distinct from health-care coverage; Health), and **Veterans & military
  affairs** (Foreign Policy & National Security). The existing AI & tech issue was
  broadened to **"AI, crypto & tech"** to cover crypto and digital assets. Migration
  `20260612120000_taxonomy_expansion`. 30-day history was backfilled for the five
  new issues (crypto is go-forward only - a widened existing issue can't be
  backfilled without duplicating its mentions). The Trade and Veterans definitions
  were tightened after a sample-validation pass to filter conflict-shipping and
  general-military noise, and `inflation`'s definition dropped "housing
  affordability" so that signal routes to the new Housing issue.

- **MCP setup guide (`/connect`): non-technical-first onboarding.** A dedicated,
  step-by-step page (get access, set password, add connector, sign in, ask your
  first question) pulled out of the marketing-heavy `/mcp` page. Leads with the
  point-and-click Claude and ChatGPT custom-connector flow; developer configs
  (Claude Code, Cursor, VS Code, Claude Desktop) live in their own tab. New
  reusable `CopyField` (copy-to-clipboard) and `ConnectGuide` components.
  Step 1 surfaces the "Add promotion code" path so beta testers with a free code
  can self-serve to $0. The post-payment `/welcome` screen and `/account` now
  link straight into the guide.

### Changed

- **`/mcp` trimmed to the pitch.** The long per-client config dump and the
  duplicate pricing block were replaced with a concise "Getting connected"
  section that links to the new `/connect` guide. Marketing (the pitch, example
  queries, tool list, data boundaries) and the top pricing CTA stay.

### Fixed

- **`backfill-issues.ts` no longer times out at panel scale.** It loaded every
  transcript's full text and filtered the date window in JS, which hit a Postgres
  statement timeout once the panel grew (~6.7k transcripts). It now filters the
  window at the DB and fetches text only for the episodes it will process, and
  runs the classify pass through a bounded-concurrency pool (matching production's
  `CLASSIFY_CONCURRENCY`) rather than serially (~14h to ~1.5h at the current size).

## v0.17.0 · 2026-06-11

### Changed

- **Support page redesigned for conversion (campaign-ready).** Studied top
  political-donation landing pages and applied the patterns. Cut the four
  paragraphs of appeal to a punchy headline + one line + three value bullets;
  added an on-brand hero visual (the live, animated Soapbox Index needle -
  "what your support funds"); and moved the ask high (first on mobile, sticky on
  the right on desktop). The donation widget is tightened to ActBlue norms: a
  six-tier amount grid ($10-$500) with a "Popular" anchor and a higher default,
  a monthly nudge, a more prominent CTA, and a "Secure checkout via Stripe"
  trust line. L/M/R per-audience variants kept for campaign refcodes. The
  default/anchor amount ($50) is the single biggest A/B lever (in DonationWidget).

## v0.16.1 · 2026-06-11

### Changed

- **Freshness badge: custom tooltip + moved next to the logo.** The header
  "Updated {relative}" badge now uses the site's shadcn tooltip on hover (showing
  the absolute last-pipeline-run time in US Eastern) instead of the native browser
  title, and sits beside the logo rather than crowded in with the nav links.

## v0.16.0 · 2026-06-11

### Added

- **Channels page: cohort tabs + search.** /channels now has All / Independent /
  Legacy tabs (matching /emerging) plus a name search box, over the existing
  Left / Middle / Right lean buckets. Client-side filtering of the server-
  provided list (new `ChannelsBrowser`); tab labels carry live counts.
- **One site-wide freshness badge in the header.** A single consistent
  "Updated {relative}" badge (with the absolute last-pipeline-run time in US
  Eastern on hover, and a subtle live dot) on every page, driven by the most
  recent cron run (`getDataFreshness`).

### Changed

- **/channels stat: "Largest single show" -> "Episodes ingested · last 24h"**
  (`getPanelStats` now counts episodes created in the last 24 hours).
- Removed the now-redundant per-page freshness treatments (home TrustStrip "Last
  updated", /log SystemStats "Latest data", /emerging board "Updated {date}") in
  favor of the single header badge.

## v0.15.3 · 2026-06-11

### Changed

- **Needle animation: a touch more pronounced, and now on the cohort needles.**
  Bumped the spring overshoot (~7% -> ~16%) so the settle reads more clearly, and
  extended the animation to the two Independent / Legacy sub-needles. The three
  needles now settle in a slight stagger (main, then +140ms, then +260ms) for a
  subtle cascade instead of firing in lockstep. Still dependency-free and
  reduced-motion-aware; the stagger applies only to the entrance - value-change
  re-settles are immediate.

## v0.15.2 · 2026-06-11

### Added

- **Subtle settle animation on the home Index needle.** The hero needle now eases
  into its reading like an analog meter: a dependency-free, under-damped spring
  (~7% overshoot, ~0.8s) sweeps it in from center on load and re-settles whenever
  the Index refreshes. Implemented as a tiny client island (`AnimatedNeedle`) that
  writes the SVG `transform` via a ref (no per-frame React re-render), so the gauge
  chrome and all per-issue sub-needles stay static, server-rendered SVG. Honors
  `prefers-reduced-motion` (snaps instantly); SSR / no-JS render the correct final
  angle. No three.js (a 3D engine for a 2D needle) or GSAP dependency - just a
  ~40-line requestAnimationFrame spring.

## v0.15.1 · 2026-06-10

### Changed

- **Speaker-attribution limitation investigated and parked.** Followed up the beta
  tester's attribution concern with two offline experiments: a 90-transcript
  classify battery (v1 vs a stance-in-classify v1.1, with a v1-vs-v1 noise floor and
  an Opus refute-judge) and a separate stance-stage prototype (v1.2) run over real
  production mentions to measure aggregate impact. Result: genuine opposing-position
  quotes are only ~8% of mentions, and correcting them barely moves the
  per-channel-per-issue scores the site reports - mean |delta| < 1 pt on the
  -10..+10 scale, no strongly-stanced channel changed its read, and the only
  sign-flips were near-zero legacy-news pairs (BBC / Bloomberg on Iran). A naive fix
  would also mislabel guests the show agrees with, risking net harm. Decision:
  parked. The /admin/prompts maturation backlog now carries a status tag plus the
  full finding.

### Added (offline only - not wired into the deployed pipeline)

- Reproducible attribution-eval harnesses `scripts/eval-attribution.ts` and
  `scripts/eval-stance-impact.ts`, and experimental prompt modules
  `src/modules/classify/experimental.ts` (v1.1) and `src/modules/classify/stance.ts`
  (v1.2). Production still runs the v1 prompts; eval outputs are gitignored.

## v0.15.0 · 2026-06-10

### Added

- **/admin/prompts: pipeline prompts + models, now versioned.** A read-only admin
  page revealing the exact system prompts and models the classify and score
  stages run (`claude-sonnet-4-6` / `claude-haiku-4-5`), with per-stage prompt
  version labels (both start at `v1`), max_tokens, descriptions, and the dynamic
  inputs. Templates are rendered from the LIVE prompt builders with placeholder
  inputs (`classifyPromptPreview` / `scorePromptPreview`), so the page can never
  drift from production. Versions live next to the builders
  (`CLASSIFY_PROMPT_VERSION` / `SCORE_PROMPT_VERSION` in `src/modules/*`) - bump
  on any change. Catalog in `src/lib/prompts.ts`.
- **Maturation backlog on the same page.** Surfaces known validity gaps in the
  current prompts as the candidates for the next versions (gold-set-gated). First
  entry, from a beta tester: **speaker attribution** - neither stage tracks who
  is speaking or whether the host endorses vs. rebuts a quote, so a host playing
  an opposing position Y to attack it currently scores as aligned with Y,
  misattributing the show's stance X.

## v0.14.1 · 2026-06-10

### Changed

- **Episode/publish dates now render in a fixed editorial timezone (US Eastern),
  not the viewer's local zone.** A viewer in Hawaii (UTC-10) saw June 9 episodes
  dated 06/08 because `toLocaleDateString` used the browser's timezone, and the
  10:00 UTC daily ingest lands at their local midnight - so the log looked like
  it had almost nothing from "today." Dates are a fact of the record, so they're
  now pinned to one zone via a single source of truth (`DISPLAY_TZ` +
  `formatDateET` in `src/lib/utils.ts`), applied across the log/episode tables,
  the emerging + channel-issue receipts, the home "as of" label, the trust strip,
  the index/volume chart axes, and the OG image. (Admin/operator timestamps stay
  in their own frame for UTC/cron reasoning.) This also unifies a prior
  inconsistency where some surfaces pinned UTC and others used local.

### Removed

- **Trending Names (BETA) removed from the home page** - superseded by the new
  /emerging board. Dropped the home-page section + its data read, deleted the
  `TrendingNames` component, and removed the now-pointless daily
  `/api/cron/trending` schedule. The trending lib + cron route remain in the repo
  (unscheduled) so the feature can be revived or wired to MCP later.

## v0.14.0 · 2026-06-09

### Added

- **/emerging cohort tabs: All / Independent / Legacy.** The emerging-issues
  board now splits by channel cohort, surfacing where independent and legacy
  outlets diverge (the platform's core thesis). The per-cohort cuts are
  **recomputed** from each candidate's member topics, not the stored all-cohort
  stats - so weight, rank, mentions, episodes, and channels are correct per tab,
  and an issue that only independents are discussing doesn't show up under
  Legacy. Cohorts partition cleanly (every channel is exactly one), so
  All = Independent + Legacy (verified: top candidate 76 + 92 = 168 topics).
  Computed in one pass over `discovery_topics` (new `getEmergingBoard()`), and
  the active tab flows into the receipts fetch (`/api/emerging/[id]/receipts?cohort=`)
  so an expanded row shows that cohort's quotes. Tab labels carry per-cohort
  counts; new `EmergingBoard` component on shadcn `Tabs`.

## v0.13.1 · 2026-06-09

### Changed

- **/emerging polish from live review.** (1) Renamed the page from "Emerging
  topics" to **"Emerging issues"** throughout - "Topics" is the reserved
  category level in the taxonomy; these candidates are issue-level. (2) Added a
  **rank column** (1, 2, 3 ... by weight, the canonical trending order). (3)
  Added an **"Updated {date}" badge** above the table (newest candidate
  created_at = last daily refresh). (4) **Redesigned the expanded receipts** to
  match the site's other receipts panels (EpisodeMentions / channel-issue): a
  grid with a colored chip + quote + episode link, instead of the flat gray
  list. Since off-taxonomy mentions aren't sentiment-scored, the chip colors by
  the **source channel's lean** (blue L / red R / gray M) - honest, and it
  restores the visual variety. New `lean` field on `/api/emerging/[id]/receipts`.

## v0.13.0 · 2026-06-09

### Added

- **Public "Emerging topics" board (`/emerging`, linked from top nav).** Surfaces
  the discovery pipeline's findings publicly: auto-detected, machine-clustered
  topics the shows are discussing that aren't in the issue taxonomy yet, in a
  sortable table (weight / mentions / episodes / channels). Each row expands to
  reveal real episode receipts - the exact supporting quotes with channel,
  episode title, date, and outbound link - lazy-loaded from a new route
  `/api/emerging/[id]/receipts` (highest-reach episode first, one per episode).
  Shows only `pending` candidates; promotion into a tracked Soapbox issue stays
  human-gated in `/admin/discovery`. Copy frames them honestly as raw, daily,
  not-hand-curated signals. New `getEmergingIssues()` + `EmergingIssuesTable`,
  mirroring the existing expand-for-receipts design (EpisodeMentions).

### Changed

- **Discovery cron now runs daily** (`0 11 * * *`, was weekly Mon) so the public
  /emerging board refreshes every day. Cost is negligible (~$0.03/run Haiku).

### Added

- **Channel page: per-issue mentions expand inline instead of linking away.**
  Each issue row on a channel page (`/channels/[id]`) was a link to the
  system-wide issue page. It now expands in place to reveal the exact scored
  mentions for *that channel on that issue* - the same supporting-quote +
  sentiment + intensity receipts already shown per episode, plus the source
  episode (title, date, outbound link), ordered strongest-first
  (|sentiment| x intensity). Lazy-loaded on expand from a new route
  `/api/channels/[id]/issues/[slug]/mentions`, scoped to the same last-30-days
  window as the mention count on the row (counts match: the route starts from
  `sentiment_scores` with the same channel/issue/window filters and no cohort
  filter, mirroring `getChannelDrillDown`). The system-wide issue page is still
  reachable via a link inside the expanded panel. Mirrors the existing
  `EpisodeMentions` expansion design (`ChannelIssueBreakdown` component).

## v0.11.1 · 2026-06-09

### Fixed

- **Issue discovery silently regressed to zero candidates as topic volume grew.**
  It worked at launch (42 candidates from ~106 topics, v0.6.39), but the Haiku
  clustering pass ran with `max_tokens: 4096`. Once the off-taxonomy pile grew
  to a full 250-label batch, the JSON output (dominated by `member_indices`
  arrays) truncated mid-array; `extractJson` returned null and
  `buildDiscoveryCandidates` returned `{candidatesCreated: 0}` with no error.
  Because the rebuild deletes pending candidates *first*, the first post-
  regression run wiped the originals and every run since produced 0 - so the
  queue sat empty despite 14k+ harvested topics. Raised `max_tokens` to 16000
  (~4x the truncation point, within Haiku's safe non-streaming range) and added
  hard guards: clustering now throws on `stop_reason === "max_tokens"`, a null
  parse, or a non-array result, so this can never fail silently again. A single
  `npm run discover` now yields 82 candidates from 14,342 topics.

### Changed

- **Discovery clustering de-fragments near-duplicate labels before ranking.**
  Topics were grouped by exact normalized string, so phrasing variants of one
  theme ("la mayoral race spencer pratt" vs "spencer pratt la mayoral race")
  counted as separate candidates and split a hot theme's frequency across the
  top-250 cut. Grouping now uses a normalized token-set key (lowercase, strip
  punctuation, drop stopwords, de-dupe + sort tokens) so word-order and
  punctuation variants collapse; the most common surface form is shown to the
  model. The LLM still does the semantic merge - this just stops obvious
  duplicates from diluting the ranking.
- **Review queue is capped to the most significant candidates.** A full rebuild
  was producing ~82 candidates - too many to review. Clustering still runs over
  the full top-250 label set, but only multi-channel themes
  (`MIN_CANDIDATE_CHANNELS = 3`, drops single-show obsessions) ranked by weight
  are persisted, capped at `MAX_PENDING_CANDIDATES = 40`. Topics in dropped
  themes stay unclustered and are reconsidered next run, so nothing is buried.
- **/admin/discovery surfaces the refresh result.** The "Refresh candidates"
  button now shows a persistent status line ("Clustered N topics into M
  candidates", a no-op note, or the error message) instead of silently
  refreshing the (previously always-empty) list.

## v0.11.0 · 2026-06-08

### Changed

- **Visual consistency pass + design-token migration.** The whole site (public
  and admin) now reads color from one semantic token palette instead of ~620
  scattered literal Tailwind grays.
  - **Token foundation:** `globals.css` stock shadcn tokens were retuned from
    pure-neutral to the exact Tailwind v3 `gray` ramp (HSL), and an extended
    `ink-*` text ramp (strong/body/muted/faint/faintest) + a `subtle` surface
    were added (wired in `tailwind.config.ts`) to preserve the page's 6-step
    text hierarchy that stock shadcn (2 text tokens) would flatten. Every token
    value is pinned to the literal gray it replaces, so light mode is
    pixel-identical.
  - **Gray to token migration:** ~620 `text/bg/border/divide-gray-*` utilities
    mapped to `text-foreground` / `text-ink-*` / `text-muted-foreground` /
    `bg-card` / `bg-muted` / `bg-subtle` / `border-border` / `border-input`
    etc. via one centralized mapping table. Dark CTAs (`bg-gray-900`) now use
    `bg-primary`.
  - **Dark-mode scaffold:** an inverted `.dark` token block was added (dormant -
    not wired to a toggle yet), so theming is now a one-knob override.
  - **Card adoption:** 29 hand-rolled card containers across 18 files now use the
    shadcn `<Card>`, giving cards a uniform subtle `shadow-sm`. Clickable `<a>`
    cards and the login `<form>` card keep their elements (Card cannot be an
    anchor/form) but match the styling.
  - **Radius + focus unified:** stray `rounded-sm`/`rounded-xl` collapsed into
    the `rounded-md`/`rounded-lg` scale; per-input `focus:ring-gray-300`
    overrides removed so every control uses the shadcn `focus-visible:ring-ring`
    treatment.

### Note

- Light mode is intended to be pixel-identical except for the one deliberate
  polish: previously-flat cards now carry a uniform subtle shadow. The chart
  `--chart-*` lean palette and the custom SVG gauges are unchanged. The OG image
  (`opengraph-image.tsx`, inline-hex via Satori) was deliberately excluded from
  tokenization since Satori does not resolve CSS variables.

## v0.10.0 · 2026-06-08

### Changed

- **Site is now 100% shadcn/ui, on Recharts v3.** Upgraded Recharts 2.15.4 to
  3.8.1 and patched `src/components/ui/chart.tsx` for v3's tighter Tooltip/Legend
  prop types. Converted every hand-built UI surface to shadcn primitives:
  - **Charts** standardized on the shadcn chart pattern: `IndexAreaChart` and
    `VolumeAreaChart` now use `ChartTooltipContent` (no more hand-rolled tooltip
    components) and reference colors via `--chart-*` tokens. New shared
    `src/components/ui/sparkline.tsx` (Recharts `LineChart` + `ChartContainer`)
    replaces the bespoke inline `<svg>` sparklines in `TrendingNames` and
    `IssuePreview`.
  - **Tables** moved to the shadcn `Table` family: `BiggestMovers`,
    `EpisodeDataTable` (TanStack logic unchanged, only the markup shell),
    `PipelineHealth`, the `/mcp` tools table, and the inline-bar data lists
    `IssueContributionsChart` and `IssueActivityByTopic` (bars kept inside cells,
    full-row links preserved via a stretched-link anchor).
  - **Buttons / inputs / selects / textareas** converted to shadcn `Button`,
    `Input`, `Select`, `Textarea`, and `Label` across `SubscribeButton`,
    `DonationWidget`, `login-form`, `AdminNav`, the admin login / add-channel /
    discovery forms, and the gold-set label form.
- **New chart color tokens** in `globals.css` (`--chart-right`/`-left`/
  `-neutral`/`-index`/`-muted` plus numbered aliases): one home for the house
  lean palette (red = right, blue = left, gray = neutral), referenced via
  `ChartConfig.color = "var(--chart-*)"` instead of scattered hex literals.
- **CLAUDE.md: "shadcn first" rule.** Before building any UI feature, check the
  shadcn library (via the shadcn MCP) first; never hand-roll a primitive that
  shadcn provides. The only sanctioned hand-built UI is the custom SVG gauges
  (`SoapboxNeedle`, `SubNeedle`) and 1-D position markers, which have no
  Recharts/shadcn equivalent.

### Note

- All conversions are behavior-preserving: existing Tailwind classes, the house
  palette, copy, links, and data flow are unchanged; primitives carry the
  original styling via `className`. `/admin/homelab` (a decision-mock scratch
  page) was intentionally left on raw Recharts.

## v0.9.2 · 2026-06-08

### Changed

- **Banned em dashes project-wide.** Added a hard style rule to CLAUDE.md (never
  use the long U+2014 dash anywhere; use commas, colons, parentheses, or a
  spaced hyphen) and scrubbed every existing em dash from the site copy,
  components, lib, comments, CLAUDE.md, and this changelog. Mechanical
  replacement: spaced em dash to " - ", attached to "-". (Minus signs in scores
  like -5 are a different character and were left alone.)

## v0.9.1 · 2026-06-08

### Changed

- **Support page copy rewritten in a warmer, Wikipedia-style appeal** -
  reflective and second-person ("think back over this past year of politics…
  what is political media actually saying?"), with the "$5, $20, $50, or
  whatever feels right" ask, an independence/threat framing, and a closing
  thank-you. L/M/R headlines kept as the targeted hook over a shared appeal
  body; widget made sticky. Footer link now reads "Support our work."

## v0.9.0 · 2026-06-08

### Added

- **Support donations (workstream 3).** Wikipedia-style "fund the referee"
  contributions to Soapbox - pay-what-you-want one-time (Stripe `payment` mode
  + `submit_type: donate`) or monthly (ad-hoc recurring price), no account
  required (`/api/stripe/donate`, `DonationWidget`). New `/support` page plus
  **L/M/R persuasion variants** (`/support/left|middle|right`) reframing the ask
  for donors who already give to candidates across the map, sharing one
  `SupportLanding` + copy map. `/support/thanks` confirmation. Clearly labeled
  **not a political contribution and not tax-deductible** (for-profit LLC) -
  goes to Soapbox/Breakfastball operations, never to candidates. Footer now
  links **Support**.

## v0.8.6 · 2026-06-08

### Changed

- **/mcp page: subscribe in, beta-access out.** Replaced the "request a beta
  access key" CTA (and the bottom "Get a key" section) with the $300/mo
  pay-first **Subscribe** card (new reusable `SubscribeButton`). Connect
  instructions updated to the OAuth sign-in path - no `YOUR_ACCESS_KEY` headers;
  just the server URL + browser login. claude.ai/ChatGPT note updated from
  "OAuth on roadmap" to "supported."

## v0.8.5 · 2026-06-08

### Changed

- **Subscription flow switched to pay-first (Model B).** No account needed to
  subscribe - the friction of "sign up before you can pay" is gone. Flow:
  `/pricing` → Subscribe (anonymous) → Stripe Checkout collects email + card →
  webhook `checkout.session.completed` **provisions a Supabase user** from the
  email (`provisionUserByEmail` - finds existing or creates + sends a Supabase
  invite/set-password email), links the subscription, and grants entitlement →
  new `/welcome` page handles the set-password landing and shows the
  connect-your-agent instructions. Stripe's hosted checkout can't create a
  login in our system, so provisioning happens server-side in the webhook
  keyed by email. Removed the account-first checkout (no more login gate on
  `/pricing`); `getOrCreateCustomer`/`syncSubscription` replaced by
  `provisionUserByEmail` + `linkSubscription` + `syncSubscriptionByCustomer`.
  - **Supabase config needed:** add `https://www.soapbox.media/welcome` to the
    Auth redirect-URL allowlist (invite link lands there). Invite emails use
    Supabase Auth's email - fine for testing; custom SMTP for scale.

## v0.8.4 · 2026-06-08

### Fixed

- **Checkout now fails gracefully instead of hanging.** An unhandled Stripe
  error (e.g. account/mode mismatch) returned a generic 500 with no JSON, so
  the Subscribe button hung. Wrapped customer + session creation in a
  try/catch that returns the error message (502) and logs the key *mode*
  (`sk_live_`/`sk_test_` prefix only, never the secret) for diagnosis. Also a
  fresh deploy to snapshot the current production Stripe key.

## v0.8.3 · 2026-06-08

### Fixed

- **Checkout hung with "No such customer" after going live.** A test-mode
  Stripe customer id (from local test-mode checkout) was stored in the shared
  `subscriptions` table and reused in live mode, where it doesn't exist.
  `getOrCreateCustomer` now verifies the stored customer exists in the current
  Stripe mode and recreates it if stale (handles test↔live and deleted
  customers). The stale test row was also cleared.

## v0.8.2 · 2026-06-08

### Fixed

- **Checkout `STRIPE_PRICE_ID not configured` in prod** - the price id was read
  at module load (`export const PRICE_ID = process.env…`), which can be inlined
  at build / survive build-cache and miss a runtime env var. Now read at
  request time via `priceId()`. (If it still reports unset after this, the var
  genuinely isn't in the Production environment scope.)

## v0.8.1 · 2026-06-08

### Changed

- Deploy bump to pick up the production Stripe env vars (`STRIPE_SECRET_KEY`,
  `STRIPE_PRICE_ID`, `STRIPE_WEBHOOK_SECRET`) - Vercel only injects env on a
  fresh deployment, and the v0.8.0 build predated them. No code change.

## v0.8.0 · 2026-06-08

### Added

- **MCP access monetization - $300/mo Stripe subscription (workstream 2).**
  Full subscribe → entitlement → gating chain on top of the OAuth identity:
  - `/pricing` (subscribe) → `/api/stripe/checkout` (Checkout, subscription
    mode, `client_reference_id` = Supabase user) → `/api/stripe/webhook`
    (signature-verified; `checkout.session.completed` +
    `customer.subscription.*` → upserts the `subscriptions` entitlement row) →
    `/account` (status + post-checkout landing) via `/api/stripe/status`.
  - **Gating:** MCP tools now require the `mcp` scope, which `verifyMcpToken`
    grants only to active subscribers - OR everyone while `MCP_OPEN_BETA` is on
    (default), so current testers aren't locked out. Flip `MCP_OPEN_BETA=false`
    to enforce paid-only; static `MCP_ACCESS_KEYS` stay exempt (comped/demo).
    Entitlement reads are DB-only (`lib/entitlements.ts`), no Stripe SDK in the
    MCP hot path.
  - New `subscriptions` table (RLS-on, service-role only). `setup-stripe-product.ts`
    creates the idempotent $300/mo product+price. New dep: `stripe`.
  - **Config still needed before live transacting:** `STRIPE_SECRET_KEY` (test
    in dev), `STRIPE_PRICE_ID` (set), `STRIPE_WEBHOOK_SECRET` (from `stripe
    listen` / dashboard webhook).

## v0.7.9 · 2026-06-08

### Changed

- **Charting standardized on Recharts v3 + the shadcn chart component.**
  Upgraded `recharts` 2.15.4 → 3.8.1 and re-pulled the v3 shadcn `chart.tsx`
  (now ships `ChartTooltipContent`/`ChartLegendContent` + `initialDimension`).
  Our code used none of v3's removed APIs, so the bump is clean - typecheck +
  build green, home/issue/homelab chart pages render without errors. CLAUDE.md
  now mandates the shadcn chart pattern (`ChartContainer` + `ChartConfig` +
  `ChartTooltipContent`) for every new/touched chart, for consistent tooltips,
  animations, theming, and a11y.
- **shadcn MCP server configured** (`.mcp.json`) so components/charts are added
  via the registry MCP (`npx shadcn@latest add …`) instead of hand-copying.
  (Loads on next Claude session.)
- Note: existing chart components (IndexAreaChart, VolumeAreaChart, homelab
  cards) now run on v3 but keep their current custom tooltips; they adopt the
  full shadcn `ChartTooltipContent` pattern as they're rebuilt in the home-page
  redesign. Visual QA of the multi-axis Composed chart on /admin/homelab
  recommended.

## v0.7.8 · 2026-06-08

### Fixed

- **MCP `get_index` / `get_movers` were very slow** - they called
  `getDashboardData()` live on every request (full paginated deep-join +
  rolling-sparkline recompute, ~10s). Now they read the precomputed
  `dashboard_snapshot` for the default 7-day window (indexed single-row read,
  ~sub-100ms), matching what the website home page already does. Non-default
  windows still compute live. Confirmed working end-to-end via a real
  claude.ai connector (OAuth + audience hook validated).

## v0.7.7 · 2026-06-08

### Added

- **MCP OAuth - consent screen + end-user accounts (part 2).** The app now has
  end-user authentication (it was service-role-only before). New
  `/oauth/consent` screen handles Supabase's OAuth authorization handoff:
  reads `authorization_id`, requires a logged-in session, shows the requesting
  client + scopes, and Approve/Deny via
  `supabase.auth.oauth.{getAuthorizationDetails,approveAuthorization,denyAuthorization}`.
  Login uses the shadcn **login-03** block wired to Supabase Auth
  (email/password + Google/Apple social OAuth, password reset), reused on a
  standalone `/login`. New browser Supabase client (`supabase-browser.ts`,
  session-persisting) kept separate from the server data client. Added shadcn
  `card` + `label` primitives.
  - **Remaining dashboard step:** set Authentication → OAuth Server →
    Authorization Path = `/oauth/consent` and confirm Site URL, then the
    claude.ai/ChatGPT connect flow is end-to-end. Enable Google/Apple
    providers if you want the social buttons live.

## v0.7.6 · 2026-06-08

### Added

- **MCP OAuth 2.1 - resource-server half (part 1 of real MCP auth).** The MCP
  endpoint now validates Supabase-issued JWTs as an OAuth resource server
  (RFC 9728): new `/.well-known/oauth-protected-resource` metadata route
  advertising Supabase as the authorization server, JWKS token validation
  (`jose`) with RFC 8707 audience binding, and the spec-compliant 401 +
  `WWW-Authenticate` challenge that lets claude.ai / ChatGPT web connectors
  discover the auth flow. **Dual-auth during migration**: existing
  `MCP_ACCESS_KEYS` static keys (Bearer or x-api-key) keep working unchanged,
  so no demo customer breaks. JWT path fails closed until the Supabase OAuth
  Server + access-token-hook (audience) are configured. Part 2 (consent page +
  end-user login) and subscription gating land next. New dep: `jose`.

## v0.7.5 · 2026-06-08

### Changed

- **Trending Names ranking, after an accuracy investigation.** The v0.7.4
  breadth-only ranking crowned "New York Times" (#1 on 119 shows) - but a
  context probe showed NYT runs at only ~1.5–1.9× its baseline: omnipresent,
  not trending. Inversely, the genuine breaking event (the Meet-the-Press /
  Kristen Welker walkout) was absent - real (0→10 shows, accelerating) but too
  fresh to clear the breadth bar under 1×/day ingest. Findings: (1) burst floor
  raised 1.4→1.7 to strip flat perennials; (2) a higher bar (2.5×) for major
  media outlets, which are structurally always-cited, so they only headline if
  genuinely the story; (3) volume floor (≥40 mentions, ≥8 shows) + extended
  stoplist to kill niche/common-word leaks. Ranking stays breadth-led (it
  implicitly suppresses the extraction noise floor) among entities that clear
  the rising bar. Result: an all-real, coherent leaderboard (Maine Senate race,
  California politics, Hamas/Lebanon) instead of NYT on ubiquity. Known beta
  limits unchanged: ASR-misspelled canonicals (e.g. "Plattner") and a 1–2 day
  lag on breaking events - both await entity-linking/NER on the roadmap.

## v0.7.4 · 2026-06-08

### Added

- **Trending Names (BETA) on the home page.** A named-entity burst tracker:
  people, orgs, and places surging across the tracked panel this week, ranked
  by how many shows picked them up, each linking back to the channels
  discussing them. Validated via two probes (n-gram → entity) before build;
  entities self-canonicalize the story (no clustering/LLM needed) and the
  baseline auto-suppresses ad reads. Extraction is cheap & deterministic
  (Title-Case runs over transcripts, ~$0) with edit-distance variant merging
  (folds ASR misspellings like Platner/Plattner), a sentence-initial-ratio
  filter + stopword/first-name blocklists to strip capitalized non-entities,
  and breadth-gated rising rank. Persisted to `dashboard_snapshot`
  (`trending_v1`), refreshed daily by `/api/cron/trending` (10:30 UTC, after
  ingest). Labelled experimental - canonicalization is still maturing. Roadmap
  path: PERSON/ORG/PLACE typing (ORG opens a corporate-comms cohort) and an
  MCP tool.

## v0.7.3 · 2026-06-06

### Added

- **/admin/homelab - home-page redesign lab.** All 14 candidate cards for
  the home-page overhaul rendered against live data (90-day pull), grouped
  by proposed zone, so the v1 cut and ordering can be chosen by looking:
  Pulse, Battlefield, Heat Grid, Ownership Map, The Gap, Two Conversations,
  Risers & Faders, Megaphone treemap, Lit Fuses, Strips, Receipts,
  Cross-Talk (string-match v1 over scored quotes), Polarization Strip, and
  Audio-vs-Video. Deliberately heavy/unoptimized - it's a decision tool;
  chosen cards get snapshot-backed production implementations.

## v0.7.2 · 2026-06-06

### Changed

- **Editorial reach calibration for 77 placeholder podcasts.** 72% of the
  podcast panel carried the seeder's 300k default (the PodScan fields the
  seeders read are never populated, so the "fallback" was really the
  default). Replaced with researched editorial estimates anchored to the ~28
  publicly-corroborated shows, using chart positions, publisher
  announcements, public rankers, YouTube presence, and a Podchaser
  powerScore prior (calibrated: ρ=0.57 - useful as prior, not as truth).
  Values bracketed to coarse tiers (50k–5M); biggest corrections: Theo Von
  300k → 5M, Up First 300k → 4M, Benny Show/Piers Morgan 300k → 2M. Total
  podcast panel reach 23.1M → 39.7M. Apply script
  (`scripts/apply-reach-estimates.ts`) only touches exact-300k rows, so
  anchors are untouchable and re-runs are no-ops.
- **Methodology page: "Audience reach: how we measure it."** New section
  disclosing the split measurement model - YouTube subscriber counts from
  the YouTube Data API (auto-refreshed daily at ingest) vs editorial
  weekly-listener estimates for podcasts (no public per-show measurement
  exists at panel scale; commercial aggregator audience fields verified
  unusable). Documents the anchoring approach, tier bracketing, review
  cadence, and why log10 weighting compresses estimation error.

## v0.7.1 · 2026-06-06

### Added

- **/mcp page - public walkthrough of the MCP server.** Who it's for
  (campaign teams, media buyers, consultants, pollsters, comms shops,
  journalists), eight persona-mapped example questions the dataset answers
  today, the nine-tool reference table, the data boundaries (excerpts +
  source links, never full transcripts), and copy-paste connect configs for
  Claude Code, Claude Desktop (mcp-remote bridge), Cursor, and VS Code -
  with an honest note that claude.ai/ChatGPT web connectors need OAuth
  (roadmap). Beta keys are free, requested via access@soapbox.media.
  Footer now links the page as "For AI Agents".

## v0.7.0 · 2026-06-06

### Added

- **Public MCP server** (`/api/mcp/mcp`, Streamable HTTP) - external AI agents
  can now query Soapbox data directly: campaign managers / media buyers /
  consultants connect their own agents and ask arbitrary questions instead of
  being limited to our charts. Nine read-only tools: `get_index`,
  `get_movers`, `list_issues`, `list_channels`, `get_issue_detail`,
  `get_channel_detail`, `search_mentions` (the workhorse - filtered
  quote-level search with sentiment, source links, pagination),
  `get_issue_trend` (weekly volume/sentiment series), and `get_methodology`
  (scoring scale + live panel stats, for citation). Auth via
  `MCP_ACCESS_KEYS` (comma-separated bearer keys, fails closed) so demo keys
  can be issued per-customer; OAuth/Stripe deferred until demo interest
  proves out. Transcript policy enforced at the data layer: mention-level
  verbatim quotes + episode source links only - full transcripts are never
  exposed (PodScan/Supadata license them to us, not through us). New deps:
  `mcp-handler`, `@modelcontextprotocol/sdk`, `zod`.

## v0.6.82 · 2026-06-05

### Changed

- **Score throughput resized for the expanded panel: `SCORE_LIMIT` 240 → 720.**
  The channel expansion tripled episode intake (~470 eps/day, ~10 mentions/ep
  ≈ 4,700 mentions/day) while score capacity stayed at 8×240 = 1,920/day -
  every cron run saturated its cap and ~2,000 unscored classifications piled
  up, showing as partially-scored episodes in /log. 240 mentions took ~35s per
  run, so 720 (~105s) fits comfortably inside the 240s stage time budget; new
  capacity is 8×720 = 5,760/day. Cost impact is negligible (score is Haiku,
  ~$0.65 per 1,000 mentions).

## v0.6.81 · 2026-06-03

### Changed

- **Tighter pipeline cadence for a fresher site.** Now that transcribe/classify/
  score run through concurrency pools, processing latency - not cost - is the
  thing to cut (cost tracks episode *volume*, which is unchanged). Transcribe +
  classify go from every 4h → **every 2h**; score from every 6h → **every 3h**
  (score also refreshes the home snapshot, so the needle now updates 8×/day
  instead of 4×). Capacity check: score 8×240=1,920 mentions/day vs ~1,400
  steady-state; classify 12×60=720 episodes/day vs ~230. Ingest stays 1×/day -
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
  lean) - pre-filling the editable field so the admin *edits* rather than
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
  to `MAX_TRANSCRIPT_ATTEMPTS` (3) before giving up - so blips self-heal while a
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

- **Cohort legend** (`<CohortLegend>`) on `/channels` and `/log` - defines the
  mic = independent / tv = legacy icons next to the channel list + episode
  table.
- **Cohort breakdown on the panel cards:**
  - **Panel balance** gains two stacked bars - shows-by-cohort and reach-by-
    cohort (independent vs legacy) - alongside the existing L/M/R bars.
    `StackedBar` generalized to per-segment colors.
  - **Panel scale** gains a "By cohort" line with the icons + each cohort's show
    count and combined reach (`getPanelStats` now returns `channelsByCohort` /
    `audienceReachByCohort`).
  - Both gated on legacy actually being present.

### Changed

- Home subheadline: "legacy institutions" → "legacy media"; em dash → comma.

## v0.6.73 · 2026-06-01

### Added - LEGACY COHORT LAUNCH 🚀

- **Legacy media is now live alongside independent.** Flipped
  `PUBLIC_COHORTS` to `['independent', 'legacy']`, which simultaneously:
  - **Blends the master Soapbox Index** across both cohorts (≈L+0.1, reach-
    weighted, volume-capped).
  - **Reveals the two sub-needles** under the master - Independent (≈L+0.5) vs
    Legacy (≈R+1.5) - with the caption "same issues, same scoring."
  - **Shows the cohort icon** (mic = independent, tv = legacy) on `/channels`
    and `/log`, and surfaces the 9 legacy channels + their episodes.
- **Copy reframe.** Home headline → "Where is online political media leaning
  right now?"; subheadline introduces the independent-creators vs legacy-
  institutions split. Site title, social meta, footer, and OG image updated
  from "alternative media discourse" → "online political media, quantified."
- **Methodology** gains a "Cohorts: independent vs legacy" section.

## v0.6.72 · 2026-06-01

### Added (gated - invisible)

- **Independent vs Legacy sub-needles** under the master Soapbox Index on the
  home page. Two compact needles (`<SubNeedle>`, reusing `SoapboxNeedle` at a
  smaller size) showing each cohort's Index - so the blended master headline
  arrives with the split that explains it. Gated on `PUBLIC_COHORTS.length > 1`,
  invisible until the flip.
- The home snapshot (`writeHomeSnapshot`) now also computes and stores
  per-cohort indices (`HomeSnapshot.cohorts`), so the sub-needles read from the
  precomputed row - no extra per-request work. Field is optional for backward
  compatibility with older snapshots.

## v0.6.71 · 2026-06-01

### Added (gated - invisible)

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
  section explains the two deliberate choices - audience-reach weighting and the
  **3-episodes/day per-channel cap** - framing the Index as "stance per unit of
  audience" rather than who posts most. (Previously only the reach-weighting
  formula was disclosed; the cap was undocumented.)

### Fixed

- **`scripts/drain.ts` rides out transient blips** - a stage round now retries
  with backoff (up to 5 consecutive errors) instead of crashing the whole drain
  on a one-off Supadata/Supabase `fetch failed`.

## v0.6.69 · 2026-05-31

### Performance

- **Parallelized transcribe too.** The transcribe stage was still serial (the
  slow part of a full drain). Now runs through the same `mapPool` at concurrency
  8 - each Supadata call is multi-second, so the request rate stays ~2/s, well
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
    until the backlog clears - used to drain the legacy seed immediately rather
    than waiting ~1–3 days for the crons.

## v0.6.67 · 2026-05-31

### Added (foundation - invisible)

- **Channel cohorts: `independent` vs `legacy`.** Groundwork for an
  independent-vs-legacy comparison and a blended master Index. New
  `channels.cohort` column (default `independent`, indexed); all 86 existing
  channels backfilled to `independent`. `episode_pipeline_summary` view gains
  `cohort`.
- **All public reads are now cohort-aware**, gated by a single control point
  (`src/lib/cohort.ts` → `PUBLIC_COHORTS = ['independent']`). The Index
  (`fetchScoreRows`), issue/topic drill-downs, channel list, panel/system
  stats (shows, episodes, hours), and the `/log` feed all filter to the public
  cohort. This lets legacy channels be seeded and ingested **invisibly** -
  legacy data accumulates but never surfaces until we flip `PUBLIC_COHORTS` and
  ship the comparison UX. Zero behavior change now (every channel is
  `independent`). Non-political legacy content stays a non-issue: it classifies
  to `no-signal` and never enters scoring/weighting.
  - Known follow-up: the secondary scale totals (transcripts/classifications
    counts in SystemStats) are still whole-pipeline; tighten at launch.

## v0.6.66 · 2026-05-31

### Performance

- **Drill-down pages (`/channels/[id]`, `/issues/[slug]`, `/topics/[slug]`)
  were ~7s - now DB-filtered.** Each called `fetchScoreRows()` - the full
  ~17K-row sentiment_scores deep join - then filtered in JS for the one
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
    unchanged - only faster. Stays live (no snapshot/staleness).

## v0.6.65 · 2026-05-31

### Performance

- **`/log` now server-paginates its episode table.** The page was loading the
  entire ~2,000-row archive every request to power client-side
  search/sort/paginate - ~1.3s TTFB that grows with the archive. (Measured: the
  underlying `episode_pipeline_summary` view runs in ~64ms - the DB was never
  the bottleneck; the cost was fetching + serializing the full row set.)
  - New `GET /api/episodes` endpoint: sort, search, and pagination run in
    Postgres (`getEpisodeTablePage` - `.range()` + `count: 'exact'`), returning
    only the ~25 rows a page shows plus the total count. Search is sanitized
    before the PostgREST `or()` filter; stage columns sort by their underlying
    status field.
  - `EpisodeDataTable` gained a `serverSide` mode (TanStack manual
    sorting/filtering/pagination + debounced search + abortable fetch). `/log`
    uses it; the per-channel table keeps client mode (small, preloaded sets).
    Expandable per-episode receipts (v0.6.64) work unchanged.
  - `/log` TTFB no longer scales with the episode count - it fetches one page
    regardless of archive size. Trade-off: the table now hydrates client-side
    (a brief "Loading episodes…") rather than being in the initial HTML.

## v0.6.64 · 2026-05-31

### Added

- **Expandable per-episode receipts on `/log`.** Each scored episode row now
  expands to show exactly what the pipeline classified and scored: every issue
  mention with its sentiment chip (L+/R+, the home Index convention), a 1–5
  intensity meter, and the supporting quote the model flagged - plus an episode
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

- **Cron classify silently stalled - `transcripts.id` doesn't exist.** The
  scheduled classify stage reported `pendingFound=0` on every run for >24h
  while 68 transcribed episodes sat ready. Root cause: `runClassify` did
  `.select("id, …")` / `.order("id")` on the `transcripts` table, whose PK is
  `episode_id` - there is no `id` column. The query 400'd every run, the error
  was swallowed (`const { data } =` with no error check), the loop broke, and
  the empty result read as "queue empty." Broken since v0.6.47 (the "add ORDER
  BY" fix used the wrong column name); masked because the CLI catchup
  (`scripts/classify.ts`, episode-first since v0.6.48) did the real draining.
- **Fix: cron classify is now episode-first, mirroring the CLI.** Query the
  `episodes` table for `classify_status='pending' AND transcript_status=
  'fetched'` (cheap - no text), then load each transcript's `text` on demand
  inside the loop. This eliminates the ≈80MB "pull every transcript" payload
  that also caused the response-size/timeout fragility, and the pending-episode
  query now **checks its error and throws** instead of silently reporting an
  empty queue - so this class of stall fails loud, not silent.
- Drained the 68-episode backlog (classify + score) so the Index reflects
  current data.

## v0.6.62 · 2026-05-30

### Added

- **"What alt-media is talking about" card on `/issues`.** The issues page was
  the only main page with no data card above its list - a static taxonomy
  reference with no live signal. Added a topic-level attention rollup above the
  taxonomy: the 23 issues' mention volume aggregated into the same 11 topics the
  list is grouped by, ranked by mention count, each with a volume bar, the
  topic's volume-weighted lean tint, and a deep link to its `/topics/[slug]`
  page.
  - Reads per-issue volume/lean from the existing `dashboard_snapshot` (one
    row, no heavy join) via `readHomeSnapshot()`, with a live `getDashboardData`
    fallback when the snapshot is absent. So the page stays fast and adds no new
    DB aggregation.
  - New `<IssueActivityByTopic>` component (pure presentational, prop-driven -
    same pattern as `PanelBalance` / `PanelScale`). Bars + headline use raw
    mention count ("how much is this discussed"); lean tint uses volume-weighted
    lean so the direction matches the Index basis.
  - Deliberately distinct from the home page's "Biggest movers" (a lean-swing
    leaderboard) - this is an attention-volume *distribution*, answering the
    `/issues` reader's question "which areas are hot, which should I open?"

## v0.6.61 · 2026-05-30

### Performance

- **Home page TTFB: precompute the dashboard instead of recomputing per
  request.** v0.6.60's `cache()` fix only deduped the double `fetchScoreRows`
  call *within* one render - it can't cache across requests, and `cache()` is
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
  via the sibling `<IssueContributionsChart>` server component) - each
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
    no text), so a 1000-row page is ~300KB - comfortably under response cap.
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
  buys time but doesn't replace it - at 100K+ scored rows the per-render
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
  transcribed=gray, classified=gray, **scored=green** - a logical
  impossibility the cascade should have prevented.

  Fix: explicit `classified === "pending" ? "pending"` guard before the
  `sc >= cc` check in `getEpisodeTableRows`. The score column now
  faithfully cascades: can't be scored before classified, can't be
  classified before transcribed.

## v0.6.58 · 2026-05-30

### Fixed

- **Podcast reach auto-refresh removed - PodScan's `audience_size` is
  unreliable for the panel's purposes.** v0.6.57's reach-refresh pass
  attempted to hit PodScan's `/podcasts/{id}` endpoint and pull
  `pickPodscanReach` from the response, but the immediate post-deploy
  refresh exposed the gap: zero of 44 podcasts updated. Probing the
  endpoint directly showed `audience_size` IS exposed - just nested at
  `reach.audience_size` (not top-level where the helper looked) - but
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
  figures refresh daily from the YouTube Data API and PodScan" - half
  wrong.)
- **`<PanelScale>` freshness label**: now reads "YouTube subs refreshed
  Xh ago · podcast reach editorial" - was "Reach refreshed Xh ago," which
  implied podcasts were also auto-refreshed.

### Notes

- `getPodcastById` helper stays in `src/lib/podscan.ts` - it's a clean
  by-id lookup that may be useful for other contexts (e.g., verifying a
  candidate matches what's in the panel during admin add-flow); just not
  for reach refresh.
- The 44 podcast rows still have their `reach_updated_at` backfilled to
  `created_at` (17 days old). That's accurate - we genuinely haven't
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
  paragraph claimed reach was "pulled live" - technically true, at seed
  time only. Index math weights by `log10(reach)`, so stale reach = mildly
  wrong weights.

### Added

- **Reach refresh piggybacked on the daily ingest cron.** The ingest pass
  already iterates every active channel; now it also refreshes each
  channel's reach in the same loop. YT is batched via
  `getChannelDetailsBatch` (one API call for up to 50 channels, ~1 quota
  unit each - free tier handles 10,000/day); podcasts are per-row via the
  new `getPodcastById` helper in `src/lib/podscan.ts` (PodScan has no batch
  endpoint). Failures are logged-and-skipped - a transient API blip on one
  channel must not abort the whole ingest pass. Only positive `reach`
  values overwrite the stored stat; a 0 / null response keeps the existing
  number so a lookup miss doesn't zero out a known channel.
- **`channels.reach_updated_at` column.** New `TIMESTAMPTZ` with `now()`
  default. Backfilled to `created_at` for existing rows (conservative "at
  least this stale" floor; the seed scripts didn't track it). Bumped on
  every refresh attempt - even when the number didn't change - so
  staleness-detection isn't misleading.
- **Freshness signal on `<PanelScale>`** - top-right of the card now reads
  "Reach refreshed Xh ago" (MAX(reach_updated_at) across active channels).
  Same `relativeTime` shape as the existing "Latest data" timestamp on
  `<SystemStats>`.
- **`/channels` intro paragraph tightened** - now reads "Reach figures
  refresh daily from the YouTube Data API and PodScan during the ingest
  pass" instead of the previous "pulled live" wording, which is honest
  about cadence.

### Changed

- **CLI `npm run ingest` now also refreshes reach** (mirrors the cron path
  via the same helpers). Per-channel log line includes the before→after
  delta when reach changes (`reach: 5,990,000 → 6,012,000  ↑ 22,000`)
  so manual catchup runs print visible movement.

### Notes

- New migration `add_channels_reach_updated_at` - non-destructive
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
  representative?" - a /channels question, not a /log question. The /log
  reader is asking "is the pipeline running?". Moved the reach number off
  /log and onto a new `<PanelScale>` card on /channels where it belongs.

### Added

- **`<PanelScale>` card on /channels** - composition stats (shows tracked,
  combined audience, platform rows, largest single show). Same visual
  shape as `<SystemStats>` on /log so the cards rhyme, but the question
  they answer is different. Sits ABOVE `<PanelBalance>` so the page reads
  magnitude (raw numbers) → distribution (stacked bars) → list (per-lean
  show grid).
- **New `getPanelStats()` aggregate helper.** Channels-table only - no
  episode/classification/score queries. Returns shows tracked + L/M/R
  count, audience reach + L/M/R split, platform row count + YT/Pod split,
  and the largest single show by max reach. Mirrors the unique-show
  methodology of `<PanelBalance>` and the old `getSystemStats.audienceReach`
  field so all three surfaces agree on the same number.

### Changed (cont.)

- **`/log` System Scale trimmed to 4 pipeline-only stats** (was 5):
  shows tracked, episodes analyzed, hours of audio, issue mentions. Grid
  shifted from `lg:grid-cols-5` to `md:grid-cols-4` - same breathing
  room per stat. `getSystemStats` still computes `audienceReach` +
  `audienceReachByLean` for any downstream caller; it's just not
  displayed on /log anymore.

## v0.6.55 · 2026-05-30

### Added

- **Panel balance badge on `/channels`.** Two stacked horizontal bars
  (count + reach) show the L/M/R distribution side by side so the
  asymmetry between editorial-intent-balanced counts and what-the-
  landscape-looks-like reach is visible at a glance. Current state:
  shows are 36% L / 14% M / 50% R but reach is 28% L / 15% M / 57% R -
  right-leaning shows carry larger average audiences (2.77M vs 1.93M L),
  so reach skews right. Badge says this plainly rather than letting the
  intro paragraph imply uniform balance. Asymmetry sentence renders
  dynamically - only shown when avg-reach ratio across cohorts ≥ 1.25×,
  so it'll quiet down if the panel rebalances.
- The honest copy explicitly notes that `log10(reach)` weighting in the
  Index dampens the asymmetry but doesn't erase it - a methodology cue
  for readers comparing the published Index to their intuition.

## v0.6.54 · 2026-05-30

### Added

- **"No signal" status on the public activity log.** ~8% of processed
  episodes (161/1941 today) are off-taxonomy - classified successfully but
  produced no political-issue mentions (sports, true crime, celebrity, etc.).
  These previously rendered as the same gray dots as "pending" episodes, with
  the `scored` column tooltip saying "Not applicable" - confusing because
  gray reads as in-progress, and a "complete but empty" episode isn't
  in-progress. New `no-signal` status with a hollow outlined dot
  (border-only, transparent fill - reads as "registered but empty") on both
  the `classified` and `scored` columns when `classify_status='processed'`
  and `classification_count = 0`. Tooltip: "No political signal · issue
  taxonomy didn't match." Added to the visible legend.
- **Combined-audience reach stat on `/log`.** Headline number for "how big
  is this panel?" - sum of unique-show reach (max per show across platform
  rows, so dual-platform shows aren't double-counted; matches the methodology
  for the by-show comparison from yesterday's enrichment script). Sublabel
  breaks reach out by editorial lean (L · M · R), same shape as the existing
  show-count sublabel - surfaces cohort balance on the same surface.

### Changed

- **`episode_pipeline_summary` view: added `classify_status`.** Migration
  `add_classify_status_to_pipeline_summary_view` - non-destructive
  `CREATE OR REPLACE VIEW`. Column had to be appended at the end of the
  SELECT (Postgres can't reorder existing view columns; only append). The
  view's only consumer (`getEpisodeTableRows`) updated to select it.
- **Hours-of-audio stat reformatted.** Was `1.4K` (compact) which read like
  a placeholder; now `1,433` (full number) with sublabel `≈ 60 days
  continuous` instead of the static `Long-form, Shorts filtered`. Confirmed
  100% of episodes have `duration_sec` - the data was always plumbed; just
  the formatter obscured it.
- **Issues-mentions sublabel: dynamic count + folded sentiment-scores stat.**
  Was hardcoded `Across 15 issues` (stale - taxonomy is at 23). Now reads
  the active-issue count from `issues` table and renders `Across N issues,
  all sentiment-scored`. The standalone "Sentiment scores" stat was dropped
  to make room for combined-audience - post-v0.6.53 score == mentions for
  the autonomous-cron steady state, so the standalone number wasn't pulling
  its weight.

## v0.6.53 · 2026-05-30

### Fixed

- **CLI scripts had the same `.range()` family bug** the cron path got fixed
  for in v0.6.51 - the previous audit pass (v0.6.52) only covered
  `src/`, not `scripts/`. Caught by the catchup drain itself: the classify
  stage drained cleanly (393 → 0, added 4,758 new classifications), but
  `scripts/score.ts` told the catchup loop "queue drained" while 5,809
  classifications were actually unscored. Root cause: both pagination loops
  in `score.ts` had no `.order()` AND the `data.length < pageSize` early-out
  - so the script only ever read page 0 of `classifications` and
  `sentiment_scores`, scored the 200-ish overlap in page 0 across 3 catchup
  iterations (600 scored), then page 0 showed "all scored" → "drained"
  sentinel fired. Same dual-bug as the original v0.6.47.
- **`scripts/score.ts`** - added stable `.order("id", asc)` on the
  classifications loop and `.order("classification_id", asc)` on the
  sentiment_scores loop (UNIQUE constraint makes it a valid pagination
  key); removed both `data.length < pageSize` early-outs. Same canonical
  pattern as `aggregate.ts:155-209`.
- **`scripts/classify.ts`** - happened to work in the catchup drain (the
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
  scaling - so fixing all of them is part of "runs autonomously."
  - `src/lib/audit.ts` `paginatedSelect` - the generic helper used by
    `/admin/channels-audit` had both halves of the v0.6.47/v0.6.51 bug: no
    `.order()` and a `data.length < pageSize` early-out. Hardcoded
    `.order("id", ascending: true)` inside the helper (all three callers
    use tables with an `id` PK; the helper's contract is now unambiguous
    - "I paginate by id") and dropped the short-page break.
  - `src/lib/episodes.ts` `getEpisodeTableRows` - had empty-page-only
    termination ✓ but ordered by `published_at DESC` alone, which isn't
    unique. Two episodes posted in the same second could re-cross page
    boundaries and appear duplicated in the /log table. Added
    `.order("id", descending)` as the stable tiebreaker after the business
    order; UI behavior unchanged when published_at values are distinct
    (the common case), now deterministic when they collide.
  - `src/app/channels/page.tsx` - single-call `.range(0, 999)` silently
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
  `pipeline.ts` ×3, `audit.ts`, `episodes.ts`, `channels/page.tsx`) - a
  good candidate for extraction into a shared helper if/when scope allows.

## v0.6.51 · 2026-05-29

### Fixed

- **Cron classify + score short-page early-out → silent backlog stall (round
  two).** Same `pendingFound=0` symptom as v0.6.47, different half of the
  same pagination antipattern. v0.6.47 added the required `ORDER BY` but
  kept `if (data.length < pageSize) break;` as the loop terminator. That
  early-out fires on *any* short page - and Vercel's edge→Supabase route
  hits a response-size cap before the row cap on `runClassify`'s deep-join
  query (each row carries full transcript text). Once `transcripts` grew
  past the response threshold (1,779 rows as of today), the first page came
  back short, the loop exited, the in-memory array only held the oldest
  already-processed rows, and the JS filter to `classify_status='pending'`
  returned `[]`. Result: **3 of every 4 classify cron runs today found 0
  pending despite 393 actually pending** (08:30/12:30/16:30 UTC; only the
  00:34 + 04:34 runs processed work). Fix: terminate on empty page only -
  matches the canonical pattern at `aggregate.ts:155-209` (v0.6.3) and the
  `getSystemStats` pagination at `aggregate.ts:450-461`. Applied to all
  three paginated loops in `pipeline.ts` (`runClassify` transcripts,
  `runScore` classifications, `runScore` sentiment_scores).

## v0.6.50 · 2026-05-29

### Added

- **Mention-volume signal alongside lean in "Biggest movers."** The home card
  now ranks issues on two orthogonal axes - lean swing (L↔R movement) and
  mention-volume swing (attention shift) - and shows both. A row earns its
  spot if `|leanΔ| ≥ 0.5` OR `volumeRatio` crosses `[0.67×, 1.5×]`; both
  numbers display so visitors can see which signal (or both) put it there.
  Ranking uses `max(|leanΔ|/2, |log2(volumeRatio)|)` so a 2-point lean swing
  and a 2× volume swing carry equal weight, and the existing
  `MOVER_MIN_MENTIONS = 25` floor applies on both windows so neither axis
  fires on thin samples. Cap moved into `getDashboardData` (6 rows) - the
  home page just renders `data.movers` directly now. Mobile keeps the
  original 3-column layout for readability; desktop expands to 6 columns
  (adds Last week / Mentions / Volume).
- **Per-issue mention-volume sparkline on `/issues/[slug]`.** New
  `<VolumeAreaChart>` component (neutral gray, non-negative y-axis, no
  zero reference line - counterpart to `<IndexAreaChart>`) renders alongside
  the existing lean trend in a 2-up grid. Answers the question the lean
  chart can't: "is anyone actually talking about this issue right now?"
  Powered by a new `rollingVolumeTrend()` helper in `aggregate.ts` that
  mirrors `rollingLeanTrend`'s windowing but keeps mid-series zero days
  (a stretch of zero is a real "issue went silent" signal - lean is just
  undefined at 0/0, volume isn't); leading-only zero days are trimmed so
  the chart starts at first activity.
- **`IssueMover` extended** with `currentMentions`, `prevMentions`,
  `volumeRatio` (week-over-week mention-count ratio). `IssueDrillDown` gains
  `volumeTrend: { values, dates }`. No new pipeline cost - both surfaces are
  derived from the existing `fetchScoreRows()` data.

## v0.6.49 · 2026-05-29

### Changed

- **`scripts/discover-socialblade.ts` handles markdown + smarter triage.**
  Added a markdown-table parser (auto-detected by extension or content) so
  Social Blade pages saved via a browser markdown-clipper extension work
  directly - previously only HTML was supported. Tightened the bucketing:
  beyond "in panel" / "legacy" / "candidate", the script now flags
  "non-US/non-English" (Cyrillic / Devanagari / Burmese / CJK scripts; known
  Spanish/Bengali/Hindi outlets) and "non-political" (gaming, true-crime,
  finance-tutorial) so the actionable candidate list isn't drowned by 100-row
  globals. Name normalization strips "The X Show" / "X Podcast" boilerplate
  to catch Social Blade ↔ panel mismatches (Ben Shapiro ↔ "The Ben Shapiro
  Show", etc.).

- **`docs/legacy-media-wishlist.md`** - appended a "From Social Blade Top
  100 News (US, 2026-05-29)" section with cable / broadcast, digital-native,
  local-affiliate, and ambiguous-cohort entries surfaced by the scrape.

## v0.6.48 · 2026-05-29

### Changed

- **CLI classify is episodes-first.** The old `scripts/classify.ts` paginated
  the entire `transcripts` table with `text` embedded in the SELECT - a 1700-
  row × ~100KB/row payload that hit Postgres's `statement_timeout` once the
  panel hit ~80 channels. Refactored to query `episodes` (no `text`) filtered
  on `classify_status='pending' AND transcript_status='fetched'`, then load
  each transcript on demand inside the loop. Orders by `published_at DESC` so
  the most-recent backlog drains first. The cron path in `pipeline.ts` may
  benefit from the same treatment if/when it starts timing out at larger
  scale - for now its 300s function budget masks the inefficiency.

### Added

- **`scripts/discover-socialblade.ts`** - one-time parser for saved Social
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
  pagination returned non-deterministic pages - some runs got pages where
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

- **`/admin/channels` - admin flow to add a channel + deep-ingest history.**
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
  work per day, smoother throughput - with the v0.6.43 time-budget guard each
  run completes cleanly, so the only knob needed is *frequency*. At 48
  channels this keeps the pipeline caught-up (transcribe 240/day vs ~148
  ingest/day; classify ~90/day vs ~40/day transcribed). Empty runs are free.

### Added

- **Channel expansion strategy draft** (`docs/channel-expansion-strategy.md`)
  for the 48→200 scale-up: curation criteria, sourcing ladder, ~$870/mo cost
  model at 200 channels, throughput requirements (hourly classify), phased
  rollout, and open editorial decisions (reach floor, lean balance target,
  cost ceiling). Not implemented - review artifact.

## v0.6.43 · 2026-05-27

### Fixed

- **Classify cron 504 after the taxonomy grew to 23 issues.** This morning's
  scheduled classify ran the full 300s on a 15-episode batch and was killed
  mid-batch (12 episodes done, no `usage_log` row) - the larger taxonomy makes
  each episode slower and produce more mentions, so a fixed `CLASSIFY_LIMIT`
  can overshoot. Added a **wall-clock budget** (`STAGE_TIME_BUDGET_MS = 240s`):
  the classify loop stops when the budget is hit and always completes cleanly,
  processing as many episodes as fit. `CLASSIFY_LIMIT` stays as an upper bound;
  the run now reports `stoppedAtTimeBudget`. (Adapts automatically as the
  taxonomy keeps growing.)

## v0.6.42 · 2026-05-27

### Added

- **Topic drill-down pages (`/topics/[slug]`)** - the deeper Phase 2 read path.
  `getTopicDrillDown` rolls a parent Topic's child issues into a topic-level
  lean + 30-day trend (same reach×intensity weighting as the Index, so the
  numbers stay consistent across issue/topic/overall). Each topic page shows the
  needle, trend chart, and its child issues ranked by share of voice. The
  `/issues` topic headers now link to them. `ScoreRow` carries `issue_topic_slug`
  (added to `fetchScoreRows`).

## v0.6.41 · 2026-05-26

Two-level taxonomy - Phase 2 (read path) + discovery integration + staged
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
  Race & discrimination - to cover the empty/thin Topics classify is currently
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

Emerging-issue discovery with admin oversight - the fixed 16-issue taxonomy no
longer silently misses new topics (e.g. it would now surface something like a
"Trump anti-weaponization fund" for review).

### Added

- **Harvest** (Phase 1): the classify pass now *also* returns substantive
  political topics that don't fit the taxonomy (`OffTaxonomyTopic` - label +
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

- Discovery **proposes, a human disposes** - the system never edits the taxonomy
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
  classifications/scores; transcripts cascaded) - all were lower-reach podcast
  copies; where only one copy was processed, that one was kept regardless of
  reach. No remaining cross-platform dup groups.

## v0.6.37 · 2026-05-26

### Fixed

- **Cron split into per-stage jobs to fix a 300s timeout.** After v0.6.29 made
  classify do real work, the combined nightly pipeline exceeded Vercel's 300s
  function limit - the 2026-05-26 run returned `504`, classified 73 mentions,
  then was killed before `score` (left them unscored) and before writing
  `usage_log`. The four stages now each run as their own cron with a full 300s
  budget: `/api/cron/{ingest,transcribe,classify,score}`, staggered at :00/:15/
  :30/:45 past 10:00 UTC. Stage logic was extracted unchanged into
  `src/lib/pipeline.ts` (stages never call each other, so they split cleanly -
  see ARCHITECTURE.md). The old `/api/cron/pipeline` endpoint is kept for manual
  full runs (logs as source "manual"). Each stage logs its own `usage_log` row.

## v0.6.36 · 2026-05-25

### Changed

- **Methodology page de-hyped toward a lab-notebook voice.** Rewrote the intro
  from marketing framing ("the way you'd want it measured", "source of truth")
  to a factual statement of what the page documents; softened "hand-curated" →
  "curated". The rigorous middle (formulas, channel-skew honesty, known
  limitations) and the bottom "Why this exists" mission section are unchanged -
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
  range, but issue/channel charts now fit to their own data - an entity that
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
  so they permanently clogged the `CLASSIFY_LIMIT=15` batch - ~$1/run for **0
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

- **`IndexSparkline.tsx` and `EpisodeList.tsx`** - v0.6.26 emptied these to
  stubs but never `git rm`'d them. Nothing imports either; deleting the files
  completes that release's intent.

### Added

- **`CLAUDE.md`** is now tracked in the repo - the working guide for Claude
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

- **Interactive Index trend chart** on the home page - a Recharts area chart
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
  intensity (1…5), confidence (1–3), + notes - instructions and the three
  calibration examples are built into the page. Shared link + name to start;
  forward-only and resumable. New `gold_items` / `gold_labels` tables
  (migration `20260524000002`), seeded by `npm run seed:gold-set` (same
  stratified sample as the CSV exporter; model answer frozen per item).
  Submissions go through a server action on the service-role client - no
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
  to `globals.css` + `tailwind.config.ts` (additive - existing literal-gray
  pages unaffected), `components.json`, and `src/components/ui/`:
  button, input, table, badge, dropdown-menu.
- **Episode receipts → a real data table** (`EpisodeDataTable`, TanStack
  Table + shadcn). Columns: category (L/M/R), date, channel, video, type,
  length, and Transcribed / Classified / Scored status (colored dots with
  Radix tooltips) - all sortable, with search, pagination, and a
  column-visibility menu. Channel names link to the channel page. The channel
  drill-down's "Recent episodes" reuses the same table (Category + Channel
  columns hidden).
- **`episode_pipeline_summary` view** (migration `20260524000001`) computes
  per-episode classify/score counts in Postgres, so /log loads one light
  result set instead of thousands of join rows.
- **Admin nav** (`AdminNav`) across the gated `/admin/*` tools.

### Changed

- **Pipeline health moved to `/admin/pipeline`** - it's operational detail
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
  `20260524000000`) - duplicate scores are now structurally impossible.

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
  **no cost/token data** - that stays on the operator-only /admin/costs.
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

- `runTranscribe` no longer swallows errors in a bare `catch {}` - failures
  (missing env var, Supadata outage) are now logged. This is what would have
  surfaced the `SUPADATA_API_KEY` problem on day one.

### Removed

- Temporary transcribe diagnostic logging (served its purpose locating the
  Supadata-key failure).

### Note

- The v0.6.17 platform-by-map change is retained as a robustness improvement,
  but it was not the root cause - the missing env var explained the failure
  on its own. No evidence the channel embed was actually broken.

## v0.6.17 · 2026-05-24

The last link in the cron chain.

### Fixed

- **Cron transcribe failed every YouTube episode without calling Supadata.**
  Once v0.6.16 fixed the key and the cache, the cron could finally *see*
  pending episodes - but it still marked them all `failed` in ~50ms, never
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
  GETs, and the Next.js App Router caches `fetch` by default - so every
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
  re-classified on every pass - catastrophic under a loop (a catch-up run
  reclassified 234 episodes ~95× into 24k duplicate rows before being
  caught). Now paginates via `.range()` and terminates only on an empty
  page. The runaway duplicates were cleaned up out-of-band.

### Added

- **`scripts/catchup.sh`** - full-pipeline drain that runs ingest, then
  loops transcribe/classify/score until each queue empties, with hard
  per-stage iteration caps so a logic bug can't run away unattended.

### Operational (no code)

- Corrected Vercel's `SUPABASE_SERVICE_ROLE_KEY`: it held a legacy **anon**
  JWT, not a service-role key. With RLS enabled on all tables and zero
  policies, an anon key reads/writes nothing - which is why the cron saw an
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
   issue since mid-2024 - the library does HTML scraping and breaks
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
  maintenance - everything we were doing badly. ~$17/mo on the Pro
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
two with auto-generated captions, one with owner-uploaded captions -
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
  per cron - the pending pool was growing by ~90/day with the rest of
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
  was arriving as `{"sentiment": +4.2, "intensity": 3}` - Haiku
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
  line. Gives the eye a magnitude anchor at a glance - previously
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
  `sparkline: number[]` - same length, same order. Days with no data
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
  Alternative Political Media"* - that framing was useful internally
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
  needle bar, channel + episode counts, and the as-of date - generated
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
  sampler that emits two CSVs - a clean labeler version with channel
  names blinded to lean, and an internal answer key with model scores).
  Run with `npm run eval:extract-gold-set`. Designed to validate the
  Haiku scorer against independent human judgment; output feeds the
  v0.7 prompt audit.

## v0.6.4 · 2026-05-13

Transcribe reliability fix. Cron's transcribe stage was burning its
TRANSCRIBE_LIMIT on the freshest YouTube uploads of the day, which
typically don't have auto-captions generated yet. Those failed and got
marked permanently failed (no retry logic). Older pending episodes -
which actually do have captions ready - were starved.

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

Failed transcripts are still permanently failed - no retry. When
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

- **Cron batch limits raised** - `CLASSIFY_LIMIT` 2 → 15, `SCORE_LIMIT`
  30 → 80. Original limits would have taken ~75 days to burn down a
  single day's 150-episode ingest backlog. New limits target a 1-week
  catch-up rate while staying ~45s clear of the 300s function timeout.
  Stage timing observations documented inline in
  `src/app/api/cron/pipeline/route.ts`.

## v0.6.1 · 2026-05-12

Same-day branding + transparency-surface polish on top of v0.6.0.

### Added

- **Brand identity** - wooden-crate logo + red/blue `soapbox` wordmark
  (red `#C8202F` on "soap", blue `#114A8A` on "box") replacing the plain
  text mark. Logo source-of-truth at `src/assets/logo-crate.png`, served
  through `next/image` with priority + blur placeholder (~5KB delivered
  at retina). Favicon auto-detected from `src/app/icon.png` (256×256).

### Changed

- **Activity moved to footer** - the `/log` link lives in the footer
  alongside Issues / Channels / Methodology rather than the top nav.
  Activity is a transparency surface, not a primary destination.
- **Trust strip totals aligned** with `/channels` SystemStats - both now
  report cumulative channel + episode counts rather than mixing in-window
  counts with all-time. "Episodes in window" → "Episodes tracked".
- **`.media` removed from header** - top-of-page brand mark is now the
  wordmark alone; the `.media` TLD was redundant next to the logo.

## v0.6.0 · 2026-05-12

Post-MVP foundations release. Same-day as v0.5.0; bundled because all of
this work shipped in a single extended session.

### Added

- **Admin tooling** (Basic Auth gated via middleware against ADMIN_PASSWORD):
  - `/admin/costs` - Anthropic spend dashboard. Daily/weekly/monthly burn vs
    $1k budget cap, 30-day daily bar chart, recent-runs table. Backed by a
    new `usage_log` table written from the cron pipeline.
  - `/admin/channels-audit` - three views to guide channel curation:
    publishing cadence per show (last 14 days), L/M/R coverage gaps by issue,
    and "mentioned but not tracked" report scanning supporting quotes for
    candidate voices.
- **PostHog product analytics** - client-side init + manual pageview capture
  for the App Router. Autocapture / heatmaps / web vitals on; session
  recordings off.
- **Public `/changelog` page** - renders `CHANGELOG.md` directly via
  react-markdown so the file remains the single source of truth. Footer
  version pill links here.
- **Public `/log` activity feed** - paginated 50/page; every episode the
  pipeline has ingested with status badges + link to source. Receipts for
  transparency.
- **Per-channel episode list** on channel drill-down pages - last 25
  episodes for that show with publish date, duration, transcript status,
  source link.
- **External-link affordance per channel** - every channel card on
  `/channels` and the drill-down page links out to YouTube or Apple Podcasts.
- **Shared `Header` + `Footer` components** - DRYed out the inline JSX
  across all pages; nav changes are now a one-line edit.
- **Version surface** - `v0.x.y` pill in every page footer linking to the
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
- **Channels list grouped by show** - same name across YouTube + podcast
  collapses to one card with platform indicators, eliminating the visual
  "duplicate channel" problem.
- **Status badge clarity** on activity log - "pending" renamed to
  "awaiting transcript" so casual visitors understand it as expected
  latency, not a bug.
- **Hero subtext rewritten** - sharper framing of why soapbox exists
  (alt-media now shapes US political discourse; not measured at scale;
  Soapbox listens above your personal algorithms).
- **Issue contribution chart** added to `/methodology` with auto-generated
  narrative explaining which issues are pulling left vs right.

### Technical

- Vercel Cron `/api/cron/pipeline` endpoint runs the full pipeline at
  10:00 UTC daily (6 AM ET). Writes a `usage_log` row at completion.
- `src/middleware.ts` enforces HTTP Basic Auth on `/admin/*`.
- Added `react-markdown`, `@tailwindcss/typography`, `posthog-js`.
- ARCHITECTURE.md - comprehensive live source-of-truth document. Maintained
  per non-trivial commit.

### Vexes documented for vNext

- **Cross-platform same-content duplicates**: shows that publish identical
  content to both YouTube and podcast feeds get ingested twice. Future fix:
  dedup by (show + date + duration).
- **Stale-feed PodScan resolution**: name-search resolution can pick wrong
  feed when a show has changed feeds. Workaround in v0.6.0: explicit
  `podscanPodcastId` field on SeedChannel. Future fix: smart resolver that
  prefers the feed with most recent episodes.
- **Reach is a snapshot at ingest time** - need periodic re-fetch.
- **Issue taxonomy fixed editorial** - emergent-topic detection deferred.
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
