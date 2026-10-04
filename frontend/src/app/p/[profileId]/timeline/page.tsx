import type { Metadata } from "next"

import { TimelineView } from "@/components/timeline/timeline-view"

export const metadata: Metadata = { title: "Timeline" }

export default async function Page({ params }: PageProps<"/p/[profileId]/timeline">) {
  const { profileId } = await params
  return <TimelineView profileId={profileId} />
}
