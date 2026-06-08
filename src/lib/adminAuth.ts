/**
 * Admin auth shared between the edge middleware and the (node) login action.
 * A correct password sets an httpOnly cookie holding a SHA-256 hash of
 * ADMIN_PASSWORD (not the password itself); middleware re-derives the hash and
 * compares. Stateless - no session store. Uses Web Crypto so it runs in both
 * the edge and node runtimes.
 */
export const ADMIN_COOKIE = "sb_admin";

async function sha256Hex(s: string): Promise<string> {
  const data = new TextEncoder().encode(s);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The expected cookie value for the current ADMIN_PASSWORD, or null if unset. */
export async function adminToken(): Promise<string | null> {
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw) return null;
  return sha256Hex(pw);
}
