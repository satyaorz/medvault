"use client"

import { FileUp, FlaskConical, Search } from "lucide-react"
import { useMemo, useState } from "react"

import { EmptyState } from "@/components/common/empty-state"
import { ErrorState } from "@/components/common/error-state"
import { PageHeader } from "@/components/common/page-header"
import { UploadDialog } from "@/components/documents/upload-dialog"
import { LabCard } from "@/components/labs/lab-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { useLabs } from "@/hooks/use-records"

export function LabsView({ profileId }: { profileId: string }) {
  const labs = useLabs(profileId)
  const [filter, setFilter] = useState("")

  const tests = useMemo(() => {
    const all = labs.data ?? []
    const needle = filter.trim().toLowerCase()
    const shown = needle ? all.filter((t) => t.name.toLowerCase().includes(needle) || t.code.includes(needle)) : all
    // Abnormal first, then alphabetical — what deserves attention floats up.
    return [...shown].sort((a, b) => {
      const ab = Number(a.latest.flag === "high" || a.latest.flag === "low")
      const bb = Number(b.latest.flag === "high" || b.latest.flag === "low")
      return bb - ab || a.name.localeCompare(b.name)
    })
  }, [labs.data, filter])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Labs"
        description="Every test across all your reports, matched to one standard name and unit."
        actions={
          labs.data && labs.data.length > 6 ? (
            <div className="relative w-full sm:w-64">
              <Label htmlFor="lab-filter" className="sr-only">
                Filter tests
              </Label>
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input id="lab-filter" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter tests…" className="pl-8" />
            </div>
          ) : null
        }
      />
      {labs.isPending ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-32 rounded-xl" />
          ))}
        </div>
      ) : labs.isError ? (
        <ErrorState error={labs.error} onRetry={() => labs.refetch()} />
      ) : labs.data.length === 0 ? (
        <EmptyState
          icon={FlaskConical}
          title="No lab results yet"
          description="Upload a blood test or other lab report — values are extracted and tracked over time automatically."
          action={
            <UploadDialog
              profileId={profileId}
              trigger={
                <Button>
                  <FileUp aria-hidden /> Upload a lab report
                </Button>
              }
            />
          }
        />
      ) : tests.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">No tests match “{filter}”.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {tests.map((test) => (
            <LabCard key={test.code} test={test} profileId={profileId} />
          ))}
        </div>
      )}
    </div>
  )
}
