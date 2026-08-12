import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import type { ProviderDefinition } from "@srouter/types";
import { Badge } from "@/components/ui/badge";
import { ProviderIcon } from "@/components/ui/provider-icon";
import { getConnectedCount } from "./provider-status";

const protocolLabels: Record<string, string> = {
    openai: "OpenAI",
    anthropic: "Anthropic",
    gemini: "Gemini",
    custom: "Custom",
};

function authLabel(provider: ProviderDefinition): string {
    if (provider.requiresOAuth) return "OAuth";
    if (provider.requiresApiKey) return "API key";
    return "Open";
}

export function ProviderRow({ provider }: { provider: ProviderDefinition }) {
    const connectedCount = getConnectedCount(provider);
    const isConnected = connectedCount > 0;

    return (
        <Link
            to="/providers/$providerId"
            params={{ providerId: provider.id }}
            className="group grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 px-1 py-3 transition-colors hover:bg-muted/40 sm:gap-x-4 sm:px-2"
        >
            <span className="flex size-8 items-center justify-center border border-border/70 bg-background">
                <ProviderIcon providerId={provider.id} className="size-4" />
            </span>

            <span className="min-w-0">
                <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-xs font-semibold text-foreground">{provider.name}</span>
                    {isConnected ? (
                        <Badge variant="emerald" className="shrink-0 gap-1 px-1.5 py-0 font-mono text-[10px]">
                            <span className="size-1 rounded-full bg-emerald-500" aria-hidden="true" />
                            {connectedCount}
                        </Badge>
                    ) : null}
                </span>
                <span className="mt-0.5 flex min-w-0 items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
                    <span className="truncate">{provider.id}</span>
                    <span aria-hidden="true">·</span>
                    <span className="shrink-0">{protocolLabels[provider.protocol] ?? provider.protocol}</span>
                    <span aria-hidden="true">·</span>
                    <span className="shrink-0">{authLabel(provider)}</span>
                </span>
            </span>

            <span className="flex shrink-0 items-center gap-3 font-mono text-[10px] text-muted-foreground">
                <span className="hidden tabular-nums sm:inline">
                    {provider.models.length} {provider.models.length === 1 ? "model" : "models"}
                </span>
                <ChevronRight
                    className="size-3.5 transition-transform group-hover:translate-x-0.5"
                    strokeWidth={1.75}
                    aria-hidden="true"
                />
            </span>
        </Link>
    );
}
