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
                className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 sm:p-6"
                onClick={onCancel}
            >
                <div
                    className="relative flex flex-col w-full max-w-lg rounded-3xl border border-hairline-soft bg-canvas text-ink shadow-none overflow-hidden font-sans"
                    onClick={(e) => e.stopPropagation()}
                >
                    <div className="flex items-center justify-between border-b border-hairline-soft px-6 py-5 bg-canvas-soft/30">
                        <h2 className="text-base font-semibold text-ink font-sans">
                            {isEditMode ? "Edit Combo" : "Create Model Combo"}
                        </h2>
                        <button
                            type="button"
                            onClick={onCancel}
                            className="size-8 inline-flex items-center justify-center rounded-full text-text-muted hover:text-ink hover:bg-canvas-soft transition-colors cursor-pointer"
                        >
                            <X className="size-4" />
                        </button>
                    </div>

                    <form onSubmit={handleSubmit} className="flex flex-col gap-5 p-6">
                        <div className="space-y-2 text-left">
                            <label className="text-xs font-semibold text-ink block font-sans">
                                Combo Name *
                            </label>
                            <input
                                type="text"
                                value={comboName}
                                onChange={(e) => setComboName(e.target.value)}
                                placeholder="e.g. smart-router, fallback-cascade"
                                disabled={isEditMode}
                                className="w-full h-10 rounded-2xl border border-hairline-soft bg-field px-4 text-xs text-ink placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-ink transition-all font-mono disabled:opacity-60 disabled:cursor-not-allowed"
                            />
                            <p
                                className={`text-[11px] font-sans ${
                                    comboName.trim() && !isNameValid
                                        ? "text-destructive font-medium"
                                        : "text-text-muted font-light"
                                }`}
                            >
                                Only letters, numbers, -, _ and . allowed (used in endpoint
                                /v1/chat/completions)
                            </p>
                        </div>

                        <div className="space-y-2 text-left">
                            <label className="text-xs font-semibold text-ink block font-sans">
                                Target Priority Sequence *
                            </label>

                            <div className="rounded-2xl border border-hairline-soft bg-canvas-soft/30 p-4 space-y-3">
                                {selectedModels.length === 0 ? (
                                    <div className="flex flex-col items-center justify-center py-8 text-center font-sans">
                                        <Layers className="size-8 text-text-muted/60 mb-2" />
                                        <span className="text-xs font-medium text-text-muted">
                                            No fallback models added yet
                                        </span>
                                    </div>
                                ) : (
                                    <div className="space-y-2 max-h-56 overflow-y-auto pr-0.5">
                                        {selectedModels.map((model, idx) => {
                                            const { hasVision, hasThinking } = getModelCapabilities(
                                                model.id,
                                                model.name
                                            );
                                            return (
                                                <div
                                                    key={model.id}
                                                    className="flex items-center justify-between gap-3 rounded-2xl border border-hairline-soft bg-canvas px-3.5 py-2.5 text-xs text-ink shadow-none font-sans"
                                                >
                                                    <div className="flex items-center gap-2.5 min-w-0">
                                                        <span className="flex size-5 items-center justify-center rounded-full bg-canvas-soft text-[10px] font-bold text-ink border border-hairline-soft font-mono">
                                                            {idx + 1}
                                                        </span>
                                                        <ProviderIcon
                                                            providerId={model.providerId}
                                                            className="size-4 shrink-0"
                                                        />
                                                        <span className="font-medium truncate text-ink">
                                                            {model.name ||
                                                                formatModelDisplayName(model.id)}
                                                        </span>
                                                        <div className="flex items-center gap-1 shrink-0">
                                                            {hasVision && (
                                                                <Eye className="size-3 text-text-muted shrink-0" />
                                                            )}
                                                            {hasThinking && (
                                                                <Brain className="size-3 text-text-muted shrink-0" />
                                                            )}
                                                        </div>
                                                    </div>

                                                    <div className="flex items-center gap-1 shrink-0">
                                                        <button
                                                            type="button"
                                                            disabled={idx === 0}
                                                            onClick={() => moveModel(idx, idx - 1)}
                                                            className="size-7 inline-flex items-center justify-center text-text-muted hover:text-ink disabled:opacity-30 cursor-pointer rounded-full hover:bg-canvas-soft transition-colors"
                                                            title="Move up priority"
                                                        >
                                                            <ChevronUp className="size-3.5" />
                                                        </button>
                                                        <button
                                                            type="button"
                                                            disabled={
                                                                idx === selectedModels.length - 1
                                                            }
                                                            onClick={() => moveModel(idx, idx + 1)}
                                                            className="size-7 inline-flex items-center justify-center text-text-muted hover:text-ink disabled:opacity-30 cursor-pointer rounded-full hover:bg-canvas-soft transition-colors"
                                                            title="Move down priority"
                                                        >
                                                            <ChevronDown className="size-3.5" />
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() =>
                                                                handleRemoveModel(model.id)
                                                            }
                                                            className="size-7 inline-flex items-center justify-center text-text-muted hover:text-destructive cursor-pointer rounded-full hover:bg-destructive/10 transition-colors"
                                                            title="Remove model"
                                                        >
                                                            <Trash2 className="size-3.5" />
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
                                    className="flex w-full items-center justify-center gap-2 rounded-full border border-dashed border-hairline bg-canvas hover:bg-canvas-soft py-2.5 text-xs font-semibold text-ink transition-colors cursor-pointer shadow-none font-sans"
                                >
                                    <Plus className="size-3.5" />
                                    <span>Select Models to Cascade</span>
                                </button>
                            </div>
                        </div>

                        <div className="flex items-center justify-end gap-2 pt-3 border-t border-hairline-soft font-sans">
                            <button
                                type="button"
                                onClick={onCancel}
                                className="rounded-full border border-hairline-soft px-5 py-2 text-xs font-semibold text-text-muted hover:text-ink bg-canvas hover:bg-canvas-soft transition-colors cursor-pointer shadow-none"
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                disabled={!canSubmit}
                                className="rounded-full px-6 py-2 text-xs font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed bg-ink text-canvas hover:opacity-90 cursor-pointer shadow-none"
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
