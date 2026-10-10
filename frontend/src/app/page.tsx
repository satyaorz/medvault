"use client"

import { Loader2 } from "lucide-react"
import { useRouter } from "next/navigation"
import { useEffect } from "react"

import { ErrorState } from "@/components/common/error-state"
import { useProfiles } from "@/hooks/use-profiles"
import { profilePath } from "@/lib/navigation"

/** Entry point: send the user to their first profile's dashboard (or /login via the 401 handler). */
export default function HomePage() {
  const router = useRouter()
  const profiles = useProfiles()

  useEffect(() => {
    const first = profiles.data?.[0]
    if (first) router.replace(profilePath(first.id))
    else if (profiles.data) router.replace("/profiles")
  }, [profiles.data, router])

  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      {profiles.isError ? (
        <div className="w-full max-w-md">
          <ErrorState error={profiles.error} onRetry={() => profiles.refetch()} />
        </div>
      ) : (
        <Loader2 className="size-6 animate-spin text-muted-foreground" aria-label="Loading your records" />
      )}
    </main>
  )
}
