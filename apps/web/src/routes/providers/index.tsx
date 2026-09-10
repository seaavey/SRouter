import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { RefreshCw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCatalog } from "@/hooks/useCatalog";
import { Catalog, CatalogToolbar, CustomProviderDialog } from "@/components/providers";
import { ProvidersSkeleton } from "@/components/skeletons";

export const Route = createFileRoute("/providers/")({
    staticData: { title: "Providers" },
    component: ProvidersPage
});

function ProvidersPage() {
    const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
    const [isCustomOpen, setIsCustomOpen] = useState(false);
    const catalog = useCatalog();
    const { data, error, isPending, isFetching, refetch } = catalog;

    if (isPending || !data) {
        if (!data && error) {
            return (
                <div className="mx-auto flex w-full max-w-7xl flex-col font-sans">
                    <div className="flex min-h-64 flex-col items-center justify-center rounded-3xl border border-destructive/30 bg-destructive/5 px-6 py-14 text-center">
                        <div className="flex size-11 items-center justify-center rounded-full bg-destructive/10 text-destructive mb-3.5">
                            <TriangleAlert className="size-5" strokeWidth={1.75} />
                        </div>
                        <h2 className="text-base font-bold text-ink">
                            Unable to load provider catalog
                        </h2>
                        <p className="mt-1.5 max-w-md text-xs text-text-muted leading-relaxed font-mono">
                            {error instanceof Error
                                ? error.message
                                : "The gateway returned an unexpected network response."}
                        </p>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="mt-5 rounded-full px-5 h-9 text-xs font-semibold cursor-pointer gap-1.5 shadow-none"
                            onClick={() => void refetch()}
                        >
                            <RefreshCw className="size-3.5" />
                            <span>Retry Connection</span>
                        </Button>
                    </div>
                </div>
            );
        }
        return <ProvidersSkeleton />;
    }

    return (
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 font-sans">
            <CatalogToolbar
                isFetching={isFetching}
                onRefresh={() => void refetch()}
                summaryItems={catalog.summaryItems}
                filterOptions={catalog.filterOptions}
                filter={catalog.filter}
                onFilterChange={catalog.setFilter}
                search={catalog.search}
                onSearchChange={catalog.setSearch}
                viewMode={viewMode}
                onViewModeChange={setViewMode}
                onAddCustom={() => setIsCustomOpen(true)}
            />

            <Catalog groups={catalog.groups} search={catalog.search} viewMode={viewMode} />

            <CustomProviderDialog open={isCustomOpen} onOpenChange={setIsCustomOpen} />
        </div>
    );
}
