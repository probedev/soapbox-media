/**
 * Public MCP server - lets external AI agents (campaign managers, media
 * buyers, consultants) query Soapbox data: the Index, issue trends, channel
 * stances, and mention-level quotes with sources.
 *
 * Transport: Streamable HTTP at POST /api/mcp/mcp (SSE transport is not
 * enabled - it would need Redis; modern MCP clients use streamable HTTP).
 *
 * Auth: DUAL-MODE during the OAuth migration -
 *   1. OAuth 2.1 (real): Supabase-issued JWTs validated as a resource server
 *      (RFC 9728 discovery via /.well-known/oauth-protected-resource → PKCE →
 *      bearer JWT). This is the claude.ai / ChatGPT web-connector path.
 *   2. Static keys (legacy): MCP_ACCESS_KEYS bearer/x-api-key allowlist still
 *      works so existing demo customers aren't broken. Both flow through
 *      verifyMcpToken; the static fast-path below skips the OAuth challenge
 *      for x-api-key callers.
 *
 * Data policy: full transcripts are NEVER exposed (licensing + house rule) -
 * mention-level supporting quotes with episode source links only. All tools
 * are read-only via the service client; RLS posture unchanged.
 */
import { createMcpHandler, withMcpAuth } from "mcp-handler";
import type { Implementation } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { getDashboardData, getIssueDrillDown, getChannelDrillDown, getPanelStats, readHomeSnapshot } from "@/lib/aggregate";
import { searchMentions, issueTrend, listIssues, listChannels } from "@/lib/mcp-data";
import { verifyMcpToken, isStaticKey, RESOURCE_METADATA_PATH } from "@/lib/mcp-auth";
import { VERSION } from "@/lib/version";

export const maxDuration = 60;

// Canonical public origin (matches the Stripe/auth helpers). Used to build the
// absolute, unauthenticated icon URL advertised in `serverInfo` so MCP clients
// (claude.ai connector list, etc.) can render the Soapbox crate mark instead of
// a generic globe. The asset lives at public/mcp-icon.png and is not gated by
// middleware (only /admin/* is), so it is fetchable without credentials.
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://www.soapbox.media";

// Returned in the `initialize` response. Per the MCP Implementation schema
// (SDK 1.26.0) `icons` + `websiteUrl` let clients brand the connector. Typed as
// Implementation (a superset of mcp-handler's narrow serverInfo type) so the
// extra fields type-check and still pass through to McpServer at runtime.
const SERVER_INFO: Implementation = {
  name: "soapbox-media",
  version: VERSION,
  websiteUrl: SITE_URL,
  icons: [
    { src: `${SITE_URL}/mcp-icon.png`, mimeType: "image/png", sizes: ["256x256"] },
  ],
};

const json = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 1) }],
});

// Prefer the precomputed dashboard_snapshot for the default 7-day window - an
// indexed single-row read (~sub-100ms) instead of getDashboardData's full
// paginated deep-join + rolling-sparkline recompute (~10s, the cause of the
// slow get_index/get_movers tool calls). The website home page already does
// this; the MCP tools now match it. Non-default windows still compute live.
async function dashboardFor(windowDays: number) {
  if (windowDays === 7) {
    const snap = await readHomeSnapshot(7).catch(() => null);
    if (snap?.dashboard) return snap.dashboard;
  }
  return getDashboardData(windowDays);
}

