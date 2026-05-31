-- Channel cohort: independent vs legacy.
-- Date: 2026-05-31
--
-- Soapbox tracks political discourse on the YouTube + podcast *platform*. Within
-- that platform we distinguish two *cohorts* of channel:
--   - 'independent' — creator / digital-native (Shapiro, TYT, Breaking Points…)
--   - 'legacy'      — traditional institutions' presence on the platform
--                     (MSNBC/MS NOW, Fox News, NPR, PBS, Vox…)
--
-- This is the foundation for the independent-vs-legacy comparison + a blended
-- master Index. Existing channels all default to 'independent'; legacy channels
-- are seeded with cohort='legacy'. Until the comparison UX ships, every public
-- read filters to cohort='independent', so adding this column + legacy channels
-- changes nothing visible.
--
-- Non-political legacy content is not a data-integrity risk: it classifies to
-- zero taxonomy matches → 'no-signal' → no scores → never enters the Index or
-- reach weighting. Curating legacy to politics-heavy channels is a cost /
-- reach-honesty optimization, not a correctness requirement.

alter table channels
  add column if not exists cohort text not null default 'independent'
  check (cohort in ('independent', 'legacy'));

-- Index for cohort-scoped reads (the public site filters channels by cohort).
create index if not exists channels_cohort_idx on channels (cohort);
