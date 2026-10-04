"use client"

import { CalendarRange, ClipboardCheck, FileText, FlaskConical, LayoutDashboard, Pill } from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"

import { Logo } from "@/components/layout/logo"
import { ProfileSwitcher } from "@/components/layout/profile-switcher"
import { UserMenu } from "@/components/layout/user-menu"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar"
import { useSummary } from "@/hooks/use-profiles"
import { profilePath } from "@/lib/navigation"

const NAV = [
  { section: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { section: "documents", label: "Documents", icon: FileText },
  { section: "timeline", label: "Timeline", icon: CalendarRange },
  { section: "labs", label: "Labs", icon: FlaskConical },
  { section: "medications", label: "Medications", icon: Pill },
  { section: "review", label: "Review", icon: ClipboardCheck },
] as const

export function AppSidebar({ profileId }: { profileId: string }) {
  const pathname = usePathname()
  const summary = useSummary(profileId)
  const pending = summary.data?.counts.pending_review ?? 0
  const { setOpenMobile } = useSidebar()

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="gap-3">
        <Link href={profilePath(profileId)} className="px-2 pt-1 group-data-[collapsible=icon]:px-0">
          <Logo className="group-data-[collapsible=icon]:hidden" />
          <Logo compact className="hidden group-data-[collapsible=icon]:inline-flex" />
        </Link>
        <ProfileSwitcher profileId={profileId} />
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Records</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV.map(({ section, label, icon: Icon }) => {
                const href = profilePath(profileId, section)
                const active = pathname === href || pathname.startsWith(`${href}/`)
                return (
                  <SidebarMenuItem key={section}>
                    <SidebarMenuButton asChild isActive={active} tooltip={label}>
                      <Link href={href} onClick={() => setOpenMobile(false)} aria-current={active ? "page" : undefined}>
                        <Icon aria-hidden />
                        <span>{label}</span>
                      </Link>
                    </SidebarMenuButton>
                    {section === "review" && pending > 0 ? (
                      <SidebarMenuBadge className="rounded-full bg-warning/20 text-warning-foreground dark:text-warning">
                        <span className="sr-only">Items waiting for review: </span>
                        {pending}
                      </SidebarMenuBadge>
                    ) : null}
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <UserMenu className="w-full group-data-[collapsible=icon]:hidden" align="start" />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
