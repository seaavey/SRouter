import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { Plus, Settings2 } from "lucide-react"
import { useEffect, useState } from "react"
import {
  addCustomProvider,
  patchProvider,
  providersListQuery,
} from "@/api/providers"
import type { ProviderEntry } from "@/api/types"
import ActionButton from "@/components/arc/action-button/action-button"
import { Alert } from "@/components/arc/alert/alert"
import { Badge } from "@/components/arc/badge/badge"
import { Button } from "@/components/arc/button/button"
import ChipGroup from "@/components/arc/chip-group/chip-group"
import { EmptyState } from "@/components/arc/empty-state/empty-state"
import { SearchField } from "@/components/arc/search-field/search-field"
import { Skeleton } from "@/components/arc/skeleton/skeleton"
import { SplitButton } from "@/components/arc/split-button/split-button"
import {
  type DataColumn,
  SortableDataTable,
} from "@/components/arc/sortable-data-table/sortable-data-table"
import useClipboard from "@/hooks/useClipboard"
import { useSearch } from "@/hooks/useSearch"
import { toast } from "@/components/arc/toast-stack/toast-stack"
import { SectionHeader } from "@/components/layout/section-header"
import AddCustomProviderDialog from "@/components/providers/modals/AddCustomProviderDialog"
import { ProviderLogo } from "@/components/providers/provider-logo"

import {
  categoryLabel,
  PROTOCOL_LABELS,
} from "@/components/providers/provider-labels"

export const Route = createFileRoute("/_authenticated/providers/")({
  head: () => ({ meta: [{ title: "SRouter - Model providers" }] }),
  component: ProvidersListPage,
})

const CATEGORIES = [
  { id: "all", label: "All" },
  { id: "oauth", label: "OAuth" },
  { id: "api_key", label: "API key" },
  { id: "free_tier", label: "Free tier" },
  { id: "custom_provider", label: "Custom" },
] as const

type CategoryFilter = (typeof CATEGORIES)[number]["id"]
type AddCustomProviderInput = Parameters<typeof addCustomProvider>[0]

const SEARCH_KEYS = ["name", "id", "protocol"] as const

/** The table sorts on a row field, so the nested status count is lifted onto it. */
type ProviderRow = ProviderEntry & { connected_count: number }

