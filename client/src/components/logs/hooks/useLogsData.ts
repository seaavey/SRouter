import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useCallback, useMemo, useState } from "react"

import { keyListQuery } from "@/api/keys"
import { logsQuery, useLogEvents } from "@/api/logs"
import type { RequestLog } from "@/api/types"
import type { DateRange } from "@/components/arc/date-range-picker/date-range-picker"
import { isSuccessStatus, type LogStatusFilter } from "../types"

const startOfDay = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate())

export default function useLogsData() {
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(10)
  const [statusFilter, setStatusFilter] = useState<LogStatusFilter>("all")
  const [customRange, setCustomRange] = useState<DateRange | null>(null)
  const [apiKeyID, setApiKeyID] = useState("all")
  const [selectedLog, setSelectedLog] = useState<RequestLog | null>(null)

  const queryClient = useQueryClient()
  const keys = useQuery(keyListQuery)

  // Map UI filter "failed" to server-accepted "error"
  const apiStatus =
    statusFilter === "all"
      ? undefined
      : statusFilter === "failed"
        ? "error"
        : "success"

  // A custom range is inclusive whole days, so the upper bound is the next
  // midnight: the server treats `to` as exclusive.
  const from = customRange ? startOfDay(customRange.start).getTime() : undefined
  const to = customRange
    ? new Date(
        customRange.end.getFullYear(),
        customRange.end.getMonth(),
        customRange.end.getDate() + 1
      ).getTime()
    : undefined

  const query = useQuery(
    logsQuery({
      page,
      limit,
      status: apiStatus,
      apiKeyID: apiKeyID === "all" ? undefined : apiKeyID,
      from,
      to,
    })
  )

  const handleNewLog = useCallback(
    (newLog: RequestLog) => {
      // If we are on the first page and every filter permits, prepend at once.
      // The live row has to pass the same filters the query sent, or it appears
      // in a list it does not belong to.
      if (page === 1) {
        queryClient.setQueryData(
          logsQuery({
            page: 1,
            limit,
            status: apiStatus,
            apiKeyID: apiKeyID === "all" ? undefined : apiKeyID,
            from,
            to,
          }).queryKey,
          (prev) => {
            if (!prev) return prev
            // Server classifies a row as success only when it is 2xx.
            const isSuccess = isSuccessStatus(newLog.status_code)
            const inTime =
              from !== undefined && to !== undefined
                ? newLog.created_at >= from && newLog.created_at < to
                : true
            const isMatch =
              (statusFilter === "all" ||
                (statusFilter === "success" && isSuccess) ||
                (statusFilter === "failed" && !isSuccess)) &&
              (apiKeyID === "all" || newLog.api_key_id === apiKeyID) &&
              inTime

            if (!isMatch) return prev

            // Avoid duplicate if it already exists
            const exists = prev.data.some((l) => l.id === newLog.id)
            if (exists) return prev

            return {
              ...prev,
              data: [newLog, ...prev.data.slice(0, limit - 1)],
              pagination: prev.pagination
                ? {
                    ...prev.pagination,
                    total: prev.pagination.total + 1,
                  }
                : null,
            }
          }
        )
      }
    },
    [page, limit, statusFilter, apiStatus, apiKeyID, from, to, queryClient]
  )

  const { isConnected, status: streamStatus } = useLogEvents({
    onRequestLogged: handleNewLog,
  })

  const keyOptions = useMemo(
    () => [
      { value: "all", label: "All keys" },
      ...(keys.data?.data ?? []).map((key) => ({
        value: key.id,
        label: key.name,
      })),
    ],
    [keys.data]
  )

  async function refresh() {
    const result = await query.refetch()
    if (result.isError) throw new Error("logs refresh failed")
  }

  function handleStatusChange(newFilter: LogStatusFilter) {
    setStatusFilter(newFilter)
    setPage(1)
  }

  function handleCustomRange(next: DateRange | null) {
    setCustomRange(next)
    setPage(1)
  }

  function handleKeyChange(next: string) {
    setApiKeyID(next)
    setPage(1)
  }

  function handleLimitChange(next: number) {
    setLimit(next)
    setPage(1)
  }

  return {
    page,
    setPage,
    limit,
    handleLimitChange,
    statusFilter,
    handleStatusChange,
    customRange,
    handleCustomRange,
    apiKeyID,
    handleKeyChange,
    keyOptions,
    selectedLog,
    setSelectedLog,
    query,
    logs: query.data?.data ?? [],
    pagination: query.data?.pagination ?? null,
    summary: query.data?.summary ?? null,
    hasFilters:
      statusFilter !== "all" || customRange !== null || apiKeyID !== "all",
    isConnected,
    streamStatus,
    refresh,
  }
}
