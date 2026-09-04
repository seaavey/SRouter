import type { APIKeyZod, CreateAPIKeyZod } from "@srouter/types";

export type ModelScope = "all" | "restricted";

export interface KeyFormData {
    name: string;
    enabled: boolean;
    rate_limit: string;
    quota_limit: string;
    credit_limit: string;
    model_scope: ModelScope;
    selected_models: string[];
}

export const default_data: KeyFormData = {
    name: "",
    enabled: true,
    rate_limit: "",
    quota_limit: "",
    credit_limit: "",
    model_scope: "all",
    selected_models: []
};

export const quick_amounts = [5, 10, 25, 50];

export type KeyLimitFieldKey = "rate_limit" | "quota_limit" | "credit_limit";

export interface KeyLimitsFieldsProps {
    form: KeyFormData;
    onChange: <K extends KeyLimitFieldKey>(field: K, val: KeyFormData[K]) => void;
    id_prefix?: string;
}

export interface ModelSelectorProps {
    scope: ModelScope;
    onScopeChange: (scope: ModelScope) => void;
    selected_models: string[];
    onToggleModel: (model_id: string) => void;
    isOpen: boolean;
}

export interface KeyTelemetryCardProps {
    api_key: APIKeyZod;
}

export function maskKey(key: string): string {
    if (key.length <= 14) return key;
    return `${key.slice(0, 10)}••••••••${key.slice(-4)}`;
}

export function parseKeyPayload(form: KeyFormData): CreateAPIKeyZod & { enabled: boolean } {
    const rate_num = form.rate_limit.trim() ? parseInt(form.rate_limit, 10) : undefined;
    const quota_num = form.quota_limit.trim() ? parseInt(form.quota_limit, 10) : undefined;
    const credit_num = form.credit_limit.trim() ? parseFloat(form.credit_limit) : undefined;
    const allowed_models =
        form.model_scope === "restricted" && form.selected_models.length > 0
            ? form.selected_models
            : null;

    const rate_limit = Number.isFinite(rate_num) && (rate_num ?? 0) >= 0 ? rate_num : undefined;
    const quota_limit = Number.isFinite(quota_num) && (quota_num ?? 0) >= 0 ? quota_num : undefined;
    const credit_limit =
        Number.isFinite(credit_num) && (credit_num ?? 0) >= 0 ? credit_num : undefined;

    return {
        name: form.name.trim(),
        enabled: form.enabled,
        rate_limit,
        quota_limit,
        credit_limit,
        allowed_models
    };
}

export function getKeyFormData(data?: APIKeyZod | null): KeyFormData {
    if (!data) return default_data;
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
