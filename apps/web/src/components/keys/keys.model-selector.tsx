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
    isOpen,
    isPickerOpen: externalPickerOpen,
    onPickerOpenChange
}: ModelSelectorProps) {
    const [model_search, setModelSearch] = useState("");
    const [internalPickerOpen, setInternalPickerOpen] = useState(false);

    const is_picker_open =
        externalPickerOpen !== undefined ? externalPickerOpen : internalPickerOpen;
    const setIsPickerOpen = onPickerOpenChange || setInternalPickerOpen;

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
            "rounded-2xl border px-3.5 py-2.5 text-left text-xs transition-colors cursor-pointer shadow-none",
            active
                ? "border-ink bg-canvas text-ink font-semibold"
                : "border-hairline-soft bg-field text-text-muted hover:text-ink hover:bg-canvas-soft"
        );

    const handleSelectScope = (value: ModelScope) => {
        onScopeChange(value);
        if (value === "restricted") {
            setIsPickerOpen(true);
        }
    };

    return (
        <div className="space-y-2 pt-1 font-sans">
            <div className="flex items-center justify-between">
                <Label className="block text-xs font-medium text-ink font-sans">
                    Allowed models
                </Label>
                {scope === "restricted" ? (
                    <button
                        type="button"
                        onClick={() => setIsPickerOpen(true)}
                        className="inline-flex items-center gap-1.5 text-xs font-mono text-ink hover:underline cursor-pointer"
                    >
                        <SlidersHorizontal className="size-3" />
                        <span>Manage ({selected_models.length})</span>
                    </button>
                ) : null}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
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
                                <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-mono font-medium text-accent">
                                    {selected_models.length}
                                </span>
                            ) : null}
                        </div>
                        <span className="block text-[10px] font-normal opacity-70 mt-0.5">
                            {desc}
                        </span>
                    </button>
                ))}
            </div>

            {scope === "restricted" ? (
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-2xl border border-hairline-soft bg-canvas-soft/60 p-3 text-xs">
                    <div className="min-w-0">
                        <div className="font-mono text-xs text-ink font-medium truncate">
                            {selected_models.length > 0
                                ? `${selected_models.length} model${selected_models.length === 1 ? "" : "s"} whitelisted`
                                : "No models selected (unrestricted)"}
                        </div>
                        <div className="text-[10px] text-text-muted font-sans mt-0.5">
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
                        className="h-8 px-4 text-xs font-sans rounded-full shrink-0 cursor-pointer shadow-none w-full sm:w-auto"
                    >
                        Choose Models
                    </Button>
                </div>
            ) : null}

            {/* Standalone fallback dialog only if NOT controlled by split card parent */}
            {externalPickerOpen === undefined && is_picker_open ? (
                <Dialog open={is_picker_open} onOpenChange={setIsPickerOpen}>
                    <DialogContent className="sm:max-w-md bg-canvas border border-hairline-soft rounded-3xl p-6 max-h-[calc(100dvh-2.5rem)] flex flex-col font-sans shadow-none">
                        <DialogHeader className="space-y-1 text-left shrink-0">
                            <div className="flex items-center gap-2.5">
                                <div className="flex size-8 items-center justify-center rounded-full bg-canvas-soft text-ink">
                                    <Cpu className="size-4" />
                                </div>
                                <DialogTitle className="text-base font-[650] tracking-tight text-ink font-sans">
                                    Select Allowed Models.
                                </DialogTitle>
                            </div>
                            <DialogDescription className="text-xs text-text-muted leading-relaxed font-sans">
                                Restrict this API key to specific models. If none selected, the key
                                will allow all models.
                            </DialogDescription>
                        </DialogHeader>

                        <div className="space-y-3 pt-3 flex-1 min-h-0 flex flex-col">
                            <div className="relative shrink-0">
                                <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-text-muted" />
                                <Input
                                    type="text"
                                    value={model_search}
                                    onChange={(e) => setModelSearch(e.target.value)}
                                    placeholder="Search models…"
                                    className="h-9 pl-9 pr-8 font-mono text-xs rounded-full bg-field border-0 text-ink placeholder:text-text-faint focus-visible:ring-2 focus-visible:ring-ink"
                                />
                                {model_search ? (
                                    <button
                                        type="button"
                                        onClick={() => setModelSearch("")}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-text-muted hover:text-ink transition-colors cursor-pointer"
                                        aria-label="Clear search"
                                    >
                                        <X className="size-3" />
                                    </button>
                                ) : null}
                            </div>

                            <div className="flex-1 overflow-y-auto min-h-0 rounded-2xl border border-hairline-soft divide-y divide-hairline-soft p-1">
                                {isPending ? (
                                    <p className="py-8 text-center font-mono text-xs text-text-muted">
                                        Loading models…
                                    </p>
                                ) : filteredModels.length === 0 ? (
                                    <p className="py-8 text-center font-mono text-xs text-text-muted">
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
                                                        className={cn(
                                                            "flex w-full items-center justify-between gap-2 px-3 py-2 rounded-xl text-left font-mono text-xs transition-colors cursor-pointer",
                                                            isSelected
                                                                ? "bg-accent/10 text-ink font-medium border border-accent/20"
                                                                : "text-text-muted hover:bg-canvas-soft hover:text-ink"
                                                        )}
                                                    >
                                                        <span className="truncate">{model.id}</span>
                                                        {isSelected ? (
                                                            <Check className="size-3.5 shrink-0 text-accent" />
                                                        ) : null}
                                                    </button>
                                                </li>
                                            );
                                        })}
                                    </ul>
                                )}
                            </div>

                            <div className="flex items-center justify-between text-xs text-text-muted font-mono shrink-0">
                                <span>{selected_models.length} model(s) selected</span>
                                {model_search ? (
                                    <span>{filteredModels.length} shown</span>
                                ) : (
                                    <span>{models.length} total</span>
                                )}
                            </div>
                        </div>

                        <DialogFooter className="pt-3 border-t border-hairline-soft shrink-0 mt-2">
                            <Button
                                type="button"
                                onClick={() => setIsPickerOpen(false)}
                                className="h-9 rounded-full px-5 text-xs font-semibold cursor-pointer w-full sm:w-auto shadow-none"
                            >
                                Done
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            ) : null}
        </div>
    );
}
