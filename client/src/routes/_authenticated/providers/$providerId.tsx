import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  createFileRoute,
  Link,
  useNavigate,
  useParams,
} from "@tanstack/react-router"
import {
  ArrowLeft,
  Eye,
  EyeOff,
  Network,
  Plus,
  Sparkles,
  Star,
} from "lucide-react"
import { useState } from "react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"

import {
  deleteProvider,
  deleteProviderConnection,
  patchProvider,
  providerDetailQuery,
  toggleRoundRobin,
} from "@/api/providers"
import type { ProviderConnectionView } from "@/api/types"
import ActionButton from "@/components/arc/action-button/action-button"
import { Alert } from "@/components/arc/alert/alert"
import { Badge, type BadgeTone } from "@/components/arc/badge/badge"
import { Button } from "@/components/arc/button/button"
import { CopyButton } from "@/components/arc/copy-button/copy-button"
import { EmptyState } from "@/components/arc/empty-state/empty-state"
import HoldToConfirm from "@/components/arc/hold-to-confirm/hold-to-confirm"
import { SearchField } from "@/components/arc/search-field/search-field"
import { Skeleton } from "@/components/arc/skeleton/skeleton"
import { useSearch } from "@/hooks/useSearch"
import { Switch } from "@/components/arc/switch/switch"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/arc/tabs/tabs"
import { toast } from "@/components/arc/toast-stack/toast-stack"
import { Tooltip } from "@/components/arc/tooltip/tooltip"
import { ConnectAccountModal } from "@/components/providers/modals/ConnectAccounts"
import { ProviderLogo } from "@/components/providers/provider-logo"
import {
  categoryLabel,
  PROTOCOL_LABELS,
} from "@/components/providers/provider-labels"

export const Route = createFileRoute("/_authenticated/providers/$providerId")({
  head: () => ({ meta: [{ title: "SRouter - Provider" }] }),
  component: ProviderDetailPage,
})

/** Models rendered before the rest are asked for. */
const MODEL_PAGE_SIZE = 100

/** What one connection row can say, and what it has to leave open. */
type ConnectionStatus = {
  tone: BadgeTone
  label: string
  detail: string
}

/**
 * The stored state of one connection. The check is passive: it reads the
 * credential row, so `active` means the token has not lapsed *on record* and
 * says nothing about whether the provider revoked it early.
 */
function connectionStatus(
  connection: ProviderConnectionView
): ConnectionStatus {
  if (!connection.enabled) {
    return {
      tone: "neutral",
      label: "Disabled",
      detail: "This connection is switched off, so rotation never picks it.",
    }
  }

  switch (connection.health) {
    case "active":
      return {
        tone: "success",
        label: "Connected",
        detail:
          "The stored token has not lapsed. Storage cannot tell whether the provider revoked it early.",
      }
    case "expired":
      return {
        tone: "danger",
        label: "Token expired",
        detail:
          "The stored token has already lapsed. Reconnect this account to route through it.",
      }
    case "unstated":
      return {
        tone: "neutral",
        label: "Connected",
        detail:
          "This driver stores no token expiry, so the enabled flag is the only state on record.",
      }
  }

  const unreachable: never = connection.health
  return unreachable
}

