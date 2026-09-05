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
        <div className="rounded-lg border border-border/80 bg-background/60 p-3 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                    Active Token
                </span>
                <button
                    type="button"
                    onClick={() => void copy(api_key.key, "API key copied to clipboard")}
                    className="inline-flex items-center gap-1.5 rounded border border-border/70 bg-secondary/30 px-2 py-0.5 font-mono text-[11px] text-foreground hover:bg-secondary hover:border-border transition-colors cursor-pointer"
                    title="Click to copy full key"
                >
                    <span className="max-w-[160px] sm:max-w-none truncate">{api_key.key}</span>
                    {copied === api_key.key ? (
                        <Check className="size-3 text-emerald-500 shrink-0" />
                    ) : (
                        <Copy className="size-3 opacity-60 shrink-0" />
                    )}
                </button>
            </div>

            <div className="grid grid-cols-3 divide-x divide-border/60 rounded border border-border/60 bg-secondary/20 py-2 text-center font-mono">
                <div className="px-1.5">
                    <span className="text-muted-foreground block text-[10px] uppercase font-sans">
                        Usage
                    </span>
                    <span className="text-xs font-semibold text-foreground tabular-nums">
                        {formatCompactNumber(api_key.usage_tokens ?? 0)}{" "}
                        <span className="text-[10px] font-normal text-muted-foreground">tok</span>
                    </span>
                </div>
                <div className="px-1.5">
                    <span className="text-muted-foreground block text-[10px] uppercase font-sans">
                        Spent
                    </span>
                    <span className="text-xs font-semibold text-foreground tabular-nums">
                        ${(api_key.usage_cost ?? 0).toFixed(2)}
                    </span>
                </div>
                <div className="px-1.5">
                    <span className="text-muted-foreground block text-[10px] uppercase font-sans">
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
