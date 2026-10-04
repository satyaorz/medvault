import type { DocumentListQuery } from "@/lib/types"

/**
 * Hierarchical query keys. Everything for a profile lives under `["profile", pid]`, so
 * `invalidateQueries({ queryKey: qk.profile(pid) })` refreshes the whole profile view.
 */
export const qk = {
  me: ["me"] as const,
  profiles: ["profiles"] as const,
  profile: (pid: string) => ["profile", pid] as const,
  summary: (pid: string) => ["profile", pid, "summary"] as const,
  documents: (pid: string) => ["profile", pid, "documents"] as const,
  documentList: (pid: string, query: DocumentListQuery) => ["profile", pid, "documents", "list", query] as const,
  review: (pid: string) => ["profile", pid, "review"] as const,
  timeline: (pid: string) => ["profile", pid, "timeline"] as const,
  labs: (pid: string) => ["profile", pid, "labs"] as const,
  labSeries: (pid: string, code: string) => ["profile", pid, "labs", code] as const,
  medications: (pid: string) => ["profile", pid, "medications"] as const,
  document: (id: string) => ["document", id] as const,
  documentItems: (id: string) => ["document", id, "items"] as const,
}
