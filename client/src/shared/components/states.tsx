import type { ReactNode } from "react"

import { Alert, AlertDescription, AlertTitle } from "@/shared/components/ui/alert"
import { Button } from "@/shared/components/ui/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/shared/components/ui/empty"
import { Skeleton } from "@/shared/components/ui/skeleton"
import { Spinner } from "@/shared/components/ui/spinner"
import { ApiError } from "@/shared/api/client"

/**
 * The three states every data screen has, in one place.
 *
 * Each one names its cause and, where there is one, the next action. "No data"
 * alone tells the operator nothing: it does not say whether the list is
 * genuinely empty, filtered to nothing, or broken.
 */

/** Turns a failed request into a sentence an operator can act on. */
export function describeError(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 429) {
      return "Too many attempts. Wait a moment and try again."
    }
    if (error.status === 401 && error.code === "authentication_required") {
      return "The session expired. Sign in again."
    }

    return error.message
  }

  return "Could not reach the server."
}

/**
 * A failed load, with the cause and a retry. The retry is present because most
 * failures here are a server that has not finished starting, which resolves
 * without the operator reloading the page.
 */
export function ErrorState({
  title,
  error,
  onRetry,
}: {
  title: string
  error: unknown
  onRetry?: () => void
}) {
  return (
    <Alert variant="destructive">
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription className="flex flex-col items-start gap-2">
        <span>{describeError(error)}</span>
        {onRetry ? (
          <Button variant="outline" size="sm" onClick={onRetry}>
            Retry
          </Button>
        ) : null}
      </AlertDescription>
    </Alert>
  )
}

/**
 * Nothing to show, with the reason. `hint` is what makes an empty state
 * useful: it names the action that fills the screen, or says why none exists.
 */
export function EmptyState({
  title,
  hint,
  media,
}: {
  title: string
  hint: string
  media?: ReactNode
}) {
  return (
    <Empty>
      <EmptyHeader>
        {media ? <EmptyMedia>{media}</EmptyMedia> : null}
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{hint}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

/** A loading placeholder shaped like the content it replaces. */
export function LoadingState({ className = "h-64 w-full" }: { className?: string }) {
  return <Skeleton className={className} />
}

/** An inline "still working" line, for a page that has nothing to show yet. */
export function PendingState({ label }: { label: string }) {
  return (
    <div className="text-muted-foreground flex items-center justify-center gap-2 p-8 text-xs">
      <Spinner />
      {label}
    </div>
  )
}
