import { createFileRoute, useNavigate } from "@tanstack/react-router"

import { useAdminAuth } from "@/components/admin-auth-provider"
import { Button } from "@/components/ui/button"

export const Route = createFileRoute("/_authenticated/")({
  component: Dashboard,
})

function Dashboard() {
  const navigate = useNavigate()
  const { logout } = useAdminAuth()

  return (
    <div className="p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-sm font-medium">Dashboard</h1>
        <Button
          variant="outline"
          size="sm"
          disabled={logout.isPending}
          onClick={() =>
            logout.mutate(undefined, {
              onSuccess: () => navigate({ to: "/login", replace: true }),
            })
          }
        >
          {logout.isPending ? "Signing out…" : "Sign out"}
        </Button>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Session verified. The usage, providers, and logs surfaces mount here.
      </p>
      {logout.isError ? (
        <p className="mt-2 text-xs text-destructive">
          Could not sign out. Check the server and try again.
        </p>
      ) : null}
    </div>
  )
}
