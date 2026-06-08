/**
 * Soapbox v2 LOCKED channel seed list - 42 channels (17 L / 7 M / 18 R).
 *
 * Source of truth lives in /CHANNELS.md at the repo root. This file is the
 * programmatic mirror used by the seed-channels script.
 *
 * For each channel:
 *  - youtubeHandle: e.g. "@MeidasTouch" - used with YT Data API forHandle param
 *  - podcastSearchName: PodScan search query (we pick the top match by title)
 *  - "both" platform channels have both fields populated and get TWO rows in
 *    the channels table (one per platform).
 */

export type Lean = "L" | "M" | "R";

export interface SeedChannel {
  name: string;
  lean: Lean;
  youtubeHandle?: string;
  podcastSearchName?: string;
  /**
   * Explicit PodScan podcast ID. When set, bypasses name-based search so we
   * don't regress to a stale or wrong feed. Use this for high-importance
   * channels where a misresolution would damage data quality.
   */
  podscanPodcastId?: string;
  /** Approximate reach from training data; replaced by live API values at seed time. */
  reachEstimate: number;
  rationale: string;
}

export const SEED_CHANNELS: SeedChannel[] = [
  // ─── L - Left (21) ─────────────────────────────────────────────────
  { name: "Pod Save America", lean: "L", podcastSearchName: "Pod Save America", reachEstimate: 1_000_000, rationale: "Flagship Democratic-adjacent podcast; ex-Obama staffers" },
  { name: "The Daily (NYT)", lean: "L", podcastSearchName: "The Daily Michael Barbaro", reachEstimate: 4_000_000, rationale: "Center-left institutional; sets daily mainstream agenda" },
  { name: "MeidasTouch Network", lean: "L", youtubeHandle: "@MeidasTouch", reachEstimate: 3_000_000, rationale: "Highest-volume L YouTube; political news + Trump opposition" },
  { name: "The Young Turks", lean: "L", youtubeHandle: "@TheYoungTurks", reachEstimate: 5_600_000, rationale: "Progressive flagship YT; daily news commentary" },
  { name: "Brian Tyler Cohen", lean: "L", youtubeHandle: "@briantylercohen", reachEstimate: 3_000_000, rationale: "Pure-play Democratic L YT commentator" },
  { name: "David Pakman Show", lean: "L", youtubeHandle: "@thedavidpakmanshow", reachEstimate: 2_000_000, rationale: "L progressive YT; daily commentary" },
  { name: "Pivot", lean: "L", podcastSearchName: "Pivot Kara Swisher", reachEstimate: 500_000, rationale: "Center-left tech/politics (Kara Swisher + Scott Galloway)" },
  { name: "Explain It to Me (Vox)", lean: "L", podcastSearchName: "Explain It to Me", reachEstimate: 200_000, rationale: "L policy-wonk show. Successor to Vox's The Weeds (ended 2023); now hosted by Jonquilyn Hill" },
  { name: "Strict Scrutiny", lean: "L", podcastSearchName: "Strict Scrutiny", reachEstimate: 150_000, rationale: "L legal commentary; SCOTUS-focused" },
  { name: "Zeteo (Mehdi Hasan)", lean: "L", youtubeHandle: "@zeteo", reachEstimate: 1_000_000, rationale: "Progressive-left; post-MSNBC, crossed 1M subs in 18 months" },
  { name: "Raging Moderates", lean: "L", podcastSearchName: "Raging Moderates Jessica Tarlov", reachEstimate: 200_000, rationale: "Jessica Tarlov + Adrienne Elrod (MeidasTouch); L bridge-to-center voice" },
  { name: "Destiny", lean: "L", youtubeHandle: "@Destiny", reachEstimate: 1_000_000, rationale: "Steven Bonnell - debate-heavy L, heterodox; engages R figures directly" },
  { name: "The Don Lemon Show", lean: "L", youtubeHandle: "@TheDonLemonShow", reachEstimate: 300_000, rationale: "Post-CNN independent; L mainstream voice" },
  { name: "Adam Mockler", lean: "L", youtubeHandle: "@adammockler", reachEstimate: 750_000, rationale: "Gen-Z progressive; rapid-response political video" },
  { name: "The Majority Report w/ Sam Seder", lean: "L", youtubeHandle: "@themajorityreport", podcastSearchName: "The Majority Report Sam Seder", reachEstimate: 1_000_000, rationale: "Established L progressive show; daily long-form" },
  { name: "Secular Talk (Kyle Kulinski)", lean: "L", youtubeHandle: "@SecularTalk", reachEstimate: 1_000_000, rationale: "L progressive YT; daily uploads, debate-friendly" },
  { name: "The Ezra Klein Show", lean: "L", podcastSearchName: "The Ezra Klein Show", reachEstimate: 500_000, rationale: "NYT institutional-L intellectual; elite L discourse" },
  { name: "More Perfect Union", lean: "L", youtubeHandle: "@MorePerfectUnion", reachEstimate: 700_000, rationale: "Labor-progressive economic populism; daily long-form video; fast-growing" },
  { name: "Democracy Now!", lean: "L", youtubeHandle: "@democracynow", podcastSearchName: "Democracy Now Amy Goodman", reachEstimate: 800_000, rationale: "Amy Goodman; daily L progressive news; long-form interviews" },
  { name: "Heather Cox Richardson", lean: "L", podcastSearchName: "Now and Then Heather Cox Richardson", reachEstimate: 500_000, rationale: "L historian; daily Letters from an American + podcast; substantive context" },
  { name: "Aaron Parnas", lean: "L", youtubeHandle: "@AaronParnas", reachEstimate: 800_000, rationale: "Gen Z L rapid-response political video; cross-platform reach" },

  // ─── M - Middle / cross-cutting (8) ────────────────────────────────
  { name: "The Joe Rogan Experience", lean: "M", podcastSearchName: "Joe Rogan Experience", podscanPodcastId: "pd_w2lvjeen4w4jzax3", reachEstimate: 14_500_000, rationale: "Largest single voice in alt-media; non-partisan posture, R-curious content" },
  { name: "Lex Fridman Podcast", lean: "M", youtubeHandle: "@lexfridman", podcastSearchName: "Lex Fridman Podcast", reachEstimate: 4_500_000, rationale: "Long-form interviews; broadly non-partisan, contrarian-friendly" },
  { name: "Honestly with Bari Weiss", lean: "M", podcastSearchName: "Honestly with Bari Weiss", reachEstimate: 500_000, rationale: "Anti-woke; center-right but heterodox" },
  { name: "The Bulwark Podcast", lean: "M", podcastSearchName: "The Bulwark Podcast", reachEstimate: 300_000, rationale: "Anti-Trump conservative; cultural M-to-L lean" },
  { name: "All-In Podcast", lean: "M", youtubeHandle: "@allin", podcastSearchName: "All-In with Chamath Jason Sacks Friedberg", reachEstimate: 900_000, rationale: "Tech/political quartet (Sacks-Chamath-Friedberg-Calacanis); drifted R 2024+" },
  { name: "Triggernometry", lean: "M", youtubeHandle: "@triggerpod", reachEstimate: 750_000, rationale: "UK hosts; heterodox/anti-woke, center-right by US standards" },
  { name: "Breaking Points", lean: "M", youtubeHandle: "@BreakingPoints", podcastSearchName: "Breaking Points Krystal Saagar", reachEstimate: 1_500_000, rationale: "Krystal Ball (L) + Saagar Enjeti (R-populist); explicit heterodox bridge show" },
  { name: "Call Me Back with Dan Senor", lean: "M", podcastSearchName: "Call Me Back Dan Senor", reachEstimate: 300_000, rationale: "Center-right foreign policy; Israel focus; high-quality, contrarian-friendly" },

  // ─── R - Right (21) ────────────────────────────────────────────────
  { name: "The Ben Shapiro Show", lean: "R", youtubeHandle: "@benshapiro", podcastSearchName: "The Ben Shapiro Show", podscanPodcastId: "pd_w6go3jmkpag52la7", reachEstimate: 7_000_000, rationale: "Most-influential R podcast; intellectual conservatism" },
  { name: "Timcast IRL (Tim Pool)", lean: "R", youtubeHandle: "@Timcast", reachEstimate: 1_500_000, rationale: "Populist-right news + commentary; nightly live" },
  { name: "Tucker Carlson Network", lean: "R", youtubeHandle: "@TuckerCarlson", reachEstimate: 5_000_000, rationale: "Post-Fox direct-to-audience; populist nationalist" },
  { name: "The Charlie Kirk Show", lean: "R", youtubeHandle: "@RealCharlieKirk", podcastSearchName: "The Charlie Kirk Show", reachEstimate: 3_500_000, rationale: "Conservative student-movement adjacent; daily. NOTE: search results reference Kirk's death - channel status post-event needs verification before we publish methodology" },
  { name: "Louder with Crowder", lean: "R", youtubeHandle: "@stevencrowder", reachEstimate: 6_000_000, rationale: "Right-populist comedy + commentary" },
  { name: "The Matt Walsh Show", lean: "R", youtubeHandle: "@mattwalsh", podcastSearchName: "The Matt Walsh Show", reachEstimate: 2_500_000, rationale: "Hard-right cultural commentary; trans/gender focus. Note: show is Daily Wire+ exclusive since 2023; YT channel hosts clips + back catalog" },
  { name: "Candace Owens", lean: "R", youtubeHandle: "@RealCandaceO", reachEstimate: 6_000_000, rationale: "Independent post-Daily Wire; populist-right, anti-establishment" },
  { name: "The PBD Podcast", lean: "R", youtubeHandle: "@PBDPodcast", reachEstimate: 2_500_000, rationale: "Patrick Bet-David; R-leaning business + politics" },
  { name: "The Megyn Kelly Show", lean: "R", youtubeHandle: "@MegynKelly", podcastSearchName: "The Megyn Kelly Show", reachEstimate: 3_500_000, rationale: "R-coded post-Tucker feud; large cross-cutting audience" },
  { name: "Morning Wire (Daily Wire)", lean: "R", podcastSearchName: "Morning Wire Daily Wire", reachEstimate: 500_000, rationale: "Daily news podcast; R-framing" },
  { name: "Bannon's War Room", lean: "R", podcastSearchName: "Bannon's War Room", reachEstimate: 1_000_000, rationale: "MAGA-right; populist nationalist. Ingest via Rumble/RSS feed." },
  { name: "The Glenn Beck Program", lean: "R", podcastSearchName: "The Glenn Beck Program", reachEstimate: 5_000_000, rationale: "Veteran conservative talk" },
  { name: "The Mark Levin Show", lean: "R", podcastSearchName: "The Mark Levin Show", reachEstimate: 7_000_000, rationale: "Legal-conservative; Trump-aligned" },
  { name: "The Dan Bongino Show", lean: "R", podcastSearchName: "The Dan Bongino Show", reachEstimate: 3_000_000, rationale: "Daily R commentary; MAGA-aligned" },
  { name: "The Sean Hannity Show", lean: "R", podcastSearchName: "The Sean Hannity Show", reachEstimate: 1_500_000, rationale: "Veteran R talk; Trump-aligned" },
  // The Dinesh D'Souza Podcast - excluded v2.1 (not indexed by PodScan as of 2026-05-11); revisit when we find his canonical PodScan name or a direct RSS URL
  { name: "Triggered with Don Jr.", lean: "R", podcastSearchName: "Triggered Donald Trump Jr", reachEstimate: 500_000, rationale: "Populist-R direct-to-base; growing in 2026 cycle. Primarily on Rumble; no canonical YT channel - track via podcast feed only" },
  { name: "Verdict with Ted Cruz", lean: "R", podcastSearchName: "Verdict with Ted Cruz", reachEstimate: 500_000, rationale: "Sitting senator's pod; R messaging-machine output" },
  { name: "Shawn Ryan Show", lean: "R", youtubeHandle: "@ShawnRyanShow", podcastSearchName: "Shawn Ryan Show", reachEstimate: 5_000_000, rationale: "Former Navy SEAL; military/intel/conspiracy-curious; major R alt-media voice; fast-growing" },
  { name: "The Rubin Report", lean: "R", youtubeHandle: "@RubinReport", podcastSearchName: "The Rubin Report", reachEstimate: 1_600_000, rationale: "Dave Rubin; libertarian-R; veteran independent podcast" },
  { name: "Hodgetwins", lean: "R", youtubeHandle: "@hodgetwins", reachEstimate: 3_000_000, rationale: "Keith and Kevin Hodge; R-populist comedy commentary; large reach" },
  { name: "Real America's Voice (RAV)", lean: "R", youtubeHandle: "@RealAmericasVoice", reachEstimate: 1_500_000, rationale: "Right-populist network channel; hosts Bannon's War Room + other shows; YT ingest covers Bannon content that PodScan doesn't transcribe" },
];
