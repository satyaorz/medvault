import { Logo } from "@/components/layout/logo"

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-8 bg-gradient-to-b from-accent/60 to-background px-4 py-12">
      <Logo />
      <div className="w-full max-w-sm">{children}</div>
      <p className="max-w-sm text-center text-xs text-muted-foreground">
        MedVault organizes your records — it is not medical advice.
      </p>
    </main>
  )
}
