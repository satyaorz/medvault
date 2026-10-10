"use client"

import { Search, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DOC_STATUSES, DOC_STATUS_LABELS, DOC_TYPES, DOC_TYPE_LABELS } from "@/lib/constants"
import type { DocStatus, DocType } from "@/lib/types"

export interface DocumentFilterValues {
  q: string
  type: DocType | ""
  status: DocStatus | ""
  from: string
  to: string
}

export const EMPTY_FILTERS: DocumentFilterValues = { q: "", type: "", status: "", from: "", to: "" }

const ALL = "__all"

export function DocumentFilters({
  value,
  onChange,
}: {
  value: DocumentFilterValues
  onChange: (next: DocumentFilterValues) => void
}) {
  const set = <K extends keyof DocumentFilterValues>(key: K, v: DocumentFilterValues[K]) => onChange({ ...value, [key]: v })
  const active = value.type || value.status || value.from || value.to || value.q

  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
      <div className="relative flex-1">
        <Label htmlFor="doc-search" className="sr-only">
          Search documents
        </Label>
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          id="doc-search"
          type="search"
          value={value.q}
          onChange={(e) => set("q", e.target.value)}
          placeholder="Search titles, filenames and document text…"
          className="pl-8"
        />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-end">
        <div className="grid gap-1">
          <Label htmlFor="doc-type-filter" className="text-xs text-muted-foreground">
            Type
          </Label>
          <Select value={value.type || ALL} onValueChange={(v) => set("type", v === ALL ? "" : (v as DocType))}>
            <SelectTrigger id="doc-type-filter" className="w-full sm:w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All types</SelectItem>
              {DOC_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {DOC_TYPE_LABELS[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1">
          <Label htmlFor="doc-status-filter" className="text-xs text-muted-foreground">
            Status
          </Label>
          <Select value={value.status || ALL} onValueChange={(v) => set("status", v === ALL ? "" : (v as DocStatus))}>
            <SelectTrigger id="doc-status-filter" className="w-full sm:w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Any status</SelectItem>
              {DOC_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {DOC_STATUS_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1">
          <Label htmlFor="doc-from" className="text-xs text-muted-foreground">
            From
          </Label>
          <Input id="doc-from" type="date" value={value.from} max={value.to || undefined} onChange={(e) => set("from", e.target.value)} className="sm:w-36" />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="doc-to" className="text-xs text-muted-foreground">
            To
          </Label>
          <Input id="doc-to" type="date" value={value.to} min={value.from || undefined} onChange={(e) => set("to", e.target.value)} className="sm:w-36" />
        </div>
        {active ? (
          <Button variant="ghost" onClick={() => onChange(EMPTY_FILTERS)} className="col-span-2 sm:col-span-1">
            <X aria-hidden /> Clear
          </Button>
        ) : null}
      </div>
    </div>
  )
}
