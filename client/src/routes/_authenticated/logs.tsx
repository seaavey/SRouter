import { createFileRoute } from "@tanstack/react-router"

import { SectionHeader } from "@/components/layout/section-header"
import useLogsData from "@/components/logs/hooks/useLogsData"
import { LogViewerSection } from "@/components/logs/LogViewerSection"

export const Route = createFileRoute("/_authenticated/logs")({
  head: () => ({ meta: [{ title: "SRouter - Request logs" }] }),
  component: LogsPage,
})

function LogsPage() {
  const {
    page,
    setPage,
    statusFilter,
    handleFilterChange,
    selectedLog,
    setSelectedLog,
    liveLogIDs,
    query,
    logs,
    pagination,
    isConnected,
    streamStatus,
    refresh,
  } = useLogsData()

  return (
    <div className="flex max-w-full min-w-0 flex-col gap-5 overflow-hidden sm:gap-6">
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

      <LogViewerSection
        logs={logs}
        liveLogIDs={liveLogIDs}
        pagination={pagination}
        page={page}
        onPageChange={setPage}
        statusFilter={statusFilter}
        onStatusFilterChange={handleFilterChange}
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
