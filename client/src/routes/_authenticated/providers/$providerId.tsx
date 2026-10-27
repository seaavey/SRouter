import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  createFileRoute,
  Link,
  useNavigate,
  useParams,
} from "@tanstack/react-router"
import {
  ArrowLeft,
  Copy,
  Eye,
  EyeOff,
  Network,
  Plus,
  Sparkles,
  Star,
  StarOff,
} from "lucide-react"
import { useState } from "react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"

import {
  deleteProvider,
  deleteProviderConnection,
  patchProvider,
  providerDetailQuery,
  refreshProviderModels,
  toggleRoundRobin,
} from "@/api/providers"
import type { ProviderConnectionView, ProviderModel } from "@/api/types"
import ActionButton from "@/components/arc/action-button/action-button"
import { Alert } from "@/components/arc/alert/alert"
import { Badge, type BadgeTone } from "@/components/arc/badge/badge"
import { Button } from "@/components/arc/button/button"
import { EmptyState } from "@/components/arc/empty-state/empty-state"
import { FloatingButtonGroup } from "@/components/arc/floating-button-group/floating-button-group"
import HoldToConfirm from "@/components/arc/hold-to-confirm/hold-to-confirm"
import { SearchField } from "@/components/arc/search-field/search-field"
import {
  type DataColumn,
  SortableDataTable,
} from "@/components/arc/sortable-data-table/sortable-data-table"
import { SplitButton } from "@/components/arc/split-button/split-button"
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
import ProviderSkeleton from "@/components/providers/ProviderSkeleton"
import {
  categoryLabel,
  PROTOCOL_LABELS,
} from "@/components/providers/provider-labels"
import useClipboard from "@/hooks/useClipboard"
import { useSearch } from "@/hooks/useSearch"

export const Route = createFileRoute("/_authenticated/providers/$providerId")({
  head: () => ({ meta: [{ title: "SRouter - Provider" }] }),
  component: ProviderDetailPage,
})

/** Models rendered before the rest are asked for. */
const MODEL_PAGE_SIZE = 100

