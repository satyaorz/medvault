import type { Metadata } from "next"

import { DocumentDetailView } from "@/components/documents/document-detail-view"

export const metadata: Metadata = { title: "Document" }

export default async function Page({ params }: PageProps<"/p/[profileId]/documents/[documentId]">) {
  const { profileId, documentId } = await params
  return <DocumentDetailView profileId={profileId} documentId={documentId} />
}
