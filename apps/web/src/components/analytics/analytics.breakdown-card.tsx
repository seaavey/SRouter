import { useState } from "react";
import { ProviderIcon } from "@/components/providers";
import { AgentBadgeIcon } from "./analytics.agent-icons";
import { parseUserAgent } from "@/utils/agent-detector";
import type { AnalyticsTopModel, AnalyticsProviderSlice, AnalyticsTopAgent } from "@srouter/types";

interface Props {
    models: AnalyticsTopModel[];
    providers: AnalyticsProviderSlice[];
    agents?: AnalyticsTopAgent[];
    totalRequests: number;
}

function parseModelIdentifier(model: string): { provider: string; name: string } {
    const slashIdx = model.indexOf("/");
    if (slashIdx !== -1) {
        return { provider: model.slice(0, slashIdx), name: model.slice(slashIdx + 1) };
    }
    const lower = model.toLowerCase();
    if (
        lower.startsWith("gpt") ||
        lower.startsWith("o1") ||
        lower.startsWith("o3") ||
        lower.startsWith("text-embedding")
    ) {
        return { provider: "openai", name: model };
    }
    if (lower.startsWith("claude")) {
        return { provider: "anthropic", name: model };
    }
    if (lower.startsWith("gemini")) {
        return { provider: "gemini", name: model };
    }
    if (lower.startsWith("deepseek")) {
        return { provider: "deepseek", name: model };
    }
    return { provider: model, name: model };
}

type TabType = "models" | "agents" | "providers";

