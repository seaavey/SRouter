import { Shield, Gauge, Zap, Activity } from "lucide-react";

export interface QuotaSummaryMetricsProps {
    totalAccounts: number;
    totalLiveQuotas: number;
    exhaustedQuotas: number;
    totalTokens: number;
    totalRequests: number;
}

export function QuotaSummaryMetrics({
    totalAccounts,
    totalLiveQuotas,
    exhaustedQuotas,
    totalTokens,
    totalRequests
}: QuotaSummaryMetricsProps) {
    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 font-mono">
            {/* 1. Accounts Monitored */}
            <div className="rounded-[10px] border border-[var(--line)] bg-[var(--surface)] p-3.5 flex flex-col justify-between shadow-2xs">
                <div className="flex items-center justify-between text-[11px] text-[var(--ink-3)]">
                    <span>Connected Accounts</span>
                    <Shield className="size-3.5 text-blue-500" />
                </div>
                <div className="mt-2">
                    <div className="text-2xl font-bold tabular-nums text-[var(--ink)]">
                        {totalAccounts}
                    </div>
                    <p className="mt-0.5 text-[10.5px] text-[var(--ink-3)] truncate">
                        {totalAccounts > 0 ? "Active provider credentials" : "No accounts stored"}
                    </p>
                </div>
            </div>

            {/* 2. Live Quota Monitors */}
            <div className="rounded-[10px] border border-[var(--line)] bg-[var(--surface)] p-3.5 flex flex-col justify-between shadow-2xs">
                <div className="flex items-center justify-between text-[11px] text-[var(--ink-3)]">
                    <span>Live Model Quotas</span>
                    <Gauge className="size-3.5 text-amber-500" />
                </div>
                <div className="mt-2">
                    <div className="text-2xl font-bold tabular-nums text-[var(--ink)]">
                        {totalLiveQuotas}
                    </div>
                    <p className="mt-0.5 text-[10.5px] text-[var(--ink-3)] truncate">
                        {exhaustedQuotas > 0 ? (
                            <span className="text-rose-500 font-semibold">
                                {exhaustedQuotas} quota exhausted
                            </span>
                        ) : (
                            "All quotas within limits"
                        )}
                    </p>
                </div>
            </div>

            {/* 3. Total Tokens */}
            <div className="rounded-[10px] border border-[var(--line)] bg-[var(--surface)] p-3.5 flex flex-col justify-between shadow-2xs">
                <div className="flex items-center justify-between text-[11px] text-[var(--ink-3)]">
                    <span>Total Tokens Routed</span>
                    <Zap className="size-3.5 text-emerald-500" />
                </div>
                <div className="mt-2">
                    <div className="text-2xl font-bold tabular-nums text-[var(--ink)]">
                        {totalTokens.toLocaleString()}
                    </div>
                    <p className="mt-0.5 text-[10.5px] text-[var(--ink-3)] truncate">
                        Combined gateway throughput
                    </p>
                </div>
            </div>

            {/* 4. Requests Tracked */}
            <div className="rounded-[10px] border border-[var(--line)] bg-[var(--surface)] p-3.5 flex flex-col justify-between shadow-2xs">
                <div className="flex items-center justify-between text-[11px] text-[var(--ink-3)]">
                    <span>Requests Handled</span>
                    <Activity className="size-3.5 text-purple-500" />
                </div>
                <div className="mt-2">
                    <div className="text-2xl font-bold tabular-nums text-[var(--ink)]">
                        {totalRequests.toLocaleString()}
                    </div>
                    <p className="mt-0.5 text-[10.5px] text-[var(--ink-3)] truncate">
                        Tracked request executions
                    </p>
                </div>
            </div>
        </div>
    );
}
