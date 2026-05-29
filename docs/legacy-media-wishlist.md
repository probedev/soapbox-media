# Legacy / traditional media wishlist

Running list of legacy/traditional-media YouTube channels and podcasts we
*don't* track in the alt-media panel today, kept here so we can spin up a
**Legacy cohort** later for direct alt-vs-legacy sentiment comparison (see
[`channel-expansion-strategy.md`](./channel-expansion-strategy.md) → "Future
extensions"). Add entries as they come up.

The mechanism, when we're ready: a `channels.cohort` column (default `'alt'`),
add these with `cohort='legacy'`, and aggregation/reporting filters or groups by it.

## Cable news & broadcast TV networks

- **CNN** — Anderson Cooper 360, The Lead with Jake Tapper, State of the Union,
  CNN Tonight, The CNN Political Briefing podcast.
- **MSNBC** — Rachel Maddow Show, Morning Joe, Deadline: White House,
  All In with Chris Hayes, The Last Word, Inside with Jen Psaki.
- **Fox News** — The Five, Hannity (TV version), Special Report with Bret Baier,
  Fox News Sunday, Outnumbered.
- **NBC News** — Meet the Press, Nightly News, Today.
- **ABC News** — This Week with George Stephanopoulos, Nightline, Start Here pod.
- **CBS News** — Face the Nation, 60 Minutes, CBS Evening News.
- **PBS NewsHour / Washington Week**.
- **BBC** — Newscast, Americast, BBC News at Ten.

## Newspapers & digital news (podcasts/video divisions)

- **The New York Times** — The Daily *(already in alt panel — leave there;
  decide whether to also list as legacy)*, Ezra Klein Show *(in alt panel)*,
  Hard Fork, The Run-Up, Matter of Opinion.
- **Washington Post** — Post Reports, The Campaign Moment.
- **Wall Street Journal** — The Journal, What's News, Opinion: Free Expression.
- **Politico** — Politico Playbook Daily Briefing, Politico Power Plays.
- **The Atlantic** — Radio Atlantic, The Atlantic Daily, Washington Week (joint
  with PBS).
- **The Economist** — Checks and Balance, The Intelligence, Money Talks.
- **Vox** — Today Explained, The Weeds.
- **Bloomberg** — Bloomberg Daybreak, Big Take DC.

## Public radio

- **NPR** — Up First, NPR Politics Podcast, Throughline, Consider This,
  Morning Edition, All Things Considered, Fresh Air.

## Wire / international

- **Associated Press** — AP Headline News.
- **Reuters** — Reuters World News.
- **France 24, Al Jazeera, Deutsche Welle** — international English-language.

## From Social Blade Top 100 News (US, scraped 2026-05-29)

Pulled from `socialblade.com/youtube/lists/top/100/subscribers/news/US` via
`npm run discover:socialblade`. Each entry includes the YT handle and
subscriber count at scrape time. Names already implicit in earlier sections
(CNN, MSNBC, etc.) aren't repeated here.

### Cable / broadcast networks not yet listed
- **NewsNation** (@newsnation, 2.7M) — newer center-aligned cable network.
- **Newsmax** (@newsmaxtv, 2.6M) — right-leaning cable.
- **Fox Business** (@foxbusiness, 3.4M).
- **CNBC Television** (@cnbctelevision, 3.4M).
- **LiveNOW from FOX** (@livenowfox, 5.6M) — live-event channel.
- **VICE News** (@vicenews, 9.3M) — established digital-native.
- **Inside Edition** (@insideedition, 13.8M) — newsmagazine.

### Digital-native news brands
- **NowThis** (@nowthis, 2.2M) and **NowThis Impact** (@nowthisimpact, 5.0M).
- **Forbes Breaking News** (@forbesbreakingnews, 5.6M).
- **The Hill** (@thehill, 2.1M) — already in NPR-era list; YT presence noted.
- **New York Post** (@nypost, 2.5M).
- **USA TODAY** (@usatoday, 7.5M).
- **Business Insider** (@businessinsider, 10.5M).
- **COURT TV** (@courttv, 2.2M) — specialty / legal news.
- **AJ+** (@ajplus, 2.5M) — Al Jazeera digital arm (parent already listed).

### Local TV affiliates (deprioritize — narrow geo scope)
- **Eyewitness News ABC7NY** (@abc7ny, 2.8M) — NYC.
- **11Alive** (@11alive, 2.7M) — Atlanta.
- **WFAA** (@wfaa8, 2.2M) — Dallas.

### Ambiguous (alt vs legacy?)
- **The Daily Wire** main channel (@dailywire, 3.3M) — Ben Shapiro's parent
  outlet. We already track its individual hosts (Shapiro, Knowles, Walsh) in
  the alt panel; the master channel reposts/aggregates their content, so
  adding it would mostly double-count. Listed here as a placeholder decision.

## Open questions (defer until activation)

- **Does The Daily (NYT) double-count?** It's already in our alt panel — when we
  spin up Legacy, leave it where it is, or move it / mirror it?
- **Cohort granularity** — one `cohort` field (alt/legacy), or finer
  (alt/legacy-broadcast/legacy-print/legacy-radio)? Probably the simple two
  buckets is fine for v1.
- **Subscriber floor for Legacy** — apply the 300K rule? Most legacy shows
  trivially clear it, so it's a no-op.
- **Reach weighting** — legacy shows' reach (broadcast viewership) is much
  larger than podcast subs; mixing them in `reach_factor = log10(reach)` is
  fine because the log dampens the difference, but worth noting.