function ProviderDetailPage() {
  const { providerId } = useParams({
    from: "/_authenticated/providers/$providerId",
  })
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const reducedMotion = useReducedMotion() ?? false
  const [connectModalOpen, setConnectModalOpen] = useState(false)

  const {
    data: provider,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery(providerDetailQuery(providerId))

  const toggleEnabledMutation = useMutation({
    mutationFn: (newEnabled: boolean) =>
      patchProvider(providerId, { enabled: newEnabled }),
    onSuccess: (updated) => {
      queryClient.setQueryData(
        providerDetailQuery(providerId).queryKey,
        updated
      )
      void queryClient.invalidateQueries({ queryKey: ["providers"] })
      toast.success(
        updated.enabled
          ? "Provider driver enabled for traffic"
          : "Provider driver disabled"
      )
    },
    onError: (err) => {
      toast.error(
        err instanceof Error ? err.message : "Failed to update driver status"
      )
    },
  })

  const toggleRoundRobinMutation = useMutation({
    mutationFn: (newRoundRobin: boolean) =>
      toggleRoundRobin(providerId, newRoundRobin),
    onSuccess: (updated) => {
      queryClient.setQueryData(
        providerDetailQuery(providerId).queryKey,
        updated
      )
      void queryClient.invalidateQueries({ queryKey: ["providers"] })
      toast.success(
        updated.round_robin
          ? "Multi-account round-robin rotation enabled"
          : "Round-robin rotation disabled"
      )
    },
    onError: (err) => {
      toast.error(
        err instanceof Error ? err.message : "Failed to toggle rotation"
      )
    },
  })

  const patchModelMutation = useMutation({
    mutationFn: (payload: {
      hide?: string[]
      restore?: string[]
      favorite?: string[]
      unfavorite?: string[]
    }) => patchProvider(providerId, payload),
    onSuccess: (updated) => {
      queryClient.setQueryData(
        providerDetailQuery(providerId).queryKey,
        updated
      )
      void queryClient.invalidateQueries({ queryKey: ["providers"] })
      toast.success("Model preferences updated")
    },
    onError: (err) => {
      toast.error(
        err instanceof Error ? err.message : "Failed to update model settings"
      )
    },
  })

  const removeConnectionMutation = useMutation({
    mutationFn: (connection: ProviderConnectionView) =>
      deleteProviderConnection(providerId, connection.id),
    onSuccess: (_result, connection) => {
      void queryClient.invalidateQueries({ queryKey: ["providers"] })
      toast.success(`Removed ${connection.name}`)
    },
    onError: (err) => {
      toast.error(
        err instanceof Error ? err.message : "Failed to remove the connection"
      )
    },
  })

  const deleteProviderMutation = useMutation({
    mutationFn: () => deleteProvider(providerId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["providers"] })
      toast.success("Custom provider deleted")
      void navigate({ to: "/providers" })
    },
    onError: (err) => {
      toast.error(
        err instanceof Error ? err.message : "Failed to delete the provider"
      )
    },
  })

  // The row leaves when the invalidation refetches, so nothing is hidden locally.
  const connections = provider?.connections ?? []

  async function refreshProvider() {
    const result = await refetch()
    if (result.error) throw result.error
  }

  const models = provider?.models ?? []

  const {
    query: modelSearch,
    filteredItems: filteredModels,
    fieldProps: modelSearchFieldProps,
  } = useSearch(models, {
    debounceMs: 150,
    keys: ["id", "owned_by"],
  })

  // A driver can advertise hundreds of models, and every row carries a
  // button pair, so the list is paged rather than mounted whole. The choice
  // belongs to the query that was in force when it was made, so a new search
  // pages again.
  const [showAllFor, setShowAllFor] = useState<string | null>(null)
  const showAllModels = showAllFor === modelSearch
  const visibleModels = showAllModels
    ? filteredModels
    : filteredModels.slice(0, MODEL_PAGE_SIZE)

  if (isLoading) {
    return (
      <div className="flex flex-col gap-6">
        <Link
          to="/providers"
          className="inline-flex min-h-[var(--control-height-sm)] items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft size={14} aria-hidden="true" />
          <span>Back to providers</span>
        </Link>
        <div
          className="rounded-xl border border-border bg-surface p-5"
          aria-busy="true"
          aria-label="Loading provider"
        >
          <Skeleton label="Loading provider" lines={2} avatar />
        </div>
      </div>
    )
  }

  if (!provider) {
    return (
      <div className="flex flex-col gap-6">
        <Link
          to="/providers"
          className="inline-flex min-h-[var(--control-height-sm)] items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft size={14} aria-hidden="true" />
          <span>Back to providers</span>
        </Link>
        <Alert tone="danger" title="Could not load provider">
          <span className="flex flex-col items-start gap-3">
            <span className="break-words">
              {error instanceof Error
                ? error.message
                : "The provider detail is unavailable."}
            </span>
            <ActionButton
              label="Retry provider"
              pendingLabel="Retrying"
              successLabel="Provider loaded"
              onAction={refreshProvider}
              className="!border-border !bg-surface !text-foreground"
            />
          </span>
        </Alert>
      </div>
    )
  }

  const hasActiveConnections = provider.status.connected_count > 0

  return (
    <div className="flex flex-col gap-6">
      {/* Navigation Breadcrumb */}
      <div>
        <Link
          to="/providers"
          className="inline-flex min-h-[var(--control-height-sm)] items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft size={14} aria-hidden="true" />
          <span>Back to providers</span>
        </Link>
      </div>

      {/* Header Banner */}
      <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <div className="flex size-13 shrink-0 items-center justify-center rounded-xl border border-border bg-surface-muted text-foreground shadow-2xs">
            <ProviderLogo
              providerID={provider.id}
              protocol={provider.protocol}
              baseURL={provider.default_base_url}
              className="size-7"
            />
          </div>

          <div className="flex flex-col">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg font-medium tracking-tight text-foreground">
                {provider.name}
              </h1>
              {hasActiveConnections ? (
                <Badge
                  tone="success"
                  size="sm"
                  icon={
                    <span
                      className="size-1.5 rounded-full bg-success"
                      aria-hidden="true"
                    />
                  }
                >
                  {provider.status.connected_count} active
                </Badge>
              ) : (
                <Badge tone="neutral" size="sm">
                  0 active
                </Badge>
              )}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs text-muted-foreground">
                {provider.id}
              </span>
              <span className="text-xs text-muted-foreground/60">•</span>
              <Badge tone="neutral" size="sm">
                {categoryLabel(provider.category)}
              </Badge>
              <Badge tone="neutral" size="sm">
                {PROTOCOL_LABELS[provider.protocol]}
              </Badge>
            </div>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex flex-wrap items-center gap-2.5 pt-2 sm:pt-0">
          <Button
            variant="primary"
            size="sm"
            onClick={() => setConnectModalOpen(true)}
            className="flex items-center gap-1.5"
          >
            <Plus size={13} aria-hidden="true" />
            <span>Connect account</span>
          </Button>

          <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-muted/50 px-2.5 py-1 text-xs">
            <span className="text-muted-foreground">Driver:</span>
            <span className="font-medium text-foreground">
              {provider.enabled ? "Active" : "Off"}
            </span>
            <Switch
              checked={provider.enabled}
              onCheckedChange={(val) => toggleEnabledMutation.mutate(val)}
              disabled={toggleEnabledMutation.isPending}
              aria-label="Toggle driver active status"
            />
          </div>

          <ActionButton
            label="Refresh"
            pendingLabel="Refreshing"
            successLabel="Refreshed"
            onAction={refreshProvider}
            className="!border-border !bg-surface !text-foreground"
          />
          {provider.category === "custom_provider" && (
            <Tooltip content="Deletes the endpoint, its accounts, and its stored models.">
              <span className="inline-flex">
                <HoldToConfirm
                  label="Hold to delete"
                  confirmedLabel="Deleted"
                  tone="danger"
                  size="sm"
                  confirmed={false}
                  disabled={deleteProviderMutation.isPending}
                  onConfirm={() => deleteProviderMutation.mutate()}
                />
              </span>
            </Tooltip>
          )}
        </div>
      </div>

      {isError && (
        <Alert tone="danger" title="Could not refresh provider">
          <span className="flex flex-col items-start gap-3">
            <span className="break-words">
              {error instanceof Error
                ? error.message
                : "The provider detail is unavailable."}
              {" Showing the last loaded data."}
            </span>
            <ActionButton
              label="Retry refresh"
              pendingLabel="Retrying"
              successLabel="Provider loaded"
              onAction={refreshProvider}
              className="!border-border !bg-surface !text-foreground"
            />
          </span>
        </Alert>
      )}

      {/* Tab Navigation: Connections vs Models */}
      <Tabs defaultValue="connections" className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger
            value="connections"
            className="flex items-center gap-1.5"
          >
            <Network size={14} aria-hidden="true" />
            {/* The full name does not fit a phone strip, so the short one
                carries it there and the long one names it from `sm` up. */}
            <span className="sm:hidden">Connections</span>
            <span className="hidden sm:inline">Connections & Routing</span>
            <span className="py-0.2 ml-1 rounded-full bg-surface-muted px-1.5 font-mono text-[10px] text-muted-foreground">
              {connections.length}
            </span>
          </TabsTrigger>
          <TabsTrigger value="models" className="flex items-center gap-1.5">
            <Sparkles size={14} aria-hidden="true" />
            <span className="sm:hidden">Models</span>
            <span className="hidden sm:inline">Supported Models</span>
            <span className="py-0.2 ml-1 rounded-full bg-surface-muted px-1.5 font-mono text-[10px] text-muted-foreground">
              {models.length}
            </span>
          </TabsTrigger>
        </TabsList>

        {/* Tab 1: Connections & Routing Settings */}
        <TabsContent value="connections">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            {/* Active Accounts & Connections (Span 2) */}
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
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setConnectModalOpen(true)}
                  className="flex items-center gap-1.5"
                >
                  <Plus size={12} aria-hidden="true" />
                  <span>Add account</span>
                </Button>
              </div>

              {connections.length > 0 ? (
                <div className="mt-4 divide-y divide-border/50 overflow-hidden">
                  <AnimatePresence initial={false}>
                    {connections.map((conn) => {
                      const status = connectionStatus(conn)
                      const duplicate = connections.find(
                        (other) => other.id === conn.duplicate_of
                      )

                      return (
                        <motion.div
                          key={conn.id}
                          layout="position"
                          initial={
                            reducedMotion
                              ? { opacity: 1 }
                              : { opacity: 0, x: -16 }
                          }
                          animate={{ opacity: 1, x: 0 }}
                          exit={
                            reducedMotion
                              ? { opacity: 0 }
                              : {
                                  opacity: 0,
                                  x: 48,
                                  height: 0,
                                  paddingTop: 0,
                                  paddingBottom: 0,
                                  transition: {
                                    duration: 0.28,
                                    ease: [0.32, 0, 0.67, 0],
                                  },
                                }
                          }
                          className="flex flex-col gap-2 py-3.5 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
                        >
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-xs font-medium text-foreground">
                                {conn.name}
                              </span>
                              {conn.prefix && (
                                <span className="rounded bg-surface-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                                  prefix: {conn.prefix}
                                </span>
                              )}
                              {duplicate && (
                                <Tooltip
                                  content={`Same account as ${duplicate.name}. Keep one of the two.`}
                                >
                                  <span className="inline-flex">
                                    <Badge tone="warning" size="sm">
                                      Duplicate account
                                    </Badge>
                                  </span>
                                </Tooltip>
                              )}
                            </div>
                            <span className="mt-0.5 block truncate font-mono text-xs text-muted-foreground">
                              {conn.base_url || provider.default_base_url}
                            </span>
                          </div>

                          <div className="flex flex-wrap items-center gap-3">
                            <Tooltip content={status.detail}>
                              <span className="inline-flex">
                                <Badge tone={status.tone} size="sm">
                                  {status.label}
                                </Badge>
                              </span>
                            </Tooltip>
                            <span className="text-xs text-muted-foreground tabular-nums">
                              {new Date(conn.created_at).toLocaleDateString()}
                            </span>
                            <HoldToConfirm
                              label="Hold to remove"
                              tone="danger"
                              size="sm"
                              confirmed={false}
                              disabled={removeConnectionMutation.isPending}
                              onConfirm={() =>
                                removeConnectionMutation.mutate(conn)
                              }
                            />
                          </div>
                        </motion.div>
                      )
                    })}
                  </AnimatePresence>
                </div>
              ) : (
                <div className="mt-4 rounded-lg bg-surface-muted/40 p-5 text-center">
                  <p className="text-xs font-medium text-foreground">
                    {provider.status.message}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {provider.requires_oauth
                      ? "Requires OAuth authentication token to establish live connections."
                      : provider.requires_api_key
                        ? "Requires valid API key or upstream endpoint configuration."
                        : "Ready for unlimited local or free tier routing."}
                  </p>
                  {(provider.requires_oauth || provider.requires_api_key) && (
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => setConnectModalOpen(true)}
                      className="mt-3.5 inline-flex items-center gap-1.5"
                    >
                      <Plus size={13} aria-hidden="true" />
                      <span>Connect account now</span>
                    </Button>
                  )}
                </div>
              )}
            </div>

            {/* Traffic Rotation Configuration */}
            <div className="flex flex-col gap-4">
              <div className="space-y-4 rounded-[var(--radius-panel)] border border-border bg-surface p-5">
                <h2 className="text-sm font-medium text-foreground">
                  Traffic rotation
                </h2>

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

                  <Switch
                    checked={provider.round_robin}
                    onCheckedChange={(val) =>
                      toggleRoundRobinMutation.mutate(val)
                    }
                    disabled={toggleRoundRobinMutation.isPending}
                    aria-label="Toggle round-robin balancing"
                  />
                </div>
              </div>

              {/* Endpoint reference card */}
              <div className="space-y-3 rounded-[var(--radius-panel)] border border-border bg-surface p-5">
                <h2 className="text-sm font-medium text-foreground">
                  Endpoint reference
                </h2>
                <div>
                  <span className="text-xs text-muted-foreground">
                    Default upstream URL
                  </span>
                  <div className="mt-1.5 flex items-center justify-between gap-2 rounded-lg border border-border bg-surface-muted/60 px-2.5 py-1.5">
                    <span className="truncate font-mono text-xs text-foreground">
                      {provider.default_base_url}
                    </span>
                    <CopyButton
                      value={provider.default_base_url}
                      iconOnly
                      variant="plain"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </TabsContent>

        {/* Tab 2: Supported Models Catalog */}
        <TabsContent value="models">
          <div className="rounded-[var(--radius-panel)] border border-border bg-surface p-5">
            <div className="flex flex-col gap-3 border-b border-border/70 pb-3.5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-sm font-medium text-foreground">
                  Advertised models
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Models routed to this driver. Toggle favorites or hide models
                  from client discovery.
                </p>
              </div>

              <SearchField
                label="Search models"
                id="model-filter"
                placeholder="Filter models by id or owner..."
                className="w-full sm:max-w-xs"
                {...modelSearchFieldProps}
              />
            </div>

            {filteredModels.length > 0 ? (
              <>
                <div className="mt-3 divide-y divide-border/40">
                  {visibleModels.map((m) => (
                    <div
                      key={m.id}
                      className="flex items-center justify-between py-2.5 text-xs transition-colors hover:bg-surface-muted/20 sm:px-2"
                    >
                      <div className="flex min-w-0 items-center gap-2.5 pr-3">
                        <button
                          type="button"
                          onClick={() => {
                            if (m.favorite) {
                              patchModelMutation.mutate({ unfavorite: [m.id] })
                            } else {
                              patchModelMutation.mutate({ favorite: [m.id] })
                            }
                          }}
                          className={`flex min-h-[var(--control-height-sm)] min-w-[var(--control-height-sm)] shrink-0 cursor-pointer items-center justify-center transition-colors ${
                            m.favorite
                              ? "text-warning hover:text-warning/80"
                              : "text-muted-foreground hover:text-foreground"
                          }`}
                          aria-label={
                            m.favorite ? "Unfavorite model" : "Favorite model"
                          }
                        >
                          <Star
                            size={14}
                            fill={m.favorite ? "currentColor" : "none"}
                          />
                        </button>

                        <div className="min-w-0">
                          <div className="flex min-w-0 items-center gap-2">
                            <span
                              title={m.id}
                              className={`min-w-0 truncate font-mono text-xs font-medium ${
                                m.hidden
                                  ? "text-muted-foreground line-through"
                                  : "text-foreground"
                              }`}
                            >
                              {m.id}
                            </span>
                            <CopyButton value={m.id} iconOnly variant="plain" />
                          </div>
                          <span className="block text-[11px] text-muted-foreground">
                            owned by {m.owned_by}
                          </span>
                        </div>
                      </div>

                      <div className="flex shrink-0 items-center gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={
                            m.hidden
                              ? "Hidden: restore model"
                              : "Active: hide model"
                          }
                          title={
                            m.hidden
                              ? "Restore to /v1/models"
                              : "Hide from /v1/models catalog"
                          }
                          onClick={() => {
                            if (m.hidden) {
                              patchModelMutation.mutate({ restore: [m.id] })
                            } else {
                              patchModelMutation.mutate({ hide: [m.id] })
                            }
                          }}
                          className="h-7 px-2 text-xs"
                        >
                          {m.hidden ? (
                            <>
                              <EyeOff
                                size={13}
                                className="text-warning"
                                aria-hidden="true"
                              />
                              <span className="hidden sm:inline">Hidden</span>
                            </>
                          ) : (
                            <>
                              <Eye
                                size={13}
                                className="text-muted-foreground"
                                aria-hidden="true"
                              />
                              <span className="hidden sm:inline">Active</span>
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
                {visibleModels.length < filteredModels.length && (
                  <div className="mt-3 flex justify-center">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setShowAllFor(modelSearch)}
                    >
                      Show all {filteredModels.length} models
                    </Button>
                  </div>
                )}
              </>
            ) : (
              <EmptyState
                label="Model catalog"
                title={
                  modelSearch ? "No matching models" : "No models advertised"
                }
                description={
                  modelSearch
                    ? "Try adjusting your search query."
                    : "This driver has not advertised any models in its catalog yet."
                }
              />
            )}
          </div>
        </TabsContent>
      </Tabs>

      <ConnectAccountModal
        open={connectModalOpen}
        onOpenChange={setConnectModalOpen}
        provider={provider}
        onSuccess={() => void refetch()}
      />
    </div>
  )
}
