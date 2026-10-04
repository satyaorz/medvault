"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { AlertTriangle, Check, FileText, Loader2, X } from "lucide-react"
import Link from "next/link"
import { useForm, type FieldValues, type UseFormReturn } from "react-hook-form"
import { toast } from "sonner"

import { ConfidenceBadge, FlagBadge, GroundedBadge } from "@/components/common/badges"
import { errorMessage } from "@/components/common/error-state"
import { SourceQuote } from "@/components/documents/extracted-items"
import { SelectInput, TextAreaInput, TextInput } from "@/components/review/fields"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card"
import { useDecideItem } from "@/hooks/use-review"
import {
  DIAGNOSIS_STATUSES,
  DIAGNOSIS_STATUS_LABELS,
  DOC_TYPE_LABELS,
  ENCOUNTER_TYPES,
  ENCOUNTER_TYPE_LABELS,
  FORM_LABELS,
  FREQUENCY_CODES,
  FREQUENCY_LABELS,
  ITEM_KIND_LABELS,
  MEDICATION_FORMS,
  TIMINGS,
  TIMING_LABELS,
} from "@/lib/constants"
import { documentTitle, formatDate } from "@/lib/format"
import { summarizeItem } from "@/lib/items"
import { profilePath } from "@/lib/navigation"
import {
  buildAcceptPayload,
  reviewFormSchemas,
  toFormValues,
  type FormValuesByKind,
} from "@/lib/review-forms"
import type { ItemKind, ReviewItem } from "@/lib/types"

type ItemOf<K extends ItemKind> = Extract<ReviewItem, { kind: K }>

const options = <T extends string>(values: readonly T[], labels: Record<T, string>) =>
  values.map((value) => ({ value, label: labels[value] }))

function KindFields({ kind, form, idPrefix }: { kind: ItemKind; form: UseFormReturn<FieldValues>; idPrefix: string }) {
  const p = { form, idPrefix }
  switch (kind) {
    case "lab_result":
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <TextInput {...p} name="test_name_original" label="Test name (as printed)" />
          <TextInput {...p} name="canonical_name" label="Standard name" hint="Leave empty if unsure" />
          <TextInput {...p} name="value" label="Value" inputMode="decimal" />
          <TextInput {...p} name="unit" label="Unit" placeholder="e.g. g/dL" />
          <TextInput {...p} name="value_text" label="Text result" placeholder="e.g. Positive" hint="Only for non-numeric results" />
          <TextInput {...p} name="measured_at" label="Measured on" type="date" />
          <TextInput {...p} name="reference_low" label="Reference low" inputMode="decimal" />
          <TextInput {...p} name="reference_high" label="Reference high" inputMode="decimal" />
        </div>
      )
    case "medication":
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <TextInput {...p} name="generic_name" label="Medicine (generic)" />
          <TextInput {...p} name="brand_name" label="Brand" />
          <SelectInput {...p} name="form" label="Form" options={options(MEDICATION_FORMS, FORM_LABELS)} noneLabel="Not specified" />
          <div className="grid grid-cols-[1fr_6rem] gap-2">
            <TextInput {...p} name="dose_value" label="Dose" inputMode="decimal" />
            <TextInput {...p} name="dose_unit" label="Unit" placeholder="mg" />
          </div>
          <SelectInput
            {...p}
            name="frequency_code"
            label="Frequency"
            options={FREQUENCY_CODES.map((c) => ({ value: c, label: `${c} — ${FREQUENCY_LABELS[c]}` }))}
            noneLabel="Not specified"
          />
          <TextInput {...p} name="schedule" label="Schedule" placeholder="1-0-1" hint="Morning-afternoon-night" />
          <SelectInput {...p} name="timing" label="Timing" options={options(TIMINGS, TIMING_LABELS)} noneLabel="Not specified" />
          <TextInput {...p} name="duration_days" label="Duration (days)" inputMode="numeric" />
          <TextAreaInput {...p} name="instructions" label="Instructions" className="sm:col-span-2" />
        </div>
      )
    case "diagnosis":
      return (
        <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
          <TextInput {...p} name="name" label="Diagnosis" />
          <SelectInput {...p} name="status" label="Status" options={options(DIAGNOSIS_STATUSES, DIAGNOSIS_STATUS_LABELS)} noneLabel="Not specified" />
        </div>
      )
    case "allergy":
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <TextInput {...p} name="substance" label="Substance" />
          <TextInput {...p} name="reaction" label="Reaction" />
        </div>
      )
    case "encounter":
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectInput {...p} name="type" label="Type" options={options(ENCOUNTER_TYPES, ENCOUNTER_TYPE_LABELS)} />
          <TextInput {...p} name="date" label="Date" type="date" />
          <TextInput {...p} name="doctor" label="Doctor" />
          <TextInput {...p} name="facility" label="Hospital / clinic" />
          <TextAreaInput {...p} name="notes" label="Notes" className="sm:col-span-2" />
        </div>
      )
  }
}

