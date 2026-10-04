import { ShieldPlus } from "lucide-react"

import { cn } from "@/lib/utils"

export function Logo({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-semibold tracking-tight", className)}>
      <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
        <ShieldPlus className="size-4.5" aria-hidden />
      </span>
      {compact ? <span className="sr-only">MedVault</span> : <span className="text-lg">MedVault</span>}
    </span>
  )
}