/** The model flags one PATCH can set or clear, on one model or on a selection. */
type ModelPatch = {
  hide?: string[]
  restore?: string[]
  favorite?: string[]
  unfavorite?: string[]
}

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
  const [selectedModels, setSelectedModels] = useState<string[]>([])
  const { copy } = useClipboard()

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
    mutationFn: (payload: ModelPatch) => patchProvider(providerId, payload),
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

  // A bulk edit clears the selection once it lands: the rows already carry the
  // new state, and a stale selection would re-apply the same patch.
  async function applyToSelected(patch: ModelPatch) {
    try {
      await patchModelMutation.mutateAsync(patch)
      setSelectedModels([])
    } catch {
      // `onError` already reported it; keeping the selection allows a retry.
    }
  }

  // The row leaves when the invalidation refetches, so nothing is hidden locally.
  const connections = provider?.connections ?? []

  async function refreshProvider() {
    await refreshProviderModels(providerId)
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

  // A model carries two independent flags, a long id, and three actions, so
  // the catalog is a table: the id aligns, the state reads as a badge, and the
  // row's actions stay behind one control.
  const modelColumns: DataColumn<ProviderModel>[] = [
    {
      key: "id",
      label: "Model",
      width: 320,
      render: (_value, model) => (
        <span
          title={model.id}
          className="block max-w-80 truncate font-mono text-xs font-medium text-foreground"
        >
          {model.id}
        </span>
      ),
    },
    {
      key: "hidden",
      label: "Status",
      width: 104,
      render: (_value, model) => (
        <Badge tone={model.hidden ? "neutral" : "success"} size="sm">
          {model.hidden ? "Hidden" : "Listed"}
        </Badge>
      ),
    },
    {
      key: "actions",
      label: "Actions",
      width: 176,
      // `numeric` is the table's only alignment lever: without it the header
      // sits at the column's start edge while its buttons sit at the end.
      numeric: true,
      sortable: false,
      render: (_value, model) => (
        <span className="flex justify-end">
          <SplitButton
            variant="secondary"
            label={model.favorite ? "Unstar" : "Star"}
            icon={
              <Star
                size={14}
                strokeWidth={1.75}
                fill={model.favorite ? "currentColor" : "none"}
                aria-hidden="true"
              />
            }
            ariaLabel={`${model.favorite ? "Unstar" : "Star"} ${model.id}`}
            disabled={patchModelMutation.isPending}
            onClick={() =>
              patchModelMutation.mutate(
                model.favorite
                  ? { unfavorite: [model.id] }
                  : { favorite: [model.id] }
              )
            }
            actions={[
              {
                label: model.hidden
                  ? "Restore to /v1/models"
                  : "Hide from /v1/models",
                destructive: !model.hidden,
                icon: model.hidden ? (
                  <Eye size={14} strokeWidth={1.75} aria-hidden="true" />
                ) : (
                  <EyeOff size={14} strokeWidth={1.75} aria-hidden="true" />
                ),
                onSelect: () =>
                  patchModelMutation.mutate(
                    model.hidden
                      ? { restore: [model.id] }
                      : { hide: [model.id] }
                  ),
              },
              {
                label: "Copy model ID",
                icon: <Copy size={14} strokeWidth={1.75} aria-hidden="true" />,
                onSelect: () => {
                  void copy(model.id).then((copied) =>
                    copied
                      ? toast.success("Model ID copied", {
                          description: model.id,
                        })
                      : toast.error("Could not copy the model ID")
                  )
                },
              },
            ]}
          />
        </span>
      ),
    },
  ]

  if (isLoading) {
    return <ProviderSkeleton onRefresh={refreshProvider} />
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

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <ProviderLogo
            providerID={provider.id}
            protocol={provider.protocol}
            baseURL={provider.default_base_url}
            className="size-10 shrink-0"
          />
          <div className="flex min-w-0 flex-col">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg font-medium tracking-tight text-foreground">
                {provider.name}
              </h1>
              <Badge tone={provider.enabled ? "success" : "neutral"} size="sm">
                {provider.enabled ? "Active" : "Off"}
              </Badge>
            </div>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <span className="font-mono">{provider.id}</span>
              <span aria-hidden="true">•</span>
              <span>{categoryLabel(provider.category)}</span>
              <span aria-hidden="true">•</span>
              <span>{PROTOCOL_LABELS[provider.protocol]}</span>
              <span aria-hidden="true">•</span>
              <span className="tabular-nums">
                {provider.status.connected_count}{" "}
                {provider.status.connected_count === 1
                  ? "connection"
                  : "connections"}
              </span>
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <ActionButton
            label="Refresh"
            pendingLabel="Refreshing"
            successLabel="Refreshed"
            onAction={refreshProvider}
            className="!border-border !bg-surface !text-foreground"
          />
          <Button
            variant="primary"
            size="sm"
            onClick={() => setConnectModalOpen(true)}
            className="flex items-center gap-1.5"
          >
            <Plus size={13} aria-hidden="true" />
            <span>Connect account</span>
          </Button>
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
            <span className="ml-1 rounded-full bg-surface-muted px-1.5 font-mono text-xs text-muted-foreground">
              {connections.length}
            </span>
          </TabsTrigger>
          <TabsTrigger value="models" className="flex items-center gap-1.5">
            <Sparkles size={14} aria-hidden="true" />
            <span className="sm:hidden">Models</span>
            <span className="hidden sm:inline">Supported Models</span>
            <span className="ml-1 rounded-full bg-surface-muted px-1.5 font-mono text-xs text-muted-foreground">
              {models.length}
            </span>
          </TabsTrigger>
        </TabsList>

        {/* Tab 1: Connections & Routing Settings */}
        <TabsContent value="connections">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            {/* Active Accounts & Connections (Span 2) */}
            <div className="flex flex-col rounded-[var(--radius-panel)] border border-border bg-surface p-5 lg:col-span-2">
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
                // The panel stretches to the right column, so the state that
                // stands in for the rows fills it instead of hugging the top.
                <div className="mt-4 flex flex-1 items-center justify-center">
                  <EmptyState
                    label="Provider connections"
                    title={provider.status.message}
                    description={
                      provider.requires_oauth
                        ? "Requires OAuth authentication token to establish live connections."
                        : provider.requires_api_key
                          ? "Requires valid API key or upstream endpoint configuration."
                          : "Ready for unlimited local or free tier routing."
                    }
                    action={
                      provider.requires_oauth || provider.requires_api_key ? (
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() => setConnectModalOpen(true)}
                          className="inline-flex items-center gap-1.5"
                        >
                          <Plus size={13} aria-hidden="true" />
                          <span>Connect account now</span>
                        </Button>
                      ) : undefined
                    }
                  />
                </div>
              )}
            </div>

            {/* Traffic Rotation Configuration */}
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
                  <Switch
                    checked={provider.enabled}
                    onCheckedChange={(val) => toggleEnabledMutation.mutate(val)}
                    disabled={toggleEnabledMutation.isPending}
                    aria-label="Toggle driver active status"
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
            </div>
          </div>
        </TabsContent>

        {/* Tab 2: Supported Models Catalog */}
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

              <SearchField
                label="Search models"
                id="model-filter"
                placeholder="Filter models by ID or owner..."
                className="w-full sm:max-w-xs"
                {...modelSearchFieldProps}
              />
            </div>

            {filteredModels.length > 0 ? (
              <>
                <SortableDataTable
                  rows={visibleModels}
                  columns={modelColumns}
                  rowKey="id"
                  caption="Advertised models"
                  selectable
                  selectedKeys={selectedModels}
                  onSelectionChange={setSelectedModels}
                  itemName={{ one: "model", other: "models" }}
                />
                {visibleModels.length < filteredModels.length && (
                  <div className="flex justify-center">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setShowAllFor(modelSearch)}
                    >
                      Show all {filteredModels.length} models
                    </Button>
                  </div>
                )}
                {selectedModels.length > 0 && (
                  // The tray sticks to the bottom of the scroll area, so a
                  // selection made on row 80 is acted on without scrolling back.
                  <div className="pointer-events-none sticky bottom-4 z-20 flex flex-wrap items-center justify-center gap-2">
                    <span
                      role="status"
                      aria-live="polite"
                      className="pointer-events-auto rounded-full border border-border bg-surface-raised px-3 py-1.5 text-xs font-medium text-foreground shadow-[var(--shadow-floating)]"
                    >
                      {selectedModels.length} selected
                    </span>
                    <FloatingButtonGroup
                      className="pointer-events-auto"
                      label="Selected model actions"
                      variant="floating"
                      size="sm"
                      items={[
                        {
                          id: "star",
                          label: "Star",
                          icon: <Star size={15} aria-hidden="true" />,
                          disabled: patchModelMutation.isPending,
                          onSelect: () =>
                            void applyToSelected({ favorite: selectedModels }),
                        },
                        {
                          id: "unstar",
                          label: "Unstar",
                          icon: <StarOff size={15} aria-hidden="true" />,
                          disabled: patchModelMutation.isPending,
                          onSelect: () =>
                            void applyToSelected({
                              unfavorite: selectedModels,
                            }),
                        },
                        { type: "separator" },
                        {
                          id: "hide",
                          label: "Hide",
                          icon: <EyeOff size={15} aria-hidden="true" />,
                          disabled: patchModelMutation.isPending,
                          onSelect: () =>
                            void applyToSelected({ hide: selectedModels }),
                        },
                        {
                          id: "restore",
                          label: "Restore",
                          icon: <Eye size={15} aria-hidden="true" />,
                          disabled: patchModelMutation.isPending,
                          onSelect: () =>
                            void applyToSelected({ restore: selectedModels }),
                        },
                      ]}
                    />
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
