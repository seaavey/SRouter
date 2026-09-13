import type { Row } from "@tanstack/react-table";
import { formatCompactNumber } from "@/lib/utils";
import type { ModelUsageItem } from "./usage-by-model.typed";

type UsageByModelMobileProps = {
    rows: Row<ModelUsageItem>[];
};

export function UsageByModelMobile({ rows }: UsageByModelMobileProps) {
    return (
        <div className="space-y-2 p-4 lg:hidden">
            {rows.map((row) => {
                const model = row.original;
                const total = model.totalInputTokens + model.totalOutputTokens;
                return (
                    <article
                        key={row.id}
                        className="min-w-0 rounded-2xl border border-hairline-soft bg-canvas-soft/40 p-3.5"
                    >
                        <div className="flex min-w-0 items-start justify-between gap-3">
                            <span
                                className="min-w-0 truncate text-sm font-medium text-ink"
                                title={model.model}
                            >
                                {model.model}
                            </span>
                            <span className="shrink-0 font-mono text-xs font-semibold text-ink tabular-nums">
                                {formatCompactNumber(total)} tok
                            </span>
                        </div>
                        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 font-mono text-[11px] text-text-muted sm:grid-cols-4">
                            <div>
                                <dt>Requests</dt>
                                <dd className="mt-0.5 font-semibold text-ink">
                                    {formatCompactNumber(model.totalRequests)}
                                </dd>
                            </div>
                            <div>
                                <dt>Input</dt>
                                <dd className="mt-0.5 font-semibold text-ink">
                                    {formatCompactNumber(model.totalInputTokens)}
                                </dd>
                            </div>
                            <div>
                                <dt>Output</dt>
                                <dd className="mt-0.5 font-semibold text-ink">
                                    {formatCompactNumber(model.totalOutputTokens)}
                                </dd>
                            </div>
                            <div>
                                <dt>Est. cost</dt>
                                <dd className="mt-0.5 font-semibold text-ink">
                                    ${model.estCost.toFixed(4)}
                                </dd>
                            </div>
                        </dl>
                    </article>
                );
            })}
        </div>
    );
}
