/**
 * MCP authentication — dual-mode, during the OAuth migration.
 *
 *  1. OAuth 2.1 (the real path): Supabase Auth is the authorization server.
 *     It issues asymmetric JWTs; we validate them here as a resource server
 *     via JWKS — no shared secret. This is what claude.ai / ChatGPT web
 *     connectors use (discovery → PKCE → bearer JWT).
 *  2. Static keys (legacy): the comma-separated MCP_ACCESS_KEYS bearer keys
 *     issued to demo customers keep working so nothing breaks mid-migration.
 *     Remove this path once everyone's moved to OAuth.
 *
 * Spec: MCP authorization 2025-11-25 — resource server MUST validate the
 * bearer token AND verify it was minted for THIS server (RFC 8707 audience).
 * The audience claim is set by a Supabase Custom Access Token Hook to
 * MCP_RESOURCE_URL; until that hook is configured, the JWT path fails closed
 * (static keys still work). See the dashboard checklist.
 */
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";

import { env } from "@/lib/env";

/** Canonical resource identifier for this MCP server (RFC 8707). Must match
 *  the `audience` the Supabase access-token hook stamps onto tokens. */
export const MCP_RESOURCE_URL =
  process.env.MCP_RESOURCE_URL || "https://www.soapbox.media/api/mcp/mcp";

/** Supabase issues + signs tokens under this issuer; JWKS lives beside it. */
const SUPABASE_ISSUER = `${env.supabaseUrl}/auth/v1`;
export const AUTH_SERVER_URL = SUPABASE_ISSUER;
export const RESOURCE_METADATA_PATH = "/.well-known/oauth-protected-resource";

// Cached remote key set — jose handles fetch + rotation.
const jwks = createRemoteJWKSet(new URL(`${SUPABASE_ISSUER}/.well-known/jwks.json`));

/** The legacy static-key allowlist (comma-separated). Fails closed when unset. */
export function staticKeys(): string[] {
  return (process.env.MCP_ACCESS_KEYS || "").split(",").map((k) => k.trim()).filter(Boolean);
}

export function isStaticKey(token: string | null | undefined): boolean {
  if (!token) return false;
  const keys = staticKeys();
  return keys.length > 0 && keys.includes(token.trim());
}

/**
 * verifyToken for mcp-handler's withMcpAuth. Returns AuthInfo when the bearer
 * token is a valid Supabase OAuth JWT OR a known static key; undefined → 401.
 * Also accepts a static key passed via the legacy `x-api-key` header.
 */
export async function verifyMcpToken(
  req: Request,
  bearerToken?: string,
): Promise<AuthInfo | undefined> {
  const token = bearerToken || req.headers.get("x-api-key")?.trim() || undefined;
  if (!token) return undefined;

  // 1. Legacy static key
  if (isStaticKey(token)) {
    return {
      token,
      clientId: "soapbox-static-key",
      scopes: ["mcp"],
      extra: { auth: "static-key" },
    };
  }

  // 2. Supabase OAuth JWT
  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: SUPABASE_ISSUER,
      audience: MCP_RESOURCE_URL,
    });
    const scopes =
      typeof payload.scope === "string" ? payload.scope.split(" ").filter(Boolean) : ["mcp"];
    return {
      token,
      clientId: (payload.client_id as string) || (payload.azp as string) || "oauth-client",
      scopes,
      expiresAt: payload.exp,
      resource: new URL(MCP_RESOURCE_URL),
      extra: {
        auth: "oauth",
        userId: payload.sub,
        email: (payload.email as string) ?? null,
        // Subscription gating (workstream 2) will read entitlement here.
      },
    };
  } catch {
    return undefined; // invalid/expired/wrong-audience → 401 challenge
  }
}
