"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { Loader2 } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { useForm } from "react-hook-form"

import { FormField, describedBy } from "@/components/common/form-field"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { useRegister } from "@/hooks/use-auth"
import { ApiError } from "@/lib/api"
import { registerSchema, type RegisterValues } from "@/lib/validation"

const FIELDS = ["name", "email", "password"] as const

export function RegisterForm() {
  const router = useRouter()
  const register = useRegister()
  const [formError, setFormError] = useState<string | null>(null)
  const form = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { name: "", email: "", password: "", confirmPassword: "" },
  })
  const { errors } = form.formState

  const onSubmit = form.handleSubmit(async ({ name, email, password }) => {
    setFormError(null)
    try {
      await register.mutateAsync({ name, email, password })
      router.replace("/")
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        form.setError("email", { message: "An account with this email already exists." })
      } else if (error instanceof ApiError && error.code === "validation_failed" && Object.keys(error.fields).length) {
        for (const [field, message] of Object.entries(error.fields)) {
          if ((FIELDS as readonly string[]).includes(field)) form.setError(field as (typeof FIELDS)[number], { message })
          else setFormError(message)
        }
      } else setFormError(error instanceof Error ? error.message : "Couldn't create your account.")
    }
  })

  const field = (name: keyof RegisterValues, label: string, type: string, autoComplete: string, hint?: string) => (
    <FormField id={name} label={label} error={errors[name]?.message} hint={hint}>
      <Input
        id={name}
        type={type}
        autoComplete={autoComplete}
        aria-invalid={!!errors[name]}
        aria-describedby={describedBy(name, errors[name]?.message, !!hint)}
        {...form.register(name)}
      />
    </FormField>
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Create your vault</CardTitle>
        <CardDescription>One private place for every prescription, report and discharge summary.</CardDescription>
      </CardHeader>
      <form onSubmit={onSubmit} noValidate>
        <CardContent className="grid gap-4">
          {formError ? (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          ) : null}
          {field("name", "Your name", "text", "name")}
          {field("email", "Email", "email", "email")}
          {field("password", "Password", "password", "new-password", "At least 8 characters.")}
          {field("confirmPassword", "Confirm password", "password", "new-password")}
        </CardContent>
        <CardFooter className="mt-6 flex flex-col gap-3">
          <Button type="submit" className="w-full" size="lg" disabled={register.isPending}>
            {register.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            Create account
          </Button>
          <p className="text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link href="/login" className="font-medium text-primary underline-offset-4 hover:underline">
              Sign in
            </Link>
          </p>
        </CardFooter>
      </form>
    </Card>
  )
}
