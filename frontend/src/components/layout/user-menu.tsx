"use client"

import { ChevronsUpDown, LogOut, Users } from "lucide-react"
import Link from "next/link"

import { ThemeMenuItems } from "@/components/layout/theme-menu"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useLogout, useMe } from "@/hooks/use-auth"
import { initials } from "@/lib/format"
import { cn } from "@/lib/utils"

export function UserMenu({ className, align = "end" }: { className?: string; align?: "start" | "end" }) {
  const me = useMe()
  const logout = useLogout()
  const name = me.data?.name ?? "Account"

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className={cn("h-auto justify-start gap-2 px-2 py-1.5", className)}>
          <Avatar className="size-7">
            <AvatarFallback className="text-xs">{initials(name)}</AvatarFallback>
          </Avatar>
          <span className="grid min-w-0 flex-1 text-left leading-tight">
            <span className="truncate text-sm font-medium">{name}</span>
            <span className="truncate text-xs text-muted-foreground">{me.data?.email ?? ""}</span>
          </span>
          <ChevronsUpDown className="size-4 text-muted-foreground" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="w-56">
        <DropdownMenuLabel className="truncate">{me.data?.email ?? name}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/profiles">
            <Users aria-hidden /> Manage profiles
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <ThemeMenuItems />
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => logout.mutate()} disabled={logout.isPending}>
          <LogOut aria-hidden /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
