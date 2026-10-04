"use client"

import { ChevronLeft, ChevronRight, FileText, FileUp, SearchX } from "lucide-react"
import { useMemo, useState } from "react"

import { EmptyState } from "@/components/common/empty-state"
import { ErrorState } from "@/components/common/error-state"
import { PageHeader } from "@/components/common/page-header"
import { DocumentFilters, EMPTY_FILTERS, type DocumentFilterValues } from "@/components/documents/document-filters"
import { DocumentList } from "@/components/documents/document-list"
import { UploadDialog } from "@/components/documents/upload-dialog"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useDebouncedValue } from "@/hooks/use-debounced-value"
import { useDocuments } from "@/hooks/use-documents"
import type { DocumentListQuery } from "@/lib/types"

const PAGE_SIZE = 20

export function DocumentsView({ profileId }: { profileId: string }) {
  const [filters, setFilters] = useState<DocumentFilterValues>(EMPTY_FILTERS)
  const [page, setPage] = useState(0)
  const q = useDebouncedValue(filters.q.trim(), 300)

  const query = useMemo<DocumentListQuery>(
    () => ({
      q: q || undefined,
      type: filters.type || undefined,
      status: filters.status || undefined,
      from: filters.from || undefined,
      to: filters.to || undefined,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    }),
    [q, filters.type, filters.status, filters.from, filters.to, page],
  )
  const documents = useDocuments(profileId, query)
  const total = documents.data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const filtered = Boolean(q || filters.type || filters.status || filters.from || filters.to)

  const onFiltersChange = (next: DocumentFilterValues) => {
    setFilters(next)
    setPage(0)
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Documents"
        description="Every original file, with what MedVault extracted from it."
        actions={<UploadDialog profileId={profileId} />}
      />
      <DocumentFilters value={filters} onChange={onFiltersChange} />

      {documents.isPending ? (
        <div className="space-y-2" aria-busy="true" aria-label="Loading documents">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-xl" />
          ))}
        </div>
      ) : documents.isError ? (
        <ErrorState error={documents.error} onRetry={() => documents.refetch()} />
      ) : documents.data.documents.length === 0 ? (
        filtered ? (
          <EmptyState
            icon={SearchX}
            title="No matching documents"
            description="Try a different search term or clear the filters."
            action={
              <Button variant="outline" onClick={() => onFiltersChange(EMPTY_FILTERS)}>
                Clear filters
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={FileText}
            title="No documents yet"
            description="Upload a prescription, lab report or discharge summary to get started."
            action={
              <UploadDialog
                profileId={profileId}
                trigger={
                  <Button>
                    <FileUp aria-hidden /> Upload your first document
                  </Button>
                }
              />
            }
          />
        )
      ) : (
        <>
          <DocumentList documents={documents.data.documents} profileId={profileId} />
          <nav className="flex items-center justify-between text-sm text-muted-foreground" aria-label="Pagination">
            <span>
              {total === 1 ? "1 document" : `${total} documents`}
              {pageCount > 1 ? ` · page ${page + 1} of ${pageCount}` : ""}
            </span>
            {pageCount > 1 ? (
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setPage((p) => p - 1)} disabled={page === 0}>
                  <ChevronLeft aria-hidden /> Previous
                </Button>
                <Button variant="outline" size="sm" onClick={() => setPage((p) => p + 1)} disabled={page + 1 >= pageCount}>
                  Next <ChevronRight aria-hidden />
                </Button>
              </div>
            ) : null}
          </nav>
        </>
      )}
    </div>
  )
}
