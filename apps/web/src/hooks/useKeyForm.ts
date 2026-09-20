import { useState } from "react";
import type { APIKeyZod } from "@srouter/types";
import { parseKeyPayload, type KeyFormData } from "@/components/keys/keys.form-types";

const DEFAULT_FORM_DATA: KeyFormData = {
    name: "",
    enabled: true,
    rate_limit: "",
    quota_limit: "",
    credit_limit: "",
    model_scope: "all",
    selected_models: []
};

function getKeyFormData(data?: APIKeyZod | null): KeyFormData {
    if (!data) return DEFAULT_FORM_DATA;
    return {
        name: data.name || "",
        enabled: Boolean(data.enabled),
        rate_limit: data.rate_limit ? String(data.rate_limit) : "",
        quota_limit: data.quota_limit ? String(data.quota_limit) : "",
        credit_limit: data.credit_limit ? String(data.credit_limit) : "",
        model_scope: data.allowed_models && data.allowed_models.length > 0 ? "restricted" : "all",
        selected_models: data.allowed_models ?? []
    };
}

// Callers must remount this hook's owner (via `key`) when the dialog opens or the
// target key changes; form state is derived once at mount rather than synced by effect.
export function useKeyForm(data: APIKeyZod | null | undefined) {
    const [form, setForm] = useState<KeyFormData>(() => getKeyFormData(data));

    const updateField = <K extends keyof KeyFormData>(field: K, val: KeyFormData[K]) => {
        setForm((prev) => ({ ...prev, [field]: val }));
    };

    const toggleModel = (modelId: string) => {
        setForm((prev) => ({
            ...prev,
            selected_models: prev.selected_models.includes(modelId)
                ? prev.selected_models.filter((id) => id !== modelId)
                : [...prev.selected_models, modelId]
        }));
    };

    const resetForm = () => setForm(DEFAULT_FORM_DATA);

    return { form, updateField, toggleModel, resetForm, getPayload: () => parseKeyPayload(form) };
}