function ProvidersListPage() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [selectedCategory, setSelectedCategory] =
    useState<CategoryFilter>("all")
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [resultAnnouncement, setResultAnnouncement] = useState("")
  const { data, isLoading, isError, error, refetch, isFetching } =
    useQuery(providersListQuery)
  const addProvider = useMutation({ mutationFn: addCustomProvider })
  const { copy } = useClipboard()
  // The row action turns one driver off without leaving the list, so the table
  // refetches as soon as the server agrees.
  const toggleDriver = useMutation({
    mutationFn: (input: {
      providerID: string
      name: string
      enabled: boolean
    }) => patchProvider(input.providerID, { enabled: input.enabled }),
    onSuccess: (_entry, input) => {
      void queryClient.invalidateQueries({ queryKey: ["providers"] })
      toast.success(input.enabled ? "Driver enabled" : "Driver disabled", {
        description: `${input.name} ${
          input.enabled
            ? "takes traffic again."
            : "takes no traffic until you enable it."
        }`,
      })
    },
    onError: (mutationError) => {
      toast.error("Could not change driver status", {
        description:
          mutationError instanceof Error ? mutationError.message : undefined,
      })
    },
  })
  const providers = data?.data ?? []
  const {
    query: search,
    setQuery: setSearch,
    hasQuery,
    filteredItems: searchedProviders,
    fieldProps: searchFieldProps,
  } = useSearch(providers, {
    keys: SEARCH_KEYS,
  })
  const normalizedSearch = search.trim().toLowerCase()
  const filteredProviders = searchedProviders.filter(
    (provider) =>
      selectedCategory === "all" || provider.category === selectedCategory
  )
  // A category is a facet, so the chips read as a filter, not as a view switch:
  // they narrow the list below and the count rides in the label.
  const categoryOptions = CATEGORIES.map((category) => {
    const count = data
      ? category.id === "all"
        ? searchedProviders.length
        : searchedProviders.filter(
            (provider) => provider.category === category.id
          ).length
      : null
    return {
      value: category.id,
      label: count === null ? category.label : `${category.label} ${count}`,
    }
  })
  const filtersActive = hasQuery || selectedCategory !== "all"
  const rows: ProviderRow[] = filteredProviders.map((provider) => ({
    ...provider,
    connected_count: provider.status.connected_count,
  }))
  const connectedCount = providers.filter(
    (provider) => provider.status.connected_count > 0
  ).length

  useEffect(() => {
    if (!data || isFetching) return
    const timer = window.setTimeout(() => {
      const activeFilters = [
        selectedCategory !== "all" ? categoryLabel(selectedCategory) : "",
        normalizedSearch ? `search “${normalizedSearch}”` : "",
      ]
        .filter(Boolean)
        .join(" and ")
      setResultAnnouncement(
        `${filteredProviders.length} of ${providers.length} providers shown${activeFilters ? ` for ${activeFilters}` : ""}.`
      )
    }, 300)
    return () => window.clearTimeout(timer)
  }, [
    data,
    filteredProviders.length,
    isFetching,
    normalizedSearch,
    providers.length,
    selectedCategory,
  ])

  async function refreshProviders() {
    const result = await refetch()
    if (result.error) throw result.error
  }

  async function submitCustomProvider(input: AddCustomProviderInput) {
    const created = await addProvider.mutateAsync(input)
    resetFilters()
    await queryClient.invalidateQueries({ queryKey: ["providers"] })
    toast.success("Custom provider added", {
      description: `${created.name} is now visible in the All providers list.`,
      action: {
        label: "View provider",
        onClick: () => {
          void navigate({
            to: "/providers/$providerId",
            params: { providerId: created.id },
          })
        },
      },
    })
  }

  function resetFilters() {
    setSearch("")
    setSelectedCategory("all")
  }

  const columns: DataColumn<ProviderRow>[] = [
    {
      key: "name",
      label: "Provider",
      render: (_value, row) => (
        <span className="flex items-center gap-2.5">
          <ProviderLogo
            providerID={row.id}
            protocol={row.protocol}
            baseURL={row.default_base_url}
            className="size-5 shrink-0"
          />
          <span className="flex min-w-0 flex-col">
            <span className="block truncate text-xs font-medium text-foreground">
              {row.name}
            </span>
            <span className="block truncate font-mono text-xs text-muted-foreground">
              {row.id}
            </span>
          </span>
        </span>
      ),
    },
    {
      key: "category",
      label: "Category",
      width: 110,
      render: (_value, row) => (
        <span className="text-xs text-muted-foreground">
          {categoryLabel(row.category)}
        </span>
      ),
    },
    {
      key: "protocol",
      label: "Protocol",
      width: 110,
      render: (_value, row) => (
        <span className="text-xs text-muted-foreground">
          {PROTOCOL_LABELS[row.protocol]}
        </span>
      ),
    },
    {
      key: "connected_count",
      label: "Connections",
      width: 130,
      numeric: true,
      render: (_value, row) => (
        <span className="flex flex-col items-end gap-0.5">
          <span className="text-xs text-foreground tabular-nums">
            {row.connected_count}
          </span>
          {row.round_robin && (
            <span className="text-xs text-muted-foreground">Rotation on</span>
          )}
        </span>
      ),
    },
    {
      key: "enabled",
      label: "Status",
      width: 120,
      render: (_value, row) => (
        <Badge tone={row.enabled ? "success" : "neutral"} size="sm">
          {row.enabled ? "Enabled" : "Disabled"}
        </Badge>
      ),
    },
    {
      key: "actions",
      label: "Actions",
      width: 210,
      // `numeric` is the table's only alignment lever; the header has to sit
      // over the right-aligned button, not at the column's start edge.
      numeric: true,
      sortable: false,
      render: (_value, row) => (
        <span className="flex justify-end">
          <SplitButton
            variant="secondary"
            label="Configure"
            icon={<Settings2 size={14} strokeWidth={1.75} aria-hidden="true" />}
            ariaLabel={`Configure ${row.name}`}
            disabled={toggleDriver.isPending}
            onClick={() =>
              void navigate({
                to: "/providers/$providerId",
                params: { providerId: row.id },
              })
            }
            actions={[
              {
                label: "Copy ID",
                onSelect: () => {
                  void copy(row.id).then((copied) =>
                    copied
                      ? toast.success("Provider ID copied", {
                          description: row.id,
                        })
                      : toast.error("Could not copy the provider ID")
                  )
                },
              },
              {
                label: row.enabled ? "Disable driver" : "Enable driver",
                onSelect: () =>
                  toggleDriver.mutate({
                    providerID: row.id,
                    name: row.name,
                    enabled: !row.enabled,
                  }),
              },
            ]}
          />
        </span>
      ),
    },
  ]

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title="Model providers"
        description={
          data
            ? `${connectedCount} of ${providers.length} drivers have a connected account.`
            : "Every model driver this gateway can route to."
        }
        actions={
          <Button
            variant="primary"
            size="md"
            onClick={() => setAddDialogOpen(true)}
          >
            <Plus size={16} aria-hidden="true" />
            <span>Add custom provider</span>
          </Button>
        }
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SearchField
          id="provider-search"
          label="Search providers"
          placeholder="Filter by name, ID, or protocol..."
          className="w-full sm:max-w-xs"
          {...searchFieldProps}
        />
        <ChipGroup
          label="Filter by category"
          options={categoryOptions}
          value={[selectedCategory]}
          onValueChange={(next) => {
            // The group sends an empty list when the active chip is clicked
            // again; the explicit "All" chip is the only way back to it.
            const picked = next[0]
            if (!picked) return
            const category = CATEGORIES.find((option) => option.id === picked)
            if (category) setSelectedCategory(category.id)
          }}
          multiple={false}
          maxVisible={3}
          className="max-w-full"
        />
      </div>

      {isError && (
        <Alert
          tone="danger"
          title={
            data ? "Could not refresh providers" : "Could not load providers"
          }
        >
          <span className="flex flex-col items-start gap-3">
            <span className="break-words">
              {error instanceof Error
                ? error.message
                : "The provider list is unavailable."}
              {data ? " Showing the last loaded data." : ""}
            </span>
            <ActionButton
              label={data ? "Retry refresh" : "Retry provider list"}
              pendingLabel="Retrying list"
              successLabel="List loaded"
              onAction={refreshProviders}
              className="!border-border !bg-surface !text-foreground"
            />
          </span>
        </Alert>
      )}

      {isLoading && !data && <Skeleton label="Loading providers" lines={6} />}

      {!isLoading && data && filteredProviders.length === 0 && (
        <EmptyState
          label="Provider results"
          title={filtersActive ? "No matching providers" : "No providers yet"}
          description={
            filtersActive
              ? "Try another search or clear the category filter."
              : "Add a custom endpoint to route requests through your own model service."
          }
          action={
            filtersActive ? (
              <Button variant="secondary" size="md" onClick={resetFilters}>
                Clear filters
              </Button>
            ) : (
              <Button
                variant="secondary"
                size="md"
                onClick={() => setAddDialogOpen(true)}
              >
                Add custom provider
              </Button>
            )
          }
        />
      )}

      {!isLoading && data && filteredProviders.length > 0 && (
        <SortableDataTable
          rows={rows}
          columns={columns}
          rowKey="id"
          caption="Model providers"
        />
      )}

      <p
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {resultAnnouncement}
      </p>

      <AddCustomProviderDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        onSubmit={submitCustomProvider}
      />
    </div>
  )
}
