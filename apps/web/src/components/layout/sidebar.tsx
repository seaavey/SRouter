import { Link } from "@tanstack/react-router";
import { Bot, Boxes, LayoutDashboard, ScrollText, Terminal, Zap } from "lucide-react";
import {
    Sidebar,
    SidebarContent,
    SidebarGroup,
    SidebarGroupContent,
    SidebarGroupLabel,
    SidebarHeader,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
    SidebarRail,
} from "@/components/ui/sidebar";

const mainNavItems = [
    { to: "/", label: "Dashboard", icon: LayoutDashboard },
    { to: "/playground", label: "Playground", icon: Terminal },
] as const;

const routerNavItems = [
    { to: "/providers", label: "Providers", icon: Boxes },
    { to: "/models", label: "Models", icon: Bot },
    { to: "/logs", label: "Logs", icon: ScrollText },
] as const;

const navGroups = [
    { label: "Workspace", items: mainNavItems },
    { label: "Routing", items: routerNavItems },
] as const;

export function AppSidebar() {
    return (
        <Sidebar collapsible="icon" className="border-r border-border/70 bg-sidebar">
            <SidebarHeader className="h-12 min-h-12 shrink-0 justify-center border-b border-border/70 p-0">
                <SidebarMenu className="items-center">
                    <SidebarMenuItem className="w-full">
                        <SidebarMenuButton
                            size="lg"
                            render={<Link to="/" aria-label="SRouter dashboard" />}
                            className="h-11 w-full rounded-none px-4 text-foreground hover:bg-transparent group-data-[collapsible=icon]:mx-auto group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0!"
                        >
                            <Zap className="size-4 shrink-0 fill-current" strokeWidth={1.75} />
                            <span className="text-sm font-semibold tracking-tight group-data-[collapsible=icon]:hidden">
                                SRouter
                            </span>
                        </SidebarMenuButton>
                    </SidebarMenuItem>
                </SidebarMenu>
            </SidebarHeader>

            <SidebarContent className="px-2 py-4">
                <nav aria-label="Primary navigation" className="space-y-5">
                    {navGroups.map((group, groupIndex) => (
                        <SidebarGroup
                            key={group.label}
                            className={groupIndex === 0 ? "p-0" : "border-t border-border/60 p-0 pt-4"}
                        >
                            <SidebarGroupLabel className="mb-1 h-6 rounded-none px-2 font-mono text-[9px] font-medium uppercase tracking-[0.12em] text-muted-foreground/70">
                                {group.label}
                            </SidebarGroupLabel>
                            <SidebarGroupContent>
                                <SidebarMenu className="gap-0.5">
                                    {group.items.map(({ to, label, icon: Icon }) => (
                                        <SidebarMenuItem key={to}>
                                            <SidebarMenuButton
                                                render={
                                                    <Link
                                                        to={to}
                                                        activeOptions={{ exact: true }}
                                                        activeProps={{
                                                            className:
                                                                "border-foreground bg-sidebar-accent/60 text-foreground",
                                                            "aria-current": "page",
                                                        }}
                                                        inactiveProps={{
                                                            className:
                                                                "border-transparent text-muted-foreground hover:border-sidebar-border hover:bg-transparent hover:text-foreground",
                                                        }}
                                                    />
                                                }
                                                tooltip={label}
                                                className="h-8 rounded-none border-l-2 px-2.5 transition-colors group-data-[collapsible=icon]:border-l-0"
                                            >
                                                <Icon strokeWidth={1.75} className="size-3.5 shrink-0" />
                                                <span className="text-xs">{label}</span>
                                            </SidebarMenuButton>
                                        </SidebarMenuItem>
                                    ))}
                                </SidebarMenu>
                            </SidebarGroupContent>
                        </SidebarGroup>
                    ))}
                </nav>
            </SidebarContent>

            <SidebarRail />
        </Sidebar>
    );
}
