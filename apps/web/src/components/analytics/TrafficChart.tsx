import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts";
import type { AnalyticsBucket } from "@srouter/types";

interface Props {
    buckets: AnalyticsBucket[];
    bucketSizeMs: number;
}

export function TrafficChart({ buckets, bucketSizeMs }: Props) {
    const data = buckets.map((b) => ({
        time: new Date(b.bucketStart).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        success: b.successRequests,
        error: b.errorRequests
    }));

    const bucketLabel = bucketSizeMs >= 86_400_000 ? "day" : bucketSizeMs >= 3_600_000 ? "hour" : "min";

    return (
        <div className="rounded-xl border border-border/60 bg-secondary/10 p-4">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground/80">
                Traffic (req/{bucketLabel})
            </h3>
            <ResponsiveContainer width="100%" height={200}>
                <BarChart data={data} stackOffset="sign">
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
                    <Legend wrapperStyle={{ fontSize: "11px" }} />
                    <Bar dataKey="success" stackId="a" fill="var(--primary)" name="Success" />
                    <Bar dataKey="error" stackId="a" fill="var(--destructive)" name="Error" />
                </BarChart>
            </ResponsiveContainer>
        </div>
    );
}