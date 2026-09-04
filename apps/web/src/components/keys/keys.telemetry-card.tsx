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
        <div className="rounded-xl border border-border/70 bg-secondary/15 p-3.5 space-y-3">
            <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-medium text-muted-foreground">Bearer Token</span>
                <code
                    onClick={() => void copy(api_key.key, "API key copied to clipboard")}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-background/90 px-2 py-0.5 font-mono text-[11px] text-foreground hover:bg-secondary hover:border-border cursor-pointer transition-colors"
                    title="Click to copy full key"
                >
                    {api_key.key}
                    {copied === api_key.key ? (
                        <Check className="size-3 text-emerald-500" />
                    ) : (
                        <Copy className="size-3 opacity-60" />
                    )}
                </code>
            </div>

            <div className="grid grid-cols-3 divide-x divide-border/60 rounded-lg border border-border/60 bg-background/60 py-2 px-1 text-center font-mono">
                <div className="px-2">
                    <span className="text-muted-foreground block text-[10px] uppercase font-sans font-medium tracking-wider">
                        Usage
                    </span>
                    <span className="text-xs font-semibold text-foreground tabular-nums">
                        {formatCompactNumber(api_key.usage_tokens ?? 0)}{" "}
                        <span className="text-[10px] font-normal text-muted-foreground">tok</span>
                    </span>
                </div>
                <div className="px-2">
                    <span className="text-muted-foreground block text-[10px] uppercase font-sans font-medium tracking-wider">
                        Spent
                    </span>
                    <span className="text-xs font-semibold text-foreground tabular-nums">
                        ${(api_key.usage_cost ?? 0).toFixed(2)}
                    </span>
                </div>
                <div className="px-2">
                    <span className="text-muted-foreground block text-[10px] uppercase font-sans font-medium tracking-wider">
                        Balance
                    </span>
                    <span className="text-xs font-semibold text-emerald-500 tabular-nums">
                        {remaining_credit !== null
                            ? `$${remaining_credit.toFixed(2)}`
                            : "Unlimited"}
                    </span>
                </div>
            </div>
        </div>
    );
}
