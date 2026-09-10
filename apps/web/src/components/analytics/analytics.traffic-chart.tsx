import { formatTime, formatTimeUnit } from "@/utils/format";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts";
import type { AnalyticsBucket } from "@srouter/types";

interface Props {
    buckets: AnalyticsBucket[];
    bucketSizeMs: number;
}

export function TrafficChart({ buckets, bucketSizeMs }: Props) {
    const data = buckets.map((b) => ({
        time: formatTime(b.bucketStart),
        success: b.successRequests,
        error: b.errorRequests
    }));

    const bucketLabel = formatTimeUnit(bucketSizeMs);

    return (
        <article className="flex flex-col rounded-3xl border border-hairline-soft bg-canvas p-6 shadow-none transition-colors hover:border-hairline font-sans">
            <div className="flex items-center justify-between mb-4">
                <div>
                    <h3 className="text-sm font-semibold text-ink font-sans">Traffic Flow.</h3>
                    <p className="text-xs text-text-muted mt-0.5 font-sans">
                        Request throughput per {bucketLabel} interval
                    </p>
                </div>
                <span className="rounded-full bg-canvas-soft px-3 py-1 font-mono text-[11px] font-medium text-text-muted">
                    req/{bucketLabel}
                </span>
            </div>
            <div className="min-h-[260px] w-full">
                <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={data} stackOffset="sign">
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
                            cursor={{ fill: "var(--canvas-soft)", opacity: 0.6 }}
                        />
                        <Legend
                            wrapperStyle={{
                                fontSize: "12px",
                                fontFamily: "var(--font-sans)",
                                color: "var(--text-muted)",
                                paddingTop: "12px"
                            }}
                        />
                        <Bar
                            dataKey="success"
                            stackId="a"
                            fill="var(--ink)"
                            name="Success"
                            radius={[2, 2, 0, 0]}
                        />
                        <Bar
                            dataKey="error"
                            stackId="a"
                            fill="#ef4444"
                            name="Error"
                            radius={[2, 2, 0, 0]}
                        />
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </article>
    );
}
