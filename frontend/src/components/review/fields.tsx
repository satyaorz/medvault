"use client"

import { Controller, type FieldValues, type Path, type UseFormReturn } from "react-hook-form"

import { FormField, describedBy } from "@/components/common/form-field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { NONE } from "@/lib/review-forms"

interface BaseProps<T extends FieldValues> {
  form: UseFormReturn<T>
  name: Path<T>
  label: string
  /** Unique prefix so several review cards on one page don't collide on ids. */
  idPrefix: string
  className?: string
  hint?: string
}

function fieldError<T extends FieldValues>(form: UseFormReturn<T>, name: Path<T>): string | undefined {
  const err = form.formState.errors[name]
  return typeof err?.message === "string" ? err.message : undefined
}

export function TextInput<T extends FieldValues>({
  form,
  name,
  label,
  idPrefix,
  className,
  hint,
  type = "text",
  inputMode,
  placeholder,
}: BaseProps<T> & { type?: string; inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"]; placeholder?: string }) {
  const id = `${idPrefix}-${name}`
  const error = fieldError(form, name)
  return (
    <FormField id={id} label={label} error={error} hint={hint} className={className}>
      <Input
        id={id}
        type={type}
        inputMode={inputMode}
        placeholder={placeholder}
        aria-invalid={!!error}
        aria-describedby={describedBy(id, error, !!hint)}
        {...form.register(name)}
      />
    </FormField>
  )
}

export function TextAreaInput<T extends FieldValues>({ form, name, label, idPrefix, className }: BaseProps<T>) {
  const id = `${idPrefix}-${name}`
  const error = fieldError(form, name)
  return (
    <FormField id={id} label={label} error={error} className={className}>
      <Textarea id={id} rows={2} aria-invalid={!!error} aria-describedby={describedBy(id, error)} {...form.register(name)} />
    </FormField>
  )
}

export function SelectInput<T extends FieldValues>({
  form,
  name,
  label,
  idPrefix,
  className,
  options,
  noneLabel,
}: BaseProps<T> & { options: { value: string; label: string }[]; noneLabel?: string }) {
  const id = `${idPrefix}-${name}`
  const error = fieldError(form, name)
  return (
    <FormField id={id} label={label} error={error} className={className}>
      <Controller
        control={form.control}
        name={name}
        render={({ field }) => (
          <Select value={field.value as string} onValueChange={field.onChange}>
            <SelectTrigger id={id} className="w-full" aria-invalid={!!error}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {noneLabel ? <SelectItem value={NONE}>{noneLabel}</SelectItem> : null}
              {options.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      />
    </FormField>
  )
}
