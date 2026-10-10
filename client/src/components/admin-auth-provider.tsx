import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { UseMutationResult, UseQueryResult } from "@tanstack/react-query"
import * as React from "react"

import {
  adminStatusQuery,
  loginAdmin,
  logoutAdmin,
  setupAdmin,
} from "@/api/admin"
import type {
  AdminAuthResult,
  AdminLoginInput,
  AdminSetupInput,
  AdminStatus,
} from "@/api/types"

type AdminAuthState = {
  /**
   * The shared `["admin", "status"]` query. `data` is `undefined` until the
   * first successful fetch; `isPending`/`isError` are the states to branch on.
   */
  status: UseQueryResult<AdminStatus>
  login: UseMutationResult<AdminAuthResult, Error, AdminLoginInput>
  setup: UseMutationResult<AdminAuthResult, Error, AdminSetupInput>
  logout: UseMutationResult<void, Error, void>
}

const AdminAuthContext = React.createContext<AdminAuthState | null>(null)

/**
 * Owns the admin session: the `["admin", "status"]` query plus the
 * login/setup/logout mutations. The query is read here, not in the session
 * guard — the guard runs in `beforeLoad`, before any component and therefore
 * before any provider, so it must go through `queryClient.ensureQueryData` on
 * the router context. This provider observes the same cache entry afterwards,
 * which is why every auth mutation invalidates it before the caller navigates.
 *
 * Mounted in `__root__` so the login screen and every signed-in screen share
 * one session object.
 */
export function AdminAuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient()
  const status = useQuery(adminStatusQuery)

  // The server sets or clears the session cookie itself; the cached status is
  // what tells the guard and the screens about it. Skip the invalidation and a
  // successful login leaves the guard looking at `authenticated: false`.
  const login = useMutation({
    mutationFn: loginAdmin,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: adminStatusQuery.queryKey }),
  })
  const setup = useMutation({
    mutationFn: setupAdmin,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: adminStatusQuery.queryKey }),
  })
  const logout = useMutation({
    mutationFn: logoutAdmin,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: adminStatusQuery.queryKey }),
  })

  const value = React.useMemo(
    () => ({ status, login, setup, logout }),
    [status, login, setup, logout]
  )

  return (
    <AdminAuthContext.Provider value={value}>
      {children}
    </AdminAuthContext.Provider>
  )
}

export function useAdminAuth() {
  const context = React.useContext(AdminAuthContext)

  if (context === null) {
    throw new Error("useAdminAuth must be used within an AdminAuthProvider")
  }

  return context
}
