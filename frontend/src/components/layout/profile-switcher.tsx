"use client"

import { Check, ChevronsUpDown, Plus, Settings2 } from "lucide-react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar"
import { Skeleton } from "@/components/ui/skeleton"
import { useProfiles } from "@/hooks/use-profiles"
import { RELATIONSHIP_LABELS } from "@/lib/constants"
import { initials } from "@/lib/format"
import { profilePath } from "@/lib/navigation"

/** Switch the active family profile, staying on the same section (Labs → Dad's Labs). */
export function ProfileSwitcher({ profileId }: { profileId: string }) {
  const profiles = useProfiles()
  const router = useRouter()
  const pathname = usePathname()
  const active = profiles.data?.find((p) => p.id === profileId)
  // /p/<pid>/<section>/... → keep only the top-level section; detail pages don't exist for other profiles.
  const section = pathname.split("/")[3] ?? "dashboard"

  if (profiles.isPending) return <Skeleton className="h-12 w-full" />

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton size="lg" className="data-[state=open]:bg-sidebar-accent">
              <Avatar className="size-8 rounded-lg">
                <AvatarFallback className="rounded-lg bg-primary/10 text-primary">
                  {initials(active?.name ?? "?")}
                </AvatarFallback>
              </Avatar>
              <span className="grid flex-1 text-left leading-tight">
                <span className="truncate font-medium">{active?.name ?? "Unknown profile"}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {active ? RELATIONSHIP_LABELS[active.relationship] : "Switch profile"}
                </span>
              </span>
              <ChevronsUpDown className="ml-auto size-4" aria-hidden />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-(--radix-dropdown-menu-trigger-width) min-w-56" align="start">
            <DropdownMenuLabel className="text-xs text-muted-foreground">Family profiles</DropdownMenuLabel>
            {profiles.data?.map((profile) => (
              <DropdownMenuItem key={profile.id} onSelect={() => router.push(profilePath(profile.id, section))}>
                <Avatar className="size-6 rounded-md">
                  <AvatarFallback className="rounded-md text-[10px]">{initials(profile.name)}</AvatarFallback>
                </Avatar>
                <span className="flex-1 truncate">{profile.name}</span>
                {profile.id === profileId ? <Check className="size-4" aria-label="Current" /> : null}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/profiles?new=1">
                <Plus aria-hidden /> Add family member
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/profiles">
                <Settings2 aria-hidden /> Manage profiles
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
