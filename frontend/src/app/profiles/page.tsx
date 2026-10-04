import type { Metadata } from "next"
import { Suspense } from "react"

import { ProfilesView } from "@/components/profiles/profiles-view"

export const metadata: Metadata = { title: "Family profiles" }

export default function ProfilesPage() {
  return (
    <Suspense>
      <ProfilesView />
    </Suspense>
  )
}
