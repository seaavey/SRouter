import { formatCompactNumber } from "@/lib/utils";
import type { APIKeyResponse } from "@/generated/api";

interface KeyTelemetryCardProps {
    apiKey: APIKeyResponse;
}

export default function KeyTelemetryCard({ apiKey }: KeyTelemetryCardProps) {
    const remainingCredit =
        (apiKey.credit_limit ?? 0) > 0
            ? Math.max(0, (apiKey.credit_limit ?? 0) - (apiKey.usage_cost ?? 0))
            : null;

    return (
        <div className="flex flex-col gap-3 rounded-2xl border border-hairline-soft bg-canvas-soft p-4 font-sans">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <span className="text-xs font-mono font-medium uppercase tracking-wider text-text-muted">
                    Active Token
                </span>
                <span
                    className="inline-flex items-center justify-start gap-2 rounded-full border border-hairline-soft bg-canvas px-3 py-1.5 text-xs font-mono text-ink w-full sm:w-auto"
                    title="Key prefix; the full secret exists only in the response that created the key"
                >
                    <span className="truncate max-w-[220px] sm:max-w-none">
                        {apiKey.key_prefix}
                    </span>
                </span>
            </div>

            <div className="grid grid-cols-3 divide-x divide-hairline-soft rounded-2xl border border-hairline-soft bg-canvas py-3 text-center">
                <div className="px-2">
                    <span className="text-text-muted block text-[10px] uppercase font-mono tracking-wider">
                        Usage
                    </span>
                    <span className="text-xs font-semibold text-ink font-mono tabular-nums mt-0.5 block">
                        {formatCompactNumber(apiKey.usage_tokens ?? 0)}{" "}
                        <span className="text-[10px] font-normal text-text-muted">tok</span>
                    </span>
                </div>
                <div className="px-2">
                    <span className="text-text-muted block text-[10px] uppercase font-mono tracking-wider">
                        Spent
                    </span>
                    <span className="text-xs font-semibold text-ink font-mono tabular-nums mt-0.5 block">
                        ${(apiKey.usage_cost ?? 0).toFixed(4)}
                    </span>
                </div>
                <div className="px-2">
                    <span className="text-text-muted block text-[10px] uppercase font-mono tracking-wider">
                        Balance
                    </span>
                    <span className="text-xs font-semibold text-ink font-mono tabular-nums mt-0.5 block">
                        {remainingCredit !== null ? `$${remainingCredit.toFixed(2)}` : "Unlimited"}
                    </span>
                </div>
            </div>
        </div>
    );
}
