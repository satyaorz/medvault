import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

interface FormFieldProps {
  id: string
  label: React.ReactNode
  error?: string
  hint?: React.ReactNode
  className?: string
  children: React.ReactNode
}

/**
 * Label + control + error/hint. The control must set `id={id}` and
 * `aria-describedby={describedBy(id, error)}` for screen readers.
 */
export function FormField({ id, label, error, hint, className, children }: FormFieldProps) {
  return (
    <div className={cn("grid gap-1.5", className)}>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

export function describedBy(id: string, error?: string, hasHint = false): string | undefined {
  if (error) return `${id}-error`
  return hasHint ? `${id}-hint` : undefined
}