export function BreakdownTabsCard({ models, providers, agents = [], totalRequests }: Props) {
    const [activeTab, setActiveTab] = useState<TabType>("models");

    const aggregatedAgents = new Map<
        string,
        { agentName: string; totalRequests: number; totalTokens: number }
    >();
    for (const item of agents) {
        const parsed = parseUserAgent(item.rawUserAgent || item.agent);
        const key = parsed.name;
        const existing = aggregatedAgents.get(key) || {
            agentName: key,
            totalRequests: 0,
            totalTokens: 0
        };
        existing.totalRequests += item.totalRequests;
        existing.totalTokens += item.totalTokens;
        aggregatedAgents.set(key, existing);
    }
    const sortedAgents = Array.from(aggregatedAgents.values()).sort(
        (a, b) => b.totalRequests - a.totalRequests
    );

    return (
        <article className="rounded-3xl border border-hairline-soft bg-canvas p-6 shadow-none transition-colors hover:border-hairline font-sans space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-hairline-soft pb-4">
                <div>
                    <h3 className="text-base font-bold text-ink font-sans">
                        Breakdown & Distribution.
                    </h3>
                    <p className="text-xs text-text-muted mt-0.5 font-sans">
                        Categorized telemetry across models, coding clients, and upstream providers.
                    </p>
                </div>

                <div className="inline-flex items-center gap-1 rounded-full bg-canvas-soft p-1 border-0 self-start sm:self-auto">
                    <button
                        type="button"
                        onClick={() => setActiveTab("models")}
                        className={`rounded-full px-4 py-1.5 text-xs font-medium transition-all cursor-pointer ${
                            activeTab === "models"
                                ? "bg-canvas text-ink font-semibold shadow-none"
                                : "text-text-muted hover:text-ink hover:bg-canvas/50"
                        }`}
                    >
                        Models ({models.length})
                    </button>
                    <button
                        type="button"
                        onClick={() => setActiveTab("agents")}
                        className={`rounded-full px-4 py-1.5 text-xs font-medium transition-all cursor-pointer ${
                            activeTab === "agents"
                                ? "bg-canvas text-ink font-semibold shadow-none"
                                : "text-text-muted hover:text-ink hover:bg-canvas/50"
                        }`}
                    >
                        Agents ({sortedAgents.length})
                    </button>
                    <button
                        type="button"
                        onClick={() => setActiveTab("providers")}
                        className={`rounded-full px-4 py-1.5 text-xs font-medium transition-all cursor-pointer ${
                            activeTab === "providers"
                                ? "bg-canvas text-ink font-semibold shadow-none"
                                : "text-text-muted hover:text-ink hover:bg-canvas/50"
                        }`}
                    >
                        Providers ({providers.length})
                    </button>
                </div>
            </div>
            <div className="divide-y divide-hairline-soft">
                {activeTab === "models" &&
                    (models.length === 0 ? (
                        <p className="text-xs text-text-muted py-8 text-center font-mono">
                            No model requests recorded in this window.
                        </p>
                    ) : (
                        models.map((m) => {
                            const { provider, name } = parseModelIdentifier(m.model);
                            const share =
                                totalRequests > 0 ? (m.totalRequests / totalRequests) * 100 : 0;
                            return (
                                <div key={m.model} className="py-3.5 flex items-center gap-3.5">
                                    <div className="flex size-9 shrink-0 items-center justify-center rounded-2xl border border-hairline-soft bg-field p-1.5">
                                        <ProviderIcon providerId={provider} className="size-5" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-baseline justify-between gap-2">
                                            <span className="text-xs font-semibold text-ink truncate">
                                                {name}
                                            </span>
                                            <span className="text-xs font-mono text-text-muted tabular-nums whitespace-nowrap">
                                                {m.totalRequests.toLocaleString()} req{" "}
                                                <span className="text-text-faint">
                                                    ({share.toFixed(1)}%)
                                                </span>
                                            </span>
                                        </div>
                                        <div className="mt-1.5 h-1.5 w-full rounded-full bg-canvas-soft overflow-hidden">
                                            <div
                                                className="h-full rounded-full bg-accent transition-all duration-300"
                                                style={{ width: `${Math.max(share, 1.5)}%` }}
                                            />
                                        </div>
                                        <div className="flex justify-between text-[11px] font-mono text-text-muted mt-1">
                                            <span className="capitalize">{provider}</span>
                                            <span>{m.totalTokens.toLocaleString()} tokens</span>
                                        </div>
                                    </div>
                                </div>
                            );
                        })
                    ))}

                {activeTab === "agents" &&
                    (sortedAgents.length === 0 ? (
                        <p className="text-xs text-text-muted py-8 text-center font-mono">
                            No agent telemetry recorded in this window.
                        </p>
                    ) : (
                        sortedAgents.map((item) => {
                            const share =
                                totalRequests > 0 ? (item.totalRequests / totalRequests) * 100 : 0;
                            return (
                                <div
                                    key={item.agentName}
                                    className="py-3.5 flex items-center gap-3.5"
                                >
                                    <div className="flex size-9 shrink-0 items-center justify-center rounded-2xl border border-hairline-soft bg-field p-1.5">
                                        <AgentBadgeIcon
                                            agentName={item.agentName}
                                            className="size-4"
                                        />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-baseline justify-between gap-2">
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
                                        <div className="flex justify-between text-[11px] font-mono text-text-muted mt-1">
                                            <span>Coding Client</span>
                                            <span>
                                                {item.totalTokens.toLocaleString()} tokens routed
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            );
                        })
                    ))}

                {activeTab === "providers" &&
                    (providers.length === 0 ? (
                        <p className="text-xs text-text-muted py-8 text-center font-mono">
                            No provider requests recorded in this window.
                        </p>
                    ) : (
                        providers.map((p) => {
                            const share =
                                totalRequests > 0 ? (p.totalRequests / totalRequests) * 100 : 0;
                            return (
                                <div
                                    key={p.providerId}
                                    className="py-3.5 flex items-center gap-3.5"
                                >
                                    <div className="flex size-9 shrink-0 items-center justify-center rounded-2xl border border-hairline-soft bg-field p-1.5">
                                        <ProviderIcon
                                            providerId={p.providerId}
                                            className="size-5"
                                        />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-baseline justify-between gap-2">
                                            <span className="text-xs font-semibold text-ink capitalize truncate">
                                                {p.providerId}
                                            </span>
                                            <span className="text-xs font-mono text-text-muted tabular-nums whitespace-nowrap">
                                                {p.totalRequests.toLocaleString()} req{" "}
                                                <span className="text-text-faint">
                                                    ({share.toFixed(1)}%)
                                                </span>
                                            </span>
                                        </div>
                                        <div className="mt-1.5 h-1.5 w-full rounded-full bg-canvas-soft overflow-hidden">
                                            <div
                                                className="h-full rounded-full bg-accent transition-all duration-300"
                                                style={{ width: `${Math.max(share, 1.5)}%` }}
                                            />
                                        </div>
                                        <div className="flex justify-between text-[11px] font-mono text-text-muted mt-1">
                                            <span>Upstream Target</span>
                                            <span>{share.toFixed(1)}% traffic share</span>
                                        </div>
                                    </div>
                                </div>
                            );
                        })
                    ))}
            </div>
        </article>
    );
}
