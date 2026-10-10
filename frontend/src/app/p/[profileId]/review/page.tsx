import type { Metadata } from "next"

import { ReviewView } from "@/components/review/review-view"

export const metadata: Metadata = { title: "Review" }

export default async function Page({ params }: PageProps<"/p/[profileId]/review">) {
  const { profileId } = await params
  return <ReviewView profileId={profileId} />
}
