import { useState } from "react";
import { useMatches } from "@tanstack/react-router";
import { Check, Copy, Moon, Sun } from "lucide-react";
import { useTheme } from "@/context/Theme";
import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";

function usePageTitle(): string {
    const matches = useMatches();
    const match = [...matches].reverse().find((item) => item.staticData?.title);
    return (match?.staticData?.title as string | undefined) ?? "Dashboard";
}

const API_BASE = `${typeof window !== "undefined" ? window.location.origin : "http://localhost:3000"}/v1`;

export function Topbar() {
    const title = usePageTitle();
    const { theme, toggleTheme } = useTheme();
    const [copied, setCopied] = useState(false);

    async function handleCopy() {
        try {
            await navigator.clipboard.writeText(API_BASE);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
        } catch {
            setCopied(false);
        }
    }

    return (
        <header className="sticky top-0 z-30 flex h-12 min-h-12 shrink-0 items-center justify-between gap-4 border-b border-border/70 bg-background px-3 sm:px-4">
            <div className="flex min-w-0 items-center gap-3">
                <SidebarTrigger className="size-7 rounded-none text-muted-foreground outline-offset-0 hover:bg-transparent hover:text-foreground focus-visible:ring-1" />
                <h1 className="truncate text-xs font-semibold text-foreground">{title}</h1>
            </div>

            <div className="flex shrink-0 items-center gap-1">
                <div className="mr-2 hidden items-center gap-2 border-r border-border/70 pr-3 md:flex">
                    <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground">API</span>
                    <code className="max-w-72 truncate text-[10px] text-muted-foreground" title={API_BASE}>
                        {API_BASE}
                    </code>
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => void handleCopy()}
                        aria-label={copied ? "Gateway endpoint copied" : "Copy gateway endpoint"}
                        className="rounded-none text-muted-foreground hover:bg-transparent hover:text-foreground"
                    >
                        {copied ? <Check /> : <Copy />}
                    </Button>
                    <span className="sr-only" role="status" aria-live="polite">
                        {copied ? "Gateway endpoint copied" : ""}
                    </span>
                </div>

                <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={(event) => toggleTheme(event)}
                    aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
                    className="rounded-none text-muted-foreground hover:bg-transparent hover:text-foreground"
                >
                    {theme === "dark" ? <Sun /> : <Moon />}
                </Button>
            </div>
        </header>
    );
}
