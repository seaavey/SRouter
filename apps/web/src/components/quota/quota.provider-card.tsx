import { ChevronDown, RefreshCw } from "lucide-react";
import { ProviderIcon } from "@/components/providers";
import type { LiveModelQuotaItem, ProviderUsageMetric } from "@srouter/types";
import { QuotaTableView } from "./quota.table-view";
import { UsageMetricsTable } from "./quota.metrics-table";

export interface QuotaAccountItem {
    id: string;
    account: string;
    provider: string;
    enabled: boolean;
    quotas?: LiveModelQuotaItem[];
    usageMetrics?: ProviderUsageMetric[];
}

export interface QuotaProviderCardProps {
    groupKey: string;
    providerName: string;
    accounts: QuotaAccountItem[];
    isCollapsed: boolean;
    isSpinning: boolean;
    onToggleCollapse: (groupKey: string) => void;
    onRefresh: (providerName: string) => void;
}

export function QuotaProviderCard({
    groupKey,
    providerName,
    accounts,
    isCollapsed,
    isSpinning,
    onToggleCollapse,
    onRefresh
}: QuotaProviderCardProps) {
    const totalAccounts = accounts.length;
    const allQuotas = accounts.flatMap((acc) => acc.quotas || []);

    return (
        <article className="rounded-3xl border border-hairline-soft bg-canvas p-6 shadow-none transition-colors hover:border-hairline space-y-5 font-sans">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-hairline-soft pb-4">
                <div
                    onClick={() => onToggleCollapse(groupKey)}
                    className="flex items-center gap-3.5 cursor-pointer group flex-1 select-none min-w-0"
                >
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl border border-hairline-soft bg-field p-2 transition-colors group-hover:border-hairline">
                        <ProviderIcon providerId={providerName} className="size-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="text-base font-bold text-ink transition-colors capitalize">
                                {providerName}
                            </h3>
                        </div>
                        <p className="text-xs text-text-muted mt-1 truncate">
                            Accounts:{" "}
                            <span className="font-mono text-ink">
                                {accounts.map((a) => a.account).join(", ")}
                            </span>
                        </p>
                    </div>

                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation();
                            onToggleCollapse(groupKey);
                        }}
                        className="flex size-8 items-center justify-center rounded-full border border-hairline-soft bg-canvas-soft text-text-muted hover:text-ink hover:bg-field transition-colors cursor-pointer shrink-0"
                        title={isCollapsed ? "Expand provider" : "Collapse provider"}
                    >
                        <ChevronDown
                            className={`size-4 transition-transform duration-200 ${
                                isCollapsed ? "-rotate-90" : "rotate-0"
                            }`}
                        />
                    </button>
                </div>

                <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
                    <button
                        type="button"
                        onClick={() => onRefresh(providerName)}
                        disabled={isSpinning}
                        className="inline-flex items-center gap-1.5 rounded-full border border-hairline-soft bg-canvas-soft hover:bg-field px-3.5 h-8 text-xs font-medium text-ink transition-colors cursor-pointer disabled:opacity-50"
                        title="Refresh this provider"
                    >
                        <RefreshCw className={`size-3.5 ${isSpinning ? "animate-spin" : ""}`} />
                        <span>Sync</span>
                    </button>
                </div>
            </div>
            {!isCollapsed && (
                <div className="space-y-4 pt-1 animate-in fade-in-50 duration-150">
                    {accounts.map((acc) => {
                        const hasQuotas = acc.quotas && acc.quotas.length > 0;
                        const hasMetrics = acc.usageMetrics && acc.usageMetrics.length > 0;

                        return (
                            <div
                                key={acc.id}
                                className="rounded-2xl border border-hairline-soft bg-canvas-soft/40 p-5 space-y-4"
                            >
                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-hairline-soft pb-3">
                                    <div className="flex items-center gap-2.5 min-w-0">
                                        <div
                                            className={`size-2 rounded-full shrink-0 ${
                                                acc.enabled ? "bg-accent" : "bg-text-faint"
                                            }`}
                                        />
                                        <span className="font-semibold text-sm text-ink truncate">
                                            {acc.account}
                                        </span>
                                        <span
                                            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold font-mono ${
                                                acc.enabled
                                                    ? "bg-accent/10 text-accent"
                                                    : "bg-canvas-soft text-text-muted"
                                            }`}
                                        >
                                            {acc.enabled ? "Active" : "Disabled"}
                                        </span>
                                    </div>
                                    <div className="text-xs text-text-muted font-mono">
                                        ID: <span className="text-ink">{acc.id}</span>
                                    </div>
                                </div>

                                {hasQuotas ? (
                                    <div className="space-y-2">
                                        <QuotaTableView quotas={acc.quotas} dense />
                                    </div>
                                ) : (
                                    <div className="text-xs text-text-muted py-2 font-mono">
                                        No active quotas reported for this account.
                                    </div>
                                )}

                                {hasMetrics && (
                                    <div className="space-y-2 pt-2">
                                        <div className="font-mono text-xs font-medium uppercase tracking-wider text-text-muted">
                                            Usage Consumption History
                                        </div>
                                        <UsageMetricsTable metrics={acc.usageMetrics} />
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </article>
    );
}
