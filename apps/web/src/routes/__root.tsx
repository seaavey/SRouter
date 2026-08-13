import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { Topbar } from "@/components/layout/Topbar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";

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
            <SidebarProvider>
                <AppSidebar />
                <SidebarInset className="h-svh overflow-hidden">
                    <Topbar />
                    <main className="min-h-0 flex-1 overflow-y-auto p-6">
                        <Outlet />
                    </main>
                </SidebarInset>
            </SidebarProvider>
        </TooltipProvider>
    ),
});
