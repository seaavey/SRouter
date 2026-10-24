import { createFileRoute } from "@tanstack/react-router"

import { SectionHeader } from "@/components/layout/section-header"
import useLogsData from "@/components/logs/hooks/useLogsData"
import { LogToolbar } from "@/components/logs/LogToolbar"
import { LogViewerSection } from "@/components/logs/LogViewerSection"

export const Route = createFileRoute("/_authenticated/logs")({
  head: () => ({ meta: [{ title: "SRouter - Request logs" }] }),
  component: LogsPage,
})

function LogsPage() {
  const {
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
    logs,
    pagination,
    summary,
    hasFilters,
    isConnected,
    streamStatus,
    refresh,
  } = useLogsData()

  return (
    <div className="flex max-w-full min-w-0 flex-col gap-5 sm:gap-6">
      <SectionHeader
        title="Request logs"
        description="Audit trail of every proxied inference call recorded in SQLite, streamed live via SSE."
        badge={
          isConnected
            ? "Live stream active"
            : streamStatus === "connecting"
              ? "Connecting..."
              : "Stream idle"
        }
      />

      <LogToolbar
        statusFilter={statusFilter}
        onStatusChange={handleStatusChange}
        customRange={customRange}
        onCustomRangeChange={handleCustomRange}
        apiKeyID={apiKeyID}
        keyOptions={keyOptions}
        onKeyChange={handleKeyChange}
      />

      <LogViewerSection
        logs={logs}
        pagination={pagination}
        page={page}
        onPageChange={setPage}
        limit={limit}
        onLimitChange={handleLimitChange}
        summary={summary}
        hasFilters={hasFilters}
        isPending={query.isPending}
        isError={query.isError}
        error={query.error instanceof Error ? query.error : null}
        selectedLog={selectedLog}
        onSelectLog={setSelectedLog}
        onRefresh={refresh}
      />
    </div>
  )
}
