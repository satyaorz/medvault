import { Info } from "lucide-react"

export function Disclaimer() {
  return (
    <footer className="flex items-center justify-center gap-1.5 border-t px-4 py-3 text-xs text-muted-foreground">
      <Info className="size-3.5" aria-hidden />
      MedVault organizes your records — it is not medical advice.
    </footer>
  )
}
