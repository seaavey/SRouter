import { createFileRoute } from "@tanstack/react-router"

import { SettingsView } from "@/components/settings/SettingsView"

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({ meta: [{ title: "SRouter - Settings" }] }),
  component: SettingsPage,
})

function SettingsPage() {
  return <SettingsView />
}
