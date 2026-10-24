import type { AnalyticsWindow } from "@/api/logs"

export const RANGE_OPTIONS: { value: AnalyticsWindow; label: string }[] = [
  { value: "1h", label: "1h" },
  { value: "24h", label: "24h" },
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
]

export type ModelMetric = "cost" | "tokens" | "requests"

export const METRIC_OPTIONS = [
  { value: "cost", label: "Spend" },
  { value: "tokens", label: "Tokens" },
  { value: "requests", label: "Requests" },
]

export type KeyFilter = "all" | "near"

export const KEY_FILTER_OPTIONS = [
  { value: "all", label: "All keys" },
  { value: "near", label: "Near quota" },
]

export const NUMBER = new Intl.NumberFormat("en-US")
export const COMPACT = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
})
// Cents stay readable on a $24 figure, and a sub-cent model rate does not round
// to $0.00 and read as "free".
export const MONEY = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
})

// A running total is read in whole cents; the sub-cent tail of a rate is noise
// on a number this size.
export const SPEND = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

export const percent = (value: number) => `${value.toFixed(1)}%`

export interface ModelRow {
  id: string
  model: string
  /** The routing id, kept for the link target. */
  provider: string
  /** The provider's display name; a custom provider's id is a UUID. */
  providerName: string
  requests: number
  tokens: number
  promptTokens: number
  cachedTokens: number
  cost: number | null
  /** The figure the selected metric sorts and scales the bars by. */
  value: number
  share: number
}

export interface KeyRow {
  id: string
  name: string
  prefix: string
  enabled: boolean
  quota: number
  used: number
  /** Null for a key with no token budget (`quota_limit = 0`). */
  percent: number | null
  rateLimit: number
}
