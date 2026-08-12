import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Plus, RefreshCw, Search, TriangleAlert } from "lucide-react";
import { api } from "@/lib/api";
import type { ProviderCategory, ProviderDefinition } from "@srouter/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { AddProviderSheet } from "@/components/providers/add-provider-sheet";
import { ProviderRow } from "@/components/providers/provider-row";
import { getConnectedCount } from "@/components/providers/provider-status";

export const Route = createFileRoute("/providers/")({
    staticData: { title: "Providers" },
    component: ProvidersPage,
});

interface CatalogSummary {
    total: number;
    categories: Record<ProviderCategory, ProviderDefinition[]>;
}

const categoryOrder: ProviderCategory[] = ["oauth", "api_key", "free_tier", "custom"];

const categoryLabels: Record<ProviderCategory, string> = {
    oauth: "OAuth session",
    api_key: "API key",
    free_tier: "Free tier",
    custom: "Custom",
};

const categoryDescriptions: Record<ProviderCategory, string> = {
    oauth: "Signed in through a provider account rather than a key.",
    api_key: "Authenticated with a platform key you supply.",
    free_tier: "Free or rate-limited public endpoints.",
    custom: "Endpoints you registered on this gateway.",
};

type FilterValue = "all" | ProviderCategory;

function ProvidersSkeleton() {
    return (
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
                <div>
                    <Skeleton className="h-3 w-24" />
                    <Skeleton className="mt-3 h-7 w-48" />
                    <Skeleton className="mt-2 h-4 w-72 max-w-full" />
                </div>
                <Skeleton className="h-8 w-32 rounded-lg" />
            </div>
            <div className="grid grid-cols-2 border-y border-border/70 xl:grid-cols-4">
                {Array.from({ length: 4 }).map((_, index) => (
                    <div key={index} className="px-4 py-5 first:pl-0">
                        <Skeleton className="h-14 rounded-lg" />
                    </div>
                ))}
            </div>
            <Skeleton className="h-8 w-full max-w-md rounded-lg" />
            <Skeleton className="h-96 rounded-lg" />
        </div>
    );
}

