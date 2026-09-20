import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import KeyLimitsFields from "./keys.form-limits";
import type { KeyFormData, ModelScope } from "./keys.form-types";
import ModelSelector from "./keys.model-selector";

type FieldChange = <K extends keyof KeyFormData>(field: K, value: KeyFormData[K]) => void;

interface KeyFormFieldsProps {
    form: KeyFormData;
    idPrefix: string;
    onChange: FieldChange;
    onScopeChange: (scope: ModelScope) => void;
    onOpenPicker: () => void;
}

export default function KeyFormFields({
    form,
    idPrefix,
    onChange,
    onScopeChange,
    onOpenPicker
}: KeyFormFieldsProps) {
    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-3 rounded-2xl border border-hairline-soft bg-canvas-soft/40 p-4">
                <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
                    <div className="flex flex-1 flex-col gap-1.5">
                        <Label
                            htmlFor={`${idPrefix}key-name`}
                            className="flex items-center justify-between text-xs font-medium text-ink font-sans"
                        >
                            <span>Key Name</span>
                            <span className="font-mono text-[10px] text-destructive">
                                *required
                            </span>
                        </Label>
                        <Input
                            id={`${idPrefix}key-name`}
                            type="text"
                            required
                            value={form.name}
                            onChange={(event) => onChange("name", event.target.value)}
                            placeholder="e.g. production-backend"
                            className="h-9 rounded-2xl border-0 bg-field font-mono text-xs text-ink shadow-none placeholder:text-text-faint focus-visible:ring-2 focus-visible:ring-ink"
                        />
                    </div>

                    <div className="flex shrink-0 flex-col gap-1.5">
                        <Label
                            htmlFor={`${idPrefix}key-status`}
                            className="block text-xs font-medium text-ink font-sans"
                        >
                            State
                        </Label>
                        <div className="flex h-9 items-center justify-between gap-2.5 rounded-2xl bg-field px-3 sm:justify-start">
                            <Switch
                                id={`${idPrefix}key-status`}
                                checked={form.enabled}
                                onCheckedChange={(enabled) => onChange("enabled", enabled)}
                            />
                            <span
                                className={cn(
                                    "min-w-14 select-none text-right text-xs font-semibold font-sans sm:text-left",
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

            <div className="flex flex-col gap-2 rounded-2xl border border-hairline-soft bg-canvas-soft/40 p-4">
                <div className="font-mono text-xs font-semibold uppercase tracking-wider text-text-muted">
                    Quotas & Limits
                </div>
                <KeyLimitsFields form={form} onChange={onChange} idPrefix={idPrefix} />
            </div>

            <div className="flex flex-col gap-2 rounded-2xl border border-hairline-soft bg-canvas-soft/40 p-4">
                <ModelSelector
                    scope={form.model_scope}
                    onScopeChange={onScopeChange}
                    selected_models={form.selected_models}
                    onOpenPicker={onOpenPicker}
                />
            </div>
        </div>
    );
}
