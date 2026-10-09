import { QueryClient } from "@tanstack/react-query"
import { createRootRouteWithContext, Outlet } from "@tanstack/react-router"
import { ReactQueryDevtools } from "@tanstack/react-query-devtools"
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools"

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
  // palette, so without it the app is locked to light mode.
  <ThemeProvider>
    <Outlet />
    {import.meta.env.DEV ? (
      <>
        <TanStackRouterDevtools position="bottom-right" />
        <ReactQueryDevtools buttonPosition="top-right" />
      </>
    ) : null}
  </ThemeProvider>
)

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootComponent,
})
