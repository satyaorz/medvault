"use client"

import { ArrowLeft, ArrowRight, Pencil, Plus, Trash2, Users } from "lucide-react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useEffect, useState } from "react"
import { toast } from "sonner"

import { EmptyState } from "@/components/common/empty-state"
import { ErrorState, errorMessage } from "@/components/common/error-state"
import { PageHeader } from "@/components/common/page-header"
import { ProfileFormDialog } from "@/components/profiles/profile-form-dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useDeleteProfile, useProfiles } from "@/hooks/use-profiles"
import { ApiError } from "@/lib/api"
import { RELATIONSHIP_LABELS, SEX_LABELS } from "@/lib/constants"
import { ageFromDob, initials } from "@/lib/format"
import { profilePath } from "@/lib/navigation"
import type { Profile } from "@/lib/types"

export function ProfilesView() {
  const profiles = useProfiles()
  const deleteProfile = useDeleteProfile()
  const searchParams = useSearchParams()
  const router = useRouter()
  const [editing, setEditing] = useState<Profile | null>(null)
  // /profiles?new=1 (from the profile switcher) opens the create dialog straight away.
  const [formOpen, setFormOpen] = useState(() => searchParams.get("new") === "1")
  const [toDelete, setToDelete] = useState<Profile | null>(null)

  useEffect(() => {
    if (searchParams.get("new") === "1") router.replace("/profiles")
  }, [searchParams, router])

  const openCreate = () => {
    setEditing(null)
    setFormOpen(true)
  }

  const confirmDelete = async () => {
    if (!toDelete) return
    try {
      await deleteProfile.mutateAsync(toDelete.id)
      toast.success(`Deleted ${toDelete.name}'s profile`)
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) toast.error("You need at least one profile", { description: "Add another profile before deleting this one." })
      else toast.error("Couldn't delete the profile", { description: errorMessage(error) })
    } finally {
      setToDelete(null)
    }
  }

  const first = profiles.data?.[0]

  return (
    <div className="space-y-6">
      {first ? (
        <Button variant="ghost" size="sm" asChild className="-ml-2 text-muted-foreground">
          <Link href={profilePath(first.id)}>
            <ArrowLeft aria-hidden /> Back to records
          </Link>
        </Button>
      ) : null}
      <PageHeader
        title="Family profiles"
        description="Keep separate records for everyone you care for."
        actions={
          <Button onClick={openCreate}>
            <Plus aria-hidden /> Add family member
          </Button>
        }
      />

      {profiles.isPending ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {Array.from({ length: 2 }, (_, i) => (
            <Skeleton key={i} className="h-32 rounded-xl" />
          ))}
        </div>
      ) : profiles.isError ? (
        <ErrorState error={profiles.error} onRetry={() => profiles.refetch()} />
      ) : profiles.data.length === 0 ? (
        <EmptyState icon={Users} title="No profiles" description="Create a profile to start uploading records." action={<Button onClick={openCreate}>Add profile</Button>} />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {profiles.data.map((profile) => {
            const age = ageFromDob(profile.date_of_birth)
            return (
              <li key={profile.id}>
                <Card className="h-full py-4">
                  <CardContent className="flex h-full flex-col gap-4 px-4">
                    <div className="flex items-start gap-3">
                      <Avatar className="size-11 rounded-xl">
                        <AvatarFallback className="rounded-xl bg-primary/10 text-primary">{initials(profile.name)}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="truncate font-semibold">{profile.name}</h2>
                          <Badge variant="secondary">{RELATIONSHIP_LABELS[profile.relationship]}</Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {[
                            age !== null ? `${age} years` : null,
                            profile.sex ? SEX_LABELS[profile.sex] : null,
                            `${profile.document_count} ${profile.document_count === 1 ? "document" : "documents"}`,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      </div>
                    </div>
                    <div className="mt-auto flex flex-wrap gap-2">
                      <Button size="sm" asChild>
                        <Link href={profilePath(profile.id)}>
                          Open records <ArrowRight aria-hidden />
                        </Link>
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setEditing(profile)
                          setFormOpen(true)
                        }}
                      >
                        <Pencil aria-hidden /> Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
                        onClick={() => setToDelete(profile)}
                        disabled={profiles.data.length <= 1}
                        title={profiles.data.length <= 1 ? "You need at least one profile" : undefined}
                      >
                        <Trash2 aria-hidden /> Delete
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </li>
            )
          })}
        </ul>
      )}

      <ProfileFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        profile={editing}
        onSaved={(saved) => {
          if (!editing) router.push(profilePath(saved.id))
        }}
      />

      <AlertDialog open={!!toDelete} onOpenChange={(open) => !open && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {toDelete?.name}&apos;s profile?</AlertDialogTitle>
            <AlertDialogDescription>
              All of their documents, original files, lab results and medicines will be permanently deleted. This can&apos;t
              be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={confirmDelete} disabled={deleteProfile.isPending}>
              Delete profile
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
