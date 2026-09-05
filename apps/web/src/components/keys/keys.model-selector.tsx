import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Cpu, Search, SlidersHorizontal, X } from "lucide-react";
import type { ModelListResponse } from "@srouter/types";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from "@/components/ui/dialog";
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
    const [is_picker_open, setIsPickerOpen] = useState(false);

    const { data: model_data, isPending } = useQuery({
        queryKey: ["models"],
        queryFn: () => api.get<ModelListResponse>("/v1/models"),
        enabled: isOpen && (scope === "restricted" || is_picker_open)
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

    const handleSelectScope = (value: ModelScope) => {
        onScopeChange(value);
        if (value === "restricted") {
            setIsPickerOpen(true);
        }
    };

    return (
        <div className="space-y-2 pt-1">
            <div className="flex items-center justify-between">
                <Label className="block text-xs font-medium text-foreground">Allowed models</Label>
                {scope === "restricted" ? (
                    <button
                        type="button"
                        onClick={() => setIsPickerOpen(true)}
                        className="inline-flex items-center gap-1.5 text-[11px] font-mono text-foreground hover:underline cursor-pointer"
                    >
                        <SlidersHorizontal className="size-3" />
                        <span>Manage ({selected_models.length})</span>
                    </button>
                ) : null}
            </div>

            <div className="grid grid-cols-2 gap-2">
                {SCOPE_OPTIONS.map(({ value, title, desc }) => (
                    <button
                        key={value}
                        type="button"
                        onClick={() => handleSelectScope(value)}
                        className={scopeButtonClass(scope === value)}
                    >
                        <div className="flex items-center justify-between">
                            <span>{title}</span>
                            {value === "restricted" && selected_models.length > 0 ? (
                                <span className="text-[10px] font-mono font-normal opacity-80 bg-primary/15 px-1.5 py-0.2 rounded">
                                    {selected_models.length}
                                </span>
                            ) : null}
                        </div>
                        <span className="block text-[10px] font-normal opacity-70">{desc}</span>
                    </button>
                ))}
            </div>

            {scope === "restricted" ? (
                <div className="flex items-center justify-between gap-2 rounded-md border border-border/70 bg-background/50 p-2.5 text-xs">
                    <div className="min-w-0">
                        <div className="font-mono text-xs text-foreground font-medium truncate">
                            {selected_models.length > 0
                                ? `${selected_models.length} model${selected_models.length === 1 ? "" : "s"} whitelisted`
                                : "No models selected (unrestricted)"}
                        </div>
                        <div className="text-[10px] text-muted-foreground font-mono">
                            {selected_models.length > 0
                                ? "Downstream calls limited to this pool"
                                : "Click choose models to restrict access"}
                        </div>
                    </div>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setIsPickerOpen(true)}
                        className="h-7.5 px-3 text-[11px] font-mono shrink-0 cursor-pointer shadow-2xs"
                    >
                        Choose Models
                    </Button>
                </div>
            ) : null}

            <Dialog open={is_picker_open} onOpenChange={setIsPickerOpen}>
                <DialogContent className="sm:max-w-md bg-card border-border p-4 sm:p-6 max-h-[calc(100dvh-2.5rem)] flex flex-col">
                    <DialogHeader className="space-y-1 text-left shrink-0">
                        <div className="flex items-center gap-2">
                            <div className="flex size-7 items-center justify-center rounded-md bg-secondary text-foreground">
                                <Cpu className="size-3.5" />
                            </div>
                            <DialogTitle className="text-base font-semibold text-foreground">
                                Select Allowed Models
                            </DialogTitle>
                        </div>
                        <DialogDescription className="text-xs text-muted-foreground leading-relaxed">
                            Restrict this API key to specific models. If none selected, the key will allow all models.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-3 pt-2 flex-1 min-h-0 flex flex-col">
                        <div className="relative shrink-0">
                            <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
                            <Input
                                type="text"
                                value={model_search}
                                onChange={(e) => setModelSearch(e.target.value)}
                                placeholder="Search models…"
                                className="h-8.5 pl-8 pr-7 font-mono text-xs rounded-md bg-background"
                                autoFocus
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

                        <div className="flex-1 overflow-y-auto min-h-0 rounded-md border border-border/70 divide-y divide-border/40">
                            {isPending ? (
                                <p className="py-8 text-center font-mono text-xs text-muted-foreground">
                                    Loading models…
                                </p>
                            ) : filteredModels.length === 0 ? (
                                <p className="py-8 text-center font-mono text-xs text-muted-foreground">
                                    No models matched your search.
                                </p>
                            ) : (
                                <ul className="divide-y divide-border/40">
                                    {filteredModels.map((model) => {
                                        const isSelected = selected_models.includes(model.id);
                                        return (
                                            <li key={model.id}>
                                                <button
                                                    type="button"
                                                    onClick={() => onToggleModel(model.id)}
                                                    className={cn(
                                                        "flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left font-mono text-xs transition-colors cursor-pointer",
                                                        isSelected
                                                            ? "bg-primary/10 text-foreground font-medium"
                                                            : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
                                                    )}
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

                        <div className="flex items-center justify-between text-[11px] text-muted-foreground font-mono shrink-0">
                            <span>{selected_models.length} model(s) selected</span>
                            {model_search ? (
                                <span>{filteredModels.length} shown</span>
                            ) : (
                                <span>{models.length} total</span>
                            )}
                        </div>
                    </div>

                    <DialogFooter className="pt-3 border-t border-border/60 shrink-0 mt-2">
                        <Button
                            type="button"
                            onClick={() => setIsPickerOpen(false)}
                            className="h-8.5 text-xs font-semibold cursor-pointer w-full sm:w-auto"
                        >
                            Done
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
