import { CATEGORY_DESCRIPTIONS, CATEGORY_LABELS } from "@srouter/constants";
import { Search } from "lucide-react";
import type { ProviderDefinition } from "@srouter/types";
import { ProviderRow } from "./providers.row";
import { ProviderCard } from "./providers.card";

interface CatalogGroup {
    category: string;
    providers: ProviderDefinition[];
}

interface CatalogProps {
    groups: CatalogGroup[];
    search: string;
    viewMode?: "grid" | "list";
}

export function Catalog({ groups, search, viewMode = "grid" }: CatalogProps) {
    const normalizedSearch = search.trim();
    const allProviders = groups.flatMap((g) => g.providers);

    if (allProviders.length === 0) {
        return (
            <div className="flex min-h-60 flex-col items-center justify-center rounded-xl border border-dashed border-border/80 bg-card/50 px-6 py-14 text-center">
                <div className="flex size-10 items-center justify-center rounded-full bg-secondary text-muted-foreground mb-3">
                    <Search className="size-4.5" strokeWidth={1.75} />
                </div>
                <h3 className="text-sm font-semibold text-foreground">No Matching Providers</h3>
                <p className="mt-1 max-w-sm text-xs text-muted-foreground leading-relaxed">
                    {normalizedSearch
                        ? `Nothing matches “${normalizedSearch}”. Try a different search query or category filter.`
                        : "No drivers registered in this category yet."}
                </p>
            </div>
        );
    }

    if (viewMode === "grid") {
        return (
            <div className="space-y-8">
                {groups.map((group) => (
                    <section
                        key={group.category}
                        aria-labelledby={`cat-title-${group.category}`}
                        className="space-y-3.5"
                    >
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <h2
                                    id={`cat-title-${group.category}`}
                                    className="text-xs font-bold text-foreground uppercase tracking-wider font-mono"
                                >
                                    {CATEGORY_LABELS[
                                        group.category as keyof typeof CATEGORY_LABELS
                                    ] ?? group.category}
                                </h2>
                                <span className="font-mono text-[10.5px] text-muted-foreground">
                                    ({group.providers.length})
                                </span>
                            </div>
                            <p className="text-[11px] text-muted-foreground hidden sm:block font-mono">
                                {CATEGORY_DESCRIPTIONS[
                                    group.category as keyof typeof CATEGORY_DESCRIPTIONS
                                ] ?? ""}
                            </p>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
                            {group.providers.map((provider) => (
                                <ProviderCard key={provider.id} provider={provider} />
                            ))}
                        </div>
                    </section>
                ))}
            </div>
        );
    }

    // List view
    return (
        <div className="space-y-6">
            {groups.map((group) => (
                <section
                    key={group.category}
                    aria-labelledby={`category-list-${group.category}`}
                    className="rounded-xl border border-border/70 bg-card overflow-hidden shadow-xs"
                >
                    {/* Category Header */}
                    <header className="flex items-center justify-between gap-4 border-b border-border/60 bg-secondary/30 px-4 py-2.5">
                        <div className="flex items-center gap-2">
                            <h2
                                id={`category-list-${group.category}`}
                                className="text-xs font-bold text-foreground font-mono"
                            >
                                {CATEGORY_LABELS[group.category as keyof typeof CATEGORY_LABELS] ??
                                    group.category}
                            </h2>
                            <span className="font-mono text-[10.5px] text-muted-foreground">
                                · {group.providers.length}{" "}
                                {group.providers.length === 1 ? "driver" : "drivers"}
                            </span>
                        </div>
                        <p className="text-[11px] text-muted-foreground hidden md:block font-mono">
                            {CATEGORY_DESCRIPTIONS[
                                group.category as keyof typeof CATEGORY_DESCRIPTIONS
                            ] ?? ""}
                        </p>
                    </header>

                    {/* Provider Rows */}
                    <div className="p-1.5 divide-y divide-border/40">
                        {group.providers.map((provider) => (
                            <ProviderRow key={provider.id} provider={provider} />
                        ))}
                    </div>
                </section>
            ))}
        </div>
    );
}
