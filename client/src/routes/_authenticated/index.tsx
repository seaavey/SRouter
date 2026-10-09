import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/_authenticated/")({
  component: Dashboard,
})

function Dashboard() {
  return (
    <div className="p-6">
      <h1 className="text-sm font-medium">Dashboard</h1>
      <p className="text-muted-foreground mt-1 text-xs">
        Session verified. The usage, providers, and logs surfaces mount here.
      </p>
    </div>
  )
}
