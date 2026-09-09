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
        <div className="border-y border-border/70 bg-secondary/10 p-3 space-y-2.5 font-mono">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <span className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Active Token
                </span>
                <button
                    type="button"
                    onClick={() => void copy(api_key.key, "API key copied to clipboard")}
                    className="inline-flex items-center justify-between sm:justify-start gap-1.5 rounded border border-border/70 bg-background px-2 py-1 text-[11px] text-foreground hover:bg-secondary transition-colors cursor-pointer w-full sm:w-auto"
                    title="Click to copy full key"
                >
                    <span className="truncate max-w-[220px] sm:max-w-none">{api_key.key}</span>
                    {copied === api_key.key ? (
                        <Check className="size-3 text-emerald-500 shrink-0" />
                    ) : (
                        <Copy className="size-3 opacity-60 shrink-0" />
                    )}
                </button>
            </div>

            <div className="grid grid-cols-3 divide-x divide-border/60 rounded border border-border/60 bg-secondary/40 py-2 text-center">
                <div className="px-1 sm:px-2">
                    <span className="text-muted-foreground block text-[9.5px] uppercase">
                        Usage
                    </span>
                    <span className="text-xs font-semibold text-foreground tabular-nums">
                        {formatCompactNumber(api_key.usage_tokens ?? 0)}{" "}
                        <span className="text-[9.5px] font-normal text-muted-foreground">tok</span>
                    </span>
                </div>
                <div className="px-1 sm:px-2">
                    <span className="text-muted-foreground block text-[9.5px] uppercase">
                        Spent
                    </span>
                    <span className="text-xs font-semibold text-foreground tabular-nums">
                        ${(api_key.usage_cost ?? 0).toFixed(2)}
                    </span>
                </div>
                <div className="px-1 sm:px-2">
                    <span className="text-muted-foreground block text-[9.5px] uppercase">
                        Balance
                    </span>
                    <span className="text-xs font-semibold text-foreground tabular-nums">
                        {remaining_credit !== null
                            ? `$${remaining_credit.toFixed(2)}`
                            : "Unlimited"}
                    </span>
                </div>
            </div>
        </div>
    );
}
