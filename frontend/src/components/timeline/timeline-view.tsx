"use client"

import { CalendarClock, CalendarRange, FileUp } from "lucide-react"
import { useMemo, useState } from "react"

import { EmptyState } from "@/components/common/empty-state"
import { ErrorState } from "@/components/common/error-state"
import { PageHeader } from "@/components/common/page-header"
import { UploadDialog } from "@/components/documents/upload-dialog"
import { TimelineEventCard } from "@/components/timeline/timeline-event-card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { useTimeline } from "@/hooks/use-records"
import { DOC_TYPE_LABELS } from "@/lib/constants"
import { todayISO } from "@/lib/format"
import { organizeTimeline } from "@/lib/timeline"
import type { TimelineEvent } from "@/lib/types"

type EventType = TimelineEvent["type"]

export function TimelineView({ profileId }: { profileId: string }) {
  const timeline = useTimeline(profileId)
  const [types, setTypes] = useState<string[]>([])

  const presentTypes = useMemo(
    () => Array.from(new Set((timeline.data ?? []).map((e) => e.type))) as EventType[],
    [timeline.data],
  )
  const { upcoming, groups } = useMemo(() => {
    const events = (timeline.data ?? []).filter((e) => types.length === 0 || types.includes(e.type))
    return organizeTimeline(events, todayISO())
  }, [timeline.data, types])

  return (
    <div className="space-y-6">
      <PageHeader title="Timeline" description="Your health history, one event per document — newest first." />

      {timeline.isPending ? (
        <div className="space-y-3" aria-busy="true">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
      ) : timeline.isError ? (
        <ErrorState error={timeline.error} onRetry={() => timeline.refetch()} />
      ) : timeline.data.length === 0 ? (
        <EmptyState
          icon={CalendarRange}
          title="Your timeline is empty"
          description="Each document you upload becomes an event here, with the key values it contains."
          action={
            <UploadDialog
              profileId={profileId}
              trigger={
                <Button>
                  <FileUp aria-hidden /> Upload a document
                </Button>
              }
            />
          }
        />
      ) : (
        <>
          {presentTypes.length > 1 ? (
            <ToggleGroup
              type="multiple"
              value={types}
              onValueChange={setTypes}
              variant="outline"
              size="sm"
              className="flex-wrap"
              aria-label="Filter events by type"
            >
              {presentTypes.map((t) => (
                <ToggleGroupItem key={t} value={t}>
                  {DOC_TYPE_LABELS[t]}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          ) : null}

          {upcoming.length > 0 ? (
            <section className="space-y-3 rounded-xl border border-chart-3/40 bg-chart-3/5 p-4" aria-labelledby="upcoming-heading">
              <h2 id="upcoming-heading" className="flex items-center gap-2 font-semibold">
                <CalendarClock className="size-4 text-chart-3" aria-hidden /> Upcoming
              </h2>
              <div className="space-y-2">
                {upcoming.map((e) => (
                  <TimelineEventCard key={e.id} event={e} profileId={profileId} />
                ))}
              </div>
            </section>
          ) : null}

          {groups.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No events match this filter.</p>
          ) : (
            <div className="space-y-8">
              {groups.map((group) => (
                <section key={group.key} aria-labelledby={`month-${group.key}`} className="relative">
                  <h2
                    id={`month-${group.key}`}
                    className="sticky top-14 z-[1] mb-3 bg-background/90 py-1 text-sm font-semibold text-muted-foreground backdrop-blur md:top-0"
                  >
                    {group.label}
                  </h2>
                  <ol className="relative space-y-3 border-l pl-5 md:ml-2">
                    {group.events.map((e) => (
                      <li key={e.id} className="relative">
                        <span className="absolute -left-[1.6rem] top-5 size-2.5 rounded-full border-2 border-background bg-primary" aria-hidden />
                        <TimelineEventCard event={e} profileId={profileId} />
                      </li>
                    ))}
                  </ol>
                </section>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
