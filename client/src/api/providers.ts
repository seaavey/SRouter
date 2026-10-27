import { queryOptions } from "@tanstack/react-query"

import { request } from "./client"
import type {
  ProviderEntry,
  ProviderListResponse,
  VerifyResponse,
} from "./types"

export type AddCustomProviderInput = Parameters<typeof addCustomProvider>[0]

/** `GET /v1/providers`. Complete provider list. */
export const providersListQuery = queryOptions({
  queryKey: ["providers", "list"] as const,
  queryFn: ({ signal }) =>
    request<ProviderListResponse>("/v1/providers", { signal }),
  staleTime: 10_000,
  refetchOnMount: "always",
})

/** `GET /v1/providers/{provider_id}`. Provider detail with connections and models. */
export function providerDetailQuery(providerID: string) {
  return queryOptions({
    queryKey: ["providers", "detail", providerID] as const,
    queryFn: ({ signal }) =>
      request<ProviderEntry>(
        `/v1/providers/${encodeURIComponent(providerID)}`,
        {
          signal,
        }
      ),
    staleTime: 10_000,
  })
}

/** Triggers a forced catalog refresh for the provider. */
export function refreshProviderModels(providerID: string) {
  return request<ProviderEntry>(
    `/v1/providers/${encodeURIComponent(providerID)}?refresh=true`
  )
}

/** `PATCH /v1/providers/{provider_id}`. Update driver flags or connection settings. */
export function patchProvider(
  providerID: string,
  body: {
    enabled?: boolean
    hide?: string[]
    restore?: string[]
    favorite?: string[]
    unfavorite?: string[]
    name?: string
    prefix?: string
    protocol?: string
    base_url?: string
    api_key?: string
  }
) {
  return request<ProviderEntry>(
    `/v1/providers/${encodeURIComponent(providerID)}`,
    {
      method: "PATCH",
      body,
    }
  )
}

/** `PATCH /v1/providers/{provider_id}/round-robin`. Toggle round robin rotation across accounts. */
export function toggleRoundRobin(providerID: string, enabled: boolean) {
  return request<ProviderEntry>(
    `/v1/providers/${encodeURIComponent(providerID)}/round-robin`,
    {
      method: "PATCH",
      body: { enabled },
    }
  )
}

export interface OAuthLoginResult {
  authorize_url: string
  state: string
  code_verifier: string
  redirect_uri: string
}

/** Initiates provider OAuth authorization flow for supported drivers. */
export function initiateOAuthLogin(
  providerID: string,
  options?: { callback?: string }
) {
  const normalized = providerID.toLowerCase()
  // OpenAI Codex client ID app_EMoamEEZ73f0CkXaXp7hrann strictly enforces port 1455 redirect URI.
  let authPath =
    "/v1/auth/openai/login?format=json&redirect_uri=" +
    encodeURIComponent("http://localhost:1455/auth/callback")
  if (normalized.includes("claude") || normalized.includes("anthropic")) {
    authPath = "/v1/auth/claude/login?format=json"
  } else if (normalized.includes("antigravity")) {
    authPath = "/v1/auth/antigravity/login?format=json"
  } else if (normalized.includes("qoder")) {
    authPath = "/v1/auth/qoder/login?format=json"
  } else if (normalized.includes("cline")) {
    authPath = "/v1/auth/cline/device"
  } else if (normalized.includes("codebuddy")) {
    authPath = "/v1/auth/codebuddy/device"
  } else if (normalized.includes("commandcode")) {
    // The studio refuses any callback that is not on loopback, so the caller
    // passes the relay it started on the operator's machine.
    authPath = options?.callback
      ? `/v1/auth/commandcode/login?callback=${encodeURIComponent(options.callback)}`
      : "/v1/auth/commandcode/login"
  } else if (normalized.includes("grok")) {
    authPath = "/v1/auth/grok/login?format=json"
  }

  return request<OAuthLoginResult>(authPath, {
    method: "GET",
  })
}

/**
 * The auth family whose driver exposes `POST /v1/auth/{family}/token`, or null
 * when the provider has no import route. Only openai (Codex), claude,
 * antigravity and commandcode mount one; the device-flow drivers (qoder,
 * cline, codebuddy, grok) do not, so a token posted for them would land on the
 * Codex route and store a credential that never authenticates.
 */
