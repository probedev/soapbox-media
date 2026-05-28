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
