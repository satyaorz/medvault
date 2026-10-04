"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { Loader2, RotateCw, Save, Trash2 } from "lucide-react"
import { useRouter } from "next/navigation"
import { useEffect } from "react"
import { Controller, useForm } from "react-hook-form"
import { toast } from "sonner"

import { errorMessage } from "@/components/common/error-state"
import { FormField, describedBy } from "@/components/common/form-field"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { useDeleteDocument, useReprocessDocument, useUpdateDocument } from "@/hooks/use-documents"
import { DOC_TYPE_LABELS, SELECTABLE_DOC_TYPES } from "@/lib/constants"
import { formatBytes, formatDateTime, formatPercent, isInFlight, todayISO } from "@/lib/format"
import { profilePath } from "@/lib/navigation"
import type { DocType, DocumentDetail, DocumentPatch } from "@/lib/types"
import { documentMetaSchema, type DocumentMetaValues } from "@/lib/validation"

const UNSET = "__unset"

function toValues(doc: DocumentDetail): DocumentMetaValues {
  return {
    title: doc.title ?? "",
    doc_date: doc.doc_date ?? "",
    doc_type: doc.doc_type === "unknown" ? "" : doc.doc_type,
    source: doc.source ?? "",
  }
}

/** Only send fields that actually changed. Exported for tests. */
export function diffDocumentPatch(original: DocumentMetaValues, next: DocumentMetaValues): DocumentPatch {
  const patch: DocumentPatch = {}
  if (next.title.trim() !== original.title) patch.title = next.title.trim() || null
  if (next.doc_date !== original.doc_date) patch.doc_date = next.doc_date || null
  if (next.doc_type !== original.doc_type && next.doc_type) patch.doc_type = next.doc_type as DocType
  if (next.source.trim() !== original.source) patch.source = next.source.trim() || null
  return patch
}

export function DocumentDetailsForm({ doc }: { doc: DocumentDetail }) {
  const router = useRouter()
  const updateDoc = useUpdateDocument()
  const reprocess = useReprocessDocument()
  const deleteDoc = useDeleteDocument()
  const form = useForm<DocumentMetaValues>({ resolver: zodResolver(documentMetaSchema), defaultValues: toValues(doc) })
  const { errors, isDirty } = form.formState

  // Re-sync when the server copy changes (e.g. AI filled in the date) and the user hasn't edited.
  useEffect(() => {
    if (!form.formState.isDirty) form.reset(toValues(doc))
  }, [doc, form])

  const onSubmit = form.handleSubmit(async (values) => {
    const patch = diffDocumentPatch(toValues(doc), values)
    if (Object.keys(patch).length === 0) return
    try {
      await updateDoc.mutateAsync({ id: doc.id, patch })
      form.reset(values)
      toast.success("Document details saved")
    } catch (error) {
      toast.error("Couldn't save", { description: errorMessage(error) })
    }
  })

  const onReprocess = async () => {
    try {
      await reprocess.mutateAsync(doc.id)
      toast.success("Reprocessing started", { description: "Previously extracted items will be replaced." })
    } catch (error) {
      toast.error("Couldn't reprocess", { description: errorMessage(error) })
    }
  }

  const onDelete = async () => {
    try {
      await deleteDoc.mutateAsync({ id: doc.id, profileId: doc.profile_id })
      toast.success("Document deleted")
      router.replace(profilePath(doc.profile_id, "documents"))
    } catch (error) {
      toast.error("Couldn't delete", { description: errorMessage(error) })
    }
  }

  return (
    <div className="space-y-6">
      <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2" noValidate>
        <FormField id="doc-title" label="Title" error={errors.title?.message} className="sm:col-span-2">
          <Input
            id="doc-title"
            placeholder={doc.filename}
            aria-invalid={!!errors.title}
            aria-describedby={describedBy("doc-title", errors.title?.message)}
            {...form.register("title")}
          />
        </FormField>
        <FormField
          id="doc-type"
          label="Document type"
          hint={doc.doc_type_source === "ai" && doc.classification_confidence !== null ? `Detected automatically (${formatPercent(doc.classification_confidence)} confident)` : doc.doc_type_source === "user" ? "Set by you" : undefined}
        >
          <Controller
            control={form.control}
            name="doc_type"
            render={({ field }) => (
              <Select value={field.value || UNSET} onValueChange={(v) => field.onChange(v === UNSET ? "" : v)}>
                <SelectTrigger id="doc-type" className="w-full" aria-describedby="doc-type-hint">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {!field.value ? <SelectItem value={UNSET}>Unclassified</SelectItem> : null}
                  {SELECTABLE_DOC_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {DOC_TYPE_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </FormField>
        <FormField id="doc-date" label="Document date" error={errors.doc_date?.message}>
          <Input
            id="doc-date"
            type="date"
            max={todayISO()}
            aria-invalid={!!errors.doc_date}
            aria-describedby={describedBy("doc-date", errors.doc_date?.message)}
            {...form.register("doc_date")}
          />
        </FormField>
        <FormField id="doc-source" label="Hospital / lab" error={errors.source?.message} className="sm:col-span-2">
          <Input id="doc-source" aria-invalid={!!errors.source} {...form.register("source")} />
        </FormField>
        <div className="flex gap-2 sm:col-span-2">
          <Button type="submit" disabled={!isDirty || updateDoc.isPending}>
            {updateDoc.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <Save aria-hidden />}
            Save changes
          </Button>
          {isDirty ? (
            <Button type="button" variant="ghost" onClick={() => form.reset(toValues(doc))}>
              Discard
            </Button>
          ) : null}
        </div>
      </form>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg bg-muted/40 p-4 text-sm">
        <dt className="text-muted-foreground">File</dt>
        <dd className="truncate">{doc.filename}</dd>
        <dt className="text-muted-foreground">Size</dt>
        <dd>{formatBytes(doc.size_bytes)}</dd>
        <dt className="text-muted-foreground">Uploaded</dt>
        <dd>{formatDateTime(doc.created_at)}</dd>
        <dt className="text-muted-foreground">Last updated</dt>
        <dd>{formatDateTime(doc.updated_at)}</dd>
      </dl>

      <Separator />

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={onReprocess} disabled={reprocess.isPending || isInFlight(doc.status)}>
          {reprocess.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <RotateCw aria-hidden />}
          Reprocess
        </Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" disabled={deleteDoc.isPending}>
              <Trash2 aria-hidden /> Delete document
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this document?</AlertDialogTitle>
              <AlertDialogDescription>
                The original file and everything extracted from it — lab values, medicines, diagnoses — will be
                permanently removed from your records.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={onDelete}>
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  )
}