function tokenImportFamily(providerID: string): string | null {
  const normalized = providerID.toLowerCase()
  if (normalized.includes("claude") || normalized.includes("anthropic")) {
    return "claude"
  }
  if (normalized.includes("antigravity")) return "antigravity"
  if (normalized.includes("commandcode")) return "commandcode"
  if (normalized.includes("codex") || normalized.includes("openai")) {
    return "openai"
  }
  return null
}

/** Whether this provider can take a pasted OAuth token at all. */
export function supportsTokenImport(providerID: string) {
  return tokenImportFamily(providerID) !== null
}

/** `POST /v1/auth/{provider}/token`. Imports an OAuth access token directly into SQLite. */
export function importOAuthToken(
  providerID: string,
  body: {
    access_token: string
    refresh_token?: string
    account_id?: string
    id_token?: string
    name?: string
  }
) {
  const family = tokenImportFamily(providerID)
  if (!family) {
    throw new Error(`Token import is not available for ${providerID}.`)
  }

  return request<{
    success: boolean
    message: string
  }>(`/v1/auth/${family}/token`, {
    method: "POST",
    body,
  })
}

/** Completes authorization callback with code and state or redirect URL. */
export function completeOAuthCallback(
  providerID: string,
  params: { code?: string; state?: string; callback_url?: string }
) {
  const normalized = providerID.toLowerCase()
  let cbPath = "/v1/auth/openai/callback"
  if (normalized.includes("claude") || normalized.includes("anthropic")) {
    cbPath = "/v1/auth/claude/callback"
  } else if (normalized.includes("antigravity")) {
    cbPath = "/v1/auth/antigravity/callback"
  } else if (normalized.includes("qoder")) {
    cbPath = "/v1/auth/qoder/callback"
  }

  return request<{
    success: boolean
    message: string
  }>(cbPath, {
    method: "POST",
    body: params,
  })
}

/** Polls a device-flow authorization session (e.g. Qoder, Cline, CodeBuddy). */
export function pollOAuthSession(providerID: string, state: string) {
  const normalized = providerID.toLowerCase()
  let pollBase: string
  if (normalized === "codebuddy-cn") {
    pollBase = "/v1/auth/codebuddy-cn/poll"
  } else if (normalized.includes("cline")) {
    pollBase = "/v1/auth/cline/poll"
  } else if (normalized.includes("codebuddy")) {
    pollBase = "/v1/auth/codebuddy/poll"
  } else if (normalized.includes("qoder")) {
    pollBase = "/v1/auth/qoder/poll"
  } else if (normalized.includes("commandcode")) {
    pollBase = "/v1/auth/commandcode/poll"
  } else {
    return Promise.reject(
      new Error(
        `Provider "${providerID}" does not support polling device authorization`
      )
    )
  }

  const pollPath = `${pollBase}?state=${encodeURIComponent(state)}`
  return request<{
    status: "pending" | "ok"
    error?: string | null
  }>(pollPath, {
    method: "GET",
  })
}

/** `POST /v1/providers/verify`. Probes an unsaved endpoint without storing it. */
export function verifyCustomProvider(
  body: Pick<AddCustomProviderInput, "protocol" | "base_url" | "api_key">
) {
  return request<VerifyResponse>("/v1/providers/verify", {
    method: "POST",
    body,
  })
}

/** `POST /v1/providers`. Registers a custom provider endpoint. */
export function addCustomProvider(body: {
  name: string
  prefix?: string
  protocol: string
  base_url: string
  api_key?: string
}) {
  return request<ProviderEntry>("/v1/providers", {
    method: "POST",
    body,
  })
}

/** `DELETE /v1/providers/{provider_id}`. Removes a custom provider with its stored accounts. */
export function deleteProvider(providerID: string) {
  return request<{ message: string }>(
    `/v1/providers/${encodeURIComponent(providerID)}`,
    { method: "DELETE" }
  )
}

/** `DELETE /v1/providers/{provider_id}/connections/{connection_id}`. Removes one stored connection of a driver. */
export function deleteProviderConnection(
  providerID: string,
  connectionID: string
) {
  return request<{ message: string }>(
    `/v1/providers/${encodeURIComponent(providerID)}/connections/${encodeURIComponent(connectionID)}`,
    { method: "DELETE" }
  )
}
