"use client"

import { Check, Copy, ScanText } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

import { EmptyState } from "@/components/common/empty-state"
import { Button } from "@/components/ui/button"
import { formatPercent } from "@/lib/format"
import type { DocumentDetail } from "@/lib/types"

const METHOD_LABELS = { text_layer: "embedded PDF text", tesseract: "Tesseract OCR", mixed: "PDF text + OCR" }

export function OcrTextPanel({ doc }: { doc: DocumentDetail }) {
  const [copied, setCopied] = useState(false)
  if (!doc.ocr_text) {
    return <EmptyState icon={ScanText} title="No text yet" description="The document's text appears here after the OCR step." />
  }
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(doc.ocr_text ?? "")
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error("Couldn't copy to the clipboard")
    }
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {doc.ocr_method ? `Read via ${METHOD_LABELS[doc.ocr_method]}` : "Extracted text"}
          {doc.ocr_confidence !== null ? ` · ${formatPercent(doc.ocr_confidence)} confidence` : ""}
          {doc.page_count ? ` · ${doc.page_count} ${doc.page_count === 1 ? "page" : "pages"}` : ""}
        </span>
        <Button variant="outline" size="sm" onClick={copy}>
          {copied ? <Check aria-hidden /> : <Copy aria-hidden />} {copied ? "Copied" : "Copy text"}
        </Button>
      </div>
      <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-words rounded-lg border bg-muted/40 p-4 font-mono text-xs leading-relaxed">
        {doc.ocr_text}
      </pre>
    </div>
  )
}
