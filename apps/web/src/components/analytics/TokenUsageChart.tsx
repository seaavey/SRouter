import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts";
import type { TooltipValueType } from "recharts";
import type { AnalyticsBucket } from "@srouter/types";

interface Props {
    buckets: AnalyticsBucket[];
    bucketSizeMs: number;
}

export function TokenUsageChart({ buckets, bucketSizeMs }: Props) {
    const data = buckets.map((b) => ({
        time: new Date(b.bucketStart).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit"
        }),
        input: b.promptTokens ?? 0,
        output: b.completionTokens ?? 0,
        cached: b.cachedTokens ?? 0
    }));

    const bucketLabel =
        bucketSizeMs >= 86_400_000 ? "day" : bucketSizeMs >= 3_600_000 ? "hour" : "min";

    return (
        <div className="flex flex-col rounded-xl border border-border/60 bg-secondary/10 p-4">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground/80">
                Token Usage (tokens/{bucketLabel})
            </h3>
            <div className="flex-1 min-h-[200px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={data}>
                        <defs>
                            <linearGradient id="inputTokenGradient" x1="0" y1="0" x2="0" y2="1">
                                <stop
                                    offset="0%"
                                    stopColor="oklch(0.65 0.18 245)"
                                    stopOpacity={0.35}
                                />
                                <stop
                                    offset="100%"
                                    stopColor="oklch(0.65 0.18 245)"
                                    stopOpacity={0.02}
                                />
                            </linearGradient>
                            <linearGradient id="outputTokenGradient" x1="0" y1="0" x2="0" y2="1">
                                <stop
                                    offset="0%"
                                    stopColor="oklch(0.72 0.18 150)"
                                    stopOpacity={0.35}
                                />
                                <stop
                                    offset="100%"
                                    stopColor="oklch(0.72 0.18 150)"
                                    stopOpacity={0.02}
                                />
                            </linearGradient>
                            <linearGradient id="cachedTokenGradient" x1="0" y1="0" x2="0" y2="1">
                                <stop
                                    offset="0%"
                                    stopColor="oklch(0.78 0.16 75)"
                                    stopOpacity={0.35}
                                />
                                <stop
                                    offset="100%"
                                    stopColor="oklch(0.78 0.16 75)"
                                    stopOpacity={0.02}
                                />
                            </linearGradient>
                        </defs>
                        <XAxis dataKey="time" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                        <YAxis
                            tick={{ fontSize: 10 }}
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
                                backgroundColor: "var(--background)",
                                border: "1px solid var(--border)",
                                borderRadius: "8px",
                                fontSize: "12px"
                            }}
                            formatter={(value: TooltipValueType | undefined, name: string | number | undefined) => [
                                `${Number(value ?? 0).toLocaleString()} tokens`,
                                name
                            ]}
                        />
                        <Legend wrapperStyle={{ fontSize: "11px" }} />
                        <Area
                            type="monotone"
                            dataKey="input"
                            stackId="tokens"
                            stroke="oklch(0.65 0.18 245)"
                            fill="url(#inputTokenGradient)"
                            strokeWidth={2}
                            name="Input (Prompt)"
                        />
                        <Area
                            type="monotone"
                            dataKey="output"
                            stackId="tokens"
                            stroke="oklch(0.72 0.18 150)"
                            fill="url(#outputTokenGradient)"
                            strokeWidth={2}
                            name="Output (Completion)"
                        />
                        <Area
                            type="monotone"
                            dataKey="cached"
                            stackId="tokens"
                            stroke="oklch(0.78 0.16 75)"
                            fill="url(#cachedTokenGradient)"
                            strokeWidth={2}
                            name="Cached"
                        />
                    </AreaChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}
