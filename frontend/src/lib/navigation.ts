/** Only allow same-site relative paths as post-login redirects (prevents open redirects). */
export function safeNextPath(next: string | null | undefined): string | null {
  if (!next) return null
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return null
  if (next.startsWith("/login") || next.startsWith("/register")) return null
  return next
}

export const profilePath = (pid: string, section = "dashboard") => `/p/${pid}/${section}`
