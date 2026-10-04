import { NextResponse, type NextRequest } from "next/server"

const SESSION_COOKIE = "mv_session"

/**
 * Optimistic auth check: no session cookie → straight to /login.
 * The real check happens in the Go API (an expired cookie still gets a 401 there,
 * which the client turns into a redirect).
 */
export function proxy(request: NextRequest) {
  if (request.cookies.has(SESSION_COOKIE)) return NextResponse.next()
  const url = request.nextUrl.clone()
  const next = request.nextUrl.pathname
  url.pathname = "/login"
  url.search = next && next !== "/" ? `?next=${encodeURIComponent(next)}` : ""
  return NextResponse.redirect(url)
}

export const config = {
  // App routes only — never /api (uploads must stream through untouched) or static assets.
  matcher: ["/", "/p/:path*", "/profiles/:path*"],
}
