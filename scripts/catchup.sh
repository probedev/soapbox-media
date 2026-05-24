#!/usr/bin/env bash
#
# Full pipeline catch-up — drains the entire backlog in one unattended run.
#
# Runs the four pipeline stages in order, looping each one until its queue
# is empty:
#   1. ingest    — top up recent episodes across ALL active channels
#   2. transcribe — fetch YT captions via Supadata for every pending episode
#   3. classify   — extract issue mentions from every new transcript (Sonnet)
#   4. score      — sentiment + intensity for every new mention (Haiku)
#
# Each looped stage stops as soon as its script reports an empty queue, so
# the script self-terminates when the backlog is drained — no babysitting.
#
# Usage:
#   bash scripts/catchup.sh
#
# Safe to re-run: every stage is idempotent (skips already-processed rows).
# Cost: transcribe = Supadata credits (cheap); classify = Sonnet (the pricey
# one, ~$0.05/episode); score = Haiku (cheap). A full 8-day drain is roughly
# $15-35, dominated by classify.

# NOTE: intentionally NOT using `set -e`. The npm scripts handle per-item
# failures internally and exit 0; a transient API blip on one batch should
# not abort the whole overnight run.

cd "$(dirname "$0")/.." || exit 1

# Per-batch limits and a max-iteration safety bound per stage.
#
# The MAX values are a hard backstop against a non-converging loop. On
# 2026-05-24 a dedup bug in classify.ts (since fixed) let the classify loop
# reprocess the same episodes ~95× — CLASSIFY_MAX was 120, so it ran for 10
# hours and ~$180 before being caught by hand. These caps are now sized just
# above the real backlog so a future logic bug self-terminates fast and cheap.
# We currently have <700 transcripts total, so no stage should need anywhere
# near these counts; hitting a cap means "something is wrong, stop and look."
TRANSCRIBE_BATCH=100;  TRANSCRIBE_MAX=20   # 2000 episodes
CLASSIFY_BATCH=25;     CLASSIFY_MAX=40     # 1000 episodes
SCORE_BATCH=200;       SCORE_MAX=40        # 8000 mentions

# Ingest coverage: all active channels, 10 episodes each (covers the gap for
# channels that publish more than once a day).
INGEST_CHANNELS=60
INGEST_PER_CHANNEL=10

log()  { printf '\n\033[1;36m%s\033[0m\n' "$*"; }
rule() { printf '%s\n' "────────────────────────────────────────────────────────────"; }

# drain <npm-script> <batch-limit> <max-iterations> <drained-regex>
# Loops the stage until its output matches the "queue empty" sentinel.
drain() {
  local name="$1" limit="$2" max="$3" sentinel="$4"
  local i=1
  while [ "$i" -le "$max" ]; do
    log "▶ ${name} — batch ${i} (limit ${limit})"
    local out
    out="$(npm run "$name" -- "$limit" 2>&1)"
    echo "$out"
    if echo "$out" | grep -qiE "$sentinel"; then
      log "✓ ${name} queue drained."
      return 0
    fi
    i=$((i + 1))
  done
  log "⚠ ${name} hit max ${max} batches without draining — re-run catchup.sh to continue."
}

START_TS="$(date)"
rule
log "Soapbox full catch-up — started ${START_TS}"
rule

# ── 1. Ingest (single pass — discovers new episodes) ──────────────────────
log "▶ ingest — ${INGEST_CHANNELS} channels × ${INGEST_PER_CHANNEL} episodes"
npm run ingest -- "$INGEST_CHANNELS" "$INGEST_PER_CHANNEL"

# ── 2. Transcribe (drain) ─────────────────────────────────────────────────
drain transcribe "$TRANSCRIBE_BATCH" "$TRANSCRIBE_MAX" "still pending: 0|No pending episodes"

# ── 3. Classify (drain) ───────────────────────────────────────────────────
drain classify "$CLASSIFY_BATCH" "$CLASSIFY_MAX" "Nothing to do|already classified"

# ── 4. Score (drain) ──────────────────────────────────────────────────────
drain score "$SCORE_BATCH" "$SCORE_MAX" "Nothing to do|already scored"

rule
log "Catch-up complete. Started ${START_TS}, finished $(date)."
rule
