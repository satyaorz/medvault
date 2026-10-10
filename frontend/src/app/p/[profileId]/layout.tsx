import { cookies } from "next/headers"

import { AppShell } from "@/components/layout/app-shell"

export default async function ProfileLayout({ children, params }: LayoutProps<"/p/[profileId]">) {
  const { profileId } = await params
  const cookieStore = await cookies()
  const sidebarOpen = cookieStore.get("sidebar_state")?.value !== "false"
  return (
    <AppShell profileId={profileId} defaultOpen={sidebarOpen}>
      {children}
    </AppShell>
  )
}
