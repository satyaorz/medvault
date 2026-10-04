"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { Loader2 } from "lucide-react"
import { useEffect } from "react"
import { Controller, useForm } from "react-hook-form"
import { toast } from "sonner"

import { errorMessage } from "@/components/common/error-state"
import { FormField, describedBy } from "@/components/common/form-field"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useCreateProfile, useUpdateProfile } from "@/hooks/use-profiles"
import { ApiError } from "@/lib/api"
import { RELATIONSHIPS, RELATIONSHIP_LABELS, SEXES, SEX_LABELS } from "@/lib/constants"
import { todayISO } from "@/lib/format"
import type { Profile, ProfileInput } from "@/lib/types"
import { profileSchema, type ProfileValues } from "@/lib/validation"

const UNSPECIFIED = "__unspecified"

const toValues = (p?: Profile | null): ProfileValues => ({
  name: p?.name ?? "",
  relationship: p?.relationship ?? "parent",
  date_of_birth: p?.date_of_birth ?? "",
  sex: p?.sex ?? "",
})

export function toProfileInput(values: ProfileValues): ProfileInput {
  return {
    name: values.name.trim(),
    relationship: values.relationship,
    date_of_birth: values.date_of_birth || null,
    sex: values.sex || null,
  }
}

interface ProfileFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Edit this profile; omit to create a new one. */
  profile?: Profile | null
  onSaved?: (profile: Profile) => void
}

export function ProfileFormDialog({ open, onOpenChange, profile, onSaved }: ProfileFormDialogProps) {
  const create = useCreateProfile()
  const update = useUpdateProfile()
  const form = useForm<ProfileValues>({ resolver: zodResolver(profileSchema), defaultValues: toValues(profile) })
  const { errors } = form.formState
  const pending = create.isPending || update.isPending
  const editing = !!profile

  useEffect(() => {
    if (open) form.reset(toValues(profile))
  }, [open, profile, form])

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const input = toProfileInput(values)
      const saved = editing ? await update.mutateAsync({ id: profile.id, input }) : await create.mutateAsync(input)
      toast.success(editing ? "Profile updated" : `Added ${saved.name}`)
      onOpenChange(false)
      onSaved?.(saved)
    } catch (error) {
      if (error instanceof ApiError && error.code === "validation_failed") {
        for (const [field, message] of Object.entries(error.fields)) {
          if (field in values) form.setError(field as keyof ProfileValues, { message })
        }
      }
      toast.error("Couldn't save the profile", { description: errorMessage(error) })
    }
  })

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${profile.name}` : "Add a family member"}</DialogTitle>
          <DialogDescription>
            Each profile keeps its own documents, labs and medicines — handy when you manage records for parents or
            children.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-4" noValidate>
          <FormField id="profile-name" label="Name" error={errors.name?.message}>
            <Input
              id="profile-name"
              autoFocus
              aria-invalid={!!errors.name}
              aria-describedby={describedBy("profile-name", errors.name?.message)}
              {...form.register("name")}
            />
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField id="profile-relationship" label="Relationship" error={errors.relationship?.message}>
              <Controller
                control={form.control}
                name="relationship"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange} disabled={profile?.relationship === "self"}>
                    <SelectTrigger id="profile-relationship" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {RELATIONSHIPS.filter((r) => r !== "self" || profile?.relationship === "self").map((r) => (
                        <SelectItem key={r} value={r}>
                          {RELATIONSHIP_LABELS[r]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </FormField>
            <FormField id="profile-sex" label="Sex" error={errors.sex?.message}>
              <Controller
                control={form.control}
                name="sex"
                render={({ field }) => (
                  <Select value={field.value || UNSPECIFIED} onValueChange={(v) => field.onChange(v === UNSPECIFIED ? "" : v)}>
                    <SelectTrigger id="profile-sex" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={UNSPECIFIED}>Prefer not to say</SelectItem>
                      {SEXES.map((s) => (
                        <SelectItem key={s} value={s}>
                          {SEX_LABELS[s]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </FormField>
          </div>
          <FormField id="profile-dob" label="Date of birth" error={errors.date_of_birth?.message} hint="Optional">
            <Input
              id="profile-dob"
              type="date"
              max={todayISO()}
              aria-invalid={!!errors.date_of_birth}
              aria-describedby={describedBy("profile-dob", errors.date_of_birth?.message, true)}
              {...form.register("date_of_birth")}
            />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {editing ? "Save" : "Add profile"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
