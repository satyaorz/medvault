import type { Metadata } from "next"

import { LabDetailView } from "@/components/labs/lab-detail-view"

export const metadata: Metadata = { title: "Lab trend" }

function safeDecode(value: string) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export default async function Page({ params }: PageProps<"/p/[profileId]/labs/[code]">) {
  const { profileId, code } = await params
  return <LabDetailView profileId={profileId} code={safeDecode(code)} />
}
