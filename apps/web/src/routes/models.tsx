import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { LayoutGrid, Search, Table as TableIcon } from "lucide-react";
import { api } from "@/lib/api";
import type { ModelListResponse, ModelObject } from "@srouter/types";
import { Skeleton } from "@/components/ui/skeleton";
import { useModels } from "@/hooks/useModels";
import { ModelCard } from "@/components/models/model-card";
import { ModelTable } from "@/components/models/model-table";

export const Route = createFileRoute("/models")({
    staticData: { title: "Models" },
    component: ModelsPage,
});

function ModelsPage() {
    const [viewMode, setViewMode] = useState<"grid" | "table">("grid");

    const { data, isLoading, error } = useQuery({
        queryKey: ["models"],
        queryFn: () => api.get<ModelListResponse>("/v1/models"),
    });

    const models: ModelObject[] = data?.data ?? [];
    const filter = useModels(models);

    if (isLoading) {
        return (
            <div className="space-y-6 max-w-7xl mx-auto p-4 md:p-6">
                <Skeleton className="h-8 w-48" />
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <Skeleton className="h-28 rounded-md" />
                    <Skeleton className="h-28 rounded-md" />
                    <Skeleton className="h-28 rounded-md" />
                </div>
            </div>
        );
    }

    if (error || !data) {
        return (
            <div className="max-w-7xl mx-auto p-4 md:p-6">
                <div className="rounded border border-destructive/40 bg-destructive/10 p-4 text-xs font-mono text-destructive">
                    Gagal memuat daftar model:{" "}
                    {error instanceof Error ? error.message : "Unknown error"}
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-6 max-w-7xl mx-auto p-4 md:p-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border/60 pb-4">
                <div>
                    <h1 className="text-xl font-bold tracking-tight text-foreground">
                        Models Registry
                    </h1>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                        Total{" "}
                        <span className="font-mono font-semibold text-foreground">
                            {models.length}
                        </span>{" "}
                        model LLM siap pakai dari semua provider terhubung.
                    </p>
                </div>

                <div className="flex items-center gap-1.5 border border-border/60 bg-secondary/30 rounded p-1">
                    <button
                        type="button"
                        onClick={() => setViewMode("grid")}
                        aria-label="Grid view"
                        className={`flex size-7 items-center justify-center rounded transition-all ${
                            viewMode === "grid"
                                ? "bg-foreground text-background font-semibold"
                                : "text-muted-foreground hover:text-foreground"
                        }`}
                    >
                        <LayoutGrid className="size-3.5" />
                    </button>
                    <button
                        type="button"
                        onClick={() => setViewMode("table")}
                        aria-label="Table view"
                        className={`flex size-7 items-center justify-center rounded transition-all ${
                            viewMode === "table"
                                ? "bg-foreground text-background font-semibold"
                                : "text-muted-foreground hover:text-foreground"
                        }`}
                    >
                        <TableIcon className="size-3.5" />
                    </button>
                </div>
            </div>

            {/* Search & Provider Filter Toolbar */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 border-b border-border/60 pb-3">
                <div className="flex items-center gap-1 overflow-x-auto pb-1 sm:pb-0">
                    <button
                        type="button"
                        onClick={() => filter.setSelectedProviderFilter("all")}
                        className={`px-3 py-1.5 rounded text-xs font-medium transition-all shrink-0 ${
                            filter.selectedProviderFilter === "all"
                                ? "bg-foreground text-background font-semibold"
                                : "bg-secondary/60 text-muted-foreground hover:text-foreground"
                        }`}
                    >
                        All ({models.length})
                    </button>
                    {filter.providersList.map((p) => (
                        <button
                            key={p}
                            type="button"
                            onClick={() => filter.setSelectedProviderFilter(p)}
                            className={`px-3 py-1.5 rounded text-xs font-medium font-mono uppercase transition-all shrink-0 ${
                                filter.selectedProviderFilter === p
                                    ? "bg-foreground text-background font-semibold"
                                    : "bg-secondary/60 text-muted-foreground hover:text-foreground"
                            }`}
                        >
                            {p} ({filter.providerCounts.get(p) ?? 0})
                        </button>
                    ))}
                </div>

                <div className="relative w-full sm:w-64">
                    <Search className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
                    <input
                        type="text"
                        placeholder="Search model ID…"
                        value={filter.searchQuery}
                        onChange={(e) => filter.setSearchQuery(e.target.value)}
                        className="w-full rounded border border-border/60 bg-secondary/30 pl-8 pr-3 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring font-mono"
                    />
                </div>
            </div>

            {/* Grid vs Table View Rendering */}
            {filter.filteredModels.length === 0 ? (
                <div className="rounded border border-dashed border-border/60 p-12 text-center text-xs font-mono text-muted-foreground">
                    Tidak ada model yang cocok dengan kriteria pencarian.
                </div>
            ) : viewMode === "grid" ? (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {filter.filteredModels.map((model) => (
                        <ModelCard key={model.id} model={model} />
                    ))}
                </div>
            ) : (
                <ModelTable models={filter.filteredModels} />
            )}
        </div>
    );
}
