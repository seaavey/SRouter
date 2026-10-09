import type { ErrorEnvelope } from "./types"

/**
 * Every failure the API reports carries the `ErrorEnvelope` shape, so callers
 * branch on `status` and `code` rather than parsing messages. `code` is the
 * stable field; `message` is prose that may be reworded.
 */
export class APIError extends Error {
  readonly status: number
  readonly code: string | null
  readonly param: string | null

  constructor(status: number, body: ErrorEnvelope["error"] | null) {
    super(body?.message ?? `Request failed with status ${status}`)
    this.name = "APIError"
    this.status = status
    this.code = body?.code ?? null
    this.param = body?.param ?? null
  }

  /** The session is gone or was never established. Callers redirect to login. */
  get isUnauthenticated() {
    return this.status === 401 && this.code === "authentication_required"
  }
}

type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "DELETE"
  body?: unknown
  signal?: AbortSignal
}

/**
 * One request against the API. Requests are same-origin: in development the
 * Vite proxy forwards `/v1` to the server, and in production the server serves
 * the built dashboard itself. That matters because the admin session is an
 * HttpOnly `SameSite=Lax` cookie, which a browser will not send across sites.
 *
 * `credentials: "include"` is what makes the cookie travel; without it the
 * session silently does not persist.
 */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, signal } = options

  const response = await fetch(path, {
    method,
    credentials: "include",
    signal,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  if (response.status === 204) {
    return undefined as T
  }

  const text = await response.text()
  let parsed: unknown = null
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text)
    } catch {
      // A non-JSON body means something answered that is not this API: a proxy
      // error page, an HTML 404 from a misconfigured static host. Surface the
      // status rather than a parse failure.
      parsed = null
    }
  }

  if (!response.ok) {
    const envelope = parsed as ErrorEnvelope | null
    throw new APIError(response.status, envelope?.error ?? null)
  }

  return parsed as T
}
