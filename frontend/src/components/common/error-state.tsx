"use client"

import { AlertTriangle, RotateCw } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { ApiError } from "@/lib/api"

interface ErrorStateProps {
  error: unknown
  title?: string
  onRetry?: () => void
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return "Something went wrong."
}

export function ErrorState({ error, title = "Couldn't load this", onRetry }: ErrorStateProps) {
  const notFound = error instanceof ApiError && error.status === 404
  return (
    <Alert variant="destructive" role="alert">
      <AlertTriangle aria-hidden />
      <AlertTitle>{notFound ? "Not found" : title}</AlertTitle>
      <AlertDescription className="flex flex-col items-start gap-3">
        <span>{notFound ? "It may have been deleted, or it belongs to another account." : errorMessage(error)}</span>
        {onRetry && !notFound ? (
          <Button size="sm" variant="outline" onClick={onRetry}>
            <RotateCw aria-hidden /> Try again
          </Button>
        ) : null}
      </AlertDescription>
    </Alert>
  )
}
