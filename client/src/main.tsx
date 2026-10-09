import { QueryClientProvider } from "@tanstack/react-query"
import { createRouter, RouterProvider } from "@tanstack/react-router"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import "./index.css"
import { queryClient } from "@/routes/__root"
import { routeTree } from "@/routeTree.gen"

const router = createRouter({
  routeTree,
  context: { queryClient },
  // The session cookie is the only credential, and the API is same-origin
  // (Vite proxy in development, the server's own static serving in
  // production), so there is no base URL to configure.
  defaultPreload: "intent",
})

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>
)
