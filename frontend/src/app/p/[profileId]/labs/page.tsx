import type { Metadata } from "next"

import { LabsView } from "@/components/labs/labs-view"

export const metadata: Metadata = { title: "Labs" }

export default async function Page({ params }: PageProps<"/p/[profileId]/labs">) {
  const { profileId } = await params
  return <LabsView profileId={profileId} />
}
