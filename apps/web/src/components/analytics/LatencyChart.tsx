import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import type { AnalyticsBucket } from "@srouter/types";

interface Props {
    buckets: AnalyticsBucket[];
}

export function LatencyChart({ buckets }: Props) {
    const data = buckets.map((b) => ({
        time: new Date(b.bucketStart).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        latency: Math.round(b.avgLatencyMs)
    }));

    return (
        <div className="rounded-xl border border-border/60 bg-secondary/10 p-4">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground/80">
                Avg Latency (ms)
            </h3>
            <ResponsiveContainer width="100%" height={160}>
                <AreaChart data={data}>
                    <defs>
                        <linearGradient id="latencyGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.3} />
                            <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
                        </linearGradient>
                    </defs>
                    <XAxis dataKey="time" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 10 }} />
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
    );
}