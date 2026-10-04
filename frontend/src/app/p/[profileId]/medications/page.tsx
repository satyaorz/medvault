import type { Metadata } from "next"

import { MedicationsView } from "@/components/medications/medications-view"

export const metadata: Metadata = { title: "Medications" }

export default async function Page({ params }: PageProps<"/p/[profileId]/medications">) {
  const { profileId } = await params
  return <MedicationsView profileId={profileId} />
}
