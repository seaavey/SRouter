import { Gauge, GaugeArc, GaugeTrack, GaugeValue } from "@/shared/components/gauge"
import { quotaPercent } from "@/shared/lib/format"

/**
 * A quota window as a dial.
 *
 * `LiveModelQuotaItem` reports `percentage_value` on a 0–100 scale and a
 * `status` the server already decided, so the dial draws that number and colors
 * the arc from the same three states the badge uses. Threshold bands are
 * deliberately absent: the status is the server's judgement, and drawing a
 * second, invented set of cutoffs beside it would invite the two to disagree.
 */

const statusColor = {
  ok: "var(--success)",
  warning: "var(--warning)",
  exhausted: "var(--destructive)",
} as const

export function QuotaGauge({
  label,
  used,
  limit,
  percentage,
  status,
  resetIn,
}: {
  label: string
  used: number
  limit: number
  percentage: number
  status: "ok" | "warning" | "exhausted"
  resetIn: string
}) {
  return (
    <div className="flex flex-col items-center gap-1">
      <Gauge
        value={percentage}
        min={0}
        max={100}
        startAngle={220}
        endAngle={500}
        radius={62}
        padding={12}
        className="h-28 w-28"
      >
        <GaugeTrack width={10} opacity={0.14} />
        <GaugeArc width={10} color={statusColor[status]} />
        <GaugeValue
          fontSize={28}
          weight="semibold"
          y={-6}
          format={(value) => quotaPercent(value)}
        />
        {/* The used/limit pair sits below the arc's centre, clear of the
            percentage; at this radius the two would overlap if centred. */}
        <GaugeValue
          fontSize={12}
          weight="regular"
          color="var(--muted-foreground)"
          y={22}
          format={() => `${used.toLocaleString()} / ${limit.toLocaleString()}`}
        />
      </Gauge>

      <div className="flex flex-col items-center gap-0.5">
        <span className="font-mono text-[0.6875rem]">{label}</span>
        <span className="text-muted-foreground text-[0.625rem]">resets in {resetIn}</span>
      </div>
    </div>
  )
}
