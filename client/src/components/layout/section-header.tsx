import type { ReactNode } from "react"

import { Badge } from "@/components/arc/badge/badge"

export interface SectionHeaderProps {
  title: string
  description: string
  badge?: string
  actions?: ReactNode
}

export function SectionHeader({
  title,
  description,
  badge,
  actions,
}: SectionHeaderProps) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          {/* 18px is the top of the scale this dashboard reaches: the Arc faces
              split at 30px, which an operator screen never needs. */}
          <h1 className="text-lg font-medium tracking-tight text-foreground">
            {title}
          </h1>
          {badge && (
            <Badge tone="neutral" size="sm" className="shrink-0">
              {badge}
            </Badge>
          )}
        </div>
        <p className="mt-1 text-sm text-pretty text-muted-foreground">
          {description}
        </p>
      </div>
      {actions && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 self-stretch sm:gap-2.5 sm:self-auto">
          {actions}
        </div>
      )}
    </div>
  )
}
