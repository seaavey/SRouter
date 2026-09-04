import { ChevronDown, RefreshCw, ArrowUpRight } from "lucide-react";
import { Link } from "@tanstack/react-router";
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
    const total_accounts = accounts.length;
    const all_quotas = accounts.flatMap((acc) => acc.quotas || []);

    return (
        <div className="rounded-[12px] border border-[var(--line)] bg-[var(--surface)] p-5 space-y-4 shadow-2xs transition-all font-mono">
            {/* Provider Group Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[var(--line)] pb-3">
                <div
                    onClick={() => onToggleCollapse(groupKey)}
                    className="flex items-center gap-3 cursor-pointer group flex-1 select-none"
                >
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-[8px] border border-[var(--line)] bg-[var(--field)] p-1.5 shadow-2xs group-hover:border-[var(--line-strong)] transition-colors">
                        <ProviderIcon providerId={providerName} className="size-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="text-sm font-bold text-[var(--ink)] group-hover:text-amber-500 transition-colors capitalize">
                                {providerName}
                            </h3>
                            <span className="inline-flex items-center gap-1 rounded-[4px] bg-[var(--field)] border border-[var(--line)] px-1.5 py-0.2 text-[9.5px] font-semibold text-[var(--ink-2)]">
                                {total_accounts} {total_accounts === 1 ? "account" : "accounts"}
                            </span>
                            <span className="inline-flex items-center rounded-[4px] bg-[var(--field)] border border-[var(--line)] px-1.5 py-0.2 text-[9.5px] font-semibold text-[var(--ink-2)]">
                                {all_quotas.length} quotas
                            </span>
                        </div>
                        <p className="text-[11px] text-[var(--ink-3)] mt-0.5">
                            Accounts:{" "}
                            <span className="text-[var(--ink-2)]">
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
                        className="flex size-7 items-center justify-center rounded-[4px] border border-[var(--line)] bg-[var(--field)] text-[var(--ink-3)] group-hover:text-[var(--ink)] transition-colors cursor-pointer shrink-0"
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
                        className="inline-flex items-center gap-1 rounded-[4px] border border-[var(--line)] bg-[var(--field)] hover:bg-[var(--hover)] px-2 py-1 text-[11px] text-[var(--ink-2)] hover:text-[var(--ink)] transition-colors cursor-pointer disabled:opacity-50"
                        title="Refresh this provider"
                    >
                        <RefreshCw className={`size-3 ${isSpinning ? "animate-spin" : ""}`} />
                        <span>Sync</span>
                    </button>

                    <Link
                        to="/providers/$providerId"
                        params={{ providerId: providerName }}
                        className="inline-flex items-center gap-1 text-xs text-amber-500 hover:text-amber-400 transition-colors"
                    >
                        <span>Manage</span>
                        <ArrowUpRight className="size-3.5" />
                    </Link>
                </div>
            </div>

            {/* Collapsible Body */}
            {!isCollapsed && (
                <div className="space-y-6 pt-2 animate-in fade-in-50 duration-150">
                    {accounts.map((acc) => {
                        const has_quotas = acc.quotas && acc.quotas.length > 0;
                        const has_metrics = acc.usageMetrics && acc.usageMetrics.length > 0;

                        return (
                            <div
                                key={acc.id}
                                className="rounded-[10px] border border-[var(--line)] bg-[var(--field)]/25 p-4 space-y-3"
                            >
                                {/* Account Sub-Header */}
                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[var(--line)] pb-2.5">
                                    <div className="flex items-center gap-2 min-w-0">
                                        <div className="size-2 rounded-full bg-amber-500 shrink-0" />
                                        <span className="font-bold text-xs text-[var(--ink)] truncate">
                                            {acc.account}
                                        </span>
                                        <span
                                            className={`inline-flex items-center gap-1 rounded-[4px] px-1.5 py-0.2 text-[9px] font-semibold ${
                                                acc.enabled
                                                    ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30"
                                                    : "bg-[var(--field)] text-[var(--ink-3)]"
                                            }`}
                                        >
                                            {acc.enabled ? "Active" : "Disabled"}
                                        </span>
                                    </div>
                                    <div className="text-[10.5px] text-[var(--ink-3)] font-mono">
                                        ID: <span className="text-[var(--ink-2)]">{acc.id}</span>
                                    </div>
                                </div>

                                {has_quotas ? (
                                    <div className="space-y-2">
                                        <QuotaTableView quotas={acc.quotas} dense />
                                    </div>
                                ) : (
                                    <div className="text-[11px] text-[var(--ink-3)] py-2">
                                        No active quotas reported for this account.
                                    </div>
                                )}

                                {has_metrics && (
                                    <div className="space-y-1.5 pt-2">
                                        <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--ink-3)]">
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
        </div>
    );
}
