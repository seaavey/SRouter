import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Search, X } from "lucide-react";
import type { ModelListResponse } from "@srouter/types";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

interface KeyModelPickerProps {
    selectedModels: string[];
    onToggleModel: (modelId: string) => void;
    onClear: () => void;
    onClose: () => void;
}

export default function KeyModelPicker({
    selectedModels,
    onToggleModel,
    onClear,
    onClose
}: KeyModelPickerProps) {
    const [modelSearch, setModelSearch] = useState("");
    const { data, isError, isPending } = useQuery({
        queryKey: ["models"],
        queryFn: () => api.get<ModelListResponse>("/v1/models")
    });
    const models = data?.data ?? [];
    const query = modelSearch.trim().toLowerCase();
    const filteredModels = query
        ? models.filter((model) => model.id.toLowerCase().includes(query))
        : models;

    return (
        <div className="flex max-h-[calc(100dvh-2.5rem)] w-full shrink-0 flex-col overflow-hidden rounded-3xl border border-hairline-soft bg-canvas p-0 font-sans shadow-none md:h-auto md:w-96 lg:w-[420px]">
            <div className="flex shrink-0 items-center justify-between border-b border-hairline-soft bg-canvas px-4 py-3.5">
                <div className="flex min-w-0 items-center gap-2">
                    <h3 className="truncate text-xs font-semibold text-ink font-sans">
                        Allowed Models
                    </h3>
                    <span className="rounded-full bg-field px-2 py-0.5 font-mono text-[10px] text-text-muted">
                        {selectedModels.length} selected
                    </span>
                </div>
                <button
                    type="button"
                    onClick={onClose}
                    className="cursor-pointer rounded-full p-1 text-text-muted transition-colors hover:bg-canvas-soft hover:text-ink"
                    title="Close model picker"
                    aria-label="Close model picker"
                >
                    <X className="size-3.5" aria-hidden="true" />
                </button>
            </div>

            <div className="shrink-0 border-b border-hairline-soft bg-canvas p-3">
                <div className="relative">
                    <Search
                        className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-text-muted"
                        aria-hidden="true"
                    />
                    <Input
                        type="text"
                        value={modelSearch}
                        onChange={(event) => setModelSearch(event.target.value)}
                        placeholder="Filter models…"
                        className="h-9 rounded-full border-0 bg-field pl-9 pr-8 font-mono text-xs text-ink shadow-none placeholder:text-text-faint focus-visible:ring-2 focus-visible:ring-ink"
                    />
                    {modelSearch ? (
                        <button
                            type="button"
                            onClick={() => setModelSearch("")}
                            className="absolute right-3 top-1/2 -translate-y-1/2 cursor-pointer rounded-full p-0.5 text-text-muted transition-colors hover:text-ink"
                            aria-label="Clear model search"
                        >
                            <X className="size-3" aria-hidden="true" />
                        </button>
                    ) : null}
                </div>
            </div>

            <div className="flex min-h-[220px] max-h-[360px] flex-1 flex-col gap-0.5 overflow-y-auto p-2 md:max-h-[420px]">
                {isPending ? (
                    <p className="py-8 text-center font-mono text-xs text-text-muted">
                        Loading available models…
                    </p>
                ) : isError ? (
                    <p className="py-8 text-center font-mono text-xs text-destructive">
                        Unable to load available models.
                    </p>
                ) : filteredModels.length === 0 ? (
                    <p className="py-8 text-center font-mono text-xs text-text-muted">
                        No models match "{modelSearch.trim()}".
                    </p>
                ) : (
                    <ul className="flex flex-col gap-0.5">
                        {filteredModels.map((model) => {
                            const isSelected = selectedModels.includes(model.id);
                            return (
                                <li key={model.id}>
                                    <button
                                        type="button"
                                        onClick={() => onToggleModel(model.id)}
                                        aria-pressed={isSelected}
                                        className={cn(
                                            "flex w-full cursor-pointer items-center justify-between gap-2 rounded-xl px-3 py-2 text-left font-mono text-xs transition-colors",
                                            isSelected
                                                ? "border border-accent/20 bg-accent/10 font-medium text-ink"
                                                : "text-text-muted hover:bg-canvas-soft hover:text-ink"
                                        )}
                                    >
                                        <span className="min-w-0 flex-1 truncate" title={model.id}>
                                            {model.id}
                                        </span>
                                        {isSelected ? (
                                            <Check
                                                className="size-3.5 shrink-0 text-accent"
                                                aria-hidden="true"
                                            />
                                        ) : null}
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>

            <div className="flex shrink-0 items-center justify-between border-t border-hairline-soft bg-canvas-soft/40 px-4 py-3 font-mono text-xs text-text-muted">
                <span>{selectedModels.length} active</span>
                <button
                    type="button"
                    onClick={onClear}
                    className="cursor-pointer text-xs text-text-muted transition-colors hover:text-destructive"
                >
                    Clear all
                </button>
            </div>
        </div>
    );
}
