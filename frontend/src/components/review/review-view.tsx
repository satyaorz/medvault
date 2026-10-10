"use client"

import { CheckCheck } from "lucide-react"
import Link from "next/link"

import { EmptyState } from "@/components/common/empty-state"
import { ErrorState } from "@/components/common/error-state"
import { PageHeader } from "@/components/common/page-header"
import { ReviewCard } from "@/components/review/review-card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useReviewQueue } from "@/hooks/use-review"
import { profilePath } from "@/lib/navigation"

export function ReviewView({ profileId }: { profileId: string }) {
  const queue = useReviewQueue(profileId)
  const count = queue.data?.length ?? 0

  return (
    <div className="space-y-6">
      <PageHeader
        title="Review"
        description={
          count > 0
            ? `${count} extracted ${count === 1 ? "item needs" : "items need"} a quick check. Correct anything that's off, then accept — only confirmed data reaches your records.`
            : "Low-confidence extractions wait here for your confirmation."
        }
      />
      {queue.isPending ? (
        <div className="space-y-4" aria-busy="true">
          <Skeleton className="h-64 w-full rounded-xl" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
      ) : queue.isError ? (
        <ErrorState error={queue.error} onRetry={() => queue.refetch()} />
      ) : count === 0 ? (
        <EmptyState
          icon={CheckCheck}
          title="All caught up"
          description="Nothing is waiting for review. New uploads with uncertain values will show up here."
          action={
            <Button variant="outline" asChild>
              <Link href={profilePath(profileId, "documents")}>Go to documents</Link>
            </Button>
          }
        />
      ) : (
        <div className="space-y-4">
          {queue.data.map((item) => (
            <ReviewCard key={item.id} item={item} profileId={profileId} />
          ))}
        </div>
      )}
    </div>
  )
}
