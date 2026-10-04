"use client"

import { Monitor, Moon, Sun } from "lucide-react"
import { useTheme } from "next-themes"

import {
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu"

/** Theme radio group, meant to sit inside a DropdownMenuContent. */
export function ThemeMenuItems() {
  const { theme, setTheme } = useTheme()
  return (
    <>
      <DropdownMenuLabel className="text-xs text-muted-foreground">Theme</DropdownMenuLabel>
      <DropdownMenuRadioGroup value={theme ?? "system"} onValueChange={setTheme}>
        <DropdownMenuRadioItem value="light">
          <Sun aria-hidden /> Light
        </DropdownMenuRadioItem>
        <DropdownMenuRadioItem value="dark">
          <Moon aria-hidden /> Dark
        </DropdownMenuRadioItem>
        <DropdownMenuRadioItem value="system">
          <Monitor aria-hidden /> System
        </DropdownMenuRadioItem>
      </DropdownMenuRadioGroup>
    </>
  )
}
