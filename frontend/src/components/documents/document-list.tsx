"use client"

import { ChevronRight } from "lucide-react"
import Link from "next/link"

import { DocTypeBadge, StatusBadge } from "@/components/common/badges"
import { DocTypeIcon } from "@/components/common/doc-type-icon"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { documentTitle, formatBytes, formatDate } from "@/lib/format"
import { profilePath } from "@/lib/navigation"
import type { MedDocument } from "@/lib/types"

function PendingBadge({ count }: { count: number }) {
  if (count <= 0) return null
  return (
    <Badge variant="outline" className="border-warning/30 bg-warning/10 text-warning-foreground dark:text-warning">
      {count} to review
    </Badge>
  )
}

export function DocumentList({ documents, profileId }: { documents: MedDocument[]; profileId: string }) {
  const href = (doc: MedDocument) => profilePath(profileId, `documents/${doc.id}`)
  return (
    <>
      {/* Mobile: cards */}
      <ul className="space-y-2 md:hidden">
        {documents.map((doc) => (
          <li key={doc.id}>
            <Link
              href={href(doc)}
              className="flex items-center gap-3 rounded-xl border bg-card p-3 outline-none transition-colors hover:bg-accent/50 focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <DocTypeIcon type={doc.doc_type} />
              <div className="min-w-0 flex-1 space-y-1">
                <p className="truncate text-sm font-medium">{documentTitle(doc)}</p>
                <p className="text-xs text-muted-foreground">
                  {formatDate(doc.doc_date, "Undated")} · {formatBytes(doc.size_bytes)}
                </p>
                <div className="flex flex-wrap gap-1">
                  <StatusBadge status={doc.status} />
                  <PendingBadge count={doc.pending_items} />
                </div>
              </div>
              <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>

      {/* Desktop: table */}
      <div className="hidden overflow-hidden rounded-xl border bg-card md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">Document</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Extracted</TableHead>
              <TableHead className="pr-4 text-right">Size</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {documents.map((doc) => (
              <TableRow key={doc.id} className="group">
                <TableCell className="max-w-80 pl-4">
                  <Link href={href(doc)} className="flex items-center gap-3 outline-none focus-visible:underline">
                    <DocTypeIcon type={doc.doc_type} className="size-8" />
                    <span className="min-w-0">
                      <span className="block truncate font-medium group-hover:text-primary">{documentTitle(doc)}</span>
                      {doc.title ? (
                        <span className="block truncate text-xs text-muted-foreground">{doc.filename}</span>
                      ) : doc.source ? (
                        <span className="block truncate text-xs text-muted-foreground">{doc.source}</span>
                      ) : null}
                    </span>
                  </Link>
                </TableCell>
                <TableCell>
                  <DocTypeBadge type={doc.doc_type} />
                </TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(doc.doc_date, "Undated")}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    <StatusBadge status={doc.status} />
                    <PendingBadge count={doc.pending_items} />
                  </div>
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">{doc.item_count || "—"}</TableCell>
                <TableCell className="pr-4 text-right tabular-nums text-muted-foreground">{formatBytes(doc.size_bytes)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  )
}
