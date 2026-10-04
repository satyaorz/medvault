import type { Metadata } from "next"

import { DashboardView } from "@/components/dashboard/dashboard-view"

export const metadata: Metadata = { title: "Dashboard" }

export default async function Page({ params }: PageProps<"/p/[profileId]/dashboard">) {
  const { profileId } = await params
  return <DashboardView profileId={profileId} />
}