const handler = createMcpHandler(
  (server) => {
    server.tool(
      "get_index",
      "The Soapbox Index: a reach- and intensity-weighted left/right needle (-10 = fully left-aligned, +10 = fully right-aligned) summarizing what tracked political channels (independent creators and legacy media) are saying, over a trailing window. Returns the index, delta vs the prior same-length window, a daily-rolling sparkline, and top issues by mention volume.",
      { window_days: z.number().int().min(1).max(90).default(7).describe("Trailing window in days (7 = site default)") },
      async ({ window_days }) => {
        const d = await dashboardFor(window_days);
        return json({
          as_of: d.asOfDate, window_days: d.windowDays, index: d.index, delta: d.delta,
          sparkline: d.sparkline, sparkline_dates: d.sparklineDates,
          top_issues: d.issues, panel: { channels: d.numChannels, episodes: d.numEpisodes, scored_mentions: d.numClassifications },
        });
      },
    );

    server.tool(
      "get_movers",
      "Issues with the biggest period-over-period change - either lean swing (which direction the conversation moved) or mention-volume swing (what got loud/quiet). Eligibility floors filter out thin-sample noise.",
      { window_days: z.number().int().min(1).max(90).default(7).describe("Trailing window in days; compared against the same-length window immediately prior") },
      async ({ window_days }) => {
        const d = await dashboardFor(window_days);
        return json({ as_of: d.asOfDate, window_days: d.windowDays, movers: d.movers });
      },
    );

    server.tool(
      "list_issues",
      "The issue taxonomy: every tracked issue with its slug, definition, and the canonical left/right positions used for scoring, grouped under locked topic slugs. Call this first to get valid issue_slug values for other tools.",
      {},
      async () => json(await listIssues()),
    );

    server.tool(
      "list_channels",
      "The channel panel: every tracked show (YouTube + podcast) with id, editorial lean (L/M/R), cohort (independent alt-media vs legacy mainstream), and estimated audience reach. Call this to get channel_id values for other tools.",
      {},
      async () => json(await listChannels()),
    );

    server.tool(
      "get_issue_detail",
      "Drill into one issue: per-channel contribution ranking for the current week - which shows are driving the conversation on this issue and from which side.",
      { issue_slug: z.string().describe("Issue slug from list_issues") },
      async ({ issue_slug }) => {
        const d = await getIssueDrillDown(issue_slug);
        return json(d ?? { error: `unknown issue_slug: ${issue_slug}` });
      },
    );

    server.tool(
      "get_channel_detail",
      "Drill into one channel: its issue mix and stance profile - what this show talks about and how it leans per issue.",
      { channel_id: z.string().uuid().describe("Channel UUID from list_channels") },
      async ({ channel_id }) => {
        const d = await getChannelDrillDown(channel_id);
        return json(d ?? { error: `unknown channel_id: ${channel_id}` });
      },
    );

    server.tool(
      "search_mentions",
      "Search scored issue mentions - each result is a verbatim quote (excerpt) from an episode with its sentiment score (-5 = left-aligned framing, +5 = right-aligned framing), intensity (1-5), issue, channel, and a source link to the full episode. For most YouTube mentions, start_ts gives the quote's start in the episode (whole seconds) and timestamp_url is a deep link that opens the video at that moment; start_ts is null (and timestamp_url falls back to the plain episode link) for podcasts and quotes that couldn't be located. Filter by issue, channel, lean, cohort, platform, date range, sentiment range, or keyword within the quote. Results are ordered by scoring recency, NOT publish date - use published_after/published_before to control the time window. Full transcripts are not available through this API; quotes + source links only.",
      {
        issue_slug: z.string().optional().describe("Filter to one issue (from list_issues)"),
        channel_id: z.string().uuid().optional().describe("Filter to one channel (from list_channels)"),
        lean: z.array(z.enum(["L", "M", "R"])).optional().describe("Filter by channel editorial lean"),
        cohort: z.enum(["independent", "legacy"]).optional().describe("independent = creator / digital-native (alt-media) cohort; legacy = traditional media. The headline Index blends both; filter to one to scope results."),
        platform: z.enum(["youtube", "podcast"]).optional(),
        published_after: z.string().optional().describe("ISO date - episodes published on/after"),
        published_before: z.string().optional().describe("ISO date - episodes published on/before"),
        sentiment_min: z.number().min(-5).max(5).optional(),
        sentiment_max: z.number().min(-5).max(5).optional(),
        quote_contains: z.string().optional().describe("Case-insensitive substring match within the quote text"),
        limit: z.number().int().min(1).max(50).default(20),
        offset: z.number().int().min(0).default(0).describe("Pagination offset"),
      },
      async (args) => json(await searchMentions(args)),
    );

    server.tool(
      "get_issue_trend",
      "Weekly time series for one issue: mention volume, average sentiment (-5 left to +5 right), and average intensity per UTC week. Use for trajectory questions ('how has the conversation on X moved?').",
      {
        issue_slug: z.string().describe("Issue slug from list_issues"),
        window_days: z.number().int().min(7).max(365).default(90),
        cohort: z.enum(["independent", "legacy"]).optional().describe("Omit for both cohorts"),
      },
      async ({ issue_slug, window_days, cohort }) => json(await issueTrend(issue_slug, window_days, cohort)),
    );

    server.tool(
      "get_methodology",
      "How Soapbox works: pipeline, scoring scale, weighting, calibration, and current panel statistics. Cite this when presenting numbers to stakeholders.",
      {},
      async () => {
        const stats = await getPanelStats();
        return json({
          version: VERSION,
          pipeline: "Episodes from tracked YouTube channels and podcasts are transcribed, classified against a two-level issue taxonomy (locked topics over living issues) by Claude Sonnet with verbatim supporting quotes, then each mention is scored by Claude Haiku.",
          sentiment_scale: "Per-mention sentiment: -5.0 (strongly left-aligned framing) to +5.0 (strongly right-aligned framing), with intensity 1-5 for how forcefully the position is held.",
          index: "The Soapbox Index (-10..+10) aggregates mention sentiment weighted by sqrt(channel reach) x intensity over a trailing window. The headline Index blends both cohorts (independent creators + legacy media); the home page also shows a per-cohort sub-needle for each on its own.",
          calibration: "Scores are validated against a human-labeled gold set; humans calibrate and validate, the model measures at scale. Sentiment distribution is bimodal by design (positions cluster left/right).",
          reach_caveat: "Podcast audience estimates are editorial (reviewed at panel-add time); YouTube subscriber counts refresh daily.",
          transcript_policy: "Full transcripts are never republished or exposed via this API - verbatim excerpts with episode source links only.",
          panel: stats,
        });
      },
    );
  },
  {
    serverInfo: SERVER_INFO,
  },
  {
    basePath: "/api/mcp",
    maxDuration: 60,
    disableSse: true,
  },
);

// Spec-compliant OAuth wrapper: validates Supabase JWTs (and static keys) via
// verifyMcpToken, and on failure emits the RFC 9728 401 challenge pointing at
// the protected-resource metadata so MCP clients can discover Supabase and run
// the OAuth flow.
const authedHandler = withMcpAuth(handler, verifyMcpToken, {
  required: true,
  resourceMetadataPath: RESOURCE_METADATA_PATH,
  // Entitlement gate: verifyMcpToken grants `mcp` only to subscribers (or
  // everyone while MCP_OPEN_BETA is on). Non-entitled users → 403.
  requiredScopes: ["mcp"],
});

// Legacy x-api-key callers bypass the OAuth challenge (they have no bearer
// token to trigger discovery); everything else - Bearer JWT or Bearer static
// key - goes through the spec path. Once all demo users migrate to OAuth this
// fast-path and the static-key branch in verifyMcpToken can be deleted.
const route = (req: Request) => {
  if (isStaticKey(req.headers.get("x-api-key"))) return handler(req);
  return authedHandler(req);
};

export { route as GET, route as POST, route as DELETE };
