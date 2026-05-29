# Changelog

All notable changes to soapbox.media are tracked here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versioning follows [SemVer](https://semver.org/spec/v2.0.0.html).

Pre-1.0 minor versions correspond roughly to development phases of the
pre-launch build leading into the November 2026 US midterms.

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
