"use client"

import { Download, ExternalLink, FileWarning } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { api } from "@/lib/api"
import type { MedDocument } from "@/lib/types"

export function DocumentPreview({ doc }: { doc: Pick<MedDocument, "id" | "content_type" | "filename"> }) {
  const url = api.documents.fileUrl(doc.id)
  const [imageFailed, setImageFailed] = useState(false)
  const isPdf = doc.content_type === "application/pdf"
  const isImage = doc.content_type.startsWith("image/")

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border bg-card">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <span className="truncate text-sm text-muted-foreground">{doc.filename}</span>
        <div className="flex shrink-0 gap-1">
          <Button variant="ghost" size="icon-sm" asChild>
            <a href={url} target="_blank" rel="noopener" aria-label="Open original in a new tab">
              <ExternalLink aria-hidden />
            </a>
          </Button>
          <Button variant="ghost" size="icon-sm" asChild>
            <a href={url} download={doc.filename} aria-label="Download original">
              <Download aria-hidden />
            </a>
          </Button>
        </div>
      </div>
      <div className="relative h-[60vh] min-h-80 bg-muted/40 lg:h-[calc(100svh-14rem)]">
        {isPdf ? (
          <iframe src={url} title={`Preview of ${doc.filename}`} className="size-full" />
        ) : isImage && !imageFailed ? (
          // eslint-disable-next-line @next/next/no-img-element -- authenticated same-origin file, not optimizable
          <img
            src={url}
            alt={`Scan of ${doc.filename}`}
            className="size-full object-contain"
            onError={() => setImageFailed(true)}
          />
        ) : (
          <div className="flex size-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
            <FileWarning className="size-8" aria-hidden />
            Preview isn&apos;t available for this file. Use the download button to open it.
          </div>
        )}
      </div>
    </div>
  )
}
