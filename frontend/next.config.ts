import type { NextConfig } from "next"

/**
 * The browser only ever talks to this Next.js server; `/api/*` is proxied to the Go API so
 * the httpOnly session cookie is first-party.
 *
 * NOTE: rewrites are resolved at **build** time and baked into the standalone output, so
 * `API_URL` must be set when running `next build` (the Dockerfile exposes it as a build arg).
 */
const apiUrl = (process.env.API_URL ?? "http://localhost:8080").replace(/\/+$/, "")

const nextConfig: NextConfig = {
  output: "standalone",
  // Pin the workspace root (a stray lockfile in $HOME would otherwise confuse Turbopack).
  turbopack: { root: import.meta.dirname },
  poweredByHeader: false,
  experimental: {
    // Request bodies that pass through proxy.ts are buffered up to this size. /api is excluded
    // from the proxy matcher, but keep the limit above the 20 MB upload cap as a safety net.
    proxyClientMaxBodySize: "25mb",
  },
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${apiUrl}/api/:path*` }]
  },
}

export default nextConfig
