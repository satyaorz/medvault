import type { Metadata } from "next"

import { DocumentsView } from "@/components/documents/documents-view"

export const metadata: Metadata = { title: "Documents" }

export default async function Page({ params }: PageProps<"/p/[profileId]/documents">) {
  const { profileId } = await params
  return <DocumentsView profileId={profileId} />
}
