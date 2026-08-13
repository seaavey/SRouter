import { Plus, RefreshCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CatalogSummaryItems, FilterValue } from "./catalog-utils";

interface CatalogToolbarProps {
    isFetching: boolean;
    onRefresh: () => void;
    onAddProvider: () => void;
    summaryItems: CatalogSummaryItems[];
    filterOptions: { value: FilterValue; label: string; count: number }[];
    filter: FilterValue;
    onFilterChange: (value: FilterValue) => void;
    search: string;
    onSearchChange: (value: string) => void;
}

export function CatalogToolbar({
    isFetching,
    onRefresh,
    onAddProvider,
    summaryItems,
    filterOptions,
    filter,
    onFilterChange,
    search,
    onSearchChange,
}: CatalogToolbarProps) {
    return (
        <>
            <header className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
                <div className="min-w-0">
                    <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                        Integrations
                    </p>
                    <h1 className="mt-1.5 text-2xl font-bold tracking-tight text-foreground">
                        Provider catalog
                    </h1>
                    <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
                        Every driver this gateway can route to, and which of them currently hold
                        live credentials.
                    </p>
                </div>

                <div className="flex shrink-0 items-center gap-1.5">
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={onRefresh}
                        disabled={isFetching}
                        className="text-muted-foreground hover:text-foreground"
                    >
                        <RefreshCw className={isFetching ? "animate-spin" : undefined} />
                        {isFetching ? "Refreshing" : "Refresh"}
                    </Button>
                    <Button type="button" size="sm" onClick={onAddProvider}>
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
                        <p
                            className="mt-1 truncate text-[11px] text-muted-foreground"
                            title={item.detail}
                        >
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
                                onClick={() => onFilterChange(option.value)}
                                className={`shrink-0 border-b-2 px-2 pb-1.5 text-xs transition-colors ${
                                    isActive
                                        ? "border-foreground font-semibold text-foreground"
                                        : "border-transparent font-medium text-muted-foreground hover:text-foreground"
                                }`}
                            >
                                {option.label}
                                <span className="ml-1 font-mono text-[10px] tabular-nums text-muted-foreground">
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
                        onChange={(event) => onSearchChange(event.target.value)}
                        placeholder="Search name, id, protocol…"
                        className="pl-8 font-mono text-xs"
                    />
                </label>
            </div>
        </>
    );
}
