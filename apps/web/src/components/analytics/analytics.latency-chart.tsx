import { formatTime } from "@/utils/format";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import type { AnalyticsBucket } from "@srouter/types";

interface Props {
    buckets: AnalyticsBucket[];
}

export function LatencyChart({ buckets }: Props) {
    const data = buckets
        .filter((b) => b.totalRequests > 0)
        .map((b) => ({
            time: formatTime(b.bucketStart),
            latency: Math.round(b.avgLatencyMs)
        }));

    return (
        <div className="flex flex-col rounded-xl border border-border/60 bg-secondary/10 p-4">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground/80">
                Avg Latency (ms)
            </h3>
            <div className="flex-1 min-h-[200px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={data}>
                        <defs>
                            <linearGradient id="latencyGradient" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.3} />
                                <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
                            </linearGradient>
                        </defs>
                        <XAxis dataKey="time" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                        <YAxis tick={{ fontSize: 10 }} domain={[0, "auto"]} />
                        <Tooltip
                            contentStyle={{
                                backgroundColor: "var(--background)",
                                border: "1px solid var(--border)",
                                borderRadius: "8px",
                                fontSize: "12px"
                            }}
                        />
                        <Area
                            type="monotone"
                            dataKey="latency"
                            stroke="var(--primary)"
                            fill="url(#latencyGradient)"
                            strokeWidth={2}
                        />
                    </AreaChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}
