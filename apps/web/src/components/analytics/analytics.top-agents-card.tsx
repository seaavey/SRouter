import type { AnalyticsTopAgent } from "@srouter/types";
import { AgentBadgeIcon } from "./analytics.agent-icons";
import { parseUserAgent } from "@/utils/agent-detector";

interface Props {
    agents?: AnalyticsTopAgent[];
    totalRequests: number;
}

export function TopCodingAgentsCard({ agents = [], totalRequests }: Props) {
    if (!agents || agents.length === 0) {
        return (
            <article className="rounded-3xl border border-hairline-soft bg-canvas p-6 shadow-none font-sans">
                <h3 className="text-sm font-semibold text-ink font-sans">Top Coding Agents.</h3>
                <p className="mt-3 text-xs text-text-muted font-mono">
                    No agent telemetry recorded in this window.
                </p>
            </article>
        );
    }

    const aggregated = new Map<
        string,
        { agentName: string; totalRequests: number; totalTokens: number }
    >();
    for (const item of agents) {
        const parsed = parseUserAgent(item.rawUserAgent || item.agent);
        const key = parsed.name;
        const existing = aggregated.get(key) || {
            agentName: key,
            totalRequests: 0,
            totalTokens: 0
        };
        existing.totalRequests += item.totalRequests;
        existing.totalTokens += item.totalTokens;
        aggregated.set(key, existing);
    }

    const sortedList = Array.from(aggregated.values()).sort(
        (a, b) => b.totalRequests - a.totalRequests
    );

    return (
        <article className="rounded-3xl border border-hairline-soft bg-canvas p-6 shadow-none transition-colors hover:border-hairline font-sans space-y-4">
            <div className="flex items-center justify-between border-b border-hairline-soft pb-3">
                <div>
                    <h3 className="text-sm font-semibold text-ink font-sans">Top Coding Agents.</h3>
                    <p className="text-xs text-text-muted mt-0.5 font-sans">
                        Telemetry classified by User-Agent header
                    </p>
                </div>
            </div>

            <div className="divide-y divide-hairline-soft">
                {sortedList.map((item) => {
                    const share =
                        totalRequests > 0 ? (item.totalRequests / totalRequests) * 100 : 0;
                    return (
                        <div key={item.agentName} className="py-3 flex items-center gap-3">
                            <div className="flex size-9 shrink-0 items-center justify-center rounded-2xl border border-hairline-soft bg-field p-1.5">
                                <AgentBadgeIcon agentName={item.agentName} className="size-4" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between gap-2">
                                    <span className="text-xs font-semibold text-ink truncate">
                                        {item.agentName}
                                    </span>
                                    <span className="text-xs font-mono text-text-muted tabular-nums whitespace-nowrap">
                                        {item.totalRequests.toLocaleString()} req{" "}
                                        <span className="text-text-faint">
                                            ({share.toFixed(1)}%)
                                        </span>
                                    </span>
                                </div>
                                <div className="mt-1.5 h-1.5 w-full rounded-full bg-canvas-soft overflow-hidden">
                                    <div
                                        className="h-full rounded-full bg-ink transition-all duration-300"
                                        style={{ width: `${Math.max(share, 1.5)}%` }}
                                    />
                                </div>
                                <div className="flex justify-between text-[10.5px] font-mono text-text-muted mt-1">
                                    <span>{item.totalTokens.toLocaleString()} tokens routed</span>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </article>
    );
}
