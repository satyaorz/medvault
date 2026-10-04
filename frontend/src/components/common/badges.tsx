import { AlertCircle, CheckCircle2, Clock, Loader2, ShieldCheck, ShieldQuestion, XCircle } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { DOC_STATUS_LABELS, DOC_TYPE_LABELS } from "@/lib/constants"
import { FLAG_LABELS, confidenceLevel, flagClasses, formatPercent } from "@/lib/format"
import type { DocStatus, DocType, ItemStatus, LabFlag } from "@/lib/types"
import { cn } from "@/lib/utils"

const STATUS_STYLES: Record<DocStatus, string> = {
  queued: "bg-muted text-muted-foreground border-border",
  processing: "bg-info/10 text-info border-info/20",
  needs_review: "bg-warning/15 text-warning-foreground dark:text-warning border-warning/30",
  completed: "bg-success/10 text-success border-success/20",
  failed: "bg-destructive/10 text-destructive border-destructive/20",
}

const STATUS_ICONS = {
  queued: Clock,
  processing: Loader2,
  needs_review: AlertCircle,
  completed: CheckCircle2,
  failed: XCircle,
} satisfies Record<DocStatus, unknown>

export function StatusBadge({ status, className }: { status: DocStatus; className?: string }) {
  const Icon = STATUS_ICONS[status]
  return (
    <Badge variant="outline" className={cn("gap-1 font-medium", STATUS_STYLES[status], className)}>
      <Icon className={cn("size-3", status === "processing" && "animate-spin")} aria-hidden />
      {DOC_STATUS_LABELS[status]}
    </Badge>
  )
}

export function DocTypeBadge({ type, className }: { type: DocType | "follow_up"; className?: string }) {
  return (
    <Badge variant="secondary" className={cn("font-normal", className)}>
      {DOC_TYPE_LABELS[type]}
    </Badge>
  )
}

export function FlagBadge({ flag, className }: { flag: LabFlag | null | undefined; className?: string }) {
  if (!flag) return null
  return (
    <Badge variant="outline" className={cn("font-medium", flagClasses(flag), className)}>
      {FLAG_LABELS[flag]}
    </Badge>
  )
}

const CONFIDENCE_STYLES = {
  high: "bg-success/10 text-success border-success/20",
  medium: "bg-warning/15 text-warning-foreground dark:text-warning border-warning/30",
  low: "bg-destructive/10 text-destructive border-destructive/20",
}

export function ConfidenceBadge({ confidence, className }: { confidence: number; className?: string }) {
  const level = confidenceLevel(confidence)
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant="outline" className={cn("tabular-nums", CONFIDENCE_STYLES[level], className)}>
          {formatPercent(confidence)} confident
        </Badge>
      </TooltipTrigger>
      <TooltipContent>
        Combined score from the extractor, the grounding check and normalization. Items at 85%+ with no issues
        are accepted automatically.
      </TooltipContent>
    </Tooltip>
  )
}

export function GroundedBadge({ grounded }: { grounded: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="outline"
          className={cn(
            "gap-1",
            grounded ? "text-success border-success/20" : "text-warning-foreground dark:text-warning border-warning/30",
          )}
        >
          {grounded ? <ShieldCheck className="size-3" aria-hidden /> : <ShieldQuestion className="size-3" aria-hidden />}
          {grounded ? "Found in document" : "Not found verbatim"}
        </Badge>
      </TooltipTrigger>
      <TooltipContent>
        {grounded
          ? "The quoted text was located in the document's OCR text."
          : "The extractor's quote couldn't be matched to the document text — double-check it."}
      </TooltipContent>
    </Tooltip>
  )
}

const ITEM_STATUS_STYLES: Record<ItemStatus, string> = {
  needs_review: "bg-warning/15 text-warning-foreground dark:text-warning border-warning/30",
  accepted: "bg-success/10 text-success border-success/20",
  rejected: "bg-muted text-muted-foreground border-border line-through",
}

const ITEM_STATUS_LABELS: Record<ItemStatus, string> = {
  needs_review: "Needs review",
  accepted: "Accepted",
  rejected: "Rejected",
}

export function ItemStatusBadge({ status, reviewedBy }: { status: ItemStatus; reviewedBy: "auto" | "user" | null }) {
  const suffix = status === "accepted" && reviewedBy ? (reviewedBy === "auto" ? " · auto" : " · by you") : ""
  return (
    <Badge variant="outline" className={ITEM_STATUS_STYLES[status]}>
      {ITEM_STATUS_LABELS[status]}
      {suffix}
    </Badge>
  )
}
