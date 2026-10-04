"use client"

import { FileUp, Pill } from "lucide-react"

import { EmptyState } from "@/components/common/empty-state"
import { ErrorState } from "@/components/common/error-state"
import { PageHeader } from "@/components/common/page-header"
import { UploadDialog } from "@/components/documents/upload-dialog"
import { MedicationCard } from "@/components/medications/medication-card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useMedications } from "@/hooks/use-records"

export function MedicationsView({ profileId }: { profileId: string }) {
  const meds = useMedications(profileId)

  return (
    <div className="space-y-8">
      <PageHeader
        title="Medications"
        description="Built from your prescriptions and discharge summaries. Brand names are matched to their generic medicine."
      />
      {meds.isPending ? (
        <div className="grid gap-4 md:grid-cols-2" aria-busy="true">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-44 rounded-xl" />
          ))}
        </div>
      ) : meds.isError ? (
        <ErrorState error={meds.error} onRetry={() => meds.refetch()} />
      ) : meds.data.current.length === 0 && meds.data.past.length === 0 ? (
        <EmptyState
          icon={Pill}
          title="No medications yet"
          description="Upload a prescription and MedVault will list each medicine with its dose, schedule and timing."
          action={
            <UploadDialog
              profileId={profileId}
              trigger={
                <Button>
                  <FileUp aria-hidden /> Upload a prescription
                </Button>
              }
            />
          }
        />
      ) : (
        <>
          <section className="space-y-3" aria-labelledby="current-heading">
            <h2 id="current-heading" className="text-lg font-semibold">
              Current <span className="font-normal text-muted-foreground">({meds.data.current.length})</span>
            </h2>
            {meds.data.current.length === 0 ? (
              <p className="text-sm text-muted-foreground">No active medications in your latest prescription.</p>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {meds.data.current.map((m) => (
                  <MedicationCard key={m.id} medication={m} profileId={profileId} />
                ))}
              </div>
            )}
          </section>
          {meds.data.past.length > 0 ? (
            <section className="space-y-3" aria-labelledby="past-heading">
              <h2 id="past-heading" className="text-lg font-semibold">
                Past <span className="font-normal text-muted-foreground">({meds.data.past.length})</span>
              </h2>
              <div className="grid gap-4 md:grid-cols-2">
                {meds.data.past.map((m) => (
                  <MedicationCard key={m.id} medication={m} profileId={profileId} />
                ))}
              </div>
            </section>
          ) : null}
        </>
      )}
    </div>
  )
}
