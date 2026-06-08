/**
 * Returns the logged-in user's subscription entitlement (for /account).
 * Auth: Supabase access token in the Authorization header.
 */
import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { env } from "@/lib/env";
import { getEntitlement, isOpenBeta } from "@/lib/entitlements";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  const supa = createClient(env.supabaseUrl, env.supabaseAnonKey);
  const { data: { user }, error } = await supa.auth.getUser(token);
  if (error || !user) return NextResponse.json({ error: "invalid session" }, { status: 401 });

  const ent = await getEntitlement(user.id);
  return NextResponse.json({ email: user.email, openBeta: isOpenBeta(), ...ent });
}
