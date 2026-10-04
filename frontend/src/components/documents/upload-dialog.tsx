"use client"

import { useQueryClient } from "@tanstack/react-query"
import { CheckCircle2, FileUp, Loader2, UploadCloud, X, XCircle } from "lucide-react"
import { useRouter } from "next/navigation"
import { useCallback, useId, useRef, useState } from "react"
import { toast } from "sonner"

import { FormField } from "@/components/common/form-field"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ApiError } from "@/lib/api"
import { DOC_TYPE_LABELS, SELECTABLE_DOC_TYPES } from "@/lib/constants"
import { formatBytes, todayISO } from "@/lib/format"
import { profilePath } from "@/lib/navigation"
import { qk } from "@/lib/query-keys"
import type { DocType } from "@/lib/types"
import { ACCEPT_ATTRIBUTE, uploadDocument, validateUploadFile, type UploadMetadata } from "@/lib/upload"
import { cn } from "@/lib/utils"

type EntryState = "ready" | "invalid" | "uploading" | "done" | "error"

interface Entry {
  key: string
  file: File
  state: EntryState
  progress: number
  message?: string
  abort?: () => void
}

const AUTO = "__auto"
const MAX_PARALLEL = 2

export function UploadDialog({ profileId, trigger }: { profileId: string; trigger?: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const [entries, setEntries] = useState<Entry[]>([])
  const [dragging, setDragging] = useState(false)
  const [title, setTitle] = useState("")
  const [docDate, setDocDate] = useState("")
  const [docType, setDocType] = useState<string>(AUTO)
  const [source, setSource] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)
  const queryClient = useQueryClient()
  const router = useRouter()
  const ids = useId()

  const uploading = entries.some((e) => e.state === "uploading")
  const readyCount = entries.filter((e) => e.state === "ready").length

  const update = (key: string, patch: Partial<Entry>) =>
    setEntries((list) => list.map((e) => (e.key === key ? { ...e, ...patch } : e)))

  const addFiles = useCallback((files: FileList | File[]) => {
    const next = Array.from(files).map<Entry>((file) => {
      const problem = validateUploadFile(file)
      return {
        key: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2)}`,
        file,
        state: problem ? "invalid" : "ready",
        progress: 0,
        message: problem ?? undefined,
      }
    })
    setEntries((list) => [...list.filter((e) => e.state !== "done"), ...next])
  }, [])

  const reset = () => {
    setEntries([])
    setTitle("")
    setDocDate("")
    setDocType(AUTO)
    setSource("")
  }

  const uploadOne = async (entry: Entry, metadata: UploadMetadata) => {
    const handle = uploadDocument(profileId, entry.file, metadata, (fraction) =>
      update(entry.key, { progress: Math.round(fraction * 100) }),
    )
    update(entry.key, { state: "uploading", progress: 0, abort: handle.abort, message: undefined })
    try {
      await handle.promise
      update(entry.key, { state: "done", progress: 100, abort: undefined })
      return true
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        update(entry.key, { state: "ready", progress: 0, abort: undefined })
        return false
      }
      const apiError = error instanceof ApiError ? error : null
      if (apiError?.status === 409 && apiError.existingId) {
        const existingId = apiError.existingId
        update(entry.key, { state: "error", abort: undefined, message: "Already in this profile." })
        toast.info(`"${entry.file.name}" was already uploaded`, {
          action: {
            label: "Open",
            onClick: () => router.push(profilePath(profileId, `documents/${existingId}`)),
          },
        })
      } else {
        update(entry.key, {
          state: "error",
          abort: undefined,
          message: apiError?.message ?? "Upload failed.",
        })
      }
      return false
    }
  }

  const startUpload = async () => {
    const queue = entries.filter((e) => e.state === "ready" || e.state === "error")
    if (queue.length === 0) return
    const metadata: UploadMetadata = {
      title: queue.length === 1 && title.trim() ? title.trim() : undefined,
      doc_date: docDate || undefined,
      doc_type: docType === AUTO ? undefined : (docType as DocType),
      source: source.trim() || undefined,
    }
    let succeeded = 0
    let cursor = 0
    const worker = async () => {
      while (cursor < queue.length) {
        const entry = queue[cursor++]
        if (await uploadOne(entry, metadata)) succeeded++
      }
    }
    await Promise.all(Array.from({ length: Math.min(MAX_PARALLEL, queue.length) }, worker))

    if (succeeded > 0) {
      queryClient.invalidateQueries({ queryKey: qk.profile(profileId) })
      queryClient.invalidateQueries({ queryKey: qk.profiles })
      toast.success(
        succeeded === 1 ? "Document uploaded — processing has started" : `${succeeded} documents uploaded — processing has started`,
      )
    }
    if (succeeded === queue.length) {
      setOpen(false)
      reset()
    }
  }

  const onOpenChange = (next: boolean) => {
    if (!next && uploading) return // keep the dialog while bytes are in flight
    setOpen(next)
    if (!next) reset()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <FileUp aria-hidden /> Upload
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Upload medical documents</DialogTitle>
          <DialogDescription>
            Prescriptions, lab reports or discharge summaries — PDF or photo, up to 20 MB each. We&apos;ll read and
            organize them for you.
          </DialogDescription>
        </DialogHeader>

        <div
          role="button"
          tabIndex={0}
          aria-label="Choose files to upload, or drop them here"
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault()
              inputRef.current?.click()
            }
          }}
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragging(false)
            if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files)
          }}
          className={cn(
            "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
            dragging ? "border-primary bg-accent" : "border-border hover:border-primary/50 hover:bg-accent/40",
          )}
        >
          <UploadCloud className="size-8 text-primary" aria-hidden />
          <p className="text-sm font-medium">Drop files here or click to browse</p>
          <p className="text-xs text-muted-foreground">PDF, PNG, JPEG, WEBP · max 20 MB</p>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={ACCEPT_ATTRIBUTE}
            className="sr-only"
            tabIndex={-1}
            onChange={(e) => {
              if (e.target.files?.length) addFiles(e.target.files)
              e.target.value = ""
            }}
          />
        </div>

        {entries.length > 0 ? (
          <ul className="max-h-48 space-y-2 overflow-y-auto pr-1" aria-label="Selected files">
            {entries.map((entry) => (
              <li key={entry.key} className="rounded-lg border p-2.5">
                <div className="flex items-center gap-2">
                  <EntryIcon state={entry.state} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{entry.file.name}</p>
                    <p
                      className={cn(
                        "text-xs",
                        entry.state === "invalid" || entry.state === "error" ? "text-destructive" : "text-muted-foreground",
                      )}
                    >
                      {entry.message ?? formatBytes(entry.file.size)}
                    </p>
                  </div>
                  {entry.state === "uploading" ? (
                    <Button variant="ghost" size="icon-sm" onClick={() => entry.abort?.()} aria-label={`Cancel ${entry.file.name}`}>
                      <X aria-hidden />
                    </Button>
                  ) : entry.state !== "done" ? (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => setEntries((list) => list.filter((e) => e.key !== entry.key))}
                      aria-label={`Remove ${entry.file.name}`}
                    >
                      <X aria-hidden />
                    </Button>
                  ) : null}
                </div>
                {entry.state === "uploading" || entry.state === "done" ? (
                  <Progress value={entry.progress} className="mt-2 h-1.5" aria-label={`${entry.file.name} upload progress`} />
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}

        <fieldset className="grid gap-3 sm:grid-cols-2" disabled={uploading}>
          <legend className="sr-only">Optional details</legend>
          {entries.length <= 1 ? (
            <FormField id={`${ids}-title`} label="Title (optional)" className="sm:col-span-2">
              <Input id={`${ids}-title`} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Annual blood test" maxLength={200} />
            </FormField>
          ) : null}
          <FormField id={`${ids}-type`} label="Type">
            <Select value={docType} onValueChange={setDocType}>
              <SelectTrigger id={`${ids}-type`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={AUTO}>Detect automatically</SelectItem>
                {SELECTABLE_DOC_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {DOC_TYPE_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField id={`${ids}-date`} label="Document date">
            <Input id={`${ids}-date`} type="date" max={todayISO()} value={docDate} onChange={(e) => setDocDate(e.target.value)} />
          </FormField>
          <FormField id={`${ids}-source`} label="Hospital / lab (optional)" className="sm:col-span-2">
            <Input id={`${ids}-source`} value={source} onChange={(e) => setSource(e.target.value)} placeholder="e.g. Apollo Diagnostics" maxLength={200} />
          </FormField>
        </fieldset>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={uploading}>
            Cancel
          </Button>
          <Button onClick={startUpload} disabled={uploading || (readyCount === 0 && !entries.some((e) => e.state === "error"))}>
            {uploading ? <Loader2 className="animate-spin" aria-hidden /> : <FileUp aria-hidden />}
            {uploading ? "Uploading…" : readyCount > 1 ? `Upload ${readyCount} files` : "Upload"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function EntryIcon({ state }: { state: EntryState }) {
  if (state === "done") return <CheckCircle2 className="size-4 shrink-0 text-success" aria-label="Uploaded" />
  if (state === "uploading") return <Loader2 className="size-4 shrink-0 animate-spin text-primary" aria-label="Uploading" />
  if (state === "invalid" || state === "error") return <XCircle className="size-4 shrink-0 text-destructive" aria-label="Problem" />
  return <FileUp className="size-4 shrink-0 text-muted-foreground" aria-hidden />
}
