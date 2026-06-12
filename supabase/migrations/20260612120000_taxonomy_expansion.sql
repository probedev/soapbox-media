-- Taxonomy expansion (2026-06-12): 5 new issues + crypto broadening.
--
-- Found by bucketing the off-taxonomy harvest (discovery_topics) by distinct
-- channel breadth over 90d: durable categories the event-grained /emerging board
-- structurally can't surface. All nest under existing locked topics (no new
-- topic). The two thinnest topics get built out: Economy 2->5 issues, Health
-- 1->2. Classify reads active issues from the DB live, so these light up
-- go-forward immediately; backfill-issues.ts gives them historical data.

-- 1. New issues (active immediately).
insert into issues (slug, name, definition, left_position, right_position, active, topic_slug) values
  ('trade-tariffs', 'Trade & tariffs',
   'Tariffs, trade deals, import and export policy, and trade protectionism.',
   'Tariffs are a regressive tax that raises prices; favor open, rules-based trade.',
   'Tariffs protect American workers and industry; leverage to fix unfair trade.',
   true, 'economy'),
  ('housing', 'Housing & homelessness',
   'Housing costs, supply and zoning, rents, and homelessness.',
   'Build affordable units, tenant protections, and fund homeless services.',
   'Deregulate and cut zoning to boost supply; enforcement-first on encampments.',
   true, 'economy'),
  ('govt-spending', 'Government spending & debt',
   'Federal spending, deficits, the national debt, and budget and shutdown fights.',
   'Deficits are manageable; protect public spending and raise revenue from the wealthy.',
   'Cut spending and waste (DOGE), shrink government, and rein in the national debt.',
   true, 'economy'),
  ('public-health', 'Public health & medical establishment',
   'Vaccines, the FDA and CDC, pharma, chronic disease, and trust in medical authorities (MAHA).',
   'Trust public-health institutions and the scientific consensus; expand preventive care.',
   'Skeptical of pharma and health agencies; medical freedom and the MAHA agenda.',
   true, 'health'),
  ('veterans', 'Veterans & military affairs',
   'Veterans'' care and benefits, the VA, and how the country treats those who served.',
   'Fully fund the VA and expand veterans'' benefits and mental-health care.',
   'VA accountability and private-care options; restore readiness and recruiting.',
   true, 'foreign-policy');

-- 2. Broaden ai-tech to include crypto / digital assets (go-forward only; a
--    widened existing issue can't be cleanly backfilled without duplicating its
--    existing mentions). Existing L/R anchors still apply (regulate vs innovate).
update issues
set name = 'AI, crypto & tech',
    definition = 'AI safety and regulation, crypto and digital assets, antitrust, and platform power.'
where slug = 'ai-tech';

-- 3. Hand housing off to the new issue: drop it from inflation's definition so
--    housing talk routes to `housing` instead of double-counting.
update issues
set definition = 'Cost of living, prices, and wages.'
where slug = 'inflation';
