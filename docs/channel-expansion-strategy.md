# Channel expansion strategy — 48 → 200

Status: **DRAFT for review** (2026-05-28). Foundational decision; needs editorial
input on curation criteria + lean balance before implementation.

## Why now, and what's already in place

The pipeline foundation is finally ready for this scale-up:
- Cron split + wall-clock budget guard ([[classify-stuck-bug]], v0.6.37/v0.6.43)
  → stages can't 504 under heavier load.
- Cross-platform dedup ([[cross-platform-dedup]]) → no double-counting when a
  show is on both YT and a podcast.
- Two-level taxonomy ([[taxonomy-v2]]) + broadened classify coverage → 23
  active issues with no major coverage blind spots.
- Backlog dynamic fixed (this release) — stages run multi-times/day, so 48
  channels stay caught up.

So **scale is the right next move**: more channels means more representative
Index, richer discovery, and a stronger story.

## Sizing the problem honestly (cost + throughput at 200)

### Per-day flow at 200 channels
At `INGEST_PER_CHANNEL = 3`, 200 channels → **~600 episodes/day** ingested.
(Some channels publish >3/day so we still miss bursts — see "Open questions".)

### Estimated monthly cost at 200 channels (full flow)

| Stage | Per-episode | /day | /month |
|---|---|---|---|
| Classify (Sonnet, ~12K input tok/ep × 23 issues) | ~$0.04 | $24 | **~$720** |
| Score (Haiku, ~1K tok) | ~$0.003 | $1.80 | ~$55 |
| Transcribe (Supadata, YT only — assume ~half) | ~$0.01 | $3 | ~$90 |
| Discover (weekly Haiku cluster) | — | — | ~$5 |
| **Total** | | | **~$870** |

That's **within the ~$1k/mo budget but tight** — classify is ~83% of it.
Worth knowing levers if it overshoots:
- Cap `INGEST_PER_CHANNEL` lower (e.g., 2) → 400/day instead of 600 → ~$580/mo.
- Skip classify for episodes below a duration floor higher than today's 180s.
- Sample (e.g., every nth episode) for very high-volume channels.

### Pipeline throughput at 200 channels
The current "every 4h" schedule (240 transcribe/day, ~90 classify/day) handles
48 channels comfortably but **falls short at 200**:

| Stage | 200-ch demand | Current cadence | Needed cadence |
|---|---|---|---|
| Transcribe | ~600/day | every 4h (240/day) | every 1–2h (480–960/day) |
| Classify | ~600/day | every 4h (90/day) | every 30–60 min (360–720/day) |
| Score | ~600/day | every 6h (320/day) | every 4h (480/day) |

Hourly classify is the tight one; the time-budget guard means each run safely
processes ~12–16 episodes regardless. Run frequency does the rest.

## Curation criteria — needs your editorial call

A candidate channel should satisfy **all** of these to be added:

1. **Political-talk focus** — primarily commentary on US politics/policy (not
   entertainment with occasional politics, not sports, not pure interview).
2. **Alternative / independent media only** — podcasts and YouTube shows, not
   legacy/traditional broadcasters (CNN, Fox, MSNBC, NYT, etc.). The product's
   thesis is "what alt-media is saying"; legacy stays out of the panel for v1.
   *Future*: a separate "Legacy vs Alt" cohort could be added for direct
   sentiment comparison — see "Future extensions" below.
3. **Reach floor: ≥300K YouTube subscribers** (or ≥300K monthly podcast
   downloads). Set deliberately high — `log10(reach)` weighting means
   sub-300K channels barely move the needle, and a higher floor keeps the
   panel meaningful and the cost contained.
4. **Activity** — publishes ≥1 substantive episode/week, with ≥6 months of
   continuous output.
5. **L/M/R lean assignable** — not so niche that the lean is unclear.
6. **Long-form** — at least most episodes ≥3 minutes (already enforced at
   ingest by `MIN_DURATION_SEC = 180`).

## Sourcing — where candidates come from

