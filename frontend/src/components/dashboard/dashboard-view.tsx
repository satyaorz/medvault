"use client"

import {
  ArrowRight,
  CalendarClock,
  ClipboardCheck,
  FileText,
  FileUp,
  FlaskConical,
  Loader2,
  Pill,
  ShieldPlus,
} from "lucide-react"
import Link from "next/link"

import { FlagBadge, StatusBadge } from "@/components/common/badges"
import { DocTypeIcon } from "@/components/common/doc-type-icon"
import { ErrorState } from "@/components/common/error-state"
import { PageHeader } from "@/components/common/page-header"
import { TrendIndicator } from "@/components/common/trend-indicator"
import { UploadDialog } from "@/components/documents/upload-dialog"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useSummary } from "@/hooks/use-profiles"
import { ENCOUNTER_TYPE_LABELS } from "@/lib/constants"
import { computeDelta, documentTitle, formatDate, formatLabValue, formatRelative } from "@/lib/format"
import { profilePath } from "@/lib/navigation"
import type { ProfileSummary } from "@/lib/types"
import { cn } from "@/lib/utils"

function StatCard({
  label,
  value,
  icon: Icon,
  href,
  tone,
  spinning,
}: {
  label: string
  value: number
  icon: typeof FileText
  href: string
  tone?: string
  spinning?: boolean
}) {
  return (
    <Link href={href} className="group rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
      <Card className="h-full gap-2 py-4 transition-colors group-hover:border-primary/40">
        <CardContent className="flex items-center justify-between gap-2 px-4">
          <div>
            <p className="text-2xl font-semibold tabular-nums">{value}</p>
            <p className="text-sm text-muted-foreground">{label}</p>
          </div>
          <span className={cn("flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground", tone)}>
            <Icon className={cn("size-4.5", spinning && "animate-spin")} aria-hidden />
          </span>
        </CardContent>
      </Card>
    </Link>
  )
}

function Welcome({ profileId, name }: { profileId: string; name: string }) {
  return (
    <Card className="overflow-hidden border-primary/20 bg-gradient-to-br from-accent to-card">
      <CardContent className="flex flex-col items-start gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-4">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <ShieldPlus className="size-6" aria-hidden />
          </span>
          <div className="space-y-1">
            <h2 className="text-lg font-semibold">Start {name}&apos;s health record</h2>
            <p className="max-w-lg text-sm text-muted-foreground">
              Upload prescriptions, blood reports or discharge summaries — PDFs or phone photos. MedVault reads them,
              pulls out lab values and medicines, and builds a timeline you can trace back to every source.
            </p>
          </div>
        </div>
        <UploadDialog
          profileId={profileId}
          trigger={
            <Button size="lg">
              <FileUp aria-hidden /> Upload your first document
            </Button>
          }
        />
      </CardContent>
    </Card>
  )
}

