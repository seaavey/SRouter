import { createFileRoute } from "@tanstack/react-router"

import { ProvidersPage } from "@/features/providers/providers-page"

export const Route = createFileRoute("/_authenticated/providers")({
  component: ProvidersPage,
})
