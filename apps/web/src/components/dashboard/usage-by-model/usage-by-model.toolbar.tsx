import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";

type UsageByModelToolbarProps = {
    search_model: string;
    on_search_model_change: (value: string) => void;
};

export function UsageByModelToolbar({
    search_model,
    on_search_model_change
}: UsageByModelToolbarProps) {
    return (
        <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-text-muted" />
            <Input
                type="text"
                placeholder="Search models…"
                value={search_model}
                onChange={(event) => on_search_model_change(event.target.value)}
                className="h-9 pl-9 pr-8 font-mono text-xs bg-field border-0 rounded-full text-ink placeholder:text-text-faint focus-visible:ring-2 focus-visible:ring-ink focus-visible:outline-none shadow-none"
            />
            {search_model && (
                <button
                    type="button"
                    onClick={() => on_search_model_change("")}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-1 text-text-muted hover:text-ink transition-colors cursor-pointer"
                    aria-label="Clear search"
                >
                    <X className="size-3" />
                </button>
            )}
        </div>
    );
}
