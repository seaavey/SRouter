import { createFileRoute } from "@tanstack/react-router"

import type { AnalyticsWindow } from "@/api/logs"
import SegmentedControl from "@/components/arc/segmented-control/segmented-control"
import { SectionHeader } from "@/components/layout/section-header"
import useKeyQuota from "@/components/usage/hooks/useKeyQuota"
import useModelBreakdown from "@/components/usage/hooks/useModelBreakdown"
import useUsageData from "@/components/usage/hooks/useUsageData"
import { KeyQuotaSection } from "@/components/usage/KeyQuotaSection"
import { LifetimeLedgerSection } from "@/components/usage/LifetimeLedgerSection"
import { ModelUsageSection } from "@/components/usage/ModelUsageSection"
import { PeriodSpendSection } from "@/components/usage/PeriodSpendSection"
import { RANGE_OPTIONS } from "@/components/usage/types"

export const Route = createFileRoute("/_authenticated/usage")({
  component: UsagePage,
})

function UsagePage() {
  const {
    range,
    setRange,
    prefetchRange,
    analytics,
    usage,
    keys,
    isConnected,
    streamStatus,
    pendingSections,
    windowTotals,
    windowSpend,
    lifetimeSpend,
    spendShare,
    refresh,
  } = useUsageData()

  const {
    metric,
    setMetric,
    expandedModel,
    toggleExpanded,
    modelRows,
    lifetimeModels,
  } = useModelBreakdown({
    analyticsData: analytics.data,
    usageData: usage.data,
  })

  const { keyFilter, setKeyFilter, keyRows } = useKeyQuota({
    keysData: keys.data,
  })

  return (
    <div className="flex max-w-full min-w-0 flex-col gap-5 overflow-hidden sm:gap-6">
      <SectionHeader
        title="Usage and quota"
        description="Spend and tokens for the selected period, the lifetime ledger they roll into, and the token budget left on each key."
        badge={
          isConnected
            ? "Live stream active"
            : streamStatus === "connecting"
              ? "Connecting..."
              : "Stream idle"
        }
        actions={
          <div className="flex flex-wrap items-center gap-2 sm:gap-2.5">
            <SegmentedControl
              options={RANGE_OPTIONS}
              value={range}
              onValueChange={(value) => setRange(value as AnalyticsWindow)}
              label="Period"
              // Pointing at a period starts its request, so choosing it lands on
              // data instead of a second wait.
              onOptionIntent={(value) => {
                prefetchRange(value as AnalyticsWindow)
              }}
            />
          </div>
        }
      />

      <PeriodSpendSection
        range={range}
        analyticsData={analytics.data}
        isPending={analytics.isPending}
        isError={analytics.isError}
        error={analytics.error instanceof Error ? analytics.error : null}
        windowSpend={windowSpend}
        lifetimeSpend={lifetimeSpend}
        spendShare={spendShare}
        windowTotals={windowTotals}
        onRetry={refresh}
      />

      {!analytics.isError && (
        <ModelUsageSection
          range={range}
          metric={metric}
          onMetricChange={setMetric}
          isPending={analytics.isPending}
          modelRows={modelRows}
          expandedModel={expandedModel}
          onToggleExpanded={toggleExpanded}
          lifetimeModels={lifetimeModels}
        />
      )}

      <LifetimeLedgerSection
        usageData={usage.data}
        isPending={usage.isPending}
        isError={usage.isError}
        error={usage.error instanceof Error ? usage.error : null}
        onRetry={async () => {
          const result = await usage.refetch()
          if (result.isError) throw new Error("retry failed")
        }}
      />

      <KeyQuotaSection
        keyFilter={keyFilter}
        onKeyFilterChange={setKeyFilter}
        isPending={keys.isPending}
        isError={keys.isError}
        error={keys.error instanceof Error ? keys.error : null}
        keyRows={keyRows}
        onRetry={async () => {
          const result = await keys.refetch()
          if (result.isError) throw new Error("retry failed")
        }}
      />

      <p
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {pendingSections.length > 0
          ? `Loading ${pendingSections.join(", ")}`
          : ""}
      </p>
    </div>
  )
}
