import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useFallbacks } from "@/hooks/useFallbacks";
import { ComboHeader } from "@/components/combo/combo.header";
import { ComboArchitecture } from "@/components/combo/combo.architecture";
import ComboForm from "@/components/combo/combo.form";
import { ComboList } from "@/components/combo/combo.list";

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
        <div className="mx-auto w-full max-w-5xl flex flex-col gap-6 font-mono pb-12">
            {/* Top Branding & Metrics Header */}
            <ComboHeader
                isAdding={isAdding || Boolean(editingCombo)}
                onToggleAdd={() => {
                    setEditingCombo(null);
                    setIsAdding(true);
                }}
            />

            {/* 3-Tier Gateway Resilience Architecture Explainer */}
            <ComboArchitecture />

            {/* Create/Edit Combo Modal Dialog */}
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

            {/* Configured Cascades Interactive List */}
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
                onApplyTemplate={async (comboName, models) => {
                    for (let i = 0; i < models.length; i++) {
                        await createFallback({
                            sourceModel: comboName.trim(),
                            targetModel: models[i]!,
                            priority: i + 1,
                            enabled: true,
                            triggerOnStatus: [429, 403, 500, 502, 503, 504]
                        });
                    }
                }}
            />
        </div>
    );
}
