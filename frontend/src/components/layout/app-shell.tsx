"use client"

import { AppSidebar } from "@/components/layout/app-sidebar"
import { Disclaimer } from "@/components/layout/disclaimer"
import { Logo } from "@/components/layout/logo"
import { ErrorState } from "@/components/common/error-state"
import { Separator } from "@/components/ui/separator"
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { useProfiles } from "@/hooks/use-profiles"
import { ApiError } from "@/lib/api"
import Link from "next/link"

interface AppShellProps {
  profileId: string
  defaultOpen: boolean
  children: React.ReactNode
}

export function AppShell({ profileId, defaultOpen, children }: AppShellProps) {
  const profiles = useProfiles()
  const profile = profiles.data?.find((p) => p.id === profileId)
  const unknownProfile = profiles.isSuccess && !profile

  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <AppSidebar profileId={profileId} />
      <SidebarInset className="min-w-0">
        <header className="sticky top-0 z-10 flex h-14 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur md:hidden">
          <SidebarTrigger />
          <Separator orientation="vertical" className="h-5" />
          <Logo compact />
          <span className="truncate text-sm font-medium">{profile?.name}</span>
        </header>
        <div className="hidden px-4 pt-3 md:block">
          <SidebarTrigger className="text-muted-foreground" />
        </div>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-10 pt-4 md:px-8">
          {unknownProfile ? (
            <div className="mx-auto max-w-md space-y-3 py-12">
              <ErrorState error={new ApiError(404, "not_found", "profile not found")} />
              <Link href="/" className="text-sm text-primary underline-offset-4 hover:underline">
                Go to your records
              </Link>
            </div>
          ) : (
            children
          )}
        </main>
        <Disclaimer />
      </SidebarInset>
    </SidebarProvider>
  )
}
