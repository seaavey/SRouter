import { QueryClient } from "@tanstack/react-query"
import {
  createRootRouteWithContext,
  HeadContent,
  Outlet,
} from "@tanstack/react-router"

import { AdminAuthProvider } from "@/components/admin-auth-provider"
import {
  ToastStack,
  ToastStackProvider,
} from "@/components/arc/toast-stack/toast-stack"
import { ThemeProvider } from "@/components/theme-provider"

export type RouterContext = {
  queryClient: QueryClient
}

/**
 * The dashboard's own query client. Retries are off because every request here
 * targets a server the operator is running themselves: a failure is
 * information, not a transient network blip, and a silent retry hides it.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
})

const RootComponent = () => (
  // ThemeProvider stays mounted at the root: `index.css` defines the `.dark`
  // palette, so without it the app is locked to light mode. AdminAuthProvider
  // sits here too: the login screen and the session guard must share one
  // `["admin", "status"]` entry.
  <ThemeProvider>
    <HeadContent />
    <AdminAuthProvider>
      <ToastStackProvider>
        <Outlet />
        <ToastStack position="top-right" />
      </ToastStackProvider>
    </AdminAuthProvider>
  </ThemeProvider>
)

export const Route = createRootRouteWithContext<RouterContext>()({
  head: () => ({ meta: [{ title: "SRouter" }] }),
  component: RootComponent,
})
