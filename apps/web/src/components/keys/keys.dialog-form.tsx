import React, { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { Check, Cpu, KeyRound, Search, ShieldCheck, X } from "lucide-react";
import type { APIKeyZod, ModelListResponse } from "@srouter/types";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useKeyForm } from "./useKeyForm";
import { KeyLimitsFields } from "./keys.form-limits";
import { ModelSelector } from "./keys.model-selector";
import { KeyTelemetryCard } from "./keys.telemetry-card";
import { parseKeyPayload } from "./keys.form-types";

export interface KeyFormDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    title: string;
    description: string;
    api_key?: APIKeyZod | null;
    submitLabel: string;
    submittingLabel: string;
    isSubmitting: boolean;
    onSubmit: (payload: ReturnType<typeof parseKeyPayload>) => Promise<void | unknown>;
}

export function KeyFormDialog({
    open,
    onOpenChange,
    title,
    description,
    api_key = null,
    submitLabel,
    submittingLabel,
    isSubmitting,
    onSubmit
}: KeyFormDialogProps) {
    const { form, updateField, toggleModel, resetForm, getPayload } = useKeyForm(api_key, open);
    const [isModelPickerExpanded, setIsModelPickerExpanded] = useState(false);
    const [modelSearch, setModelSearch] = useState("");
    const IDPrefix = api_key ? "edit-" : "create-";

    const { data: modelData, isPending: isModelsPending } = useQuery({
        queryKey: ["models"],
        queryFn: () => api.get<ModelListResponse>("/v1/models"),
        enabled: open && (form.model_scope === "restricted" || isModelPickerExpanded)
    });

    const models = useMemo(() => modelData?.data ?? [], [modelData]);
    const filteredModels = useMemo(() => {
        const query = modelSearch.trim().toLowerCase();
        return query ? models.filter((m) => m.id.toLowerCase().includes(query)) : models;
    }, [models, modelSearch]);

    const handleSubmit = async (e: React.SubmitEvent<HTMLFormElement>) => {
        e.preventDefault();
        const payload = getPayload();
        if (!payload.name) return;

        await onSubmit(payload);
        if (!api_key) {
            resetForm();
            setIsModelPickerExpanded(false);
        } else {
            onOpenChange(false);
        }
    };

    const isSidePanelOpen = form.model_scope === "restricted" && isModelPickerExpanded;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="p-0 border-none bg-transparent shadow-none w-auto max-w-none flex items-center justify-center pointer-events-auto overflow-visible">
                <motion.div
                    layout="position"
                    transition={{ type: "spring", stiffness: 350, damping: 32 }}
                    className={cn(
                        "w-[calc(100vw-1.5rem)] flex flex-col md:flex-row items-stretch md:items-start justify-center gap-4 font-sans max-h-[calc(100dvh-2rem)] overflow-y-auto md:overflow-visible",
                        isSidePanelOpen ? "max-w-3xl lg:max-w-4xl" : "max-w-lg"
                    )}
                >
                    <motion.div
                        layout="position"
                        transition={{ type: "spring", stiffness: 350, damping: 32 }}
                        className="w-full md:w-[460px] lg:w-[480px] shrink-0 border border-hairline-soft bg-canvas rounded-3xl p-0 flex flex-col shadow-none overflow-hidden max-h-[calc(100dvh-2.5rem)]"
                    >
                        <div className="px-6 py-5 border-b border-hairline-soft bg-canvas shrink-0">
                            <div className="flex items-center justify-between gap-3">
                                <div className="flex items-center gap-3 min-w-0">
                                    <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-canvas-soft text-ink">
                                        <KeyRound className="size-4" />
                                    </div>
                                    <div className="min-w-0">
                                        <h2 className="text-base font-[650] tracking-tight text-ink font-sans truncate">
                                            {title}
                                        </h2>
                                        <p className="text-xs text-text-muted font-sans truncate mt-0.5">
                                            {description}
                                        </p>
                                    </div>
                                </div>
                                {api_key ? (
                                    <span className="hidden sm:inline-flex items-center gap-1.5 font-mono text-xs text-text-muted bg-canvas-soft rounded-full px-3 py-1 shrink-0">
                                        <ShieldCheck className="size-3 text-emerald-600 dark:text-emerald-400" />
                                        {api_key.id.slice(0, 8)}…
                                    </span>
                                ) : null}
                            </div>
                        </div>
                        <div className="flex-1 overflow-y-auto min-h-0 px-6 py-5 space-y-4">
                            {api_key ? <KeyTelemetryCard api_key={api_key} /> : null}

                            <form id="key-form" onSubmit={handleSubmit} className="space-y-4">
                                <div className="rounded-2xl border border-hairline-soft bg-canvas-soft/40 p-4 space-y-3">
                                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                                        <div className="flex-1 space-y-1.5">
                                            <Label
                                                htmlFor={`${IDPrefix}key-name`}
                                                className="text-xs font-medium text-ink flex items-center justify-between font-sans"
                                            >
                                                <span>Key Name</span>
                                                <span className="text-[10px] text-destructive font-mono">
                                                    *required
                                                </span>
                                            </Label>
                                            <Input
                                                id={`${IDPrefix}key-name`}
                                                type="text"
                                                required
                                                value={form.name}
                                                onChange={(e) =>
                                                    updateField("name", e.target.value)
                                                }
                                                placeholder="e.g. production-backend"
                                                className="h-9 font-mono text-xs rounded-2xl bg-field border-0 text-ink placeholder:text-text-faint focus-visible:ring-2 focus-visible:ring-ink shadow-none"
                                            />
                                        </div>

                                        <div className="space-y-1.5 shrink-0">
                                            <Label
                                                htmlFor={`${IDPrefix}key-status`}
                                                className="text-xs font-medium text-ink block font-sans"
                                            >
                                                State
                                            </Label>
                                            <div className="flex h-9 items-center justify-between sm:justify-start gap-2.5 rounded-2xl bg-field px-3">
                                                <Switch
                                                    id={`${IDPrefix}key-status`}
                                                    checked={form.enabled}
                                                    onCheckedChange={(checked) =>
                                                        updateField("enabled", checked)
                                                    }
                                                />
                                                <span
                                                    className={cn(
                                                        "font-sans text-xs font-semibold select-none min-w-14 text-right sm:text-left",
                                                        form.enabled
                                                            ? "text-emerald-600 dark:text-emerald-400"
                                                            : "text-text-muted"
                                                    )}
                                                >
                                                    {form.enabled ? "Active" : "Paused"}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                <div className="rounded-2xl border border-hairline-soft bg-canvas-soft/40 p-4 space-y-2">
                                    <div className="text-xs font-mono text-text-muted uppercase tracking-wider font-semibold">
                                        Quotas & Limits
                                    </div>
                                    <KeyLimitsFields
                                        form={form}
                                        onChange={updateField}
                                        id_prefix={IDPrefix}
                                    />
                                </div>
                                <div className="rounded-2xl border border-hairline-soft bg-canvas-soft/40 p-4 space-y-2">
                                    <ModelSelector
                                        scope={form.model_scope}
                                        onScopeChange={(scope) => {
                                            updateField("model_scope", scope);
                                            if (scope === "restricted") {
                                                setIsModelPickerExpanded(true);
                                            } else {
                                                setIsModelPickerExpanded(false);
                                            }
                                        }}
                                        selected_models={form.selected_models}
                                        onToggleModel={toggleModel}
                                        isOpen={open}
                                        isPickerOpen={isModelPickerExpanded}
                                        onPickerOpenChange={setIsModelPickerExpanded}
                                    />
                                </div>
                            </form>
                        </div>
                        <div className="px-6 py-4 border-t border-hairline-soft bg-canvas shrink-0 flex flex-row items-center justify-end gap-2 mt-0">
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => onOpenChange(false)}
                                className="h-9 rounded-full px-5 text-xs font-medium cursor-pointer shadow-none flex-1 sm:flex-initial"
                            >
                                Cancel
                            </Button>
                            <Button
                                type="submit"
                                form="key-form"
                                disabled={isSubmitting || !form.name.trim()}
                                className="h-9 rounded-full px-5 text-xs font-semibold cursor-pointer shadow-none flex-1 sm:flex-initial"
                            >
                                {isSubmitting ? submittingLabel : submitLabel}
                            </Button>
                        </div>
                    </motion.div>
                    <AnimatePresence>
                        {isSidePanelOpen && (
                            <motion.div
                                key="allowed-models-pool"
                                initial={{ opacity: 0, x: -16, scale: 0.98, width: 0 }}
                                animate={{ opacity: 1, x: 0, scale: 1, width: "auto" }}
                                exit={{ opacity: 0, x: -16, scale: 0.98, width: 0 }}
                                transition={{
                                    opacity: { duration: 0.2, ease: "easeInOut" },
                                    x: { type: "spring", stiffness: 350, damping: 32 },
                                    scale: { duration: 0.2, ease: "easeInOut" },
                                    width: { type: "spring", stiffness: 350, damping: 32 }
                                }}
                                className="w-full md:w-96 lg:w-[420px] border border-hairline-soft bg-canvas rounded-3xl p-0 flex flex-col shadow-none overflow-hidden shrink-0 max-h-[calc(100dvh-2.5rem)] md:h-auto font-sans"
                            >
                                <div className="px-4 py-3.5 border-b border-hairline-soft bg-canvas flex items-center justify-between shrink-0">
                                    <div className="flex items-center gap-2 min-w-0">
                                        <h3 className="text-xs font-semibold text-ink truncate font-sans">
                                            Allowed Models
                                        </h3>
                                        <span className="rounded-full bg-field px-2 py-0.5 text-[10px] font-mono text-text-muted">
                                            {form.selected_models.length} selected
                                        </span>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => setIsModelPickerExpanded(false)}
                                        className="rounded-full p-1 text-text-muted hover:bg-canvas-soft hover:text-ink transition-colors cursor-pointer"
                                        title="Close model picker"
                                        aria-label="Close model picker"
                                    >
                                        <X className="size-3.5" />
                                    </button>
                                </div>
                                <div className="p-3 border-b border-hairline-soft shrink-0 bg-canvas">
                                    <div className="relative">
                                        <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-text-muted" />
                                        <Input
                                            type="text"
                                            value={modelSearch}
                                            onChange={(e) => setModelSearch(e.target.value)}
                                            placeholder="Filter models…"
                                            className="h-9 pl-9 pr-8 font-mono text-xs rounded-full bg-field border-0 text-ink placeholder:text-text-faint focus-visible:ring-2 focus-visible:ring-ink"
                                        />
                                        {modelSearch && (
                                            <button
                                                type="button"
                                                onClick={() => setModelSearch("")}
                                                className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-text-muted hover:text-ink transition-colors cursor-pointer"
                                                aria-label="Clear model search"
                                            >
                                                <X className="size-3" />
                                            </button>
                                        )}
                                    </div>
                                </div>
                                <div className="flex-1 overflow-y-auto min-h-[220px] max-h-[360px] md:max-h-[420px] p-2 space-y-0.5">
                                    {isModelsPending ? (
                                        <p className="py-8 text-center font-mono text-xs text-text-muted">
                                            Loading available models…
                                        </p>
                                    ) : filteredModels.length === 0 ? (
                                        <p className="py-8 text-center font-mono text-xs text-text-muted">
                                            No models match "{modelSearch.trim()}".
                                        </p>
                                    ) : (
                                        <ul className="space-y-0.5">
                                            {filteredModels.map((m) => {
                                                const isSelected = form.selected_models.includes(
                                                    m.id
                                                );
                                                return (
                                                    <li key={m.id}>
                                                        <button
                                                            type="button"
                                                            onClick={() => toggleModel(m.id)}
                                                            className={cn(
                                                                "flex w-full items-center justify-between gap-2 px-3 py-2 rounded-xl text-left font-mono text-xs transition-colors cursor-pointer",
                                                                isSelected
                                                                    ? "bg-accent/10 text-ink font-medium border border-accent/20"
                                                                    : "text-text-muted hover:bg-canvas-soft hover:text-ink"
                                                            )}
                                                        >
                                                            <span
                                                                className="truncate flex-1 min-w-0"
                                                                title={m.id}
                                                            >
                                                                {m.id}
                                                            </span>
                                                            {isSelected && (
                                                                <Check className="size-3.5 text-accent shrink-0" />
                                                            )}
                                                        </button>
                                                    </li>
                                                );
                                            })}
                                        </ul>
                                    )}
                                </div>
                                <div className="px-4 py-3 border-t border-hairline-soft bg-canvas-soft/40 flex items-center justify-between text-xs font-mono text-text-muted shrink-0">
                                    <span>{form.selected_models.length} active</span>
                                    <button
                                        type="button"
                                        onClick={() => updateField("selected_models", [])}
                                        className="text-xs text-text-muted hover:text-destructive transition-colors cursor-pointer"
                                    >
                                        Clear all
                                    </button>
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </motion.div>
            </DialogContent>
        </Dialog>
    );
}
