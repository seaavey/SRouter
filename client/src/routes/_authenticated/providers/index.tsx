import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { Plus } from "lucide-react"
import { useEffect, useState } from "react"
import { addCustomProvider, providersListQuery } from "@/api/providers"
import ActionButton from "@/components/arc/action-button/action-button"
import { Alert } from "@/components/arc/alert/alert"
import { Badge } from "@/components/arc/badge/badge"
import { Button } from "@/components/arc/button/button"
import { Card } from "@/components/arc/card/card"
import ChipGroup from "@/components/arc/chip-group/chip-group"
import { EmptyState } from "@/components/arc/empty-state/empty-state"
import { SearchField } from "@/components/arc/search-field/search-field"
import { Skeleton } from "@/components/arc/skeleton/skeleton"
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

/* The rail and the topbar take their width out of the viewport before this grid
   sees any of it, so a viewport breakpoint here overstates the room a card has.
   One column until the content column is wide enough for two cards at their
   natural size, then three only on a wide desk. */
const CARD_GRID = "grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3"

function connectionLabel(count: number) {
  return `${count} active ${count === 1 ? "connection" : "connections"}`
}

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

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title="Model providers"
        description="Manage model drivers, enabled connections, and custom endpoints."
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
          placeholder="Filter by name, id, or protocol..."
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

      {isLoading && !data && (
        <div
          aria-busy="true"
          aria-label="Loading providers"
          className={CARD_GRID}
        >
          {Array.from({ length: 6 }, (_, index) => (
            <div
              key={index}
              className="rounded-[var(--radius-panel)] border border-border bg-surface p-5"
            >
              <Skeleton label="Loading providers" lines={2} avatar />
            </div>
          ))}
        </div>
      )}

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
        <section
          aria-labelledby="provider-list-title"
          className="flex flex-col gap-3"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h2
              id="provider-list-title"
              className="text-sm font-medium text-foreground"
            >
              Available providers
            </h2>
            <p className="text-xs text-muted-foreground">
              {filteredProviders.length} of {providers.length} providers
            </p>
          </div>
          <div className={CARD_GRID}>
            {filteredProviders.map((provider) => (
              <Card
                key={provider.id}
                title={provider.name}
                avatar={
                  <ProviderLogo
                    providerID={provider.id}
                    protocol={provider.protocol}
                    baseURL={provider.default_base_url}
                    className="size-8"
                  />
                }
                meta={<span className="font-mono">{provider.id}</span>}
                // The driver's message describes the empty state, so it only
                // reads true while no account is connected.
                status={
                  provider.status.state === "no_connections"
                    ? provider.status.message
                    : undefined
                }
                action={
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      void navigate({
                        to: "/providers/$providerId",
                        params: { providerId: provider.id },
                      })
                    }
                  >
                    Configure
                  </Button>
                }
              >
                {/* The separator rides with the item that follows it, so a
                    wrapped line never ends on a lone bullet. */}
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <Badge
                    tone={provider.enabled ? "success" : "neutral"}
                    size="sm"
                  >
                    {provider.enabled ? "Enabled" : "Disabled"}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {connectionLabel(provider.status.connected_count)}
                  </span>
                  <span className="flex items-center gap-2 text-xs whitespace-nowrap text-muted-foreground">
                    <span aria-hidden="true">•</span>
                    {categoryLabel(provider.category)}
                  </span>
                  <span className="flex items-center gap-2 text-xs whitespace-nowrap text-muted-foreground">
                    <span aria-hidden="true">•</span>
                    {PROTOCOL_LABELS[provider.protocol]}
                  </span>
                  {provider.round_robin && (
                    <span className="flex items-center gap-2 text-xs whitespace-nowrap text-muted-foreground">
                      <span aria-hidden="true">•</span>
                      Rotation on
                    </span>
                  )}
                </div>
              </Card>
            ))}
          </div>
        </section>
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
