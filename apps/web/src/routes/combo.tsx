import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useFallbacks } from "@/hooks/useFallbacks";
import { ComboHeader } from "@/components/combo/ComboHeader";
import { ComboArchitecture } from "@/components/combo/ComboArchitecture";
import { ComboForm } from "@/components/combo/ComboForm";
import { ComboList } from "@/components/combo/ComboList";

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

    return (
        <div className="mx-auto w-full max-w-5xl flex flex-col gap-6 font-mono pb-12">
            {/* Top Branding & Metrics Header */}
            <ComboHeader isAdding={isAdding} onToggleAdd={() => setIsAdding(true)} />

            {/* 3-Tier Gateway Resilience Architecture Explainer */}
            <ComboArchitecture />

            {/* Create Combo Modal Dialog */}
            <ComboForm
                open={isAdding}
                saving={saving}
                existingFallbacks={fallbacks}
                onCancel={() => setIsAdding(false)}
                onSubmitCombo={async (comboName, models) => {
                    for (let i = 0; i < models.length; i++) {
                        await createFallback({
                            sourceModel: comboName.trim(),
                            targetModel: models[i]!,
                            priority: i + 1,
                            enabled: true,
                            triggerOnStatus: [429, 403, 500, 502, 503, 504]
                        });
                    }
                    setIsAdding(false);
                }}
            />

            {/* Configured Cascades Interactive List */}
            <ComboList
                fallbacks={fallbacks}
                loading={loading}
                deletingId={deletingId}
                onUpdate={updateFallback}
                onDelete={deleteFallback}
                onAddClick={() => setIsAdding(true)}
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
