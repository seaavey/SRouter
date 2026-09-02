import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import { AppSidebar, Topbar } from "@/components/layout";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AdminAuthGate } from "@/components/auth";

interface RouterContext {
    queryClient: QueryClient;
}

declare module "@tanstack/react-router" {
    interface StaticDataRouteOption {
        title?: string;
    }
}

export const Route = createRootRouteWithContext<RouterContext>()({
    component: () => (
        <TooltipProvider>
            <AdminAuthGate>
                <SidebarProvider>
                    <AppSidebar />
                    <SidebarInset className="h-svh overflow-hidden">
                        <Topbar />
                        <main className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4 sm:p-6 bg-grid-pattern">
                            <Outlet />
                        </main>
                    </SidebarInset>
                </SidebarProvider>
            </AdminAuthGate>
        </TooltipProvider>
    )
});
