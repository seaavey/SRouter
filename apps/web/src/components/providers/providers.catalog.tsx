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
            <div className="flex min-h-64 flex-col items-center justify-center rounded-3xl border border-dashed border-hairline bg-canvas px-6 py-14 text-center">
                <div className="flex size-12 items-center justify-center rounded-full bg-canvas-soft text-text-muted mb-3.5">
                    <Search className="size-5" strokeWidth={1.75} />
                </div>
                <h3 className="text-sm font-semibold text-ink font-sans">No Matching Providers</h3>
                <p className="mt-1 max-w-sm text-xs text-text-muted leading-relaxed font-sans">
                    {normalizedSearch
                        ? `Nothing matches “${normalizedSearch}”. Try a different search query or category filter.`
                        : "No drivers registered in this category yet."}
                </p>
            </div>
        );
    }

    if (viewMode === "grid") {
        return (
            <div className="space-y-9">
                {groups.map((group) => (
                    <section
                        key={group.category}
                        aria-labelledby={`cat-title-${group.category}`}
                        className="space-y-4"
                    >
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <h2
                                    id={`cat-title-${group.category}`}
                                    className="text-xs font-bold text-ink uppercase tracking-wider font-mono"
                                >
                                    {CATEGORY_LABELS[
                                        group.category as keyof typeof CATEGORY_LABELS
                                    ] ?? group.category}
                                </h2>
                                <span className="font-mono text-xs text-text-muted">
                                    ({group.providers.length})
                                </span>
                            </div>
                            <p className="text-xs text-text-muted hidden sm:block font-sans">
                                {CATEGORY_DESCRIPTIONS[
                                    group.category as keyof typeof CATEGORY_DESCRIPTIONS
                                ] ?? ""}
                            </p>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                            {group.providers.map((provider) => (
                                <ProviderCard key={provider.id} provider={provider} />
                            ))}
                        </div>
                    </section>
                ))}
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {groups.map((group) => (
                <section
                    key={group.category}
                    aria-labelledby={`category-list-${group.category}`}
                    className="rounded-3xl border border-hairline-soft bg-canvas overflow-hidden shadow-none"
                >
                    <header className="flex items-center justify-between gap-4 border-b border-hairline-soft bg-canvas-soft px-5 py-3.5">
                        <div className="flex items-center gap-2">
                            <h2
                                id={`category-list-${group.category}`}
                                className="text-xs font-bold text-ink font-mono uppercase tracking-wider"
                            >
                                {CATEGORY_LABELS[group.category as keyof typeof CATEGORY_LABELS] ??
                                    group.category}
                            </h2>
                            <span className="font-mono text-xs text-text-muted">
                                · {group.providers.length}{" "}
                                {group.providers.length === 1 ? "driver" : "drivers"}
                            </span>
                        </div>
                        <p className="text-xs text-text-muted hidden md:block font-sans">
                            {CATEGORY_DESCRIPTIONS[
                                group.category as keyof typeof CATEGORY_DESCRIPTIONS
                            ] ?? ""}
                        </p>
                    </header>
                    <div className="p-2 divide-y divide-hairline-soft">
                        {group.providers.map((provider) => (
                            <ProviderRow key={provider.id} provider={provider} />
                        ))}
                    </div>
                </section>
            ))}
        </div>
    );
}
