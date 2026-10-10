"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { Loader2 } from "lucide-react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useState } from "react"
import { useForm } from "react-hook-form"

import { FormField, describedBy } from "@/components/common/form-field"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { useLogin } from "@/hooks/use-auth"
import { ApiError } from "@/lib/api"
import { safeNextPath } from "@/lib/navigation"
import { loginSchema, type LoginValues } from "@/lib/validation"

export function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const login = useLogin()
  const [formError, setFormError] = useState<string | null>(null)
  const form = useForm<LoginValues>({ resolver: zodResolver(loginSchema), defaultValues: { email: "", password: "" } })
  const { errors } = form.formState

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null)
    try {
      await login.mutateAsync(values)
      router.replace(safeNextPath(searchParams.get("next")) ?? "/")
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) setFormError("Incorrect email or password.")
      else if (error instanceof ApiError && error.status === 429)
        setFormError("Too many attempts. Please wait a minute and try again.")
      else if (error instanceof ApiError && error.code === "validation_failed") {
        for (const [field, message] of Object.entries(error.fields)) {
          if (field === "email" || field === "password") form.setError(field, { message })
        }
        if (Object.keys(error.fields).length === 0) setFormError(error.message)
      } else setFormError(error instanceof Error ? error.message : "Couldn't sign you in.")
    }
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Welcome back</CardTitle>
        <CardDescription>Sign in to your health records.</CardDescription>
      </CardHeader>
      <form onSubmit={onSubmit} noValidate>
        <CardContent className="grid gap-4">
          {formError ? (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          ) : null}
          <FormField id="email" label="Email" error={errors.email?.message}>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              autoFocus
              aria-invalid={!!errors.email}
              aria-describedby={describedBy("email", errors.email?.message)}
              {...form.register("email")}
            />
          </FormField>
          <FormField id="password" label="Password" error={errors.password?.message}>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              aria-invalid={!!errors.password}
              aria-describedby={describedBy("password", errors.password?.message)}
              {...form.register("password")}
            />
          </FormField>
        </CardContent>
        <CardFooter className="mt-6 flex flex-col gap-3">
          <Button type="submit" className="w-full" size="lg" disabled={login.isPending}>
            {login.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            Sign in
          </Button>
          <p className="text-sm text-muted-foreground">
            New to MedVault?{" "}
            <Link href="/register" className="font-medium text-primary underline-offset-4 hover:underline">
              Create an account
            </Link>
          </p>
        </CardFooter>
      </form>
    </Card>
  )
}
