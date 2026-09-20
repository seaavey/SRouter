import { SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { ModelScope } from "./keys.form-types";

interface ModelSelectorProps {
    scope: ModelScope;
    onScopeChange: (scope: ModelScope) => void;
    selected_models: string[];
    onOpenPicker: () => void;
}

const SCOPE_OPTIONS: { value: ModelScope; title: string; description: string }[] = [
    {
        value: "all",
        title: "All models",
        description: "Unrestricted access"
    },
    {
        value: "restricted",
        title: "Specific models",
        description: "Restrict to a subset"
    }
];

export default function ModelSelector({
    scope,
    onScopeChange,
    selected_models,
    onOpenPicker
}: ModelSelectorProps) {
    return (
        <div className="flex flex-col gap-2 pt-1 font-sans">
            <div className="flex items-center justify-between">
                <Label className="block text-xs font-medium text-ink font-sans">
                    Allowed models
                </Label>
                {scope === "restricted" ? (
                    <button
                        type="button"
                        onClick={onOpenPicker}
                        className="inline-flex min-h-11 items-center gap-1.5 text-xs font-mono text-ink hover:underline cursor-pointer"
                    >
                        <SlidersHorizontal className="size-3" aria-hidden="true" />
                        <span>Manage ({selected_models.length})</span>
                    </button>
                ) : null}
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {SCOPE_OPTIONS.map(({ value, title, description }) => (
                    <button
                        key={value}
                        type="button"
                        onClick={() => onScopeChange(value)}
                        aria-pressed={scope === value}
                        className={cn(
                            "rounded-2xl border px-3.5 py-2.5 text-left text-xs transition-colors cursor-pointer shadow-none",
                            scope === value
                                ? "border-ink bg-canvas text-ink font-semibold"
                                : "border-hairline-soft bg-field text-text-muted hover:text-ink hover:bg-canvas-soft"
                        )}
                    >
                        <div className="flex items-center justify-between">
                            <span>{title}</span>
                            {value === "restricted" && selected_models.length > 0 ? (
                                <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-mono font-medium text-accent">
                                    {selected_models.length}
                                </span>
                            ) : null}
                        </div>
                        <span className="mt-0.5 block text-[10px] font-normal opacity-70">
                            {description}
                        </span>
                    </button>
                ))}
            </div>

            {scope === "restricted" ? (
                <div className="flex flex-col justify-between gap-2 rounded-2xl border border-hairline-soft bg-canvas-soft/60 p-3 text-xs sm:flex-row sm:items-center">
                    <div className="min-w-0">
                        <div className="truncate font-mono text-xs font-medium text-ink">
                            {selected_models.length > 0
                                ? `${selected_models.length} model${selected_models.length === 1 ? "" : "s"} whitelisted`
                                : "No models selected (unrestricted)"}
                        </div>
                        <div className="mt-0.5 text-[10px] text-text-muted font-sans">
                            {selected_models.length > 0
                                ? "Downstream calls limited to this pool"
                                : "Choose models to restrict access"}
                        </div>
                    </div>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={onOpenPicker}
                        className="h-8 w-full shrink-0 rounded-full px-4 text-xs font-sans cursor-pointer shadow-none sm:w-auto"
                    >
                        Choose Models
                    </Button>
                </div>
            ) : null}
        </div>
    );
}
