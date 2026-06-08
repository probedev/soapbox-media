/**
 * OAuth 2.0 Protected Resource Metadata (RFC 9728) for the MCP server.
 * MCP clients (claude.ai, ChatGPT) hit this after a 401 to discover which
 * authorization server (Supabase) to authenticate against. Required by the
 * MCP authorization spec (2025-11-25).
 */
import { protectedResourceHandler, metadataCorsOptionsRequestHandler } from "mcp-handler";

import { AUTH_SERVER_URL, MCP_RESOURCE_URL } from "@/lib/mcp-auth";

export const dynamic = "force-dynamic";

const handler = protectedResourceHandler({
  authServerUrls: [AUTH_SERVER_URL],
  resourceUrl: MCP_RESOURCE_URL,
});

export { handler as GET, metadataCorsOptionsRequestHandler as OPTIONS };
