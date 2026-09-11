import { Link } from "@tanstack/react-router";
import type { ComponentType } from "react";
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

type NavItem = {
    to: string;
    label: string;
    icon: ComponentType<{ strokeWidth?: number; className?: string }>;
};

type NavGroup = {
    label?: string;
    items: NavItem[];
};

const navGroups: NavGroup[] = [
    {
        items: [{ to: "/", label: "Overview", icon: LayoutDashboard }]
    },
    {
        label: "Gateway",
        items: [
            { to: "/providers", label: "Providers", icon: Boxes },
            { to: "/keys", label: "API Keys", icon: KeyRound },
            { to: "/combo", label: "Combos", icon: GitFork }
        ]
    },
    {
        label: "Insights",
        items: [
            { to: "/quota", label: "Quotas", icon: Gauge },
            { to: "/analytics", label: "Analytics", icon: BarChart2 },
            { to: "/logs", label: "Logs", icon: ScrollText },
            { to: "/pricing", label: "Pricing", icon: Coins }
        ]
    },
    {
        label: "System",
        items: [{ to: "/settings", label: "Settings", icon: Settings }]
    }
];

export function AppSidebar() {
    return (
        <Sidebar className="bg-canvas border-r border-hairline-soft w-64 flex flex-col h-full">
            <div className="flex flex-col h-full justify-between p-4 bg-canvas">
                <div className="flex flex-col gap-6 min-h-0 flex-1">
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
                    <nav
                        aria-label="Main navigation"
                        className="scrollbar-hidden flex flex-col gap-5 overflow-y-auto"
                    >
                        {navGroups.map(({ label, items }, groupIndex) => (
                            <div
                                key={label ?? `group-${groupIndex}`}
                                className="flex flex-col gap-1"
                            >
                                {label ? (
                                    <p
                                        id={`nav-group-${label.toLowerCase()}`}
                                        className="px-4 pb-1 font-mono text-[10px] font-medium uppercase tracking-wider text-text-muted"
                                    >
                                        {label}
                                    </p>
                                ) : null}
                                <ul
                                    aria-labelledby={
                                        label ? `nav-group-${label.toLowerCase()}` : undefined
                                    }
                                    className="flex flex-col gap-1 list-none p-0 m-0"
                                >
                                    {items.map(({ to, label: itemLabel, icon: Icon }) => (
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
                                                <Icon
                                                    strokeWidth={1.75}
                                                    className="size-4 shrink-0"
                                                />
                                                <span className="truncate">{itemLabel}</span>
                                            </Link>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ))}
                    </nav>
                </div>
            </div>
        </Sidebar>
    );
}
