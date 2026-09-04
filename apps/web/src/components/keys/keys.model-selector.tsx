import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Search, X } from "lucide-react";
import type { ModelListResponse } from "@srouter/types";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ModelSelectorProps, ModelScope } from "./keys.form-types";

const SCOPE_OPTIONS: { value: ModelScope; title: string; desc: string }[] = [
    {
        value: "all",
        title: "All models",
        desc: "Unrestricted access"
    },
    {
        value: "restricted",
        title: "Specific models",
        desc: "Restrict to a subset"
    }
];

export function ModelSelector({
    scope,
    onScopeChange,
    selected_models,
    onToggleModel,
    isOpen
}: ModelSelectorProps) {
    const [model_search, setModelSearch] = useState("");

    const { data: model_data, isPending } = useQuery({
        queryKey: ["models"],
        queryFn: () => api.get<ModelListResponse>("/v1/models"),
        enabled: isOpen && scope === "restricted"
    });

    const models = useMemo(() => model_data?.data ?? [], [model_data]);
    const filteredModels = useMemo(() => {
        const query = model_search.trim().toLowerCase();
        return query ? models.filter((m) => m.id.toLowerCase().includes(query)) : models;
    }, [models, model_search]);

    const scopeButtonClass = (active: boolean) =>
        cn(
            "rounded-md border px-3 py-2 text-left text-xs transition-colors cursor-pointer",
            active
                ? "border-primary bg-primary/10 text-foreground font-semibold"
                : "border-input bg-background text-muted-foreground hover:text-foreground"
        );

    return (
        <div className="space-y-2 pt-1">
            <Label className="block text-xs font-medium text-foreground">Allowed models</Label>
            <div className="grid grid-cols-2 gap-2">
                {SCOPE_OPTIONS.map(({ value, title, desc }) => (
                    <button
                        key={value}
                        type="button"
                        onClick={() => onScopeChange(value)}
                        className={scopeButtonClass(scope === value)}
                    >
                        {title}
                        <span className="block text-[10px] font-normal opacity-70">{desc}</span>
                    </button>
                ))}
            </div>

            {scope === "restricted" ? (
                <div className="space-y-2 rounded-md border border-border/70 bg-background/50 p-2.5">
                    <div className="relative">
                        <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
                        <Input
                            type="text"
                            value={model_search}
                            onChange={(e) => setModelSearch(e.target.value)}
                            placeholder="Search models…"
                            className="h-8 pl-8 pr-7 font-mono text-xs rounded-md bg-background"
                        />
                        {model_search ? (
                            <button
                                type="button"
                                onClick={() => setModelSearch("")}
                                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-xs p-0.5 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                                aria-label="Clear search"
                            >
                                <X className="size-3" />
                            </button>
                        ) : null}
                    </div>

                    <div className="max-h-40 overflow-y-auto rounded-md">
                        {isPending ? (
                            <p className="py-3 text-center text-[11px] text-muted-foreground">
                                Loading models…
                            </p>
                        ) : filteredModels.length === 0 ? (
                            <p className="py-3 text-center text-[11px] text-muted-foreground">
                                No models matched your search.
                            </p>
                        ) : (
                            <ul className="space-y-0.5">
                                {filteredModels.map((model) => {
                                    const isSelected = selected_models.includes(model.id);
                                    return (
                                        <li key={model.id}>
                                            <button
                                                type="button"
                                                onClick={() => onToggleModel(model.id)}
                                                className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left font-mono text-[11px] transition-colors cursor-pointer ${
                                                    isSelected
                                                        ? "bg-primary/10 text-foreground font-medium"
                                                        : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
                                                }`}
                                            >
                                                <span className="truncate">{model.id}</span>
                                                {isSelected ? (
                                                    <Check className="size-3.5 shrink-0 text-primary" />
                                                ) : null}
                                            </button>
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </div>

                    <p className="text-[11px] text-muted-foreground font-sans">
                        {selected_models.length > 0
                            ? `${selected_models.length} model${selected_models.length === 1 ? "" : "s"} selected`
                            : "Select at least one model, or the key stays unrestricted."}
                    </p>
                </div>
            ) : null}
        </div>
    );
}