export function ReviewCard<K extends ItemKind>({ item, profileId }: { item: ItemOf<K>; profileId: string }) {
  const decide = useDecideItem(profileId)
  const kind = item.kind as K
  const form = useForm<FormValuesByKind[K]>({
    // Zod schema per kind; the generic union makes RHF's resolver typing unhappy, so widen once here.
    resolver: zodResolver(reviewFormSchemas[kind] as never),
    defaultValues: toFormValues(kind, item.data as never) as never,
  })
  const summary = summarizeItem(item)
  const dirty = form.formState.isDirty
  const idPrefix = `item-${item.id}`

  const onAccept = form.handleSubmit(async (values) => {
    const input = buildAcceptPayload(item as never, values as never)
    try {
      await decide.mutateAsync({ item, input })
      toast.success(input.data ? `Saved your corrections to ${summary.label}` : `Accepted ${summary.label}`)
    } catch (error) {
      toast.error("Couldn't save this item", { description: errorMessage(error) })
    }
  })

  const onReject = async () => {
    try {
      await decide.mutateAsync({ item, input: { action: "reject" } })
      toast(`Rejected ${summary.label}`, { description: "It won't appear in your records." })
    } catch (error) {
      toast.error("Couldn't reject this item", { description: errorMessage(error) })
    }
  }

  const doc = item.document
  return (
    <Card aria-labelledby={`${idPrefix}-title`}>
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{ITEM_KIND_LABELS[item.kind]}</Badge>
              <h2 id={`${idPrefix}-title`} className="font-semibold">
                {summary.label}
                {summary.value ? <span className="ml-2 font-normal tabular-nums text-muted-foreground">{summary.value}</span> : null}
              </h2>
              <FlagBadge flag={summary.flag} />
            </div>
            <Link
              href={profilePath(profileId, `documents/${doc.id}`)}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary hover:underline"
            >
              <FileText className="size-3.5" aria-hidden />
              {documentTitle(doc)} · {DOC_TYPE_LABELS[doc.doc_type]} · {formatDate(doc.doc_date, "Undated")}
            </Link>
          </div>
          <div className="flex flex-wrap gap-1">
            <ConfidenceBadge confidence={item.confidence} />
            <GroundedBadge grounded={item.grounded} />
          </div>
        </div>
        <SourceQuote text={item.source_text} />
        {item.issues.length > 0 ? (
          <ul className="space-y-1" aria-label="Why this needs review">
            {item.issues.map((issue) => (
              <li key={issue} className="flex items-center gap-1.5 text-sm text-warning-foreground dark:text-warning">
                <AlertTriangle className="size-4 shrink-0" aria-hidden /> {issue}
              </li>
            ))}
          </ul>
        ) : null}
      </CardHeader>
      <form onSubmit={onAccept} noValidate>
        <CardContent>
          <fieldset disabled={decide.isPending}>
            <legend className="sr-only">Correct the extracted values if needed</legend>
            <KindFields kind={kind} form={form as unknown as UseFormReturn<FieldValues>} idPrefix={idPrefix} />
          </fieldset>
        </CardContent>
        <CardFooter className="mt-4 flex flex-wrap justify-end gap-2 border-t pt-4">
          <Button type="button" variant="outline" onClick={onReject} disabled={decide.isPending}>
            <X aria-hidden /> Reject
          </Button>
          <Button type="submit" disabled={decide.isPending}>
            {decide.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <Check aria-hidden />}
            {dirty ? "Save & accept" : "Accept"}
          </Button>
        </CardFooter>
      </form>
    </Card>
  )
}
