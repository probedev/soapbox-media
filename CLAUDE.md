# CLAUDE.md - working guide for soapbox.media

Soapbox quantifies what alt-media political voices (podcasts + YouTube) are
saying about a defined issue taxonomy, and surfaces it as the **Soapbox Index**
(an L/R needle, −10..+10) plus issue/channel drill-downs. Next.js 14 (App
Router, TS) on Vercel; Supabase Postgres; Anthropic for classify/score.

Design history lives in `ARCHITECTURE.md`; release-by-release detail in
`CHANGELOG.md`. Read those before large changes.

## Commands

- `npm run dev` - local dev (reads `.env.local`)
- `npm run typecheck` - **run before declaring any task done**
- `npm run build` - prod build (catches what tsc misses)
- Pipeline (CLI, hit live DB via `.env.local`): `npm run ingest -- <chans> <per>`,
  `npm run transcribe -- <n>`, `npm run classify -- <n>`, `npm run score -- <n>`
- `bash scripts/catchup.sh` - full-pipeline drain (loops with hard safety caps)
- `npm run seed:gold-set` - populate the gold-set labeling items

## Release ritual (every shippable change)

1. Bump **both** `package.json` `version` and `src/lib/version.ts` `VERSION`.
2. Add a dated `CHANGELOG.md` entry (SemVer; patch bumps for fixes).
3. `npm run typecheck` clean.
4. `git ls-remote --tags origin vX.Y.Z` (confirm unused) → commit → push → tag.
5. Push to `main` auto-deploys on Vercel. The footer shows `VERSION`.

## Guardrails (learned the hard way - don't relearn)

- **Never loop cost-incurring stages unattended.** classify = Sonnet (~$0.05/ep).
  A loop with a loose cap reclassified the same episodes ~95× ($180 burned).
  Caps live in `scripts/catchup.sh`; single high-limit invocations are safer.
- **Supabase Max Rows cap is 1000.** `.limit(50000)` does NOT beat it - it
  silently truncates. Paginate with `.range()`, order by a stable key, stop
  only on an empty page. This caused both a data-loss bug and the classify
  runaway.
- **Next.js caches `fetch` by default**, and supabase-js reads via `fetch`.
  `src/lib/db.ts` forces `cache: "no-store"`; keep it. Without it, server reads
  freeze at a stale snapshot.
- **Scoring is idempotent**: `sentiment_scores` has `UNIQUE(classification_id)`
  and the writers upsert `onConflict: classification_id`. Don't revert to plain
  insert (concurrent cron+CLI created duplicate scores otherwise).
- **RLS is ON with no policies on every table** → only the service-role key
  reads/writes. The app is server-side only. Never route an app path through the
  anon key (it returns empty, silently).
- **Observe before theorizing.** When debugging, instrument / query for ground
  truth before asserting a root cause. Confident-but-wrong theories (IP
  blocking, a "broken" channel embed) wasted real time; the actual causes were
  a missing env var and Next fetch caching, found only by logging.

## Architecture principle

Pipeline stages (ingest → transcribe → classify → score) never call each other.
Each reads inputs from the DB and writes outputs to the DB, so any stage is
swappable. Aggregation (`src/lib/aggregate.ts`) is read-only.

## Infra facts

- Cron: Vercel, per-stage jobs with throughput-tuned cadences (set in
  `vercel.json`). Ingest 1×/day (10:00 UTC). Transcribe + classify every 2h
  (12×/day), classify offset +30 min. Score every 3h (also refreshes the home
  snapshot). Cadence tightened v0.6.81 now stages are parallelized - frequency
  doesn't change cost (episode *volume* does), it just cuts processing latency.
  Ingest stays 1×/day on purpose: its 3-episode cap is enforced per-RUN, so
  running it more often would over-sample high-volume channels past the 3/day
  "stance per audience" cap (would need a per-day cap first). Discover weekly
  (Mon 11:00 UTC). Each stage has a 300s function limit; classify's per-run wall-
  clock is bounded by `STAGE_TIME_BUDGET_MS = 240s` in `src/lib/pipeline.ts`
  (v0.6.43) so it always completes cleanly as the taxonomy grows. Stage logic
  is in `src/lib/pipeline.ts`; `/api/cron/pipeline` kept for manual full runs.
  All auth via `CRON_SECRET`. Domain redirects apex → `www`.
- Supabase project ref `xhqtirzxkbiehkuzglqm`. YT transcripts via **Supadata**
  (managed API, native-caption mode). Podcast transcripts inline from PodScan.
- Useful objects: `episode_pipeline_summary` view (per-episode classify/score
  counts for the /log table); `usage_log` (cron run history → /admin/pipeline +
  /admin/costs); `gold_items` / `gold_labels` (human calibration → /eval/label).
- `/admin/*` is HTTP Basic Auth (`ADMIN_PASSWORD`). Public pages are
  server-rendered (`force-dynamic`).

## Connectors

Supabase, Vercel, and GitHub MCP connectors are available - query the DB and
read deploy/runtime logs directly instead of asking the user to paste. Prefer
**read** for Supabase; for destructive writes or schema migrations, confirm
with the user first.

## Conventions & quality bar

- **Never use em dashes** (the long dash, Unicode U+2014) in any copy, comment,
  or code. Use commas, colons, parentheses, or a spaced hyphen (" - ") instead.
  This is a hard style rule across the whole project, going forward.
- **shadcn first: check the library before building any UI.** Before
  implementing ANY UI feature (a button, input, table, form, menu, dialog,
  chart, badge, card, etc.), first check whether shadcn/ui already provides it.
  Use the **shadcn MCP** (configured in `.mcp.json`) to browse/search the
  registry, or `npx shadcn@latest add <component>`. Never hand-roll a raw
  `<button>`/`<input>`/`<select>`/`<textarea>`/`<table>` or a bespoke
  tooltip/menu when a shadcn primitive exists - compose the primitive and pass
  custom Tailwind via `className` if you need to tweak its look. The whole site
  is 100% shadcn as of v0.10.0; keep it that way. The only sanctioned
  hand-built UI is the custom SVG gauges (`SoapboxNeedle`, `SubNeedle`) and the
  1-D position markers, which have no Recharts/shadcn equivalent.
- Secrets live only in gitignored `.env.local`; never commit them.
- Clean, type-safe, scalable code over MVP shortcuts. Cost-conscious
  (~$1k/mo budget). UI is shadcn/ui + Tailwind; tables via TanStack Table.
- **Charts: standardize on Recharts v3 + the shadcn chart component.** Every
  chart (new or touched) uses `ChartContainer` + `ChartConfig` +
  `ChartTooltip`/`ChartTooltipContent` (+ `ChartLegendContent` where useful)
  from `src/components/ui/chart.tsx` - not bare Recharts elements or hand-rolled
  tooltips. This buys consistent tooltips, animations, theming, and a11y across
  the site. Give `ChartContainer` an explicit `min-h-*`/`aspect-*` (v3 needs a
  measurable size). Reference chart colors via the `--chart-*` CSS tokens /
  `ChartConfig.color`, never `hsl(var(...))`. Keep the house lean palette
  (red = right `#dc2626`, blue = left `#2563eb`) and the L+x/R+x labels.
  To add components/charts, use the **shadcn MCP** (configured in `.mcp.json`)
  rather than hand-copying - `npx shadcn@latest add <component>`.
- Scoring changes must be validated against the gold set (`/eval/label`) before
  shipping - the sentiment scale is bimodal and under active calibration.
- Never republish full transcripts; excerpts + source links only.
