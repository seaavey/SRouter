// Fixture data shared by the E2E stack (which seeds it) and the specs (which
// assert it). One source of truth keeps the expected totals from drifting away
// from the traffic the harness actually sends.

export interface UsageFixture {
  /** How many whole hours before the run this request is dated. */
  hours_ago: number
  prompt_tokens: number
  completion_tokens: number
  cached_tokens: number
}

export interface ModelTraffic {
  /** Bare model id the mock upstream serves, without the provider prefix. */
  model: string
  /** Usage the mock upstream reports, one entry per request, in order. */
  calls: UsageFixture[]
}

/** The provider id the seeded `providers` row carries. */
export const PROVIDER_ID = "e2e-mock"

/** Model prefix that routes a request onto the seeded custom provider. */
export const PROVIDER_PREFIX = "mock"

/** How many hourly buckets the fixtures cover. */
const HOURS = 12

/**
 * One request per hour, so the plot has a shape at every range instead of a
 * single spike. The token counts are large enough for the priced model to move
 * Est. Spend off $0.00, and every request's total is unique so the stack can
 * address its log row when it dates the traffic.
 */
function hourlyCall(index: number): UsageFixture {
  return {
    hours_ago: index,
    prompt_tokens: 20_000 + index * 137,
    completion_tokens: 5_000 + index * 61,
    cached_tokens: index % 3 === 0 ? 8_000 : 0,
  }
}

/** What the mock upstream is told to report per model, in call order. */
export const TRAFFIC: ModelTraffic[] = [
  {
    model: "gpt-4o-mini",
    calls: [
      ...Array.from({ length: HOURS }, (_, index) => index)
        .filter((index) => index % 2 === 0)
        .map(hourlyCall),
      // Breaks the tie on request count so the default sort has an order to show.
      {
        hours_ago: 0,
        prompt_tokens: 21_000,
        completion_tokens: 6_000,
        cached_tokens: 0,
      },
    ],
  },
  {
    model: "gpt-e2e",
    calls: Array.from({ length: HOURS }, (_, index) => index)
      .filter((index) => index % 2 === 1)
      .map(hourlyCall),
  },
]

/** Every model id the mock upstream advertises on `GET /models`. */
export const SERVED_MODELS = TRAFFIC.map((entry) => entry.model)

/** The master password the stack boots the gateway with. */
export const ADMIN_PASSWORD = "srouter-e2e-password"

/** The upstream token the gateway reads back off the seeded provider row. */
export const UPSTREAM_API_KEY = "sk-e2e-upstream"

export interface Totals {
  requests: number
  prompt: number
  completion: number
  cached: number
  total: number
}

function summarize(calls: UsageFixture[]): Totals {
  const totals: Totals = {
    requests: 0,
    prompt: 0,
    completion: 0,
    cached: 0,
    total: 0,
  }

  for (const call of calls) {
    totals.requests += 1
    totals.prompt += call.prompt_tokens
    totals.completion += call.completion_tokens
    totals.cached += call.cached_tokens
    totals.total += call.prompt_tokens + call.completion_tokens
  }

  return totals
}

/** The request total each log row is addressed by when the stack dates it. */
export function callTotal(call: UsageFixture) {
  return call.prompt_tokens + call.completion_tokens
}

/**
 * Totals implied by [`TRAFFIC`]. The page aggregates the analytics buckets
 * itself, so the spec compares the rendered figures against these numbers to
 * prove the seed landed rather than against a snapshot of the page.
 */
export function expectedTotals(traffic: ModelTraffic[] = TRAFFIC): Totals {
  return summarize(traffic.flatMap((entry) => entry.calls))
}

/** Totals implied by [`TRAFFIC`] for one model, as the page would show them. */
export function modelTotals(model: string) {
  const entry = TRAFFIC.find((candidate) => candidate.model === model)
  if (!entry) {
    throw new Error(`no fixture traffic for "${model}"`)
  }

  const totals = summarize(entry.calls)
  const cacheRate =
    totals.prompt > 0
      ? ((totals.cached / totals.prompt) * 100).toFixed(1)
      : "0.0"

  return { ...totals, cacheRate }
}
