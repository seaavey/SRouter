import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { KeyLimitFieldKey, KeyLimitsFieldsProps } from "./keys.form-types";

interface FieldConfig {
    key: KeyLimitFieldKey;
    label: string;
    suffix: string;
    id: string;
    helper: string;
    placeholder: string;
    min: string;
    step?: string;
    type: "number" | "text";
}

const LIMIT_FIELDS: FieldConfig[] = [
    {
        key: "rate_limit",
        label: "Rate Limit",
        suffix: "req/m",
        id: "rate-limit",
        helper: "Max requests per minute",
        placeholder: "Unlimited",
        min: "0",
        type: "number"
    },
    {
        key: "quota_limit",
        label: "Token Quota",
        suffix: "tokens",
        id: "quota-limit",
        helper: "Lifetime token ceiling",
        placeholder: "Unlimited",
        min: "0",
        type: "number"
    },
    {
        key: "credit_limit",
        label: "Credit Limit",
        suffix: "$ USD",
        id: "credit-limit",
        helper: "Budget spending cap",
        placeholder: "Unlimited",
        min: "0",
        step: "0.01",
        type: "number"
    }
];

export function KeyLimitsFields({ form, onChange, id_prefix = "" }: KeyLimitsFieldsProps) {
    return (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            {LIMIT_FIELDS.map(({ key, label, suffix, id, helper, placeholder, min, step, type }) => (
                <div key={id} className="space-y-1">
                    <Label
                        htmlFor={`${id_prefix}${id}`}
                        className="text-[11px] font-medium text-foreground flex items-center justify-between"
                    >
                        <span>{label}</span>
                        <span className="text-[10px] font-mono text-muted-foreground">
                            {suffix}
                        </span>
                    </Label>
                    <Input
                        id={`${id_prefix}${id}`}
                        type={type}
                        min={min}
                        step={step}
                        value={form[key]}
                        onChange={(e) => onChange(key, e.target.value)}
                        placeholder={placeholder}
                        className="h-8.5 font-mono text-xs rounded-md bg-background border-input"
                    />
                    <p className="text-[10px] text-muted-foreground font-mono truncate">{helper}</p>
                </div>
            ))}
        </div>
    );
}