function DashboardContent({ data, profileId }: { data: ProfileSummary; profileId: string }) {
  const { counts } = data
  const link = (section: string) => profilePath(profileId, section)

  return (
    <div className="space-y-6">
      {counts.documents === 0 ? <Welcome profileId={profileId} name={data.profile.name} /> : null}

      {counts.pending_review > 0 ? (
        <div className="flex flex-col gap-3 rounded-xl border border-warning/30 bg-warning/10 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <ClipboardCheck className="size-5 shrink-0 text-warning-foreground dark:text-warning" aria-hidden />
            <p className="text-sm">
              <strong className="font-semibold">{counts.pending_review}</strong>{" "}
              {counts.pending_review === 1 ? "extracted value needs" : "extracted values need"} your confirmation before
              {counts.pending_review === 1 ? " it appears" : " they appear"} in your records.
            </p>
          </div>
          <Button asChild>
            <Link href={link("review")}>
              Review now <ArrowRight aria-hidden />
            </Link>
          </Button>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="Documents" value={counts.documents} icon={FileText} href={link("documents")} />
        <StatCard
          label="Processing"
          value={counts.processing}
          icon={Loader2}
          href={link("documents")}
          tone={counts.processing > 0 ? "bg-info/10 text-info" : undefined}
          spinning={counts.processing > 0}
        />
        <StatCard
          label="To review"
          value={counts.pending_review}
          icon={ClipboardCheck}
          href={link("review")}
          tone={counts.pending_review > 0 ? "bg-warning/15 text-warning-foreground dark:text-warning" : undefined}
        />
        <StatCard label="Active medicines" value={counts.active_medications} icon={Pill} href={link("medications")} />
        <StatCard label="Lab tests tracked" value={counts.lab_tests} icon={FlaskConical} href={link("labs")} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Recent lab results</CardTitle>
            <Button variant="ghost" size="sm" asChild>
              <Link href={link("labs")}>
                All labs <ArrowRight aria-hidden />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            {data.recent_labs.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Lab values appear here once a lab report is processed.</p>
            ) : (
              <ul className="divide-y">
                {data.recent_labs.map((lab) => {
                  const delta = computeDelta(lab.latest, lab.previous)
                  return (
                    <li key={lab.code}>
                      <Link
                        href={link(`labs/${encodeURIComponent(lab.code)}`)}
                        className="flex items-center justify-between gap-3 py-2.5 hover:text-primary"
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{lab.name}</span>
                          <span className="text-xs text-muted-foreground">{formatDate(lab.latest.measured_at)}</span>
                        </span>
                        <span className="flex shrink-0 items-center gap-2 text-right">
                          {lab.previous ? (
                            <span className="hidden text-xs text-muted-foreground tabular-nums sm:inline">
                              {formatLabValue(lab.previous)} →
                            </span>
                          ) : null}
                          <span className="font-semibold tabular-nums">{formatLabValue(lab.latest)}</span>
                          <TrendIndicator trend={delta?.direction} />
                          <FlagBadge flag={lab.latest.flag} />
                        </span>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <CalendarClock className="size-4 text-muted-foreground" aria-hidden /> Upcoming
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.upcoming.length === 0 ? (
                <p className="text-sm text-muted-foreground">No follow-ups found in your documents.</p>
              ) : (
                <ul className="space-y-3">
                  {data.upcoming.map((u) => (
                    <li key={`${u.document_id}-${u.date}`} className="flex gap-3">
                      <span className="flex w-12 shrink-0 flex-col items-center rounded-lg bg-chart-3/15 py-1 text-center leading-tight">
                        <span className="text-[10px] uppercase text-muted-foreground">{formatDate(u.date).split(" ")[1]}</span>
                        <span className="text-lg font-semibold">{formatDate(u.date).split(" ")[0]}</span>
                      </span>
                      <span className="min-w-0 text-sm">
                        <span className="block font-medium">{ENCOUNTER_TYPE_LABELS[u.type]}</span>
                        <span className="block truncate text-muted-foreground">
                          {[u.doctor, u.facility].filter(Boolean).join(" · ") || formatRelative(u.date)}
                        </span>
                        {u.notes ? <span className="block truncate text-xs text-muted-foreground">{u.notes}</span> : null}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Recent documents</CardTitle>
              <UploadDialog
                profileId={profileId}
                trigger={
                  <Button variant="outline" size="sm">
                    <FileUp aria-hidden /> Upload
                  </Button>
                }
              />
            </CardHeader>
            <CardContent>
              {data.recent_documents.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing uploaded yet.</p>
              ) : (
                <ul className="space-y-1">
                  {data.recent_documents.map((doc) => (
                    <li key={doc.id}>
                      <Link
                        href={link(`documents/${doc.id}`)}
                        className="-mx-2 flex items-center gap-3 rounded-lg p-2 hover:bg-accent/50"
                      >
                        <DocTypeIcon type={doc.doc_type} className="size-8" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{documentTitle(doc)}</span>
                          <span className="text-xs text-muted-foreground">{formatDate(doc.doc_date ?? doc.created_at)}</span>
                        </span>
                        <StatusBadge status={doc.status} />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

export function DashboardView({ profileId }: { profileId: string }) {
  const summary = useSummary(profileId)
  const name = summary.data?.profile.name
  return (
    <div className="space-y-6">
      <PageHeader
        title={name ? (summary.data?.profile.relationship === "self" ? `Hello, ${name.split(" ")[0]}` : `${name}'s health`) : "Dashboard"}
        description="A summary of everything MedVault has organized so far."
        actions={<UploadDialog profileId={profileId} />}
      />
      {summary.isPending ? (
        <div className="space-y-4" aria-busy="true">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-20 rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-72 rounded-xl" />
        </div>
      ) : summary.isError ? (
        <ErrorState error={summary.error} onRetry={() => summary.refetch()} />
      ) : (
        <DashboardContent data={summary.data} profileId={profileId} />
      )}
    </div>
  )
}
