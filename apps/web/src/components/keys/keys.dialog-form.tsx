import React from "react";
import { KeyRound, ShieldCheck } from "lucide-react";
import type { APIKeyZod } from "@srouter/types";
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
    const IDPrefix = api_key ? "edit-" : "create-";

    const handleSubmit = async (e: React.SubmitEvent<HTMLFormElement>) => {
        e.preventDefault();
        const payload = getPayload();
        if (!payload.name) return;

        await onSubmit(payload);
        if (!api_key) {
            resetForm();
        } else {
            onOpenChange(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-lg bg-card border-border/80 p-0 max-h-[calc(100dvh-2.5rem)] flex flex-col shadow-2xl">
                {/* Header Section */}
                <DialogHeader className="px-5 py-4 border-b border-border/60 bg-secondary/10 shrink-0">
                    <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2.5 min-w-0">
                            <div className="flex size-7.5 shrink-0 items-center justify-center rounded-md border border-border/80 bg-background text-foreground shadow-xs">
                                <KeyRound className="size-3.5" />
                            </div>
                            <div className="min-w-0">
                                <DialogTitle className="text-sm font-semibold tracking-tight text-foreground truncate">
                                    {title}
                                </DialogTitle>
                                <DialogDescription className="text-[11px] text-muted-foreground leading-tight truncate mt-0.5">
                                    {description}
                                </DialogDescription>
                            </div>
                        </div>
                        {api_key ? (
                            <span className="hidden sm:inline-flex items-center gap-1 font-mono text-[10px] text-muted-foreground bg-secondary/60 border border-border/60 px-2 py-0.5 rounded shrink-0">
                                <ShieldCheck className="size-3 text-emerald-500" />
                                {api_key.id.slice(0, 10)}…
                            </span>
                        ) : null}
                    </div>
                </DialogHeader>

                {/* Form Body with Internal Scroll */}
                <div className="flex-1 overflow-y-auto min-h-0 px-5 py-4 space-y-4">
                    {api_key ? <KeyTelemetryCard api_key={api_key} /> : null}

                    <form id="key-form" onSubmit={handleSubmit} className="space-y-4">
                        {/* Key Identifier & Status */}
                        <div className="rounded-lg border border-border/70 bg-background/50 p-3 space-y-3">
                            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                                <div className="flex-1 space-y-1">
                                    <Label
                                        htmlFor={`${IDPrefix}key-name`}
                                        className="text-xs font-medium text-foreground flex items-center justify-between"
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
                                        className="text-xs font-medium text-foreground block"
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
                                                "font-mono text-[11px] font-medium select-none min-w-14 text-right sm:text-left",
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
                        <div className="rounded-lg border border-border/70 bg-background/50 p-3 space-y-2">
                            <div className="text-[11px] font-mono text-muted-foreground uppercase tracking-wider">
                                Quotas & Limits
                            </div>
                            <KeyLimitsFields form={form} onChange={updateField} id_prefix={IDPrefix} />
                        </div>

                        {/* Model Scope */}
                        <div className="rounded-lg border border-border/70 bg-background/50 p-3 space-y-2">
                            <ModelSelector
                                scope={form.model_scope}
                                onScopeChange={(scope) => updateField("model_scope", scope)}
                                selected_models={form.selected_models}
                                onToggleModel={toggleModel}
                                isOpen={open}
                            />
                        </div>
                    </form>
                </div>

                {/* Footer Section */}
                <DialogFooter className="px-5 py-3 border-t border-border/60 bg-secondary/15 shrink-0 flex items-center justify-end gap-2 mt-0">
                    <Button
                        type="button"
                        variant="outline"
                        onClick={() => onOpenChange(false)}
                        className="h-8 text-xs font-medium cursor-pointer"
                    >
                        Cancel
                    </Button>
                    <Button
                        type="submit"
                        form="key-form"
                        disabled={isSubmitting || !form.name.trim()}
                        className="h-8 px-4 text-xs font-semibold cursor-pointer shadow-xs"
                    >
                        {isSubmitting ? submittingLabel : submitLabel}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
