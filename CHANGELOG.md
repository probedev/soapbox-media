# Changelog

All notable changes to soapbox.media are tracked here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versioning follows [SemVer](https://semver.org/spec/v2.0.0.html).

Pre-1.0 minor versions correspond roughly to development phases of the
pre-launch build leading into the November 2026 US midterms.

## [v0.5.0] — 2026-05-12

Initial public release after the 5-day MVP sprint.

### Added

- 49 hand-curated alt-media channels balanced across Left, Middle, and Right
  political-publishing posture.
- End-to-end pipeline: ingest (RSS + YouTube Data API) → transcribe (PodScan
  inline + youtube-transcript for YT) → classify (Claude Sonnet 4.6) →
  score (Claude Haiku 4.5) → aggregate.
- **Soapbox Index** — single L/R number for the trailing 7-day window of
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
- Vercel Cron — full pipeline runs daily, idempotent against re-runs.

### Technical foundation

- Next.js 14 (app router) + TypeScript + Tailwind + Geist sans on Vercel.
- Supabase Postgres backend with paginated reads + service-role server client.
- Claude Sonnet 4.6 for classification, Claude Haiku 4.5 for scoring.
- PodScan.fm for podcast transcripts (inline with episode metadata).
- YouTube Data API v3 + youtube-transcript npm package for YT.

### Methodology disclosures

- Filter: YouTube videos under 3 minutes excluded from ingest (filters Shorts).
- Known gap: Bannon's War Room and Charlie Kirk Show (podcast feed) aren't
  transcribed by PodScan — metadata only.
- Classifier directional accuracy: ~85–90% at the per-row level.
- L/R position assignments per issue are editorial and reviewed quarterly.

### Known limitations / vNext queue

- Channel reach is a snapshot at ingest time; needs periodic re-fetch.
- Issue taxonomy is fixed-editorial; emergent-topic detection is a v0.6+
  design challenge.
- No admin tooling yet (cost dashboard, channel management) — planned next.
- Episode-level transparency surfaces (per-channel episode list, public
  daily ingest log) — planned next.
