"use client"

import { AlertTriangle, ArrowLeft } from "lucide-react"
import Link from "next/link"
import { useState } from "react"

import { DocTypeBadge, StatusBadge } from "@/components/common/badges"
import { ErrorState } from "@/components/common/error-state"
import { DocumentDetailsForm } from "@/components/documents/document-details-form"
import { DocumentPreview } from "@/components/documents/document-preview"
import { ExtractedItems } from "@/components/documents/extracted-items"
import { OcrTextPanel } from "@/components/documents/ocr-text-panel"
import { ProcessingStepper } from "@/components/documents/processing-stepper"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useDocument } from "@/hooks/use-documents"
import { documentTitle, formatDate, isInFlight } from "@/lib/format"
import { profilePath } from "@/lib/navigation"

export function DocumentDetailView({ profileId, documentId }: { profileId: string; documentId: string }) {
  const document = useDocument(documentId)
  const [tab, setTab] = useState<string | null>(null)

  const back = (
    <Button variant="ghost" size="sm" asChild className="-ml-2 text-muted-foreground">
      <Link href={profilePath(profileId, "documents")}>
        <ArrowLeft aria-hidden /> Documents
      </Link>
    </Button>
  )

  if (document.isPending) {
    return (
      <div className="space-y-4" aria-busy="true">
        {back}
        <Skeleton className="h-8 w-72" />
        <div className="grid gap-6 lg:grid-cols-2">
          <Skeleton className="h-[60vh] rounded-xl" />
          <Skeleton className="h-[60vh] rounded-xl" />
        </div>
      </div>
    )
  }
  if (document.isError) {
    return (
      <div className="space-y-4">
        {back}
        <ErrorState error={document.error} onRetry={() => document.refetch()} />
      </div>
    )
  }

  const doc = document.data
  const inFlight = isInFlight(doc.status)
  // Default tab follows the document's state: watch progress while processing, then show results.
  const activeTab = tab ?? (inFlight || doc.status === "failed" ? "processing" : "items")

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        {back}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold tracking-tight">{documentTitle(doc)}</h1>
            <p className="text-sm text-muted-foreground">
              {formatDate(doc.doc_date, "Undated")}
              {doc.source ? ` · ${doc.source}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <DocTypeBadge type={doc.doc_type} />
            <StatusBadge status={doc.status} />
          </div>
        </div>
      </div>

      {doc.status === "failed" ? (
        <Alert variant="destructive">
          <AlertTriangle aria-hidden />
          <AlertTitle>Processing failed</AlertTitle>
          <AlertDescription>
            {doc.error ?? "Something went wrong while reading this document."} You can fix the details and reprocess it
            from the Details tab.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <DocumentPreview doc={doc} />
        <Card className="py-4">
          <CardContent className="px-4">
            <Tabs value={activeTab} onValueChange={setTab}>
              <TabsList className="w-full">
                <TabsTrigger value="processing">Processing</TabsTrigger>
                <TabsTrigger value="items">
                  Extracted{doc.item_count ? ` (${doc.item_count})` : ""}
                </TabsTrigger>
                <TabsTrigger value="ocr">Text</TabsTrigger>
                <TabsTrigger value="details">Details</TabsTrigger>
              </TabsList>
              <TabsContent value="processing" className="pt-4">
                <ProcessingStepper doc={doc} />
              </TabsContent>
              <TabsContent value="items" className="pt-4">
                <ExtractedItems documentId={doc.id} profileId={profileId} status={doc.status} />
              </TabsContent>
              <TabsContent value="ocr" className="pt-4">
                <OcrTextPanel doc={doc} />
              </TabsContent>
              <TabsContent value="details" className="pt-4">
                <DocumentDetailsForm doc={doc} />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
