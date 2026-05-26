# Two-level taxonomy — design draft

Status: **DRAFT for review** (2026-05-26). Not implemented.

## Terminology (locked for this doc)

- **Topic** — a broad, **locked**, curated bucket (~11). The measurement
  backbone; changes ~never, so the Index stays comparable over time.
- **Issue** — a specific subject within exactly one Topic. The **living** layer:
  the current 16 + whatever discovery adds. Carries the L/R position anchors and
  is what classify matches against. (Keeps "issue" meaning what's on the site
  today; we add Topics *above* issues.)

So: **Topics contain Issues.** Issues contain scored mentions. The headline
Index is unchanged — same scored mentions, now also roll up to a Topic level.

## Why

Today's 16 "issues" are a flat, ad-hoc list that mixes grains and has blind
spots. Splitting into a locked **Topic** layer + a living **Issue** layer:
- keeps the measurement backbone stable (Topics don't churn) while letting
  Issues emerge/fade (where discovery lives);
- gives trends at two grains ("Foreign Policy leaned right, driven by Iran");
- and — see the coverage analysis — exposes whole categories the current
  taxonomy can't even see.

## The locked Topic set (Pew-informed, ~11)

Grounded in the Pew Research "Politics & Policy" taxonomy, which usefully
separates *policy issues* from *actors*, *elections*, *institutions*, and
*political systems*. (Pew is a credible reference, not a gold standard; we adapt
its policy-issue vocabulary and its axis separation.)

| Topic | slug | Pew lineage |
|---|---|---|
| Foreign Policy & National Security | `foreign-policy` | International Affairs, War & Conflict, Terrorism, Military & Veterans, Nuclear |
| Economy & Work | `economy` | Economy & Work, National Conditions |
| Immigration | `immigration` | Immigration & Migration |
| Health Care | `health` | Health Policy, Social Security & Medicare, COVID |
| Crime, Guns & Drugs | `crime-safety` | Criminal Justice, Gun Policy, Drug Policy, Death Penalty |
| Civil Rights & Identity | `civil-rights` | Abortion, LGBT, Discrimination & Prejudice (race/gender) |
| Education | `education` | Education |
| Elections & Democracy | `elections-democracy` | Elections, Voters & Voting, Democracy, Trust in Govt |
| Government & Rule of Law | `rule-of-law` | Federal Government, Congress, Supreme Court, institutions |
| Tech, Media & Speech | `tech-media` | Technology Policy, Free Speech & Press, Privacy, Politics & Media |
| Climate, Energy & Environment | `climate-energy` | Climate, Energy & Environment |

Plus an **orthogonal actor axis** (Pew's "Leaders") — *not* a Topic. See below.

## How today's 16 issues map — and the coverage gaps

| Topic | Current issues mapped in | Count |
|---|---|---|
| Foreign Policy & National Security | Iran, Ukraine, China, Israel–Gaza | **4 — overloaded** |
| Civil Rights & Identity | Abortion, Transgender/LGBTQ | 2 |
| Tech, Media & Speech | AI policy, Free speech | 2 |
| Economy & Work | Inflation | 1 |
| Immigration | Immigration | 1 |
| Crime, Guns & Drugs | Crime *(no guns, no drugs)* | 1 (thin) |
| Education | Education/DEI | 1 |
| Elections & Democracy | Election integrity | 1 |
| Climate, Energy & Environment | Climate | 1 |
| **Health Care** | — | **0 — EMPTY** |
| **Government & Rule of Law** | — | **0 — EMPTY** |
| *(Actor axis — not a Topic)* | Trump/GOP, Democratic leadership | *2 — not issues* |

**Findings:**
- **Two empty Topics**: Health Care and Government & Rule of Law — both major in
  real discourse. Rule of Law being empty is exactly why the DOJ
  "anti-weaponization fund" had nowhere to land. **Classify is blind to these.**
- **Thin Topics**: Crime has no Gun Policy / Drug Policy; Civil Rights has no
  Race/Discrimination issue.
- **Overloaded**: Foreign Policy holds 4 of 16 — partly real (alt-media is
  foreign-policy-heavy), partly a granularity bias toward what we already track.
- **Two of the 16 aren't issues at all** (Trump/GOP, Dem leadership) → actors.

## Decisions

1. **L/R positions stay at the Issue level** (no change — issues already carry
   them). Topics have no L/R; Topic lean is a reach×intensity-weighted aggregate
   of its issues, same math as the Index.
2. **Actor dimension.** v1: park Trump/GOP + Dem leadership as issues under a
   stopgap (or simply leave them as-is, untyped). Proper fix later: an orthogonal
   `actor` field on classifications ("who is this about") cutting across topics.
   Pew validates treating leaders as a separate axis. Deferred.
3. **Classify matches Issues** (granular), loading the *active* issue set —
   exactly as today, just a longer list once we broaden coverage. Anything
   substantive matching no active issue → off-taxonomy harvest → discovery.

## Schema (sketch) — smaller than it first looked

Because Issues stay the granular L/R-bearing layer, **classifications don't
change** and **nothing is re-tagged**. We only add a Topic layer above.

```sql
create table topics (
  slug text primary key,
  name text not null,
  description text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

alter table issues add column topic_slug text references topics(slug);
-- issues otherwise unchanged: slug, name, definition, left/right_position, active
-- classifications.issue_slug: UNCHANGED
```

RLS on, no policies (service-role only) per convention. `discovery_candidates`
gains `assigned_topic_slug`; promoting a candidate creates a new **issue** under
that topic.

## Migration plan (phased; Index value never moves)

1. **Topics layer.** Create `topics`, seed the ~11, add `issues.topic_slug`,
   assign the current 16 (deterministic). No classification or Index change.
2. **Read path.** `aggregate.ts` rolls issue → topic; add topic-level breakdown
   + issue→topic→channel drill-down in the UI. Index identical; new grains shown.
3. **Discovery integration.** Promote = new issue under a chosen topic (admin
   picks topic + writes L/R). Locked Topic layer never touched.
4. **(Actor axis, later.)** Add `classifications.actor` + reporting.

## First win this unlocks: broaden classify coverage

The Topic set is a **coverage checklist**. The empty/thin Topics show classify
can't currently see Health, Rule of Law, Guns, Drugs, or Race. Closing those is
the highest-value follow-on — see the separate classify-broadening plan below.

---

# Classify-broadening plan

Goal: classify currently detects only the 16 issues, so whole Topics
(Health, Rule of Law) and sub-areas (Guns, Drugs, Race) are invisible — their
mentions vanish or get mislabeled, biasing the Index. Fix = **add granular
issues for the gaps**, each with L/R anchors and a parent Topic, so classify
(which loads the active issue set) starts detecting them.

## Candidate new issues (gap-filling)

Drafts — L/R anchors need a careful editorial pass before shipping:

| New issue | Topic | Left anchor (sketch) | Right anchor (sketch) |
|---|---|---|---|
| Health care & coverage | Health | Expand public coverage / lower drug prices via govt | Market-based, repeal mandates, less federal role |
| Social Security & Medicare | Health (or Economy) | Protect/expand benefits | Reform/means-test/privatize for solvency |
| Politicized justice / rule of law | Rule of Law | Trump politicizing DOJ; threat to rule of law | DOJ was weaponized vs. conservatives; needs cleanup |
| Government corruption & institutions | Rule of Law | Self-dealing/oligarchy concerns | Deep-state/unaccountable-bureaucracy concerns |
| Gun policy | Crime, Guns & Drugs | Stronger gun control/restrictions | 2A rights; oppose restrictions |
| Drug policy | Crime, Guns & Drugs | Decriminalize / treatment / harm reduction | Enforcement; border-fentanyl crackdown |
| Race & discrimination | Civil Rights & Identity | Systemic racism; anti-discrimination | Colorblind; anti-DEI; reverse-discrimination concerns |

Note overlaps to avoid: "Race & discrimination" vs the existing "Education/DEI"
issue — keep DEI scoped to education/culture, race to discrimination broadly.

## Sequencing & considerations

1. **Depends on the Topics layer** (Phase 1 above) so each new issue gets a
   parent Topic. Could ship flat first, but cleaner with Topics.
2. **L/R anchors are the careful part.** These are the framing every score is
   measured against. Draft → editorial review → (eventually) validate against
   the gold set, same bar as existing scoring calibration.
3. **Prospective by default.** Adding issues only affects *future* classify
   runs; past episodes were `classify_status='processed'` and won't be
   re-examined. To get history, a **bounded re-classify backfill** over recent
   transcripts that inserts ONLY the new issues' classifications (reusing the
   harvest-only backfill pattern from discovery, so existing classifications
   aren't duplicated). Cost ≈ Sonnet × episodes.
4. **Prompt size.** Goes from 16 → ~23 issues; still fine. Cap to *active*
   issues as the set grows.
5. **Validation.** After broadening, re-run the discovery harvest — fewer
   off-taxonomy topics should fall into the now-covered areas (a check that the
   gaps actually closed).
