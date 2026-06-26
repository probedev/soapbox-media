/**
 * Lead capture for the monthly Soapbox Report list. Used by the site-wide
 * engagement popup and the report email-gate. Stores into `report_leads`
 * (service-role; RLS-on table) and sets an `sb_unlocked` cookie so the gated
 * report renders in full on the next request. One row per email (the table has
 * a case-insensitive unique index); a repeat signup is treated as success.
 */
import { type NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/db";

export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SOURCES = new Set(["popup", "report-gate"]);

export async function POST(req: NextRequest) {
  let body: { email?: string; source?: string; reportSlug?: string; pagesSeen?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const email = String(body.email || "").trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 254) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }
  const source = SOURCES.has(String(body.source)) ? String(body.source) : "unknown";

  const db = createServiceClient();
  const { error } = await db.from("report_leads").insert({
    email,
    source,
    report_slug: typeof body.reportSlug === "string" ? body.reportSlug.slice(0, 120) : null,
    pages_seen: Number.isFinite(body.pagesSeen) ? Math.floor(body.pagesSeen as number) : null,
    user_agent: (req.headers.get("user-agent") || "").slice(0, 400),
  });

  // 23505 = unique violation (already on the list). Treat as success.
  if (error && error.code !== "23505") {
    console.error(`SIGNUP_ERR ${error.code} ${error.message}`);
    return NextResponse.json({ error: "Could not save right now, please try again." }, { status: 502 });
  }

  const res = NextResponse.json({ ok: true, already: error?.code === "23505" });
  res.cookies.set("sb_unlocked", "1", {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    httpOnly: true,
    sameSite: "lax",
    secure: true,
  });
  return res;
}
