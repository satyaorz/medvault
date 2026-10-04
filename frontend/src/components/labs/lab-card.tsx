"use client"

import Link from "next/link"

import { FlagBadge } from "@/components/common/badges"
import { TrendIndicator } from "@/components/common/trend-indicator"
import { Sparkline } from "@/components/labs/sparkline"
import { Card, CardContent } from "@/components/ui/card"
import { useLabSeries } from "@/hooks/use-records"
import { computeDelta, formatDate, formatLabValue } from "@/lib/format"
import { profilePath } from "@/lib/navigation"
import type { LabTestSummary } from "@/lib/types"

export function LabCard({ test, profileId }: { test: LabTestSummary; profileId: string }) {
  // Full series powers the sparkline (also warms the cache for the detail page).
  const series = useLabSeries(profileId, test.code)
  const values =
    series.data?.results.flatMap((r) => (r.value === null ? [] : [r.value])) ??
    [test.previous?.value, test.latest.value].filter((v): v is number => v !== null && v !== undefined)
  const delta = computeDelta(test.latest, test.previous)
  const unrecognized = test.code.startsWith("raw:")

  return (
    <Link
      href={profilePath(profileId, `labs/${encodeURIComponent(test.code)}`)}
      className="group rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <Card className="h-full gap-3 py-4 transition-colors group-hover:border-primary/40 group-hover:bg-accent/30">
        <CardContent className="space-y-3 px-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h2 className="truncate font-medium group-hover:text-primary">{test.name}</h2>
              <p className="text-xs text-muted-foreground">
                {test.count} {test.count === 1 ? "result" : "results"}
                {unrecognized ? " · not standardized" : ""}
              </p>
            </div>
            <FlagBadge flag={test.latest.flag} />
          </div>
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-2xl font-semibold tabular-nums tracking-tight">{formatLabValue(test.latest)}</p>
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                {formatDate(test.latest.measured_at)}
                <TrendIndicator trend={test.trend ?? delta?.direction} label={delta?.label} />
              </p>
            </div>
            {values.length > 1 ? <Sparkline values={values} /> : null}
          </div>
        </CardContent>
      </Card>
    </Link>
  )
}