Primary mechanism: **YouTube API "Featured Channels"** for each of the current
48 YT channels. The host curates a list of channels they "feature" on their
page — peers, network siblings, friends-of-the-show. It's a *very* high-signal
adjacency signal because the show itself picks them. We pull these for all
48, aggregate, dedup against existing, filter to ≥300K subs, rank by how many
of our 48 endorse each candidate. Tooling lives in `scripts/discover-channels.ts`
(see below).

Secondary:
1. **Apple Podcasts Politics & News top charts** — dedup against the existing
   panel + candidates from YT featured channels.
2. **Editorial seed list** — your own additions; highest signal of all.
3. **Future**: discovery's eventual actor-axis could surface under-covered
   voices the existing 48 talk *about*. Deferred.

Lean balance: **no fixed target — honest imbalance**. Whoever has ≥300K
subscribers and meets the other criteria gets in; we let the data fall where
it falls. The methodology already says alt-media has a structural R-skew in
published reach and that *"the imbalance is the finding, not a bug"* — this
expansion stays consistent with that.

## Onboarding workflow

For each new channel, editorial inputs are:
`name · platform (youtube|podcast) · platform_id · political_lean (L|M|R) · reach (subs or monthly downloads)`.

The flow:

1. **Add to seed config**; run `npm run seed:channels` to upsert into `channels`.
2. **Quiet activation** — channel set `active=true` from day 1, but its
   classifications are visible only after a **7-day observation period** where
   we verify it produces real (non-zero) classify mentions and isn't off-topic
   noise. (Implementation: a simple `channels.observed_since` timestamp + UI
   gate. Light lift.)
3. **Auto-disable rule** — any channel that produces 0 classifications over 14
   consecutive days is flagged for review and toggled `active=false`. Prevents
   the taxonomy from being polluted by broken or non-political channels.

## Phased rollout (recommended)

1. **48 → 75** (add ~27). Validate pipeline keeps up at higher frequency
   crons; watch classify cost trajectory.
2. **75 → 125**. Re-tune cadences if needed (likely hourly classify).
3. **125 → 200**. Final scale; review cost monthly.

Each phase: 1 week of observation between, gating on (a) classify pending
stays bounded, (b) monthly cost projection stays ≤$1k, (c) no spike in
classify failures or 504s.

## Decisions made (2026-05-28)

- ✅ **Reach floor: 300K** (subs or monthly downloads).
- ✅ **Lean balance: honest imbalance** — no fixed target; whoever meets the
  criteria gets in.
- ✅ **Sourcing: lead with YT API "Featured Channels" for the 48** —
  candidate-discovery tool builds the list; you triage.

- ✅ **Cost ceiling: up to $1,000/mo** for ongoing processing. The ~$870/mo
  full-200 estimate fits with room; if per-episode classify cost runs higher
  than $0.04 we can pull the levers (lower `INGEST_PER_CHANNEL` or sample
  high-volume channels) before hitting the cap.

## Future extensions (not for v1)

- **Legacy vs Alternative cohort.** Add a separate panel of legacy/traditional
  media (CNN, Fox, MSNBC, NYT podcasts, etc.) tagged with a `cohort` flag, so
  the Index can be split: "alt-media sentiment on issue X" vs "legacy
  sentiment on issue X". Same pipeline, same taxonomy; only difference is the
  source set. This is the natural way to make the platform's thesis legible
  ("here's where alt and legacy diverge") without polluting the core alt-media
  panel. Schema sketch: `channels.cohort text default 'alt'`; aggregation
  optionally filters/groups by cohort.

## Risks

- **Cost overrun** if average per-episode classify cost is higher than $0.04
  (longer transcripts, more mentions per episode).
- **Quality dilution** — adding lower-reach noisy channels could shift the
  Index toward non-substantive content. The reach-weighted aggregation
  protects against this but not perfectly.
- **Taxonomy stress** — at 200 channels we'll surface more discovery
  candidates; the topic+issue model should hold but worth watching.
- **Anthropic rate limits** — at hourly classify + multi-run transcribe, we'll
  hit the API harder. Worth checking the account's current rate limits.
