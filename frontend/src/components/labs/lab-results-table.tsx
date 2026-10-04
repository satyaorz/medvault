import { FileText } from "lucide-react"
import Link from "next/link"

import { FlagBadge } from "@/components/common/badges"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatDate, formatLabValue, formatOriginalLab, formatReferenceRange } from "@/lib/format"
import { profilePath } from "@/lib/navigation"
import type { LabPoint } from "@/lib/types"

/** Normalized value next to what was literally printed — shows the normalization engine at work. */
export function LabResultsTable({ results, profileId }: { results: LabPoint[]; profileId: string }) {
  const rows = [...results].reverse() // newest first
  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-4">Date</TableHead>
            <TableHead>Result</TableHead>
            <TableHead>Flag</TableHead>
            <TableHead>As printed on report</TableHead>
            <TableHead>Reference</TableHead>
            <TableHead className="pr-4 text-right">
              <span className="sr-only">Source document</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="whitespace-nowrap pl-4">{formatDate(r.measured_at)}</TableCell>
              <TableCell className="font-medium tabular-nums">{formatLabValue(r)}</TableCell>
              <TableCell>
                <FlagBadge flag={r.flag} />
              </TableCell>
              <TableCell className="font-mono text-xs text-muted-foreground">{formatOriginalLab(r)}</TableCell>
              <TableCell className="whitespace-nowrap text-muted-foreground">
                {formatReferenceRange(r.reference_low, r.reference_high, r.unit) ?? "—"}
              </TableCell>
              <TableCell className="pr-4 text-right">
                <Button variant="ghost" size="icon-sm" asChild>
                  <Link href={profilePath(profileId, `documents/${r.document_id}`)} aria-label={`Open the report from ${formatDate(r.measured_at)}`}>
                    <FileText aria-hidden />
                  </Link>
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
