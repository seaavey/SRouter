import { useQuery } from "@tanstack/react-query";
import { Activity } from "lucide-react";
import { api } from "@/lib/api";
import { formatCompactNumber } from "@/lib/utils";
import type { RequestLogEntry } from "@srouter/types";
import type { ListResponse } from "@/lib/types";

function formatTimeAgo(timestamp: number): string {
    const diffSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
    if (diffSeconds < 10) return "just now";
    if (diffSeconds < 60) return `${diffSeconds}s ago`;
    const diffMinutes = Math.floor(diffSeconds / 60);
    if (diffMinutes < 60) return `${diffMinutes}m ago`;
    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${Math.floor(diffHours / 24)}d ago`;
}

export function RecentRequestsFeed() {
    const { data, isLoading } = useQuery({
        queryKey: ["recent-logs-feed"],
        queryFn: () => api.get<ListResponse<RequestLogEntry>>("/v1/logs?limit=6"),
        refetchInterval: 3000,
        refetchIntervalInBackground: false
    });

    const logs = data?.data ?? [];

    return (
        <section
            aria-label="Recent Requests"
            className="flex h-full min-w-0 flex-col justify-between rounded-3xl border border-hairline-soft bg-canvas p-4 shadow-none sm:p-5 lg:p-6"
        >
            <div>
                <header className="flex items-center justify-between gap-3 border-b border-hairline-soft pb-4">
                    <div className="flex min-w-0 items-center gap-3">
                        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-canvas-soft text-ink">
                            <Activity className="size-4" strokeWidth={1.75} />
                        </div>
                        <div className="min-w-0">
                            <h2 className="font-heading text-base font-semibold text-ink">
                                Recent Requests.
                            </h2>
                            <p className="truncate text-xs text-text-muted">
                                Live gateway dispatch stream
                            </p>
                        </div>
                    </div>
                </header>
                <div className="mt-4">
                    {isLoading ? (
                        <div className="space-y-3 py-2">
                            {Array.from({ length: 5 }).map((_, i) => (
                                <div
                                    key={i}
                                    className="flex items-center justify-between gap-3 rounded-2xl p-2.5"
                                >
                                    <div className="flex items-center gap-2.5">
                                        <div className="size-2 animate-pulse rounded-full bg-field" />
                                        <div className="h-4 w-28 animate-pulse rounded bg-field" />
                                    </div>
                                    <div className="h-4 w-16 animate-pulse rounded bg-field" />
                                </div>
                            ))}
                        </div>
                    ) : logs.length === 0 ? (
                        <div className="flex min-h-[220px] flex-col items-center justify-center text-center">
                            <span className="size-2 rounded-full bg-text-faint/60 mb-2" />
                            <p className="text-xs font-medium text-ink">
                                No requests recorded yet.
                            </p>
                            <p className="mt-0.5 max-w-[220px] text-[11px] text-text-muted">
                                Telemetry entries will appear here once the gateway receives
                                traffic.
                            </p>
                        </div>
                    ) : (
                        <div className="divide-y divide-hairline-soft">
                            {logs.map((log) => {
                                const isSuccess = log.statusCode >= 200 && log.statusCode < 300;
                                return (
                                    <div
                                        key={log.id}
                                        className="flex items-center justify-between gap-3 py-3 first:pt-1 last:pb-1"
                                    >
                                        <div className="flex min-w-0 items-center gap-2.5">
                                            <span
                                                className={`size-2 shrink-0 rounded-full ${
                                                    isSuccess ? "bg-emerald-500" : "bg-rose-500"
                                                }`}
                                                title={`HTTP ${log.statusCode}`}
                                                aria-label={`Status ${log.statusCode}`}
                                            />
                                            <div className="min-w-0">
                                                <p
                                                    className="truncate font-sans text-sm font-medium text-ink"
                                                    title={log.model}
                                                >
                                                    {log.model}
                                                </p>
                                                <p className="font-mono text-xs text-text-muted">
                                                    {formatCompactNumber(log.promptTokens)} in ·{" "}
                                                    {formatCompactNumber(log.completionTokens)} out
                                                </p>
                                            </div>
                                        </div>

                                        <div className="flex shrink-0 flex-col items-end gap-0.5">
                                            <span className="font-mono text-xs text-text-faint">
                                                {formatTimeAgo(log.createdAt)}
                                            </span>
                                            {log.latencyMs !== undefined && (
                                                <span className="font-mono text-[11px] text-text-faint/80">
                                                    {log.latencyMs}ms
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </section>
    );
}
