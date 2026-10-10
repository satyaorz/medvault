import Link from "next/link"

import { Disclaimer } from "@/components/layout/disclaimer"
import { Logo } from "@/components/layout/logo"
import { UserMenu } from "@/components/layout/user-menu"

export default function ProfilesLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col">
      <header className="flex h-14 items-center justify-between border-b px-4 md:px-8">
        <Link href="/">
          <Logo />
        </Link>
        <UserMenu className="max-w-56" />
      </header>
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-6 md:px-8">{children}</main>
      <Disclaimer />
    </div>
  )
}
