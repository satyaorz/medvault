"use client"

import { ArrowLeft, Info } from "lucide-react"
import Link from "next/link"

import { FlagBadge } from "@/components/common/badges"
import { ErrorState } from "@/components/common/error-state"
import { TrendIndicator } from "@/components/common/trend-indicator"
import { LabChart } from "@/components/labs/lab-chart"
import { LabResultsTable } from "@/components/labs/lab-results-table"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useLabSeries } from "@/hooks/use-records"
import { computeDelta, formatDate, formatLabValue } from "@/lib/format"
import { profilePath } from "@/lib/navigation"

export function LabDetailView({ profileId, code }: { profileId: string; code: string }) {
  const series = useLabSeries(profileId, code)

  const back = (
    <Button variant="ghost" size="sm" asChild className="-ml-2 text-muted-foreground">
      <Link href={profilePath(profileId, "labs")}>
        <ArrowLeft aria-hidden /> Labs
      </Link>
    </Button>
  )

  if (series.isPending)
    return (
      <div className="space-y-4" aria-busy="true">
        {back}
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-80 rounded-xl" />
      </div>
    )
  if (series.isError)
    return (
      <div className="space-y-4">
        {back}
        <ErrorState error={series.error} onRetry={() => series.refetch()} />
      </div>
    )

  const { test, results } = series.data
  const latest = results.at(-1)
  const previous = results.length > 1 ? results.at(-2) : null
  const delta = latest ? computeDelta(latest, previous) : null
  const names = Array.from(new Set(results.map((r) => r.test_name_original)))
  const units = Array.from(new Set(results.map((r) => r.unit_original).filter(Boolean)))
  const unrecognized = code.startsWith("raw:")

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        {back}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{test.name}</h1>
            <p className="text-sm text-muted-foreground">
              {results.length} {results.length === 1 ? "result" : "results"}
              {test.unit ? ` · shown in ${test.unit}` : ""}
            </p>
          </div>
          {latest ? (
            <div className="text-left sm:text-right">
              <p className="text-3xl font-semibold tabular-nums tracking-tight">{formatLabValue(latest)}</p>
              <p className="flex items-center gap-2 text-xs text-muted-foreground sm:justify-end">
                Latest · {formatDate(latest.measured_at)}
                <TrendIndicator trend={delta?.direction} label={delta ? `${delta.label} vs previous` : undefined} />
                <FlagBadge flag={latest.flag} />
              </p>
            </div>
          ) : null}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Over time</CardTitle>
          <CardDescription>Dots are coloured by the lab&apos;s own flag; the shaded band is the reference range.</CardDescription>
        </CardHeader>
        <CardContent>
          <LabChart results={results} unit={test.unit} />
        </CardContent>
      </Card>

      {names.length > 1 || units.length > 1 || unrecognized ? (
        <div className="flex gap-2 rounded-lg border bg-accent/40 p-3 text-sm">
          <Info className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
          <p>
            {unrecognized ? (
              <>This test name wasn&apos;t matched to a standard test, so results are grouped by the name as printed.</>
            ) : (
              <>
                Your reports call this test{" "}
                {names.map((n, i) => (
                  <span key={n}>
                    {i > 0 ? (i === names.length - 1 ? " and " : ", ") : null}
                    <span className="font-mono text-xs">{n}</span>
                  </span>
                ))}
                {units.length > 1 ? ` and use ${units.length} different units (${units.join(", ")})` : ""}. MedVault
                matched them to <strong className="font-medium">{test.name}</strong>
                {test.unit ? ` in ${test.unit}` : ""} so they can be compared.
              </>
            )}
          </p>
        </div>
      ) : null}

      <section className="space-y-2" aria-labelledby="results-heading">
        <h2 id="results-heading" className="text-sm font-semibold text-muted-foreground">
          All results
        </h2>
        <LabResultsTable results={results} profileId={profileId} />
      </section>
    </div>
  )
}
