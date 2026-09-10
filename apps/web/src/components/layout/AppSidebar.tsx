import { Link } from "@tanstack/react-router";
import {
    BarChart2,
    Boxes,
    Coins,
    Gauge,
    GitFork,
    KeyRound,
    LayoutDashboard,
    ScrollText,
    Settings
} from "lucide-react";
import { Sidebar } from "@/components/ui/sidebar";
import { CURRENT_VERSION } from "@/hooks/useVersion";

const navItems = [
    { to: "/", label: "Overview", icon: LayoutDashboard },
    { to: "/providers", label: "Providers", icon: Boxes },
    { to: "/keys", label: "API Keys", icon: KeyRound },
    { to: "/quota", label: "Quotas", icon: Gauge },
    { to: "/analytics", label: "Analytics", icon: BarChart2 },
    { to: "/pricing", label: "Pricing", icon: Coins },
    { to: "/logs", label: "Logs", icon: ScrollText },
    { to: "/combo", label: "Combos", icon: GitFork },
    { to: "/settings", label: "Settings", icon: Settings }
] as const;

export function AppSidebar() {
    return (
        <Sidebar className="bg-canvas border-r border-hairline-soft w-64 flex flex-col h-full">
            <div className="flex flex-col h-full justify-between p-4 bg-canvas">
                <div className="flex flex-col gap-6 min-h-0 flex-1">
                    {/* Header: SRouter wordmark in Inter 650 + version pill */}
                    <div className="flex items-center justify-between px-2 py-1 shrink-0">
                        <Link to="/" className="flex items-center gap-1.5 group">
                            <span className="text-xl font-[650] tracking-tight text-ink font-sans">
                                SRouter<span className="text-ink">.</span>
                            </span>
                        </Link>
                        <span className="rounded-full bg-canvas-soft text-ink px-2.5 py-0.5 text-xs font-mono">
                            {CURRENT_VERSION}
                        </span>
                    </div>

                    {/* Nav List: Stadium pill items */}
                    <nav
                        aria-label="Main navigation"
                        className="flex flex-col gap-1 overflow-y-auto"
                    >
                        <ul className="flex flex-col gap-1 list-none p-0 m-0">
                            {navItems.map(({ to, label, icon: Icon }) => (
                                <li key={to}>
                                    <Link
                                        to={to}
                                        activeOptions={{ exact: to === "/" }}
                                        className="flex items-center gap-3 rounded-full px-4 py-2.5 text-sm transition-colors"
                                        activeProps={{
                                            className:
                                                "bg-ink text-canvas font-semibold shadow-none",
                                            "aria-current": "page"
                                        }}
                                        inactiveProps={{
                                            className:
                                                "text-text-muted hover:text-ink hover:bg-canvas-soft font-medium"
                                        }}
                                    >
                                        <Icon strokeWidth={1.75} className="size-4 shrink-0" />
                                        <span className="truncate">{label}</span>
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    </nav>
                </div>

                {/* Footer: Gateway connection dot indicator and status text */}
                <div className="pt-4 border-t border-hairline-soft shrink-0">
                    <div className="flex items-center justify-between px-3.5 py-2.5 rounded-full bg-canvas-soft text-xs text-text-muted">
                        <div className="flex items-center gap-2">
                            <span
                                className="size-2 rounded-full bg-emerald-500 shrink-0"
                                aria-hidden="true"
                            />
                            <span className="font-medium text-ink">Gateway Online</span>
                        </div>
                        <span className="font-mono text-[11px] text-text-muted">Active</span>
                    </div>
                </div>
            </div>
        </Sidebar>
    );
}
