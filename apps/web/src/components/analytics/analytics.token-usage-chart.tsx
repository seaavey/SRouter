import { formatTime, formatTimeUnit } from "@/utils/format";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts";
import type { TooltipValueType } from "recharts";
import type { AnalyticsBucket } from "@srouter/types";

interface Props {
    buckets: AnalyticsBucket[];
    bucketSizeMs: number;
}

export function TokenUsageChart({ buckets, bucketSizeMs }: Props) {
    const data = buckets.map((b) => ({
        time: formatTime(b.bucketStart, bucketSizeMs),
        input: b.promptTokens ?? 0,
        output: b.completionTokens ?? 0,
        cached: b.cachedTokens ?? 0
    }));

    const bucketLabel = formatTimeUnit(bucketSizeMs);

    return (
        <article className="flex flex-col rounded-3xl border border-hairline-soft bg-canvas p-6 shadow-none transition-colors hover:border-hairline font-sans">
            <div className="flex items-center justify-between mb-4">
                <div>
                    <h3 className="text-sm font-semibold text-ink font-sans">Token Consumption.</h3>
                    <p className="text-xs text-text-muted mt-0.5 font-sans">
                        Aggregated volume across prompt, completion, and cache hits
                    </p>
                </div>
                <span className="rounded-full bg-canvas-soft px-3 py-1 font-mono text-[11px] font-medium text-text-muted">
                    tokens/{bucketLabel}
                </span>
            </div>
            <div className="min-h-[280px] w-full">
                <ResponsiveContainer width="100%" height={280}>
                    <AreaChart data={data}>
                        <defs>
                            <linearGradient id="inputTokenGradient" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.2} />
                                <stop offset="100%" stopColor="var(--accent)" stopOpacity={0.0} />
                            </linearGradient>
                            <linearGradient id="outputTokenGradient" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="var(--ink)" stopOpacity={0.15} />
                                <stop offset="100%" stopColor="var(--ink)" stopOpacity={0.0} />
                            </linearGradient>
                            <linearGradient id="cachedTokenGradient" x1="0" y1="0" x2="0" y2="1">
                                <stop
                                    offset="0%"
                                    stopColor="var(--text-muted)"
                                    stopOpacity={0.15}
                                />
                                <stop
                                    offset="100%"
                                    stopColor="var(--text-muted)"
                                    stopOpacity={0.0}
                                />
                            </linearGradient>
                        </defs>
                        <XAxis
                            dataKey="time"
                            tick={{
                                fontSize: 11,
                                fill: "var(--text-muted)",
                                fontFamily: "var(--font-mono)"
                            }}
                            tickLine={false}
                            axisLine={{ stroke: "var(--hairline-soft)" }}
                            interval="preserveStartEnd"
                        />
                        <YAxis
                            tick={{
                                fontSize: 11,
                                fill: "var(--text-muted)",
                                fontFamily: "var(--font-mono)"
                            }}
                            tickLine={false}
                            axisLine={false}
                            domain={[0, "auto"]}
                            tickFormatter={(val) =>
                                val >= 1_000_000
                                    ? `${(val / 1_000_000).toFixed(1)}M`
                                    : val >= 1_000
                                      ? `${Math.round(val / 1_000)}k`
                                      : val
                            }
                        />
                        <Tooltip
                            contentStyle={{
                                backgroundColor: "var(--canvas)",
                                borderColor: "var(--hairline-soft)",
                                borderRadius: "16px",
                                padding: "12px 14px",
                                boxShadow: "none",
                                fontSize: "12px",
                                fontFamily: "var(--font-mono)",
                                color: "var(--ink)"
                            }}
                            formatter={(
                                value: TooltipValueType | undefined,
                                name: string | number | undefined
                            ) => [`${Number(value ?? 0).toLocaleString()} tokens`, name]}
                        />
                        <Legend
                            wrapperStyle={{
                                fontSize: "12px",
                                fontFamily: "var(--font-sans)",
                                color: "var(--text-muted)",
                                paddingTop: "14px"
                            }}
                        />
                        <Area
                            type="monotone"
                            dataKey="input"
                            stackId="tokens"
                            stroke="var(--accent)"
                            fill="url(#inputTokenGradient)"
                            strokeWidth={2}
                            name="Input (Prompt)"
                        />
                        <Area
                            type="monotone"
                            dataKey="output"
                            stackId="tokens"
                            stroke="var(--ink)"
                            fill="url(#outputTokenGradient)"
                            strokeWidth={2}
                            name="Output (Completion)"
                        />
                        <Area
                            type="monotone"
                            dataKey="cached"
                            stackId="tokens"
                            stroke="var(--text-muted)"
                            fill="url(#cachedTokenGradient)"
                            strokeWidth={2}
                            name="Cached"
                        />
                    </AreaChart>
                </ResponsiveContainer>
            </div>
        </article>
    );
}