function ProvidersPage() {
    const [filter, setFilter] = useState<FilterValue>("all");
    const [search, setSearch] = useState("");
    const [isAddOpen, setIsAddOpen] = useState(false);

    const { data, isPending, isFetching, error, refetch } = useQuery({
        queryKey: ["providers", "catalog"],
        queryFn: () => api.get<CatalogSummary>("/v1/providers/catalog"),
    });

    const allProviders = useMemo(
        () => (data ? categoryOrder.flatMap((category) => data.categories[category] ?? []) : []),
        [data],
    );

    const normalizedSearch = search.trim().toLowerCase();

    const matches = useMemo(
        () =>
            allProviders.filter((provider) => {
                if (filter !== "all" && provider.category !== filter) return false;
                if (!normalizedSearch) return true;
                return (
                    provider.name.toLowerCase().includes(normalizedSearch) ||
                    provider.id.toLowerCase().includes(normalizedSearch) ||
                    provider.protocol.toLowerCase().includes(normalizedSearch)
                );
            }),
        [allProviders, filter, normalizedSearch],
    );

    if (isPending && !data) {
        return <ProvidersSkeleton />;
    }

    if (!data) {
        return (
            <div className="mx-auto w-full max-w-7xl">
                <div className="flex min-h-64 flex-col items-center justify-center rounded-xl border border-destructive/30 bg-destructive/5 px-6 text-center">
                    <div className="flex size-10 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                        <TriangleAlert className="size-5" strokeWidth={1.75} />
                    </div>
                    <h1 className="mt-4 text-base font-semibold text-foreground">Unable to load the provider catalog</h1>
                    <p className="mt-1 max-w-lg text-xs text-muted-foreground">
                        {error instanceof Error ? error.message : "The gateway returned an unknown error."}
                    </p>
                    <Button type="button" variant="outline" size="sm" className="mt-4" onClick={() => void refetch()}>
                        <RefreshCw />
                        Retry
                    </Button>
                </div>
            </div>
        );
    }

    const connectedProviders = allProviders.filter((provider) => getConnectedCount(provider) > 0);
    const totalConnections = allProviders.reduce(
        (total, provider) => total + getConnectedCount(provider),
        0,
    );
    const totalModels = allProviders.reduce((total, provider) => total + provider.models.length, 0);

    const summaryItems = [
        { label: "Drivers", value: data.total.toLocaleString(), detail: "Available in the registry" },
        {
            label: "Connected",
            value: connectedProviders.length.toLocaleString(),
            detail: `${totalConnections.toLocaleString()} active ${totalConnections === 1 ? "connection" : "connections"}`,
        },
        {
            label: "Unconfigured",
            value: (allProviders.length - connectedProviders.length).toLocaleString(),
            detail: "Ready to connect",
        },
        { label: "Models", value: totalModels.toLocaleString(), detail: "Exposed across all drivers" },
    ];

    const filterOptions: { value: FilterValue; label: string; count: number }[] = [
        { value: "all", label: "All", count: allProviders.length },
        ...categoryOrder.map((category) => ({
            value: category as FilterValue,
            label: categoryLabels[category],
            count: (data.categories[category] ?? []).length,
        })),
    ];

    const groups =
        filter === "all"
            ? categoryOrder
                  .map((category) => ({
                      category,
                      providers: matches.filter((provider) => provider.category === category),
                  }))
                  .filter((group) => group.providers.length > 0)
            : [{ category: filter, providers: matches }];

    return (
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
            <header className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
                <div className="min-w-0">
                    <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                        Integrations
                    </p>
                    <h1 className="mt-1.5 text-2xl font-bold tracking-tight text-foreground">Provider catalog</h1>
                    <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
                        Every driver this gateway can route to, and which of them currently hold live credentials.
                    </p>
                </div>

                <div className="flex shrink-0 items-center gap-1.5">
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => void refetch()}
                        disabled={isFetching}
                        className="text-muted-foreground hover:text-foreground"
                    >
                        <RefreshCw className={isFetching ? "animate-spin" : undefined} />
                        {isFetching ? "Refreshing" : "Refresh"}
                    </Button>
                    <Button type="button" size="sm" onClick={() => setIsAddOpen(true)}>
                        <Plus />
                        Add provider
                    </Button>
                </div>
            </header>

            <section
                aria-label="Catalog summary"
                className="grid grid-cols-1 border-y border-border/70 sm:grid-cols-2 sm:[&>article:nth-child(n+3)]:border-t xl:grid-cols-4 xl:[&>article:nth-child(n+3)]:border-t-0"
            >
                {summaryItems.map((item) => (
                    <article
                        key={item.label}
                        className="relative min-w-0 px-4 py-5 xl:[&:not(:first-child)]:border-l xl:[&:not(:first-child)]:border-border/70"
                    >
                        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                            {item.label}
                        </span>
                        <div className="mt-2 text-2xl font-semibold tracking-tight tabular-nums text-foreground">
                            {item.value}
                        </div>
                        <p className="mt-1 truncate text-[11px] text-muted-foreground" title={item.detail}>
                            {item.detail}
                        </p>
                    </article>
                ))}
            </section>

            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div
                    role="tablist"
                    aria-label="Filter providers by category"
                    className="-mx-1 flex items-center gap-1 overflow-x-auto px-1 pb-1 lg:mx-0 lg:px-0 lg:pb-0"
                >
                    {filterOptions.map((option) => {
                        const isActive = filter === option.value;
                        return (
                            <button
                                key={option.value}
                                type="button"
                                role="tab"
                                aria-selected={isActive}
                                onClick={() => setFilter(option.value)}
                                className={`shrink-0 border-b-2 px-2 pb-1.5 text-xs transition-colors ${
                                    isActive
                                        ? "border-foreground font-semibold text-foreground"
                                        : "border-transparent font-medium text-muted-foreground hover:text-foreground"
                                }`}
                            >
                                {option.label}
                                <span className="ml-1.5 font-mono text-[10px] tabular-nums text-muted-foreground">
                                    {option.count}
                                </span>
                            </button>
                        );
                    })}
                </div>

                <label className="relative w-full lg:w-64">
                    <span className="sr-only">Search providers</span>
                    <Search
                        className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
                        strokeWidth={1.75}
                    />
                    <Input
                        type="search"
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        placeholder="Search name, id, protocol…"
                        className="pl-8 font-mono text-xs"
                    />
                </label>
            </div>

            {matches.length === 0 ? (
                <div className="flex min-h-56 flex-col items-center justify-center border-y border-border/70 px-6 text-center">
                    <Search className="mb-3 size-5 text-muted-foreground" strokeWidth={1.5} />
                    <p className="text-sm font-medium text-foreground">No matching providers</p>
                    <p className="mt-1 max-w-sm text-xs text-muted-foreground">
                        {normalizedSearch
                            ? `Nothing matches “${search.trim()}” in this view. Try a different term or clear the filter.`
                            : "This category has no drivers registered yet."}
                    </p>
                </div>
            ) : (
                <div className="flex flex-col gap-6">
                    {groups.map((group) => (
                        <section key={group.category} aria-labelledby={`category-${group.category}`}>
                            <header className="flex items-baseline justify-between gap-4 border-b border-border/70 pb-2">
                                <div className="min-w-0">
                                    <h2
                                        id={`category-${group.category}`}
                                        className="text-xs font-semibold text-foreground"
                                    >
                                        {categoryLabels[group.category]}
                                    </h2>
                                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                                        {categoryDescriptions[group.category]}
                                    </p>
                                </div>
                                <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
                                    {group.providers.length}
                                </span>
                            </header>

                            <div className="divide-y divide-border/50">
                                {group.providers.map((provider) => (
                                    <ProviderRow key={provider.id} provider={provider} />
                                ))}
                            </div>
                        </section>
                    ))}
                </div>
            )}

            <AddProviderSheet open={isAddOpen} onOpenChange={setIsAddOpen} />
        </div>
    );
}
