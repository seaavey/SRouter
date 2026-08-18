import { useMemo, useState } from "react";
import { Brain, ChevronDown, ChevronUp, Eye, Layers, Plus, Trash2, X } from "lucide-react";
import {
    ComboModelPickerModal,
    formatModelDisplayName,
    getModelCapabilities,
    type ComboModelItem
} from "./ComboModelPickerModal";
import { ProviderIcon } from "@/components/ProviderIcon";
import type { FallbackRule } from "@srouter/types";

interface ComboFormProps {
    open?: boolean;
    saving: boolean;
    existingFallbacks?: FallbackRule[];
    onCancel: () => void;
    onSubmitCombo?: (comboName: string, models: string[]) => Promise<unknown>;
    onSubmit?: (data: {
        sourceModel: string;
        targetModel: string;
        priority: number;
        enabled: boolean;
        triggerOnStatus?: number[];
    }) => Promise<unknown>;
}

const COMBO_NAME_REGEX = /^[a-zA-Z0-9._-]+$/;

export function ComboForm({
    open = true,
    saving,
    existingFallbacks = [],
    onCancel,
    onSubmitCombo,
    onSubmit
}: ComboFormProps) {
    const [comboName, setComboName] = useState("");
    const [selectedModels, setSelectedModels] = useState<ComboModelItem[]>([]);
    const [isPickerOpen, setIsPickerOpen] = useState(false);

    const existingComboNames = useMemo(() => {
        const set = new Set<string>();
        for (const fb of existingFallbacks) {
            if (fb.sourceModel && !fb.sourceModel.includes("*")) {
                set.add(fb.sourceModel);
            }
        }
        return Array.from(set);
    }, [existingFallbacks]);

    const isNameValid = useMemo(() => {
        if (!comboName.trim()) return false;
        return COMBO_NAME_REGEX.test(comboName.trim());
    }, [comboName]);

    const canSubmit = isNameValid && selectedModels.length > 0 && !saving;

    const handleToggleModel = (model: ComboModelItem) => {
        setSelectedModels((prev) => {
            const exists = prev.some((m) => m.id === model.id);
            if (exists) {
                return prev.filter((m) => m.id !== model.id);
            }
            return [...prev, model];
        });
    };

    const handleRemoveModel = (modelId: string) => {
        setSelectedModels((prev) => prev.filter((m) => m.id !== modelId));
    };

    const handleMoveUp = (index: number) => {
        if (index <= 0) return;
        setSelectedModels((prev) => {
            const next = [...prev];
            const temp = next[index - 1]!;
            next[index - 1] = next[index]!;
            next[index] = temp;
            return next;
        });
    };

    const handleMoveDown = (index: number) => {
        if (index >= selectedModels.length - 1) return;
        setSelectedModels((prev) => {
            const next = [...prev];
            const temp = next[index + 1]!;
            next[index + 1] = next[index]!;
            next[index] = temp;
            return next;
        });
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!canSubmit) return;

        const trimmedName = comboName.trim();
        const modelIds = selectedModels.map((m) => m.id);

        if (onSubmitCombo) {
            await onSubmitCombo(trimmedName, modelIds);
        } else if (onSubmit) {
            for (let i = 0; i < modelIds.length; i++) {
                await onSubmit({
                    sourceModel: trimmedName,
                    targetModel: modelIds[i]!,
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
                className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4"
                onClick={onCancel}
            >
                <div
                    className="relative flex flex-col w-full max-w-lg rounded-2xl border border-zinc-800 bg-[#161618] text-zinc-100 shadow-2xl overflow-hidden font-sans"
                    onClick={(e) => e.stopPropagation()}
                >
                    {/* macOS Title Bar */}
                    <div className="flex items-center justify-between border-b border-zinc-800/80 px-4 py-3 bg-[#121214]">
                        <div className="flex items-center gap-2">
                            <div className="flex items-center gap-1.5">
                                <span className="size-3 rounded-full bg-[#ff5f56] inline-block shadow-xs" />
                                <span className="size-3 rounded-full bg-[#ffbd2e] inline-block shadow-xs" />
                                <span className="size-3 rounded-full bg-[#27c93f] inline-block shadow-xs" />
                            </div>
                            <h2 className="text-sm font-bold text-zinc-100 ml-2">Create Combo</h2>
                        </div>
                        <button
                            type="button"
                            onClick={onCancel}
                            className="rounded-md p-1 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors cursor-pointer"
                        >
                            <X className="size-4" />
                        </button>
                    </div>

                    <form onSubmit={handleSubmit} className="flex flex-col gap-4 p-5">
                        {/* Field 1: Combo Name */}
                        <div className="space-y-1.5 text-left">
                            <label className="text-xs font-semibold text-zinc-200 block">
                                Combo Name
                            </label>
                            <input
                                type="text"
                                value={comboName}
                                onChange={(e) => setComboName(e.target.value)}
                                placeholder="my-combo"
                                className="w-full h-9 rounded-lg border border-zinc-800 bg-[#1c1c1f] px-3 text-xs text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-zinc-600 focus:ring-1 focus:ring-zinc-600 transition-all font-mono"
                                autoFocus
                            />
                            <p
                                className={`text-[11px] ${
                                    comboName.trim() && !isNameValid
                                        ? "text-rose-400 font-medium"
                                        : "text-zinc-500"
                                }`}
                            >
                                Only letters, numbers, -, _ and . allowed
                            </p>
                        </div>

                        {/* Field 2: Models Box */}
                        <div className="space-y-1.5 text-left">
                            <label className="text-xs font-semibold text-zinc-200 block">
                                Models
                            </label>

                            <div className="rounded-xl border border-dashed border-zinc-800 bg-[#1a1a1d] p-3.5 space-y-3">
                                {selectedModels.length === 0 ? (
                                    <div className="flex flex-col items-center justify-center py-5 text-center">
                                        <Layers className="size-7 text-zinc-500 mb-2" />
                                        <span className="text-xs font-medium text-zinc-400">
                                            No models added yet
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
                                                    className="flex items-center justify-between gap-2 rounded-lg bg-[#202024] border border-zinc-800/80 px-2.5 py-1.5 text-xs text-zinc-200"
                                                >
                                                    <div className="flex items-center gap-2 min-w-0">
                                                        <span className="flex size-4.5 items-center justify-center rounded-full bg-zinc-800 text-[10px] font-bold text-zinc-400">
                                                            {idx + 1}
                                                        </span>
                                                        <ProviderIcon
                                                            providerId={model.providerId}
                                                            className="size-3.5 shrink-0"
                                                        />
                                                        <span className="font-medium truncate">
                                                            {model.name ||
                                                                formatModelDisplayName(model.id)}
                                                        </span>
                                                        <div className="flex items-center gap-1 shrink-0">
                                                            {hasVision && (
                                                                <Eye className="size-3 text-sky-400" />
                                                            )}
                                                            {hasThinking && (
                                                                <Brain className="size-3 text-amber-400" />
                                                            )}
                                                        </div>
                                                    </div>

                                                    <div className="flex items-center gap-1 shrink-0">
                                                        <button
                                                            type="button"
                                                            disabled={idx === 0}
                                                            onClick={() => handleMoveUp(idx)}
                                                            className="p-1 text-zinc-500 hover:text-zinc-200 disabled:opacity-30 cursor-pointer"
                                                            title="Move up"
                                                        >
                                                            <ChevronUp className="size-3" />
                                                        </button>
                                                        <button
                                                            type="button"
                                                            disabled={
                                                                idx === selectedModels.length - 1
                                                            }
                                                            onClick={() => handleMoveDown(idx)}
                                                            className="p-1 text-zinc-500 hover:text-zinc-200 disabled:opacity-30 cursor-pointer"
                                                            title="Move down"
                                                        >
                                                            <ChevronDown className="size-3" />
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() =>
                                                                handleRemoveModel(model.id)
                                                            }
                                                            className="p-1 text-zinc-500 hover:text-rose-400 cursor-pointer"
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

                                {/* Dashed Add Model Button */}
                                <button
                                    type="button"
                                    onClick={() => setIsPickerOpen(true)}
                                    className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-zinc-700/90 hover:border-orange-500/80 bg-[#161618]/60 hover:bg-[#202024] py-2.5 text-xs font-semibold text-orange-500 dark:text-orange-400 transition-all cursor-pointer shadow-2xs"
                                >
                                    <Plus className="size-3.5 text-orange-500 dark:text-orange-400" />
                                    <span>Add Model</span>
                                </button>
                            </div>
                        </div>

                        {/* Modal Actions */}
                        <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-zinc-800/80">
                            <button
                                type="button"
                                onClick={onCancel}
                                className="px-4 py-2 rounded-lg text-xs font-semibold text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors cursor-pointer"
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                disabled={!canSubmit}
                                className="px-5 py-2 rounded-lg text-xs font-semibold transition-all disabled:bg-zinc-800 disabled:text-zinc-500 disabled:cursor-not-allowed bg-zinc-100 text-zinc-900 hover:bg-white cursor-pointer shadow-xs"
                            >
                                {saving ? "Creating..." : "Create"}
                            </button>
                        </div>
                    </form>
                </div>
            </div>

            {/* Submodal for selecting models */}
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
