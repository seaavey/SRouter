import type { AnalyticsBucket } from "@/shared/api/types"
import { axisEdgeLabel, bucketLabel, compactCount, duration } from "@/shared/lib/format"

/**
 * Traffic over the analytics window: one column per bucket, stacked so the
 * failed share is visible inside the total rather than beside it.
 *
 * Hand-drawn rather than pulled from a chart library: the whole figure is
 * `total_requests` split two ways over at most 60 buckets, and a dependency
 * would cost more than it explains. The geometry follows the rules in
 * `client/DESIGN.md` — a zero baseline, one documented scale for every column,
 * and no mark drawn without a value behind it.
 */

const HEIGHT = 140
const GAP = 2
const MIN_BAR = 2

export function TrafficChart({
  buckets,
  bucketSizeMs,
  className,
}: {
  buckets: AnalyticsBucket[]
  bucketSizeMs: number
  className?: string
}) {
  if (buckets.length === 0) {
    return null
  }

  // Every column shares one scale, taken from the busiest bucket. A per-column
  // scale would make an idle hour look as tall as a busy one.
  const peak = Math.max(...buckets.map((bucket) => bucket.total_requests), 1)

  const busiest = buckets.reduce((most, bucket) =>
    bucket.total_requests > most.total_requests ? bucket : most
  )

  // The window's own span decides whether the edge labels need a date: an
  // hourly series that starts and ends at the same clock time would otherwise
  // print the same label twice.
  const spanMs =
    buckets[buckets.length - 1].bucket_start - buckets[0].bucket_start

  return (
    <div className={className}>
      <div
        className="flex items-end gap-[2px]"
        style={{ height: HEIGHT }}
        role="img"
        aria-label={`Requests per ${bucketSizeMs >= 86_400_000 ? "day" : "bucket"} over the window. Peak ${busiest.total_requests} at ${bucketLabel(busiest.bucket_start, bucketSizeMs)}.`}
      >
        {buckets.map((bucket) => {
          const totalHeight = (bucket.total_requests / peak) * HEIGHT
          const errorHeight =
            bucket.total_requests === 0
              ? 0
              : (bucket.error_requests / bucket.total_requests) * totalHeight

          return (
            <div
              key={bucket.bucket_start}
              className="group relative flex flex-1 flex-col justify-end"
              style={{ minWidth: MIN_BAR, gap: GAP }}
              title={`${bucketLabel(bucket.bucket_start, bucketSizeMs)} · ${bucket.total_requests} requests · ${bucket.error_requests} failed · p95 ${duration(bucket.avg_latency_ms ?? 0)} avg`}
            >
              {/* The failed share sits on top, in the destructive token. */}
              <div
                className="w-full rounded-t-[2px] bg-destructive"
                style={{ height: errorHeight }}
              />
              <div
                className="w-full rounded-t-[2px] bg-chart-3"
                style={{ height: Math.max(totalHeight - errorHeight, 0) }}
              />
            </div>
          )
        })}
      </div>

      <div className="text-muted-foreground mt-2 flex justify-between text-[0.625rem] tabular-nums">
        <span>{axisEdgeLabel(buckets[0].bucket_start, bucketSizeMs, spanMs)}</span>
        <span>peak {compactCount(busiest.total_requests)}</span>
        <span>
          {axisEdgeLabel(
            buckets[buckets.length - 1].bucket_start,
            bucketSizeMs,
            spanMs
          )}
        </span>
      </div>
    </div>
  )
}
