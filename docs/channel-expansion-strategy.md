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
2. **Reach floor** — e.g. **≥100K YouTube subscribers** OR ≥100K monthly
   podcast downloads (proxy via PodScan). The reach factor (`log10(reach)`)
   means lower-reach channels barely move the needle anyway.
3. **Activity** — publishes ≥1 substantive episode/week, with ≥6 months of
   continuous output.
4. **L/M/R lean assignable** — not so niche that the lean is unclear.
5. **Long-form** — at least most episodes ≥3 minutes (already enforced at
   ingest by `MIN_DURATION_SEC = 180`).

## Sourcing — where 152 more candidates come from

A pragmatic ladder:

1. **The shows the current 48 already mention** — guests, named competitors,
   network siblings (Daily Wire, MeidasTouch, etc.). Cheap and surfaces the
   actually-influential adjacent voices.
2. **Apple Podcasts Politics & News charts** — top 50 in the US, dedup against
   the current 48.
3. **Editorial seed list** — your own additions. Highest signal.
4. **Discovery-driven** — *future*: once the discovery feature also tracks
   *who* is being talked about (an actor-axis we deferred), it could surface
   under-covered voices. Not for v1 of this expansion.

Lean balance target: roughly mirror alt-media's actual share-of-voice (the
methodology already says it's R-skewed). A reasonable starting target is
**40% R / 40% L / 20% M**, but the *imbalance is itself a finding* per the
methodology — so the target is "honest representation," not artificial parity.

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

## Open questions for you

1. **Reach floor** — is 100K subs / 100K monthly downloads the right bar? Lower
   surfaces longer-tail voices; higher keeps the Index dominated by the loudest.
2. **Lean balance target** — explicit target (e.g., 40/40/20) or "honest
   imbalance" (let the data fall where it falls)?
3. **Source list cap** — how many channels do you want to seed yourself
   editorially, vs. having me draft a candidate list from Apple Podcasts top
   charts + the current 48's mentioned-shows for you to triage?
4. **Cost ceiling** — strict ~$870/mo at full 200, or willing to go to $1k with
   the levers above (lower `INGEST_PER_CHANNEL`, sampling for high-volume)?

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
