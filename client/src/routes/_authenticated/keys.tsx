import { createFileRoute } from "@tanstack/react-router"

import { APIKeysPage } from "@/features/keys/api-keys-page"

export const Route = createFileRoute("/_authenticated/keys")({
  component: APIKeysPage,
})
