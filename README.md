# Soapbox.media

The FiveThirtyEight of alternative political media — a daily-updating dashboard that quantifies what top political podcasts and YouTube voices are saying, how loudly, and which way the broader discourse is tilting.

See [`../PRD.md`](../PRD.md) for the product spec.

## Status

**Live** at [soapbox.media](https://www.soapbox.media). The full pipeline
(ingest → transcribe → classify → score) runs autonomously via a daily Vercel
cron and the site renders real data: the Soapbox Index + trend chart, issue
and channel drill-downs, a public activity log, and a gold-set calibration
tool at `/eval/label`.

For the current system design see [`ARCHITECTURE.md`](ARCHITECTURE.md); for the
release-by-release history see [`CHANGELOG.md`](CHANGELOG.md). The Day-1 setup
checklist below is retained for historical/onboarding reference — those steps
are long done.

## Quickstart

```bash
cd /Users/greggheil/Documents/Claude/Projects/soap-box/soapbox
npm install
cp .env.example .env.local        # fill in keys as we wire each module
npm run dev                       # http://localhost:3000
```

You should see the Soapbox Index needle, the headline number, and six placeholder issue cards.

## Day-1 setup checklist

External accounts and provisioning that need to happen tonight so Day 2 isn't blocked:

1. **Supabase** — sign in at [supabase.com](https://supabase.com), create project `soapbox-media` (region: us-east-1). Copy `URL`, `anon` key, and `service_role` key into `.env.local`.
2. **Run the schema** — open the Supabase SQL editor and paste `supabase/migrations/20260511000000_initial_schema.sql`. Confirm 7 tables created and 15 issues seeded.
3. **GitHub repo** — `gh repo create soapbox-media --private --source=. --push` (or do it via the GitHub UI). Use `main` as the default branch.
4. **Vercel** — import the GitHub repo, set framework to Next.js (auto-detected), no environment variables needed yet for the placeholder. Add the `soapbox.media` domain under Project → Settings → Domains.
5. **Anthropic API key** — *not* the same as your Pro/Claude.ai subscription. Generate at [console.anthropic.com](https://console.anthropic.com) → API Keys. Put a hard $50 cap on the key for safety until Day 3.
6. **PodScan API key** — confirm you have a key and that it can pull transcripts for at least one of our seed shows. Add to `.env.local`.
7. **YouTube Data API key** — Google Cloud Console → APIs & Services → enable "YouTube Data API v3" → create API key. Restrict to that single API.

## Architecture

```
src/
├── app/
│   ├── layout.tsx           # root layout, fonts, metadata
│   ├── page.tsx             # home — Soapbox Index hero + top issues
│   ├── globals.css
│   ├── issues/[slug]/page.tsx       # (Day 4) issue drill-down
│   ├── channels/[id]/page.tsx       # (Day 4) channel drill-down
│   └── methodology/page.tsx         # (Day 5) public methodology
├── components/
│   ├── SoapboxNeedle.tsx    # the L/R gauge (pure SVG)
│   └── IssuePreview.tsx     # issue card on the home page
├── lib/
│   ├── utils.ts             # cn() for class merging
│   ├── env.ts               # (Day 2) typed env loader
│   └── db.ts                # (Day 2) Supabase server client
└── modules/                 # (Day 2+) the swappable seams
    ├── ingest/              # RSS / YT discovery → episodes
    ├── transcribe/          # provider-agnostic ASR wrapper
    ├── classify/            # transcript → (issue, quote, ts)
    └── score/               # sentiment + intensity + Soapbox Score
```

The Day-1 commit intentionally ships only the parts of this tree that are needed to render a believable placeholder. Each subsequent day brings one module online.

## Conventions

- Modules never call each other directly. Everything writes to and reads from the database.
- LLM calls always pin `model` and `model_version` in the row they produce.
- We never republish full transcripts in the UI. Excerpts + timestamps + source links only.
