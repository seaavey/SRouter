import { Link, useMatches } from "@tanstack/react-router";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/context/Theme";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { KNOWN_PROVIDER_MAP, providerBaseId } from "@srouter/constants";
import { useProvider } from "@/hooks/useProvider";

const ROUTE_TITLE_MAP: Record<string, string> = {
    "/": "Gateway Overview",
    "/providers": "Provider Connections",
    "/providers/": "Provider Connections",
    "/keys": "API Keys",
    "/quota": "Quotas & Limits",
    "/analytics": "Gateway Analytics",
    "/pricing": "Model Pricing",
    "/logs": "Audit Logs",
    "/combo": "Model Combos",
    "/settings": "Gateway Settings"
};

type RouteTitleInfo = {
    title: string;
    parentTitle?: string;
    parentHref?: string;
};

function useRouteTitle(): RouteTitleInfo {
    const matches = useMatches();

    const providerMatch = matches.find((m) => m.routeId === "/providers/$providerId");
    const rawId = (providerMatch?.params as { providerId?: string })?.providerId;
    const { data: providerData } = useProvider(rawId ?? "");

    if (rawId) {
        const fallbackName =
            KNOWN_PROVIDER_MAP[rawId]?.name ??
            KNOWN_PROVIDER_MAP[providerBaseId(rawId)]?.name ??
            rawId;
        const displayName = providerData?.name || fallbackName;

        return {
            title: displayName.endsWith(".") ? displayName : `${displayName}.`,
            parentTitle: "Provider Connections",
            parentHref: "/providers"
        };
    }

    const match = [...matches]
        .reverse()
        .find((item) => ROUTE_TITLE_MAP[item.routeId] || item.staticData?.title);
    const baseTitle =
        (match ? ROUTE_TITLE_MAP[match.routeId] : undefined) ??
        (match?.staticData?.title as string | undefined) ??
        "Gateway Overview";
    const title = baseTitle.endsWith(".") ? baseTitle : `${baseTitle}.`;

    return { title };
}

export function Topbar() {
    const titleInfo = useRouteTitle();
    const { theme, toggleTheme } = useTheme();

    return (
        <header className="sticky top-0 z-30 bg-canvas/80 backdrop-blur-md border-b border-hairline-soft h-16 px-6 flex items-center justify-between">
            <div className="flex items-center gap-3 min-w-0">
                <SidebarTrigger className="size-8 rounded-full text-text-muted hover:text-ink hover:bg-canvas-soft transition-colors cursor-pointer flex items-center justify-center shrink-0" />

                {titleInfo.parentTitle && titleInfo.parentHref ? (
                    <div className="flex items-center gap-2 truncate">
                        <Link
                            to={titleInfo.parentHref}
                            className="text-text-muted hover:text-ink transition-colors font-medium text-sm truncate"
                        >
                            {titleInfo.parentTitle}
                        </Link>
                        <span className="text-text-faint text-sm">/</span>
                        <h1 className="text-lg font-[650] tracking-tight text-ink font-sans truncate">
                            {titleInfo.title}
                        </h1>
                    </div>
                ) : (
                    <h1 className="text-lg font-[650] tracking-tight text-ink font-sans truncate">
                        {titleInfo.title}
                    </h1>
                )}
            </div>
            <div className="flex items-center gap-2.5 sm:gap-3 shrink-0">
                <button
                    type="button"
                    onClick={(event) => toggleTheme(event)}
                    className="flex items-center gap-1.5 rounded-full bg-canvas-soft hover:bg-field text-ink px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer"
                    aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
                    title={theme === "dark" ? "Light theme" : "Dark theme"}
                >
                    {theme === "dark" ? (
                        <>
                            <Sun className="size-3.5" strokeWidth={2} />
                            <span className="hidden sm:inline">Light</span>
                        </>
                    ) : (
                        <>
                            <Moon className="size-3.5" strokeWidth={2} />
                            <span className="hidden sm:inline">Dark</span>
                        </>
                    )}
                </button>
            </div>
        </header>
    );
}
