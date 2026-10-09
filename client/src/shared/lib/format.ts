/**
 * Formatting shared by every screen. Each helper exists because at least two
 * features need the same rendering of the same server field, and a second copy
 * would drift.
 */

const decimal = new Intl.NumberFormat("en-US")
const compact = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
})

/** Token counts, request counts: grouped digits, never abbreviated below 10k. */
export const count = (value: number) => decimal.format(value)

/**
 * Token counts, request counts: grouped digits, never abbreviated below 10k.
 * The window is a fixed one, so the same total does not render two ways.
 */
export const compactCount = (value: number) =>
  value >= 10_000 ? compact.format(value) : decimal.format(value)

/**
 * Cost in USD. Sub-cent totals keep four decimals because a gateway's daily
 * spend is often fractions of a cent, and rounding to cents would show $0.00
 * for a day that did cost something.
 */
export const cost = (value: number | null, fallback: string) => {
  if (value === null) {
    return fallback
  }

  return `$${value.toFixed(value < 1 ? 4 : 2)}`
}

/** A rate the server already computed as a percentage, to one decimal. */
export const rate = (value: number | null) => {
  if (value === null) {
    return "—"
  }

  // The server reports a ratio (0.02) for `error_rate`; anything already on a
  // 0–100 scale would exceed 1 and must not be multiplied again.
  const percent = value <= 1 ? value * 100 : value

  return `${percent.toFixed(percent < 10 ? 2 : 1)}%`
}

/**
 * A quota percentage. `LiveModelQuotaItem` carries both a formatted
 * `percentage` string and a numeric `percentage_value`; the numeric one is used
 * so the gauge and its label can never disagree.
 */
export const quotaPercent = (value: number) => `${Math.round(value)}%`

/** Milliseconds as a human duration. Sub-second stays in milliseconds. */
export const duration = (ms: number) => {
  if (ms < 1000) {
    return `${Math.round(ms)} ms`
  }

  const seconds = ms / 1000
  if (seconds < 60) {
    return `${seconds.toFixed(seconds < 10 ? 1 : 0)} s`
  }

  const minutes = Math.floor(seconds / 60)
  const remainder = Math.round(seconds % 60)

  return `${minutes}m ${remainder}s`
}

/** A request timestamp, as the local wall clock time. */
export const clock = (ms: number) =>
  new Date(ms).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })

/** A request timestamp with its date, for anything older than today. */
export const dateTime = (ms: number) =>
  new Date(ms).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })

/** An axis label for an analytics bucket, at the window's own resolution. */
export const bucketLabel = (ms: number, bucketSizeMs: number) =>
  bucketSizeMs >= 86_400_000
    ? new Date(ms).toLocaleDateString([], { month: "short", day: "numeric" })
    : new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })

/**
 * A chart's edge label. A 24-hour window of hourly buckets starts and ends at
 * the same wall-clock time, so the two edges would read identically; the date
 * is added when the window spans more than a day.
 */
export const axisEdgeLabel = (ms: number, bucketSizeMs: number, spanMs: number) => {
  const time = bucketLabel(ms, bucketSizeMs)

  return spanMs >= 86_400_000
    ? `${new Date(ms).toLocaleDateString([], { month: "short", day: "numeric" })} ${time}`
    : time
}

/** A model identifier for display: the provider prefix is noise in a list. */
export const modelName = (model: string | null) => {
  if (model === null || model.length === 0) {
    return "—"
  }

  const slash = model.indexOf("/")
  return slash === -1 ? model : model.slice(slash + 1)
}
