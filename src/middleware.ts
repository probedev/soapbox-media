import { NextResponse, type NextRequest } from "next/server";

/**
 * Protects /admin/* routes with HTTP Basic Auth.
 * Uses the `ADMIN_PASSWORD` env var. Username can be anything; only the
 * password is checked. Browser caches credentials for the session, so the
 * user is prompted once per session.
 *
 * Set ADMIN_PASSWORD in .env.local (local dev) and in Vercel project
 * settings → Environment Variables (production).
 */
export function middleware(request: NextRequest) {
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminPassword) {
    return new NextResponse(
      "ADMIN_PASSWORD env var not configured on this deployment.",
      { status: 500 },
    );
  }

  const auth = request.headers.get("authorization");

  if (!auth?.startsWith("Basic ")) {
    return new NextResponse("Authentication required", {
      status: 401,
      headers: {
        "WWW-Authenticate": 'Basic realm="Soapbox Admin", charset="UTF-8"',
      },
    });
  }

  // Decode base64 username:password
  let credentials: string;
  try {
    credentials = atob(auth.slice("Basic ".length));
  } catch {
    return new NextResponse("Invalid auth encoding", { status: 401 });
  }
  const colon = credentials.indexOf(":");
  const password = colon >= 0 ? credentials.slice(colon + 1) : "";

  if (password !== adminPassword) {
    return new NextResponse("Invalid credentials", {
      status: 401,
      headers: {
        "WWW-Authenticate": 'Basic realm="Soapbox Admin", charset="UTF-8"',
      },
    });
  }

  return NextResponse.next();
}

export const config = {
  matcher: "/admin/:path*",
};
