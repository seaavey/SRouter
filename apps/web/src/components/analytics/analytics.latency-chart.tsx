import { formatDuration, formatTime } from "@/utils/format";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import type { AnalyticsBucket } from "@srouter/types";

interface Props {
    buckets: AnalyticsBucket[];
    bucketSizeMs: number;
}

export function LatencyChart({ buckets, bucketSizeMs }: Props) {
    const data = buckets
        .filter((b) => b.totalRequests > 0)
        .map((b) => ({
            time: formatTime(b.bucketStart, bucketSizeMs),
            latency: Math.round(b.avgLatencyMs)
        }));

    return (
        <article className="flex flex-col rounded-3xl border border-hairline-soft bg-canvas p-6 shadow-none transition-colors hover:border-hairline font-sans">
            <div className="flex items-center justify-between mb-4">
                <div>
                    <h3 className="text-sm font-semibold text-ink font-sans">
                        Latency Distribution.
                    </h3>
                    <p className="text-xs text-text-muted mt-0.5 font-sans">
                        Average upstream response duration
                    </p>
                </div>
                <span className="rounded-full bg-canvas-soft px-3 py-1 font-mono text-[11px] font-medium text-text-muted">
                    avg ms
                </span>
            </div>
            <div className="min-h-[260px] w-full">
                <ResponsiveContainer width="100%" height={260}>
                    <AreaChart data={data}>
                        <defs>
                            <linearGradient id="latencyGradient" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.18} />
                                <stop offset="100%" stopColor="var(--accent)" stopOpacity={0.0} />
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
                            tickFormatter={formatDuration}
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
                            formatter={(val: unknown) => [
                                formatDuration(Number(val ?? 0)),
                                "Avg Latency"
                            ]}
                        />
                        <Area
                            type="monotone"
                            dataKey="latency"
                            stroke="var(--accent)"
                            fill="url(#latencyGradient)"
                            strokeWidth={2}
                            name="Avg Latency"
                        />
                    </AreaChart>
                </ResponsiveContainer>
            </div>
        </article>
    );
}
