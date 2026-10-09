import type { ReactNode } from "react"

import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card"
import { cn } from "@/shared/lib/utils"

/** A page heading with the one line that says what the screen answers. */
export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string
  subtitle?: string
  actions?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-sm font-medium">{title}</h1>
        {subtitle ? <p className="text-muted-foreground text-xs">{subtitle}</p> : null}
      </div>
      {actions}
    </div>
  )
}

/**
 * A single figure with its label and a caption. Deliberately not a row of equal
 * cards: this is placed by the screen that owns the number, so the figure sits
 * beside the thing that explains it rather than in a generic summary strip.
 */
export function MetricCard({
  label,
  value,
  hint,
  className,
}: {
  label: string
  value: ReactNode
  hint?: ReactNode
  className?: string
}) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-muted-foreground text-[0.625rem] font-medium tracking-wide uppercase">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-1.5">
        <span className="text-lg tabular-nums">{value}</span>
        {hint ? (
          <span className="text-muted-foreground text-[0.625rem]">{hint}</span>
        ) : null}
      </CardContent>
    </Card>
  )
}

/** A titled panel. The title states what the panel answers, not its genre. */
export function Panel({
  title,
  description,
  actions,
  children,
  className,
  contentClassName,
}: {
  title: string
  description?: string
  actions?: ReactNode
  children: ReactNode
  className?: string
  contentClassName?: string
}) {
  return (
    <Card className={className}>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="text-xs">{title}</CardTitle>
          {description ? (
            <p className="text-muted-foreground mt-0.5 text-[0.625rem]">{description}</p>
          ) : null}
        </div>
        {actions}
      </CardHeader>
      <CardContent className={cn("px-0", contentClassName)}>{children}</CardContent>
    </Card>
  )
}
