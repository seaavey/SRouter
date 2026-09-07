import { useEffect, useMemo, useState } from "react";
import { Brain, ChevronDown, ChevronUp, Eye, Layers, Plus, Trash2, X } from "lucide-react";
import ComboModelPickerModal, {
    formatModelDisplayName,
    getModelCapabilities,
    type ComboModelItem
} from "./combo.dialog";
import { ProviderIcon } from "@/components/providers";
import type { CreateFallbackRuleInput, FallbackRule } from "@srouter/types";

interface ComboFormProps {
    open?: boolean;
    saving: boolean;
    existing_fallbacks?: FallbackRule[];
    initial_combo_name?: string;
    initial_models?: string[];
    onCancel: () => void;
    onSubmitCombo?: (comboName: string, models: string[]) => Promise<void> | void;
    onSubmit?: (data: CreateFallbackRuleInput) => Promise<void> | void;
}

const COMBO_NAME_REGEX = /^[a-zA-Z0-9._-]+$/;

const toModelItem = (id: string): ComboModelItem => {
    const providerId = id.includes("/") ? id.split("/")[0]! : "custom";
    return {
        id,
        name: formatModelDisplayName(id),
        providerId,
        providerName: providerId.toUpperCase()
    };
};

export default function ComboForm({
    open = true,
    saving,
    existing_fallbacks = [],
    initial_combo_name = "",
    initial_models = [],
    onCancel,
    onSubmitCombo,
    onSubmit
}: ComboFormProps) {
    const isEditMode = Boolean(initial_combo_name);
    const [comboName, setComboName] = useState(initial_combo_name);
    const [selectedModels, setSelectedModels] = useState<ComboModelItem[]>([]);
    const [isPickerOpen, setIsPickerOpen] = useState(false);

    useEffect(() => {
        if (!open) return;
        setComboName(initial_combo_name);
        setSelectedModels(initial_models.length > 0 ? initial_models.map(toModelItem) : []);
    }, [open, initial_combo_name, initial_models]);

    const existingComboNames = useMemo(
        () =>
            Array.from(
                new Set(
                    existing_fallbacks
                        .filter((f) => f.sourceModel && !f.sourceModel.includes("*"))
                        .map((f) => f.sourceModel)
                )
            ),
        [existing_fallbacks]
    );

    const isNameValid = COMBO_NAME_REGEX.test(comboName.trim());
    const canSubmit = isNameValid && selectedModels.length > 0 && !saving;

    const handleToggleModel = (model: ComboModelItem) =>
        setSelectedModels((prev) =>
            prev.some((m) => m.id === model.id)
                ? prev.filter((m) => m.id !== model.id)
                : [...prev, model]
        );

    const handleRemoveModel = (modelId: string) =>
        setSelectedModels((prev) => prev.filter((m) => m.id !== modelId));

    const moveModel = (from: number, to: number) => {
        setSelectedModels((prev) => {
            if (to < 0 || to >= prev.length) return prev;
            const next = [...prev];
            const [moved] = next.splice(from, 1);
            if (moved) next.splice(to, 0, moved);
            return next;
        });
    };

    const handleSubmit = async (e: React.SubmitEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (!canSubmit) return;

        const trimmedName = comboName.trim();
        const modelIds = selectedModels.map((m) => m.id);

        if (onSubmitCombo) {
            await onSubmitCombo(trimmedName, modelIds);
        } else if (onSubmit) {
            for (const [i, targetModel] of modelIds.entries()) {
                await onSubmit({
                    sourceModel: trimmedName,
                    targetModel,
                    priority: i + 1,
                    enabled: true,
                    triggerOnStatus: [429, 403, 500, 502, 503, 504]
                });
            }
        }

        setComboName("");
        setSelectedModels([]);
        onCancel();
    };

    if (!open) return null;

    return (
        <>
            <div
                className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4"
                onClick={onCancel}
            >
                <div
                    className="relative flex flex-col w-full max-w-lg rounded-lg border border-border/80 bg-card text-foreground shadow-xl overflow-hidden font-mono"
                    onClick={(e) => e.stopPropagation()}
                >
                    <div className="flex items-center justify-between border-b border-border/80 px-4 py-3 bg-secondary/30">
                        <h2 className="text-sm font-bold text-foreground">
                            {isEditMode ? "Edit Combo" : "Create Model Combo"}
                        </h2>
                        <button
                            type="button"
                            onClick={onCancel}
                            className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors cursor-pointer"
                        >
                            <X className="size-4" />
                        </button>
                    </div>

                    <form onSubmit={handleSubmit} className="flex flex-col gap-4 p-4 sm:p-5">
                        <div className="space-y-1.5 text-left">
                            <label className="text-xs font-semibold text-foreground block">
                                Combo Name *
                            </label>
                            <input
                                type="text"
                                value={comboName}
                                onChange={(e) => setComboName(e.target.value)}
                                placeholder="e.g. smart-router, fallback-cascade"
                                disabled={isEditMode}
                                className="w-full h-8.5 rounded border border-border/80 bg-background px-3 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-foreground transition-all font-mono disabled:opacity-60 disabled:cursor-not-allowed"
                                autoFocus={!isEditMode}
                            />
                            <p
                                className={`text-[10.5px] ${
                                    comboName.trim() && !isNameValid
                                        ? "text-destructive font-medium"
                                        : "text-muted-foreground"
                                }`}
                            >
                                Only letters, numbers, -, _ and . allowed (used in endpoint /v1/chat/completions)
                            </p>
                        </div>

                        <div className="space-y-1.5 text-left">
                            <label className="text-xs font-semibold text-foreground block">
                                Target Priority Sequence *
                            </label>

                            <div className="rounded border border-border/80 bg-secondary/15 p-3 space-y-2.5">
                                {selectedModels.length === 0 ? (
                                    <div className="flex flex-col items-center justify-center py-6 text-center">
                                        <Layers className="size-6 text-muted-foreground/60 mb-2" />
                                        <span className="text-xs font-medium text-muted-foreground">
                                            No fallback models added yet
                                        </span>
                                    </div>
                                ) : (
                                    <div className="space-y-1.5 max-h-52 overflow-y-auto pr-0.5">
                                        {selectedModels.map((model, idx) => {
                                            const { hasVision, hasThinking } = getModelCapabilities(
                                                model.id,
                                                model.name
                                            );
                                            return (
                                                <div
                                                    key={model.id}
                                                    className="flex items-center justify-between gap-2 rounded border border-border/80 bg-card px-2.5 py-1.5 text-xs text-foreground shadow-2xs"
                                                >
                                                    <div className="flex items-center gap-2 min-w-0">
                                                        <span className="flex size-4 items-center justify-center rounded bg-secondary text-[9px] font-bold text-foreground border border-border/80">
                                                            {idx + 1}
                                                        </span>
                                                        <ProviderIcon
                                                            providerId={model.providerId}
                                                            className="size-3.5 shrink-0"
                                                        />
                                                        <span className="font-semibold truncate">
                                                            {model.name ||
                                                                formatModelDisplayName(model.id)}
                                                        </span>
                                                        <div className="flex items-center gap-1 shrink-0">
                                                            {hasVision && (
                                                                <Eye className="size-3 text-muted-foreground/80" />
                                                            )}
                                                            {hasThinking && (
                                                                <Brain className="size-3 text-muted-foreground/80" />
                                                            )}
                                                        </div>
                                                    </div>

                                                    <div className="flex items-center gap-0.5 shrink-0">
                                                        <button
                                                            type="button"
                                                            disabled={idx === 0}
                                                            onClick={() => moveModel(idx, idx - 1)}
                                                            className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30 cursor-pointer rounded"
                                                            title="Move up priority"
                                                        >
                                                            <ChevronUp className="size-3" />
                                                        </button>
                                                        <button
                                                            type="button"
                                                            disabled={
                                                                idx === selectedModels.length - 1
                                                            }
                                                            onClick={() => moveModel(idx, idx + 1)}
                                                            className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30 cursor-pointer rounded"
                                                            title="Move down priority"
                                                        >
                                                            <ChevronDown className="size-3" />
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() =>
                                                                handleRemoveModel(model.id)
                                                            }
                                                            className="p-1 text-muted-foreground hover:text-destructive cursor-pointer rounded"
                                                            title="Remove model"
                                                        >
                                                            <Trash2 className="size-3" />
                                                        </button>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}

                                <button
                                    type="button"
                                    onClick={() => setIsPickerOpen(true)}
                                    className="flex w-full items-center justify-center gap-1.5 rounded border border-dashed border-border/90 hover:border-foreground/40 bg-card hover:bg-secondary/40 py-2 text-xs font-semibold text-foreground transition-colors cursor-pointer shadow-2xs"
                                >
                                    <Plus className="size-3.5" />
                                    <span>Select Models to Cascade</span>
                                </button>
                            </div>
                        </div>

                        <div className="flex items-center justify-end gap-2 pt-2 border-t border-border/80">
                            <button
                                type="button"
                                onClick={onCancel}
                                className="px-3.5 py-1.5 rounded border border-border/80 text-xs font-medium text-muted-foreground hover:text-foreground bg-card hover:bg-secondary transition-colors cursor-pointer"
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                disabled={!canSubmit}
                                className="px-4 py-1.5 rounded text-xs font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed bg-foreground text-background hover:bg-foreground/90 cursor-pointer shadow-2xs"
                            >
                                {saving
                                    ? isEditMode
                                        ? "Saving…"
                                        : "Creating…"
                                    : isEditMode
                                      ? "Save Changes"
                                      : "Save Combo"}
                            </button>
                        </div>
                    </form>
                </div>
            </div>

            <ComboModelPickerModal
                open={isPickerOpen}
                onClose={() => setIsPickerOpen(false)}
                selectedModelIds={selectedModels.map((m) => m.id)}
                onToggleModel={handleToggleModel}
                existingCombos={existingComboNames}
            />
        </>
    );
}

export { ComboForm };
