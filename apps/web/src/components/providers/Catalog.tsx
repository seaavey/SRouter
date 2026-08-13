import { Search } from "lucide-react";
import type { ProviderDefinition } from "@srouter/types";
import { ProviderRow } from "./ProviderRow";
import { categoryDescriptions, categoryLabels } from "./catalog-utils";

interface CatalogGroup {
    category: string;
    providers: ProviderDefinition[];
}

interface CatalogProps {
    groups: CatalogGroup[];
    search: string;
}

export function Catalog({ groups, search }: CatalogProps) {
    const normalizedSearch = search.trim();

    if (groups.length === 0) {
        return (
            <div className="flex min-h-56 flex-col items-center justify-center border-y border-border/70 px-6 text-center">
                <Search className="mb-3 size-5 text-muted-foreground" strokeWidth={1.5} />
                <p className="text-sm font-medium text-foreground">No matching providers</p>
                <p className="mt-1 max-w-sm text-muted-foreground text-xs">
                    {normalizedSearch
                        ? `Nothing matches “${normalizedSearch}” in this view. Try a different term or clear the filter.`
                        : "This category has no drivers registered yet."}
                </p>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-6">
            {groups.map((group) => (
                <section key={group.category} aria-labelledby={`category-${group.category}`}>
                    <header className="flex items-baseline justify-between gap-4 border-b border-border/70 pb-2">
                        <div className="min-w-0">
                            <h2
                                id={`category-${group.category}`}
                                className="text-xs font-semibold text-foreground"
                            >
                                {categoryLabels[group.category as keyof typeof categoryLabels] ??
                                    group.category}
                            </h2>
                            <p className="mt-0.5 text-[11px] text-muted-foreground">
                                {categoryDescriptions[
                                    group.category as keyof typeof categoryDescriptions
                                ] ?? ""}
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
    );
}
