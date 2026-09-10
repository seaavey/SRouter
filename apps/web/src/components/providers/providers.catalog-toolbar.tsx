import {
    Boxes,
    CheckCircle2,
    Cpu,
    LayoutGrid,
    Layers,
    List,
    Plus,
    RefreshCw,
    Search,
    X
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CatalogSummaryItems, FilterValue } from "@/utils/catalog.utils";

interface CatalogToolbarProps {
    isFetching: boolean;
    onRefresh: () => void;
    summaryItems?: CatalogSummaryItems[];
    filterOptions: { value: FilterValue; label: string; count: number }[];
    filter: FilterValue;
    onFilterChange: (value: FilterValue) => void;
    search: string;
    onSearchChange: (value: string) => void;
    viewMode: "grid" | "list";
    onViewModeChange: (mode: "grid" | "list") => void;
    onAddCustom?: () => void;
}

const summaryIcons = {
    Drivers: Cpu,
    Connected: CheckCircle2,
    Unconfigured: Boxes,
    Models: Layers
};

export function CatalogToolbar({
    isFetching,
    onRefresh,
    summaryItems,
    filterOptions,
    filter,
    onFilterChange,
    search,
    onSearchChange,
    viewMode,
    onViewModeChange,
    onAddCustom
}: CatalogToolbarProps) {
    return (
        <div className="space-y-6">
            {/* Editorial Header */}
            <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end border-b border-hairline-soft pb-5">
                <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                        Telemetry & Routing Catalog
                    </p>
                    <h1 className="mt-1 text-3xl md:text-4xl font-bold tracking-tight text-ink font-sans">
                        Provider Registry.
                    </h1>
                    <p className="mt-1.5 max-w-2xl text-sm text-text-muted leading-relaxed">
                        Manage upstream LLM executors, API credentials, and live inference
                        connections across OpenAI, Anthropic, and gateway providers.
                    </p>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                    {onAddCustom && (
                        <Button
                            type="button"
                            size="sm"
                            onClick={onAddCustom}
                            className="rounded-full px-5 h-9 text-xs font-semibold cursor-pointer gap-1.5 shadow-none"
                        >
                            <Plus className="size-3.5" />
                            <span>Add Custom Provider</span>
                        </Button>
                    )}
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={onRefresh}
                        disabled={isFetching}
                        className="rounded-full px-4 h-9 text-xs font-semibold cursor-pointer gap-1.5 border-hairline bg-canvas hover:bg-canvas-soft transition-colors shadow-none text-ink"
                    >
                        <RefreshCw
                            className={`size-3.5 text-text-muted ${isFetching ? "animate-spin" : ""}`}
                        />
                        <span>{isFetching ? "Syncing…" : "Refresh"}</span>
                    </Button>
                </div>
            </header>

            {/* Tactical Summary KPI Strip (if summary items available) */}
            {summaryItems && summaryItems.length > 0 && (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    {summaryItems.map((item) => {
                        const Icon = summaryIcons[item.label as keyof typeof summaryIcons] ?? Boxes;
                        const isConnectedCategory = item.label === "Connected";
                        const connectedCount = parseInt(item.value, 10) || 0;
                        const hasConnections = isConnectedCategory && connectedCount > 0;

                        return (
                            <div
                                key={item.label}
                                className="relative flex flex-col justify-between rounded-3xl border border-hairline-soft bg-canvas p-5 transition-colors shadow-none hover:border-hairline"
                            >
                                <div className="flex items-center justify-between text-text-muted">
                                    <span className="text-xs font-semibold uppercase tracking-wider">
                                        {item.label}
                                    </span>
                                    <Icon className="size-4 text-text-muted/70" />
                                </div>
                                <div className="mt-3 flex items-baseline gap-2">
                                    <span className="text-3xl font-bold tracking-tight text-ink tabular-nums font-mono">
                                        {item.value}
                                    </span>
                                    {hasConnections && (
                                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                                            <span className="size-1.5 rounded-full bg-emerald-500" />
                                            Active
                                        </span>
                                    )}
                                </div>
                                <p className="mt-1.5 text-xs text-text-muted truncate">
                                    {item.detail}
                                </p>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Controls Bar: Filter Tabs, Search & View Toggle */}
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between border border-hairline-soft p-2 bg-canvas-soft rounded-3xl lg:rounded-full">
                {/* Category Filter Tabs: Segmented Control Stadium Pills */}
                <div
                    role="tablist"
                    aria-label="Filter providers by category"
                    className="flex flex-wrap items-center gap-1 p-0.5"
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
                                className={`rounded-full px-4 py-1.5 text-xs transition-colors cursor-pointer flex items-center gap-1.5 ${
                                    isActive
                                        ? "bg-ink text-canvas font-semibold shadow-none"
                                        : "text-text-muted hover:text-ink hover:bg-canvas/50 font-medium"
                                }`}
                            >
                                <span>{option.label}</span>
                                <span
                                    className={`rounded-full px-1.5 py-0.2 text-[10px] tabular-nums font-mono font-semibold ${
                                        isActive
                                            ? "bg-canvas/20 text-canvas"
                                            : "bg-field text-text-muted"
                                    }`}
                                >
                                    {option.count}
                                </span>
                            </button>
                        );
                    })}
                </div>

                {/* Search & View Mode Switcher */}
                <div className="flex items-center gap-2 px-1">
                    <div className="relative w-full sm:w-64">
                        <Search
                            className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-text-muted"
                            strokeWidth={1.75}
                        />
                        <Input
                            type="text"
                            value={search}
                            onChange={(e) => onSearchChange(e.target.value)}
                            placeholder="Search providers & models…"
                            className="h-9 pl-9 pr-8 text-xs rounded-full bg-field border-0 text-ink placeholder:text-text-faint focus-visible:ring-2 focus-visible:ring-ink shadow-none font-mono"
                        />
                        {search && (
                            <button
                                type="button"
                                onClick={() => onSearchChange("")}
                                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-1 text-text-muted hover:text-ink transition-colors cursor-pointer"
                                aria-label="Clear search"
                            >
                                <X className="size-3" />
                            </button>
                        )}
                    </div>

                    {/* View Toggle */}
                    <div className="flex items-center rounded-full bg-field p-0.5 border border-hairline-soft">
                        <button
                            type="button"
                            onClick={() => onViewModeChange("grid")}
                            className={`flex size-8 items-center justify-center rounded-full transition-colors cursor-pointer ${
                                viewMode === "grid"
                                    ? "bg-ink text-canvas font-semibold shadow-none"
                                    : "text-text-muted hover:text-ink"
                            }`}
                            title="Grid view"
                            aria-label="Grid view"
                        >
                            <LayoutGrid className="size-3.5" />
                        </button>
                        <button
                            type="button"
                            onClick={() => onViewModeChange("list")}
                            className={`flex size-8 items-center justify-center rounded-full transition-colors cursor-pointer ${
                                viewMode === "list"
                                    ? "bg-ink text-canvas font-semibold shadow-none"
                                    : "text-text-muted hover:text-ink"
                            }`}
                            title="List view"
                            aria-label="List view"
                        >
                            <List className="size-3.5" />
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
