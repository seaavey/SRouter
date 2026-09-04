import React from "react";
import { KeyRound } from "lucide-react";
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
            <DialogContent className="sm:max-w-lg bg-card border-border p-6">
                <DialogHeader className="space-y-1 text-left">
                    <div className="flex items-center gap-2">
                        <div className="flex size-7 items-center justify-center rounded-md bg-secondary text-foreground">
                            <KeyRound className="size-3.5" />
                        </div>
                        <DialogTitle className="text-base font-semibold text-foreground">
                            {title}
                        </DialogTitle>
                    </div>
                    <DialogDescription className="text-xs text-muted-foreground leading-relaxed">
                        {description}
                    </DialogDescription>
                </DialogHeader>

                {api_key ? <KeyTelemetryCard api_key={api_key} /> : null}

                <form onSubmit={handleSubmit} className="space-y-4 pt-1">
                    <div className="flex items-start gap-3">
                        <div className="flex-1 space-y-1.5">
                            <Label
                                htmlFor={`${IDPrefix}key-name`}
                                className="block text-xs font-medium text-foreground"
                            >
                                Key Name <span className="text-destructive">*</span>
                            </Label>
                            <Input
                                id={`${IDPrefix}key-name`}
                                type="text"
                                required
                                autoFocus={!api_key}
                                value={form.name}
                                onChange={(e) => updateField("name", e.target.value)}
                                placeholder="e.g. production-backend"
                                className="h-9 font-mono text-xs rounded-md bg-background border-input"
                            />
                        </div>

                        <div className="space-y-1.5">
                            <Label
                                htmlFor={`${IDPrefix}key-status`}
                                className="block text-xs font-medium text-foreground"
                            >
                                Status
                            </Label>
                            <div className="flex h-9 items-center gap-2 rounded-md border border-input bg-background px-2.5">
                                <Switch
                                    id={`${IDPrefix}key-status`}
                                    checked={form.enabled}
                                    onCheckedChange={(checked) => updateField("enabled", checked)}
                                />
                                <span
                                    className={cn(
                                        "text-xs font-medium select-none min-w-14",
                                        form.enabled
                                            ? "text-emerald-600 dark:text-emerald-400"
                                            : "text-muted-foreground"
                                    )}
                                >
                                    {form.enabled ? "Active" : "Disabled"}
                                </span>
                            </div>
                        </div>
                    </div>

                    <KeyLimitsFields form={form} onChange={updateField} id_prefix={IDPrefix} />

                    <ModelSelector
                        scope={form.model_scope}
                        onScopeChange={(scope) => updateField("model_scope", scope)}
                        selected_models={form.selected_models}
                        onToggleModel={toggleModel}
                        isOpen={open}
                    />

                    <DialogFooter className="pt-2 gap-2">
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => onOpenChange(false)}
                            className="h-8.5 text-xs font-medium cursor-pointer"
                        >
                            Cancel
                        </Button>
                        <Button
                            type="submit"
                            disabled={isSubmitting || !form.name.trim()}
                            className="h-8.5 text-xs font-semibold cursor-pointer shadow-xs"
                        >
                            {isSubmitting ? submittingLabel : submitLabel}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
