import { createFileRoute } from "@tanstack/react-router"

import { LogsPage } from "@/features/logs/logs-page"
import type { LogsFilter } from "@/shared/api/queries"

const FILTERS: LogsFilter[] = ["all", "success", "error"]

function isFilter(value: unknown): value is LogsFilter {
  return typeof value === "string" && FILTERS.includes(value as LogsFilter)
}

export const Route = createFileRoute("/_authenticated/logs")({
  validateSearch: (search: Record<string, unknown>) => ({
    page: Math.max(1, Number(search.page) || 1),
    filter: isFilter(search.filter) ? search.filter : "all",
  }),
  component: LogsPage,
})
