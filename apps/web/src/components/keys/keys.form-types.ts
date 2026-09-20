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

const TOKEN_UNITS: Record<string, number> = {
    K: 1e3,
    M: 1e6,
    B: 1e9,
    T: 1e12
};

const COMPACT_UNITS = [
    { value: 1e12, suffix: "T" },
    { value: 1e9, suffix: "B" },
    { value: 1e6, suffix: "M" },
    { value: 1e3, suffix: "K" }
];

const MAX_DECIMALS = 2;

export function maskKey(key: string): string {
    if (key.length <= 14) return key;
    return `${key.slice(0, 8)}••••••••${key.slice(-4)}`;
}

export function tokenUnitOf(value: string): string | null {
    const match = value.match(/[a-zA-Z]\s*$/);
    if (!match) return null;

    const unit = match[0].trim().toUpperCase();
    return unit in TOKEN_UNITS ? unit : null;
}

export function sanitizeLimitInput(value: string, allowDecimal = false, allowUnit = false): string {
    const unit = allowUnit ? tokenUnitOf(value) : null;
    const numeric = unit ? value.replace(/[a-zA-Z]/g, "") : value;

    return `${normalizeNumberText(numeric, allowDecimal)}${unit ?? ""}`;
}

export function formatLimitInput(value: string, allowDecimal = false, allowUnit = false): string {
    const unit = allowUnit ? tokenUnitOf(value) : null;
    const numeric = unit ? value.replace(/[a-zA-Z]/g, "") : value;

    return `${groupThousands(normalizeNumberText(numeric, allowDecimal))}${unit ?? ""}`;
}

export function groupThousands(value: string): string {
    const [whole, ...fraction] = value.split(".");
    const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

    return fraction.length > 0 ? `${grouped}.${fraction.join("")}` : grouped;
}

export function compactNumber(value: number): string {
    const unit = COMPACT_UNITS.find((candidate) => value >= candidate.value);
    if (!unit) return String(value);

    const scaled = (value / unit.value).toFixed(MAX_DECIMALS).replace(/\.?0+$/, "");
    return `${scaled}${unit.suffix}`;
}

export function resolveLimitCaret(raw: string, caret: number, formatted: string): number {
    const keptBefore = raw.slice(0, caret).replace(/,/g, "").length;
    if (keptBefore <= 0) return 0;

    let seen = 0;
    for (let index = 0; index < formatted.length; index += 1) {
        if (formatted[index] !== ",") seen += 1;
        if (seen === keptBefore) return index + 1;
    }

    return formatted.length;
}

export function parseLimitValue(value: string, integer = false): number | undefined {
    if (!value.trim()) return undefined;

    const numeric = Number(value.replace(/[a-zA-Z]/g, "").trim());
    if (!Number.isFinite(numeric) || numeric < 0) return undefined;

    const unit = tokenUnitOf(value);
    const scaled = unit ? numeric * (TOKEN_UNITS[unit] ?? 1) : numeric;

    return integer ? Math.round(scaled) : scaled;
}

export function parseKeyPayload(form: KeyFormData): CreateAPIKeyZod & { enabled: boolean } {
    const rate_num = parseLimitValue(form.rate_limit, true);
    const quota_num = parseLimitValue(form.quota_limit, true);
    const credit_num = parseLimitValue(form.credit_limit);
    const allowed_models =
        form.model_scope === "restricted" && form.selected_models.length > 0
            ? form.selected_models
            : null;

    return {
        name: form.name.trim(),
        enabled: form.enabled,
        rate_limit: rate_num,
        quota_limit: quota_num,
        credit_limit: credit_num,
        allowed_models
    };
}

function normalizeNumberText(value: string, allowDecimal: boolean): string {
    if (!allowDecimal) return value.replace(/\D/g, "");

    const [whole, ...fraction] = value.replace(/[^\d.]/g, "").split(".");
    const decimals = fraction.join("").slice(0, MAX_DECIMALS);
    if (!whole && !decimals) return "";

    return fraction.length > 0 ? `${whole || "0"}.${decimals}` : whole;
}
