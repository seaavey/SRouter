import { Link } from "@tanstack/react-router"
import { ArrowLeft, Network, Plus, Sparkles } from "lucide-react"

import ActionButton from "@/components/arc/action-button/action-button"
import { Button } from "@/components/arc/button/button"
import { Skeleton } from "@/components/arc/skeleton/skeleton"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/arc/tabs/tabs"

/**
 * One text bar where a value will land. `Skeleton` renders its own status
 * region, so the wrapper hides it from assistive tech: the page announces the
 * load once, below.
 */
function Bar({ className }: { className?: string }) {
  return (
    <div className={className} aria-hidden="true">
      <Skeleton lines={1} />
    </div>
  )
}

/**
 * The provider page while its detail query is in flight: the same frame, copy,
 * and tier behaviour as the loaded page, with the provider's own values standing
 * in as bars, so the swap to real data moves nothing.
 */
export default function ProviderSkeleton({
  onRefresh,
}: {
  onRefresh: () => Promise<void>
}) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          to="/providers"
          className="inline-flex min-h-[var(--control-height-sm)] items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft size={14} aria-hidden="true" />
          <span>Back to providers</span>
        </Link>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className="size-10 shrink-0 rounded-[var(--radius-control)] bg-surface-muted"
            aria-hidden="true"
          />
          <div className="flex min-w-0 flex-col">
            <div className="flex flex-wrap items-center gap-2">
              <Bar className="w-40" />
              <span
                className="h-[22px] w-14 rounded-full bg-surface-muted"
                aria-hidden="true"
              />
            </div>
            <Bar className="mt-1 max-w-72" />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <ActionButton
            label="Refresh"
            pendingLabel="Refreshing"
            successLabel="Refreshed"
            onAction={onRefresh}
            className="!border-border !bg-surface !text-foreground"
          />
          <Button
            variant="primary"
            size="sm"
            disabled
            className="flex items-center gap-1.5"
          >
            <Plus size={13} aria-hidden="true" />
            <span>Connect account</span>
          </Button>
        </div>
      </div>

      <Tabs defaultValue="connections" className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger
            value="connections"
            className="flex items-center gap-1.5"
          >
            <Network size={14} aria-hidden="true" />
            {/* Same short/long pair as the loaded strip: it is the same strip. */}
            <span className="sm:hidden">Connections</span>
            <span className="hidden sm:inline">Connections & Routing</span>
            <span
              className="ml-1 h-5 w-6 rounded-full bg-surface-muted"
              aria-hidden="true"
            />
          </TabsTrigger>
          <TabsTrigger value="models" className="flex items-center gap-1.5">
            <Sparkles size={14} aria-hidden="true" />
            <span className="sm:hidden">Models</span>
            <span className="hidden sm:inline">Supported Models</span>
            <span
              className="ml-1 h-5 w-6 rounded-full bg-surface-muted"
              aria-hidden="true"
            />
          </TabsTrigger>
        </TabsList>

        <TabsContent value="connections">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div className="rounded-[var(--radius-panel)] border border-border bg-surface p-5 lg:col-span-2">
              <div className="flex items-center justify-between border-b border-border/70 pb-3.5">
                <div>
                  <h2 className="text-sm font-medium text-foreground">
                    Active connections
                  </h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Configured accounts and authentication sessions under this
                    driver.
                  </p>
                </div>
              </div>

              <div className="mt-4 divide-y divide-border/50 overflow-hidden">
                {[0, 1].map((row) => (
                  <div
                    key={row}
                    className="flex flex-col gap-2 py-3.5 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0 flex-1">
                      <Bar className="max-w-40" />
                      <Bar className="mt-0.5 max-w-64" />
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <span
                        className="h-[22px] w-20 rounded-full bg-surface-muted"
                        aria-hidden="true"
                      />
                      <span
                        className="h-4 w-16 rounded-full bg-surface-muted"
                        aria-hidden="true"
                      />
                      <span
                        className="h-7 w-24 rounded-[var(--radius-control)] bg-surface-muted"
                        aria-hidden="true"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-4">
              <div className="space-y-4 rounded-[var(--radius-panel)] border border-border bg-surface p-5">
                <h2 className="text-sm font-medium text-foreground">Traffic</h2>

                <div className="flex items-start justify-between gap-3 pt-1">
                  <div>
                    <span className="block text-xs font-medium text-foreground">
                      Driver enabled
                    </span>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      A disabled driver takes no requests, whatever accounts it
                      holds.
                    </p>
                  </div>
                  <span
                    className="h-6 w-[42px] shrink-0 rounded-full bg-surface-muted"
                    aria-hidden="true"
                  />
                </div>

                <div className="flex items-start justify-between gap-3 pt-1">
                  <div>
                    <span className="block text-xs font-medium text-foreground">
                      Round-robin balancing
                    </span>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Distributes incoming requests evenly across all active
                      accounts.
                    </p>
                  </div>
                  <span
                    className="h-6 w-[42px] shrink-0 rounded-full bg-surface-muted"
                    aria-hidden="true"
                  />
                </div>
              </div>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="models">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-sm font-medium text-foreground">
                  Advertised models
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Models routed to this driver. Star one to flag it in the
                  catalog; hidden models stay out of /v1/models.
                </p>
              </div>
              <span
                className="h-[var(--control-height-md)] w-full rounded-[var(--radius-control)] border border-border bg-surface-muted sm:max-w-xs"
                aria-hidden="true"
              />
            </div>

            <div
              className="overflow-hidden rounded-[var(--radius-surface)] border border-border bg-surface shadow-[var(--shadow-resting)]"
              aria-hidden="true"
            >
              <div className="flex h-11 items-center gap-6 border-b border-border px-3 text-sm font-medium text-muted-foreground">
                <span className="size-[18px] shrink-0 rounded-[5px] border border-border bg-surface-muted" />
                <span className="flex-1">Model</span>
                <span className="w-[104px]">Status</span>
                <span className="w-[176px] text-right">Actions</span>
              </div>
              {[0, 1, 2].map((row) => (
                <div
                  key={row}
                  className="flex h-[52px] items-center gap-6 border-b border-border/60 px-3 last:border-b-0"
                >
                  <span className="size-[18px] shrink-0 rounded-[5px] border border-border bg-surface-muted" />
                  <Bar className="max-w-80 min-w-0 flex-1" />
                  <div className="w-[104px]">
                    <span className="inline-block h-[22px] w-16 rounded-full bg-surface-muted" />
                  </div>
                  <div className="flex w-[176px] justify-end">
                    <span className="h-[var(--control-height-sm)] w-[72px] rounded-[var(--radius-control)] bg-surface-muted sm:w-[152px]" />
                  </div>
                </div>
              ))}
              <div className="flex h-11 items-center border-t border-border px-3">
                <Bar className="w-20" />
              </div>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      <p
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        Loading provider
      </p>
    </div>
  )
}
