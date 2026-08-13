import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { RefreshCw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCatalog } from "@/hooks/useCatalog";
import { AddProviderSheet } from "@/components/providers/AddProviderSheet";
import { Catalog } from "@/components/providers/Catalog";
import { CatalogSkeleton } from "@/components/providers/CatalogSkeleton";
import { CatalogToolbar } from "@/components/providers/CatalogToolbar";

export const Route = createFileRoute("/providers/")({
    staticData: { title: "Providers" },
    component: ProvidersPage,
});

function ProvidersPage() {
    const [isAddOpen, setIsAddOpen] = useState(false);
    const catalog = useCatalog();
    const { data, error, isPending, isFetching, refetch } = catalog;

    if (isPending && !data) {
        return <CatalogSkeleton />;
    }

    if (!data) {
        return (
            <div className="mx-auto w-full max-w-7xl">
                <div className="flex min-h-64 flex-col items-center justify-center rounded-xl border border-destructive/30 bg-destructive/5 px-6 text-center">
                    <div className="flex size-10 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                        <TriangleAlert className="size-5" strokeWidth={1.75} />
                    </div>
                    <h1 className="mt-4 text-base font-semibold text-foreground">
                        Unable to load the provider catalog
                    </h1>
                    <p className="mt-1 max-w-lg text-xs text-muted-foreground">
                        {error instanceof Error
                            ? error.message
                            : "The gateway returned an unknown error."}
                    </p>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="mt-4"
                        onClick={() => void refetch()}
                    >
                        <RefreshCw />
                        Retry
                    </Button>
                </div>
            </div>
        );
    }

    return (
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
            <CatalogToolbar
                isFetching={isFetching}
                onRefresh={() => void refetch()}
                onAddProvider={() => setIsAddOpen(true)}
                summaryItems={catalog.summaryItems}
                filterOptions={catalog.filterOptions}
                filter={catalog.filter}
                onFilterChange={catalog.setFilter}
                search={catalog.search}
                onSearchChange={catalog.setSearch}
            />

            <Catalog groups={catalog.groups} search={catalog.search} />

            <AddProviderSheet open={isAddOpen} onOpenChange={setIsAddOpen} />
        </div>
    );
}
