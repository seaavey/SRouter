import { queryOptions } from "@tanstack/react-query"

import { request } from "./client"
import type {
  CreatedUserResponse,
  CreateUserInput,
  UpdateUserInput,
  UserListResponse,
  UserResponse,
} from "./types"

/**
 * `GET /v1/users`. Admin session only. The keys screen reads the same cache
 * entry to resolve a key's owner, so both surfaces name a user identically.
 */
export const usersQuery = queryOptions({
  queryKey: ["users", "list"] as const,
  queryFn: ({ signal }) => request<UserListResponse>("/v1/users", { signal }),
  staleTime: 15_000,
})

/**
 * `POST /v1/users`. The only response that carries the full login token; the
 * server keeps a hash and a display prefix, so this is the one chance to hand
 * it over.
 */
export function createUser(input: CreateUserInput) {
  return request<CreatedUserResponse>("/v1/users", {
    method: "POST",
    body: input,
  })
}

/**
 * `PATCH /v1/users/{id}`. Absent fields are left untouched; disabling also
 * suspends every key the account owns.
 */
export function updateUser(userID: string, input: UpdateUserInput) {
  return request<UserResponse>(`/v1/users/${encodeURIComponent(userID)}`, {
    method: "PATCH",
    body: input,
  })
}

/** `POST /v1/users/{id}/token`. Replaces the token and ends the account's sessions. */
export function rotateUserToken(userID: string) {
  return request<CreatedUserResponse>(
    `/v1/users/${encodeURIComponent(userID)}/token`,
    { method: "POST" }
  )
}
