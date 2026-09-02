import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { RefreshCw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCatalog } from "@/hooks/useCatalog";
import { Catalog } from "@/components/providers/providers.catalog";
import { CatalogToolbar } from "@/components/providers/providers.catalog-toolbar";
import { CustomProviderDialog } from "@/components/providers/providers.custom-provider-dialog";
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
                <div className="mx-auto flex w-full max-w-7xl flex-col font-mono">
                    <div className="flex min-h-64 flex-col items-center justify-center rounded-xl border border-destructive/30 bg-destructive/5 px-6 py-14 text-center">
                        <div className="flex size-10 items-center justify-center rounded-full bg-destructive/10 text-destructive mb-3.5">
                            <TriangleAlert className="size-5" strokeWidth={1.75} />
                        </div>
                        <h2 className="text-sm font-bold text-foreground">
                            Unable to load provider catalog
                        </h2>
                        <p className="mt-1 max-w-md text-xs text-muted-foreground leading-relaxed">
                            {error instanceof Error
                                ? error.message
                                : "The gateway returned an unexpected network response."}
                        </p>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="mt-4 h-8 text-xs cursor-pointer gap-1.5"
                            onClick={() => void refetch()}
                        >
                            <RefreshCw className="size-3" />
                            <span>Retry Connection</span>
                        </Button>
                    </div>
                </div>
            );
        }
        return <ProvidersSkeleton />;
    }

    return (
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
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
