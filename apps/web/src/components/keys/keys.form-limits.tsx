import { useLayoutEffect, useRef, type ChangeEvent } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    compactNumber,
    formatLimitInput,
    groupThousands,
    parseLimitValue,
    resolveLimitCaret,
    sanitizeLimitInput,
    tokenUnitOf,
    type KeyFormData
} from "./keys.form-types";

type KeyLimitFieldKey = "rate_limit" | "quota_limit" | "credit_limit";

interface KeyLimitsFieldsProps {
    form: KeyFormData;
    onChange: <K extends KeyLimitFieldKey>(field: K, value: KeyFormData[K]) => void;
    idPrefix?: string;
}

interface FieldConfig {
    key: KeyLimitFieldKey;
    label: string;
    suffix: string;
    id: string;
    helper: string;
    placeholder: string;
    allowDecimal?: boolean;
    allowUnit?: boolean;
    amountPrefix?: string;
}

const LIMIT_FIELDS: FieldConfig[] = [
    {
        key: "rate_limit",
        label: "Rate Limit",
        suffix: "req/m",
        id: "rate-limit",
        helper: "Max requests per minute",
        placeholder: "Unlimited"
    },
    {
        key: "quota_limit",
        label: "Token Quota",
        suffix: "K/M/B/T",
        id: "quota-limit",
        helper: "Lifetime token ceiling",
        placeholder: "Unlimited",
        allowDecimal: true,
        allowUnit: true
    },
    {
        key: "credit_limit",
        label: "Credit Limit",
        suffix: "$ USD",
        id: "credit-limit",
        helper: "Budget spending cap",
        placeholder: "Unlimited",
        allowDecimal: true,
        amountPrefix: "$"
    }
];

function describeAmount(value: string, config: FieldConfig): string | null {
    const resolved = parseLimitValue(value, config.key !== "credit_limit");
    if (resolved === undefined) return null;

    const text =
        config.key === "quota_limit" && tokenUnitOf(value) === null
            ? compactNumber(resolved)
            : groupThousands(String(resolved));

    return `${config.amountPrefix ?? ""}${text}`;
}

interface LimitFieldProps {
    config: FieldConfig;
    value: string;
    idPrefix: string;
    onChange: <K extends KeyLimitFieldKey>(field: K, value: KeyFormData[K]) => void;
}

function LimitField({ config, value, idPrefix, onChange }: LimitFieldProps) {
    const inputRef = useRef<HTMLInputElement>(null);
    const pendingCaret = useRef<number | null>(null);
    const { key, label, suffix, id, helper, placeholder, allowDecimal, allowUnit } = config;
    const display = formatLimitInput(value, allowDecimal, allowUnit);
    const amount = describeAmount(value, config);

    useLayoutEffect(() => {
        const caret = pendingCaret.current;
        pendingCaret.current = null;
        if (caret !== null) inputRef.current?.setSelectionRange(caret, caret);
    }, [display]);

    const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
        const raw = event.target.value;
        const caret = event.target.selectionStart ?? raw.length;
        const next = sanitizeLimitInput(raw, allowDecimal, allowUnit);

        if (next === value) {
            event.target.value = display;
            const restored = resolveLimitCaret(raw, caret, display);
            event.target.setSelectionRange(restored, restored);
            return;
        }

        pendingCaret.current = resolveLimitCaret(
            raw,
            caret,
            formatLimitInput(next, allowDecimal, allowUnit)
        );
        onChange(key, next);
    };

    return (
        <div className="flex flex-col gap-1.5">
            <Label
                htmlFor={`${idPrefix}${id}`}
                className="text-xs font-medium text-ink flex items-center justify-between font-sans"
            >
                <span>{label}</span>
                <span className="text-[10px] font-mono text-text-muted">{suffix}</span>
            </Label>
            <Input
                ref={inputRef}
                id={`${idPrefix}${id}`}
                type="text"
                inputMode={allowDecimal ? "decimal" : "numeric"}
                autoComplete="off"
                value={display}
                onChange={handleChange}
                placeholder={placeholder}
                className="h-9 rounded-2xl border-0 bg-field px-4 py-2 font-mono text-xs text-ink placeholder:text-text-faint focus-visible:ring-2 focus-visible:ring-ink shadow-none"
            />
            <p className="text-[10px] text-text-muted font-sans leading-tight">
                {helper}
                {amount ? ` · ${amount}` : ""}
            </p>
        </div>
    );
}

export default function KeyLimitsFields({ form, onChange, idPrefix = "" }: KeyLimitsFieldsProps) {
    return (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {LIMIT_FIELDS.map((config) => (
                <LimitField
                    key={config.id}
                    config={config}
                    value={form[config.key]}
                    idPrefix={idPrefix}
                    onChange={onChange}
                />
            ))}
        </div>
    );
}
