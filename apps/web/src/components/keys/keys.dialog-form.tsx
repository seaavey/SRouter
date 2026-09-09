import React, { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { Check, Cpu, KeyRound, Search, ShieldCheck, X } from "lucide-react";
import type { APIKeyZod, ModelListResponse } from "@srouter/types";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from "@/components/ui/dialog";
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
            <DialogContent
                className="p-0 border-none bg-transparent shadow-none w-auto max-w-none flex items-center justify-center pointer-events-auto"
            >
                <motion.div
                    layout="position"
                    transition={{ type: "spring", stiffness: 350, damping: 32 }}
                    className={cn(
                        "w-[calc(100vw-1.5rem)] flex flex-col md:flex-row items-stretch md:items-start justify-center gap-3.5 font-mono max-h-[calc(100dvh-2rem)] overflow-y-auto md:overflow-visible",
                        isSidePanelOpen
                            ? "max-w-3xl lg:max-w-4xl"
                            : "max-w-lg"
                    )}
                >
                    {/* Primary Card: API Key Details & Settings */}
                    <motion.div
                        layout="position"
                        transition={{ type: "spring", stiffness: 350, damping: 32 }}
                        className="w-full md:w-[460px] lg:w-[480px] shrink-0 border border-border/80 bg-card p-0 flex flex-col shadow-lg overflow-hidden max-h-[calc(100dvh-2.5rem)]"
                    >
                        {/* Header Section */}
                        <div className="px-4 sm:px-5 py-3.5 sm:py-4 border-b border-border/60 bg-secondary/15 shrink-0">
                            <div className="flex items-center justify-between gap-3">
                                <div className="flex items-center gap-2.5 min-w-0">
                                    <div className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border/80 bg-secondary text-foreground shadow-2xs">
                                        <KeyRound className="size-3.5" />
                                    </div>
                                    <div className="min-w-0">
                                        <h2 className="text-xs sm:text-sm font-bold tracking-tight text-foreground truncate uppercase">
                                            {title}
                                        </h2>
                                        <p className="text-[10.5px] sm:text-[11px] text-muted-foreground leading-tight truncate mt-0.5">
                                            {description}
                                        </p>
                                    </div>
                                </div>
                                {api_key ? (
                                    <span className="hidden sm:inline-flex items-center gap-1 font-mono text-[10px] text-muted-foreground bg-secondary/60 border border-border/60 px-2 py-0.5 rounded shrink-0">
                                        <ShieldCheck className="size-3 text-emerald-600 dark:text-emerald-400" />
                                        {api_key.id.slice(0, 8)}…
                                    </span>
                                ) : null}
                            </div>
                        </div>

                        {/* Form Body with Internal Scroll */}
                        <div className="flex-1 overflow-y-auto min-h-0 px-4 sm:px-5 py-4 space-y-4">
                            {api_key ? <KeyTelemetryCard api_key={api_key} /> : null}

                            <form id="key-form" onSubmit={handleSubmit} className="space-y-4">
                                {/* Key Identifier & Status */}
                                <div className="border-y border-border/70 bg-secondary/10 p-3 space-y-3">
                                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                                        <div className="flex-1 space-y-1">
                                            <Label
                                                htmlFor={`${IDPrefix}key-name`}
                                                className="text-xs font-semibold text-foreground flex items-center justify-between"
                                            >
                                                <span>Key Name</span>
                                                <span className="text-[10px] text-destructive font-mono">*required</span>
                                            </Label>
                                            <Input
                                                id={`${IDPrefix}key-name`}
                                                type="text"
                                                required
                                                autoFocus={!api_key}
                                                value={form.name}
                                                onChange={(e) => updateField("name", e.target.value)}
                                                placeholder="e.g. production-backend"
                                                className="h-8.5 font-mono text-xs rounded-md bg-background border-input focus-visible:ring-1"
                                            />
                                        </div>

                                        <div className="space-y-1 shrink-0">
                                            <Label
                                                htmlFor={`${IDPrefix}key-status`}
                                                className="text-xs font-semibold text-foreground block"
                                            >
                                                State
                                            </Label>
                                            <div className="flex h-8.5 items-center justify-between sm:justify-start gap-2 rounded-md border border-input bg-background px-2.5">
                                                <Switch
                                                    id={`${IDPrefix}key-status`}
                                                    checked={form.enabled}
                                                    onCheckedChange={(checked) => updateField("enabled", checked)}
                                                />
                                                <span
                                                    className={cn(
                                                        "font-mono text-[11px] font-semibold select-none min-w-14 text-right sm:text-left",
                                                        form.enabled
                                                            ? "text-emerald-600 dark:text-emerald-400"
                                                            : "text-muted-foreground"
                                                    )}
                                                >
                                                    {form.enabled ? "Active" : "Paused"}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Guardrails: Rate limit & Quotas */}
                                <div className="border-y border-border/70 bg-secondary/10 p-3 space-y-2">
                                    <div className="text-[10.5px] font-mono text-muted-foreground uppercase tracking-wider font-semibold">
                                        Quotas & Limits
                                    </div>
                                    <KeyLimitsFields form={form} onChange={updateField} id_prefix={IDPrefix} />
                                </div>

                                {/* Model Scope */}
                                <div className="border-y border-border/70 bg-secondary/10 p-3 space-y-2">
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

                        {/* Footer Section */}
                        <div className="px-4 sm:px-5 py-3 border-t border-border/60 bg-secondary/15 shrink-0 flex flex-row items-center justify-end gap-2 mt-0">
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => onOpenChange(false)}
                                className="h-8 text-xs font-medium cursor-pointer flex-1 sm:flex-initial"
                            >
                                Cancel
                            </Button>
                            <Button
                                type="submit"
                                form="key-form"
                                disabled={isSubmitting || !form.name.trim()}
                                className="h-8 px-4 text-xs font-semibold cursor-pointer shadow-xs flex-1 sm:flex-initial"
                            >
                                {isSubmitting ? submittingLabel : submitLabel}
                            </Button>
                        </div>
                    </motion.div>

                    {/* Secondary Card (Separated Card to the Right): Allowed Models Pool with Motion Entrance */}
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
                                className="w-full md:w-72 lg:w-80 border border-border/80 bg-card p-0 flex flex-col shadow-lg overflow-hidden shrink-0 max-h-[calc(100dvh-2.5rem)] md:h-auto"
                            >
                                {/* Panel Header */}
                                <div className="px-3.5 py-3 border-b border-border/60 bg-secondary/15 flex items-center justify-between shrink-0">
                                    <div className="flex items-center gap-2 min-w-0">
                                        <div className="flex size-6 shrink-0 items-center justify-center rounded border border-border/80 bg-secondary text-foreground">
                                            <Cpu className="size-3" />
                                        </div>
                                        <h3 className="text-xs font-bold text-foreground truncate uppercase">
                                            Allowed Models
                                        </h3>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => setIsModelPickerExpanded(false)}
                                        className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors cursor-pointer"
                                        title="Close Model Card"
                                    >
                                        <X className="size-3.5" />
                                    </button>
                                </div>

                                {/* Search Filter */}
                                <div className="p-2.5 border-b border-border/40 shrink-0 bg-background/50">
                                    <div className="relative">
                                        <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 size-3 text-muted-foreground" />
                                        <Input
                                            type="text"
                                            value={modelSearch}
                                            onChange={(e) => setModelSearch(e.target.value)}
                                            placeholder="Filter models…"
                                            className="h-7.5 pl-7 pr-7 font-mono text-xs rounded bg-background border-border/70 focus-visible:ring-1"
                                            autoFocus
                                        />
                                        {modelSearch && (
                                            <button
                                                type="button"
                                                onClick={() => setModelSearch("")}
                                                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                                                aria-label="Clear model search"
                                            >
                                                <X className="size-3" />
                                            </button>
                                        )}
                                    </div>
                                </div>

                                {/* Scrollable Model Checkbox List */}
                                <div className="flex-1 overflow-y-auto min-h-[220px] max-h-[360px] md:max-h-[420px] divide-y divide-border/40 p-1">
                                    {isModelsPending ? (
                                        <p className="py-8 text-center font-mono text-xs text-muted-foreground">
                                            Loading available models…
                                        </p>
                                    ) : filteredModels.length === 0 ? (
                                        <p className="py-8 text-center font-mono text-xs text-muted-foreground">
                                            No models match "{modelSearch.trim()}".
                                        </p>
                                    ) : (
                                        <ul className="space-y-0.5">
                                            {filteredModels.map((m) => {
                                                const isSelected = form.selected_models.includes(m.id);
                                                return (
                                                    <li key={m.id}>
                                                        <button
                                                            type="button"
                                                            onClick={() => toggleModel(m.id)}
                                                            className={cn(
                                                                "flex w-full items-center justify-between gap-2 px-2.5 py-1.5 rounded text-left font-mono text-xs transition-colors cursor-pointer",
                                                                isSelected
                                                                    ? "bg-emerald-500/5 text-foreground font-semibold border border-emerald-500/30"
                                                                    : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
                                                            )}
                                                        >
                                                            <span className="truncate max-w-[200px]" title={m.id}>
                                                                {m.id}
                                                            </span>
                                                            {isSelected && (
                                                                <Check className="size-3 text-emerald-600 dark:text-emerald-400 shrink-0" />
                                                            )}
                                                        </button>
                                                    </li>
                                                );
                                            })}
                                        </ul>
                                    )}
                                </div>

                                {/* Panel Summary Footer */}
                                <div className="px-3 py-2 border-t border-border/60 bg-secondary/15 flex items-center justify-between text-[10.5px] font-mono text-muted-foreground shrink-0">
                                    <span>{form.selected_models.length} active</span>
                                    <button
                                        type="button"
                                        onClick={() => updateField("selected_models", [])}
                                        className="text-[10px] text-muted-foreground hover:text-destructive transition-colors cursor-pointer"
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
