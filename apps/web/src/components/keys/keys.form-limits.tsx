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
        label: "Rate limit",
        suffix: "(req/m)",
        id: "rate-limit",
        helper: "Max req/min",
        placeholder: "Unlimited",
        min: "0",
        type: "number"
    },
    {
        key: "quota_limit",
        label: "Token quota",
        suffix: "(tokens)",
        id: "quota-limit",
        helper: "Max tokens",
        placeholder: "Unlimited",
        min: "0",
        type: "number"
    },
    {
        key: "credit_limit",
        label: "Credit limit",
        suffix: "($ USD)",
        id: "credit-limit",
        helper: "Prepaid budget",
        placeholder: "Unlimited",
        min: "0",
        step: "0.01",
        type: "number"
    }
];

export function KeyLimitsFields({ form, onChange, id_prefix = "" }: KeyLimitsFieldsProps) {
    return (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
            {LIMIT_FIELDS.map(({ key, label, suffix, id, helper, placeholder, min, step, type }) => (
                <div key={id} className="space-y-1.5">
                    <Label
                        htmlFor={`${id_prefix}${id}`}
                        className="block text-xs font-medium text-foreground"
                    >
                        {label}{" "}
                        <span className="text-[10px] font-normal text-muted-foreground">
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
                        className="h-9 font-mono text-xs rounded-md bg-background border-input"
                    />
                    <p className="text-[10px] text-muted-foreground">{helper}</p>
                </div>
            ))}
        </div>
    );
}
