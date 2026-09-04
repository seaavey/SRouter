import { useState, useEffect } from "react";
import type { APIKeyZod } from "@srouter/types";
import {
    default_data,
    getKeyFormData,
    parseKeyPayload,
    type KeyFormData
} from "./keys.form-types";

export function useKeyForm(data?: APIKeyZod | null, is_open?: boolean) {
    const [form, setForm] = useState<KeyFormData>(() => getKeyFormData(data));

    useEffect(() => {
        if (data && is_open) {
            setForm(getKeyFormData(data));
        } else if (!is_open && !data) {
            setForm(default_data);
        }
    }, [data, is_open]);

    const updateField = <K extends keyof KeyFormData>(field: K, val: KeyFormData[K]) => {
        setForm((prev) => ({ ...prev, [field]: val }));
    };

    const toggleModel = (model_id: string) => {
        setForm((prev) => ({
            ...prev,
            selected_models: prev.selected_models.includes(model_id)
                ? prev.selected_models.filter((id) => id !== model_id)
                : [...prev.selected_models, model_id]
        }));
    };

    const resetForm = () => setForm(default_data);

    return { form, updateField, toggleModel, resetForm, getPayload: () => parseKeyPayload(form) };
}
