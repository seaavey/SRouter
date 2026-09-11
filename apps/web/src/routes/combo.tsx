import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useFallbacks } from "@/hooks/useFallbacks";
import { ComboArchitecture, ComboForm, ComboHeader, ComboList } from "@/components/combo";

export const Route = createFileRoute("/combo")({
    staticData: { title: "Model Combo" },
    component: ComboPage
});

function ComboPage() {
    const {
        fallbacks,
        loading,
        saving,
        deletingId,
        createFallback,
        updateFallback,
        deleteFallback
    } = useFallbacks();

    const [isAdding, setIsAdding] = useState(false);
    const [editingCombo, setEditingCombo] = useState<{
        name: string;
        models: string[];
    } | null>(null);

    const handleSaveCombo = async (comboName: string, models: string[]) => {
        const trimmedName = comboName.trim();
        // If editing, delete existing rules for this combo first
        const existingRules = fallbacks.filter((f) => f.sourceModel === trimmedName);
        for (const rule of existingRules) {
            await deleteFallback(rule.id);
        }

        for (let i = 0; i < models.length; i++) {
            await createFallback({
                sourceModel: trimmedName,
                targetModel: models[i]!,
                priority: i + 1,
                enabled: true,
                triggerOnStatus: [429, 403, 500, 502, 503, 504]
            });
        }
        setIsAdding(false);
        setEditingCombo(null);
    };

    return (
        <div className="mx-auto flex w-full max-w-[1360px] flex-col gap-8 font-sans pb-16">
            <ComboHeader
                isAdding={isAdding || Boolean(editingCombo)}
                onToggleAdd={() => {
                    setEditingCombo(null);
                    setIsAdding(true);
                }}
            />
            <ComboArchitecture />
            <ComboForm
                open={isAdding || Boolean(editingCombo)}
                saving={saving}
                existing_fallbacks={fallbacks}
                initial_combo_name={editingCombo?.name ?? ""}
                initial_models={editingCombo?.models ?? []}
                onCancel={() => {
                    setIsAdding(false);
                    setEditingCombo(null);
                }}
                onSubmitCombo={handleSaveCombo}
            />
            <ComboList
                fallbacks={fallbacks}
                loading={loading}
                deletingId={deletingId}
                onUpdate={updateFallback}
                onDelete={deleteFallback}
                onAddClick={() => {
                    setEditingCombo(null);
                    setIsAdding(true);
                }}
                onEditClick={(comboName, models) => {
                    setEditingCombo({ name: comboName, models });
                }}
            />
        </div>
    );
}
