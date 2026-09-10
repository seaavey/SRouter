import { Check, Copy } from "lucide-react";
import { formatCompactNumber } from "@/lib/utils";
import { useCopy } from "@/hooks/useCopy";
import type { KeyTelemetryCardProps } from "./keys.form-types";

export function KeyTelemetryCard({ api_key }: KeyTelemetryCardProps) {
    const { copied, copy } = useCopy();
    const remaining_credit =
        (api_key.credit_limit ?? 0) > 0
            ? Math.max(0, (api_key.credit_limit ?? 0) - (api_key.usage_cost ?? 0))
            : null;

    return (
        <div className="rounded-2xl border border-hairline-soft bg-canvas-soft p-4 space-y-3 font-sans">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <span className="text-xs font-mono font-medium uppercase tracking-wider text-text-muted">
                    Active Token
                </span>
                <button
                    type="button"
                    onClick={() => void copy(api_key.key, "API key copied to clipboard")}
                    className="inline-flex items-center justify-between sm:justify-start gap-2 rounded-full border border-hairline-soft bg-canvas px-3 py-1.5 text-xs font-mono text-ink hover:bg-field transition-colors cursor-pointer w-full sm:w-auto shadow-none"
                    title="Click to copy full key"
                >
                    <span className="truncate max-w-[220px] sm:max-w-none">{api_key.key}</span>
                    {copied === api_key.key ? (
                        <Check className="size-3 text-emerald-500 shrink-0" />
                    ) : (
                        <Copy className="size-3 text-text-muted shrink-0" />
                    )}
                </button>
            </div>

            <div className="grid grid-cols-3 divide-x divide-hairline-soft rounded-2xl border border-hairline-soft bg-canvas py-3 text-center">
                <div className="px-2">
                    <span className="text-text-muted block text-[10px] uppercase font-mono tracking-wider">
                        Usage
                    </span>
                    <span className="text-xs font-semibold text-ink font-mono tabular-nums mt-0.5 block">
                        {formatCompactNumber(api_key.usage_tokens ?? 0)}{" "}
                        <span className="text-[10px] font-normal text-text-muted">tok</span>
                    </span>
                </div>
                <div className="px-2">
                    <span className="text-text-muted block text-[10px] uppercase font-mono tracking-wider">
                        Spent
                    </span>
                    <span className="text-xs font-semibold text-ink font-mono tabular-nums mt-0.5 block">
                        ${(api_key.usage_cost ?? 0).toFixed(2)}
                    </span>
                </div>
                <div className="px-2">
                    <span className="text-text-muted block text-[10px] uppercase font-mono tracking-wider">
                        Balance
                    </span>
                    <span className="text-xs font-semibold text-ink font-mono tabular-nums mt-0.5 block">
                        {remaining_credit !== null
                            ? `$${remaining_credit.toFixed(2)}`
                            : "Unlimited"}
                    </span>
                </div>
            </div>
        </div>
    );
}
