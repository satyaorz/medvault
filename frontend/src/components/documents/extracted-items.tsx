"use client"

import { AlertTriangle, ClipboardCheck, Quote, Sparkles } from "lucide-react"
import Link from "next/link"

import { ConfidenceBadge, FlagBadge, GroundedBadge, ItemStatusBadge } from "@/components/common/badges"
import { EmptyState } from "@/components/common/empty-state"
import { ErrorState } from "@/components/common/error-state"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useDocumentItems } from "@/hooks/use-documents"
import { ITEM_KIND_ORDER, ITEM_KIND_PLURALS } from "@/lib/constants"
import { isInFlight } from "@/lib/format"
import { groupByKind, summarizeItem } from "@/lib/items"
import { profilePath } from "@/lib/navigation"
import type { DocStatus, ExtractedItem } from "@/lib/types"
import { cn } from "@/lib/utils"

export function SourceQuote({ text, className }: { text: string | null; className?: string }) {
  if (!text) return null
  return (
    <blockquote
      className={cn(
        "flex gap-2 rounded-md border-l-2 border-primary/40 bg-muted/60 px-3 py-2 font-mono text-xs leading-relaxed text-muted-foreground",
        className,
      )}
    >
      <Quote className="mt-0.5 size-3 shrink-0" aria-hidden />
      <span className="whitespace-pre-wrap break-words">{text}</span>
    </blockquote>
  )
}

function ItemRow({ item }: { item: ExtractedItem }) {
  const summary = summarizeItem(item)
  return (
    <li className={cn("space-y-2 rounded-lg border p-3", item.status === "rejected" && "opacity-60")}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium">
            {summary.label}
            {summary.value ? <span className="ml-2 font-normal tabular-nums">{summary.value}</span> : null}
          </p>
          {summary.detail ? <p className="text-xs text-muted-foreground">{summary.detail}</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <FlagBadge flag={summary.flag} />
          <ItemStatusBadge status={item.status} reviewedBy={item.reviewed_by} />
        </div>
      </div>
      <SourceQuote text={item.source_text} />
      <div className="flex flex-wrap items-center gap-1">
        <ConfidenceBadge confidence={item.confidence} />
        <GroundedBadge grounded={item.grounded} />
      </div>
      {item.issues.length > 0 ? (
        <ul className="space-y-1">
          {item.issues.map((issue) => (
            <li key={issue} className="flex items-center gap-1.5 text-xs text-warning-foreground dark:text-warning">
              <AlertTriangle className="size-3.5 shrink-0" aria-hidden /> {issue}
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  )
}

export function ExtractedItems({
  documentId,
  profileId,
  status,
}: {
  documentId: string
  profileId: string
  status: DocStatus
}) {
  const items = useDocumentItems(documentId, !isInFlight(status))

  if (isInFlight(status)) {
    return (
      <EmptyState
        icon={Sparkles}
        title="Still reading this document"
        description="Extracted values will appear here as soon as processing finishes."
      />
    )
  }
  if (items.isPending) return <Skeleton className="h-40 w-full rounded-xl" />
  if (items.isError) return <ErrorState error={items.error} onRetry={() => items.refetch()} />
  if (items.data.length === 0)
    return (
      <EmptyState
        icon={Sparkles}
        title="Nothing extracted"
        description={
          status === "failed"
            ? "Processing failed before any data could be extracted. Try reprocessing from the Details tab."
            : "No lab values, medicines or diagnoses were found in this document."
        }
      />
    )

  const groups = groupByKind(items.data)
  const pending = items.data.filter((i) => i.status === "needs_review").length

  return (
    <div className="space-y-5">
      {pending > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm">
          <span>
            <strong className="font-medium">{pending}</strong> {pending === 1 ? "item needs" : "items need"} your
            confirmation before it shows up in your records.
          </span>
          <Button size="sm" asChild>
            <Link href={profilePath(profileId, "review")}>
              <ClipboardCheck aria-hidden /> Review now
            </Link>
          </Button>
        </div>
      ) : null}
      {ITEM_KIND_ORDER.filter((kind) => groups.has(kind)).map((kind) => (
        <section key={kind} className="space-y-2" aria-labelledby={`kind-${kind}`}>
          <h3 id={`kind-${kind}`} className="text-sm font-semibold text-muted-foreground">
            {ITEM_KIND_PLURALS[kind]} <span className="font-normal">({groups.get(kind)!.length})</span>
          </h3>
          <ul className="space-y-2">
            {groups.get(kind)!.map((item) => (
              <ItemRow key={item.id} item={item} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
