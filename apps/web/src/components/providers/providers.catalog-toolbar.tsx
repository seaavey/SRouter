import {
    Boxes,
    CheckCircle2,
    Cpu,
    Gauge,
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
        <div className="space-y-6 font-mono">
            {/* Editorial Header */}
            <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end border-b border-border/80 pb-5">
                <div className="min-w-0">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/80">
                        Telemetry & Routing Catalog
                    </p>
                    <h1 className="mt-1.5 text-2xl font-bold tracking-tight text-foreground">
                        Provider Registry
                    </h1>
                    <p className="mt-1 max-w-2xl text-xs text-muted-foreground leading-relaxed">
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
                            className="h-8 text-xs font-medium cursor-pointer gap-1.5 shadow-2xs"
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
                        className="h-8 text-xs font-medium cursor-pointer gap-1.5 border-border/80 bg-card hover:bg-secondary/60 transition-colors shadow-2xs"
                    >
                        <RefreshCw
                            className={`size-3.5 text-muted-foreground ${isFetching ? "animate-spin" : ""}`}
                        />
                        <span>{isFetching ? "Syncing…" : "Refresh"}</span>
                    </Button>
                </div>
            </header>

            {/* Tactical Summary KPI Strip (if summary items available) */}
            {summaryItems && summaryItems.length > 0 && (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    {summaryItems.map((item) => {
                        const Icon = summaryIcons[item.label as keyof typeof summaryIcons] ?? Boxes;
                        const isOnline = item.label === "Connected" && parseInt(item.value, 10) > 0;
                        return (
                            <div
                                key={item.label}
                                className="relative flex flex-col justify-between rounded-xl border border-border/80 bg-card/60 p-3.5 shadow-2xs hover:border-foreground/20 transition-colors"
                            >
                                <div className="flex items-center justify-between text-muted-foreground">
                                    <span className="text-[10px] font-semibold uppercase tracking-[0.14em]">
                                        {item.label}
                                    </span>
                                    <Icon className="size-3.5 text-muted-foreground/70" />
                                </div>
                                <div className="mt-2.5 flex items-baseline gap-2">
                                    <span className="text-2xl font-bold tracking-tight text-foreground">
                                        {item.value}
                                    </span>
                                    {isOnline && (
                                        <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
                                    )}
                                </div>
                                <p className="mt-1 text-[10.5px] text-muted-foreground truncate">
                                    {item.detail}
                                </p>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Controls Bar: Filter Tabs, Search & View Toggle */}
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between border-y border-border/70 py-3 bg-secondary/15 px-3 rounded-lg">
                {/* Category Filter Tabs */}
                <div
                    role="tablist"
                    aria-label="Filter providers by category"
                    className="flex flex-wrap items-center gap-1.5"
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
                                className={`rounded-md px-2.5 py-1 text-[11px] font-mono transition-all cursor-pointer flex items-center gap-1.5 ${
                                    isActive
                                        ? "bg-foreground text-background font-bold shadow-xs"
                                        : "text-muted-foreground hover:text-foreground hover:bg-secondary/70"
                                }`}
                            >
                                <span>{option.label}</span>
                                <span
                                    className={`rounded px-1 py-0.2 text-[9px] tabular-nums font-semibold ${
                                        isActive
                                            ? "bg-background/20 text-background"
                                            : "bg-secondary text-muted-foreground"
                                    }`}
                                >
                                    {option.count}
                                </span>
                            </button>
                        );
                    })}
                </div>

                {/* Search & View Mode Switcher */}
                <div className="flex items-center gap-2.5">
                    <div className="relative w-full sm:w-64">
                        <Search
                            className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
                            strokeWidth={1.75}
                        />
                        <Input
                            type="text"
                            value={search}
                            onChange={(e) => onSearchChange(e.target.value)}
                            placeholder="Filter drivers & protocols…"
                            className="h-8 pl-8 pr-7 font-mono text-xs rounded-md bg-card border-border/80"
                        />
                        {search && (
                            <button
                                type="button"
                                onClick={() => onSearchChange("")}
                                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-xs p-0.5 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                                aria-label="Clear search"
                            >
                                <X className="size-3" />
                            </button>
                        )}
                    </div>

                    {/* View Toggle */}
                    <div className="flex items-center rounded-md border border-border/80 bg-card p-0.5 shadow-2xs">
                        <button
                            type="button"
                            onClick={() => onViewModeChange("grid")}
                            className={`flex size-7 items-center justify-center rounded-xs transition-colors cursor-pointer ${
                                viewMode === "grid"
                                    ? "bg-foreground text-background font-semibold shadow-xs"
                                    : "text-muted-foreground hover:text-foreground"
                            }`}
                            title="Grid view"
                            aria-label="Grid view"
                        >
                            <LayoutGrid className="size-3.5" />
                        </button>
                        <button
                            type="button"
                            onClick={() => onViewModeChange("list")}
                            className={`flex size-7 items-center justify-center rounded-xs transition-colors cursor-pointer ${
                                viewMode === "list"
                                    ? "bg-foreground text-background font-semibold shadow-xs"
                                    : "text-muted-foreground hover:text-foreground"
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
