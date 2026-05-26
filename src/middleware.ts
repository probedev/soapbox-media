import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_COOKIE, adminToken } from "@/lib/adminAuth";

/**
 * Gates /admin/* behind a cookie session. The login page (/admin/login) is
 * public; everything else requires the `sb_admin` cookie to match the hash of
 * ADMIN_PASSWORD. Missing/invalid → redirect to the login screen (no more
 * browser Basic Auth dialog). The login form sets the cookie; see
 * /admin/login/actions.ts.
 */
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Login page (and its server-action POST) must be reachable unauthenticated.
  if (pathname === "/admin/login") return NextResponse.next();

  if (!process.env.ADMIN_PASSWORD) {
    return new NextResponse(
      "ADMIN_PASSWORD env var not configured on this deployment.",
      { status: 500 },
    );
  }

  const expected = await adminToken();
  const cookie = request.cookies.get(ADMIN_COOKIE)?.value;
  if (!expected || cookie !== expected) {
    const url = request.nextUrl.clone();
    url.pathname = "/admin/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: "/admin/:path*",
};
