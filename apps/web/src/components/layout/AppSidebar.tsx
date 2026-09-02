import { Link } from "@tanstack/react-router";
import {
    Boxes,
    Coins,
    Cpu,
    Gauge,
    GitFork,
    KeyRound,
    LayoutDashboard,
    ScrollText,
    Settings,
    Zap,
    BarChart2
} from "lucide-react";
import {
    Sidebar,
    SidebarContent,
    SidebarFooter,
    SidebarGroup,
    SidebarGroupContent,
    SidebarGroupLabel,
    SidebarHeader,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
    SidebarRail
} from "@/components/ui/sidebar";

const mainNavItems = [
    { to: "/", label: "Dashboard", icon: LayoutDashboard },
    { to: "/keys", label: "API Keys", icon: KeyRound }
] as const;

const routingNavItems = [
    { to: "/providers", label: "Providers", icon: Boxes },
    { to: "/combo", label: "Combo", icon: GitFork },
    { to: "/token-saver", label: "Token Saver", icon: Coins },
    { to: "/analytics", label: "Analytics", icon: BarChart2 },
    { to: "/quota", label: "Quotas & Limits", icon: Gauge },
    { to: "/logs", label: "Audit Logs", icon: ScrollText }
] as const;

export function AppSidebar() {
    return (
        <Sidebar collapsible="icon" className="border-r border-border/80 bg-sidebar/95 font-mono">
            {/* Header: Machined Branding */}
            <SidebarHeader className="h-12 min-h-12 shrink-0 justify-center border-b border-border/80 px-3">
                <SidebarMenu className="items-center">
                    <SidebarMenuItem className="w-full">
                        <SidebarMenuButton
                            size="lg"
                            render={<Link to="/" aria-label="SRouter dashboard" />}
                            className="group h-10 w-full rounded-lg px-2 text-foreground transition-all duration-150 hover:bg-secondary/60 group-data-[collapsible=icon]:mx-auto group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0! cursor-pointer"
                        >
                            {/* Logo Mark: Double-bezel Machined Emblem with Beacon */}
                            <div className="relative flex size-7.5 shrink-0 items-center justify-center rounded-lg border border-border/80 bg-linear-to-b from-secondary/90 via-secondary/50 to-background p-1 text-foreground shadow-2xs transition-all duration-200 group-hover:border-foreground/30 group-hover:bg-secondary/80">
                                <svg
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    className="size-4 text-foreground transition-transform duration-200 group-hover:scale-105"
                                >
                                    <path
                                        d="M13 2.5L5 13H11.5L9.5 21.5L18.5 10H12L13.5 2.5Z"
                                        fill="currentColor"
                                        fillOpacity="0.92"
                                        stroke="currentColor"
                                        strokeWidth="0.5"
                                        strokeLinejoin="round"
                                    />
                                </svg>
                                <span
                                    className="absolute -right-0.5 -top-0.5 size-1.5 rounded-full border border-background bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.5)]"
                                    title="Gateway Online"
                                    aria-hidden="true"
                                />
                            </div>

                            {/* Label & Tactical Subtitle */}
                            <div className="flex flex-col min-w-0 group-data-[collapsible=icon]:hidden text-left pl-1">
                                <div className="flex items-center gap-1.5">
                                    <span className="text-[13px] font-bold tracking-tight text-foreground leading-tight">
                                        SRouter
                                    </span>
                                    <span className="rounded-xs border border-border/70 bg-secondary/70 px-1 py-0.2 font-mono text-[8px] font-semibold text-muted-foreground/80 leading-none">
                                        MESH
                                    </span>
                                </div>
                                <span className="text-[9px] font-mono font-medium text-muted-foreground/75 tracking-[0.14em] uppercase mt-0.5 truncate">
                                    Gateway Proxy
                                </span>
                            </div>
                        </SidebarMenuButton>
                    </SidebarMenuItem>
                </SidebarMenu>
            </SidebarHeader>

            <SidebarContent className="px-2.5 py-4">
                <nav aria-label="Primary navigation" className="space-y-6">
                    {/* Workspace Group */}
                    <SidebarGroup className="p-0">
                        <SidebarGroupLabel className="mb-1.5 h-5 px-2 text-[9px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/80">
                            Workspace
                        </SidebarGroupLabel>
                        <SidebarGroupContent>
                            <SidebarMenu className="gap-1">
                                {mainNavItems.map(({ to, label, icon: Icon }) => (
                                    <SidebarMenuItem key={to}>
                                        <SidebarMenuButton
                                            render={
                                                <Link
                                                    to={to}
                                                    activeOptions={{ exact: true }}
                                                    activeProps={{
                                                        className:
                                                            "bg-secondary text-foreground font-semibold border border-border/80 shadow-2xs",
                                                        "aria-current": "page"
                                                    }}
                                                    inactiveProps={{
                                                        className:
                                                            "text-muted-foreground hover:bg-secondary/40 hover:text-foreground border border-transparent"
                                                    }}
                                                />
                                            }
                                            tooltip={label}
                                            className="h-8.5 rounded-md px-2.5 transition-all text-xs cursor-pointer group-data-[collapsible=icon]:justify-center"
                                        >
                                            <Icon
                                                strokeWidth={1.75}
                                                className="size-3.5 shrink-0"
                                            />
                                            <span className="text-xs truncate">{label}</span>
                                        </SidebarMenuButton>
                                    </SidebarMenuItem>
                                ))}
                            </SidebarMenu>
                        </SidebarGroupContent>
                    </SidebarGroup>

                    {/* Routing Group */}
                    <SidebarGroup className="border-t border-border/60 p-0 pt-4">
                        <SidebarGroupLabel className="mb-1.5 h-5 px-2 text-[9px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/80">
                            Routing Engine
                        </SidebarGroupLabel>
                        <SidebarGroupContent>
                            <SidebarMenu className="gap-1">
                                {routingNavItems.map(({ to, label, icon: Icon }) => (
                                    <SidebarMenuItem key={to}>
                                        <SidebarMenuButton
                                            render={
                                                <Link
                                                    to={to}
                                                    activeOptions={{ exact: to !== "/providers" }}
                                                    activeProps={{
                                                        className:
                                                            "bg-secondary text-foreground font-semibold border border-border/80 shadow-2xs",
                                                        "aria-current": "page"
                                                    }}
                                                    inactiveProps={{
                                                        className:
                                                            "text-muted-foreground hover:bg-secondary/40 hover:text-foreground border border-transparent"
                                                    }}
                                                />
                                            }
                                            tooltip={label}
                                            className="h-8.5 rounded-md px-2.5 transition-all text-xs cursor-pointer group-data-[collapsible=icon]:justify-center"
                                        >
                                            <Icon
                                                strokeWidth={1.75}
                                                className="size-3.5 shrink-0"
                                            />
                                            <span className="text-xs truncate">{label}</span>
                                        </SidebarMenuButton>
                                    </SidebarMenuItem>
                                ))}
                            </SidebarMenu>
                        </SidebarGroupContent>
                    </SidebarGroup>
                </nav>
            </SidebarContent>

            {/* Footer with Settings & Node Telemetry */}
            <SidebarFooter className="border-t border-border/80 p-2.5 space-y-2">
                <SidebarMenu>
                    <SidebarMenuItem>
                        <SidebarMenuButton
                            render={
                                <Link
                                    to="/settings"
                                    activeOptions={{ exact: true }}
                                    activeProps={{
                                        className:
                                            "bg-secondary text-foreground font-semibold border border-border/80 shadow-2xs",
                                        "aria-current": "page"
                                    }}
                                    inactiveProps={{
                                        className:
                                            "text-muted-foreground hover:bg-secondary/40 hover:text-foreground border border-transparent"
                                    }}
                                />
                            }
                            tooltip="Settings"
                            className="h-8.5 rounded-md px-2.5 transition-all text-xs cursor-pointer group-data-[collapsible=icon]:justify-center"
                        >
                            <Settings strokeWidth={1.75} className="size-3.5 shrink-0" />
                            <span className="text-xs">Settings & Ops</span>
                        </SidebarMenuButton>
                    </SidebarMenuItem>
                </SidebarMenu>

                {/* Micro Node Info */}
                <div className="hidden group-data-[collapsible=icon]:hidden px-2 py-1.5 rounded-md bg-secondary/30 border border-border/50 text-[10px] text-muted-foreground flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                        <Cpu className="size-3 text-muted-foreground/80" />
                        <span>Node SQLite</span>
                    </div>
                    <span className="font-semibold text-foreground/80">WAL</span>
                </div>
            </SidebarFooter>

            <SidebarRail />
        </Sidebar>
    );
}
