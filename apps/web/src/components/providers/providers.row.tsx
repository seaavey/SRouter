import { Link } from "@tanstack/react-router";
import { ArrowUpRight, Cpu, Layers } from "lucide-react";
import type { ProviderDefinition } from "@srouter/types";
import { ProviderIcon } from "@/components/providers";
import { getConnectedCount } from "@/utils/provider.utils";

const protocolLabels: Record<string, string> = {
    openai: "OpenAI v1",
    anthropic: "Anthropic v1",
    gemini: "Gemini v1",
    custom: "Custom"
};

function authLabel(provider: ProviderDefinition): string {
    if (provider.requires_oauth) return "OAuth 2.0";
    if (provider.requires_api_key) return "API Key";
    return "Public";
}

export function ProviderRow({ provider }: { provider: ProviderDefinition }) {
    const connectedCount = getConnectedCount(provider);
    const isConnected = connectedCount > 0;
    const modelCount = provider.models?.length ?? 0;

    return (
        <Link
            to="/providers/$providerId"
            params={{ providerId: provider.id }}
            className="group flex items-center justify-between gap-3 px-4 py-3 rounded-lg hover:bg-secondary/40 transition-colors font-mono cursor-pointer border-b border-border/40 last:border-b-0"
        >
            {/* Left: Icon & Info */}
            <div className="flex items-center gap-3.5 min-w-0">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border/80 bg-secondary/60 shadow-2xs group-hover:border-border transition-colors">
                    <ProviderIcon providerId={provider.id} className="size-5" />
                </div>

                <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="truncate text-xs font-bold text-foreground">
                            {provider.name}
                        </span>

                        {isConnected ? (
                            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.2 text-[9.5px] font-semibold text-emerald-600 dark:text-emerald-400">
                                <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                {connectedCount}{" "}
                                {connectedCount === 1 ? "connection" : "connections"}
                            </span>
                        ) : (
                            <span className="rounded-full border border-border/60 bg-secondary/60 px-2 py-0.2 text-[9px] text-muted-foreground font-medium">
                                Ready
                            </span>
                        )}
                    </div>

                    <div className="mt-1 flex items-center gap-2 text-[10.5px] text-muted-foreground">
                        <span className="truncate text-foreground/80 font-medium">
                            {provider.id}
                        </span>
                        <span className="text-muted-foreground/40">·</span>
                        <span>{protocolLabels[provider.protocol] ?? provider.protocol}</span>
                        <span className="text-muted-foreground/40">·</span>
                        <span>{authLabel(provider)}</span>
                        {modelCount > 0 && (
                            <>
                                <span className="text-muted-foreground/40">·</span>
                                <span className="inline-flex items-center gap-1 text-muted-foreground/90">
                                    <Layers className="size-2.5 text-muted-foreground/70" />
                                    <span>{modelCount} models</span>
                                </span>
                            </>
                        )}
                    </div>
                </div>
            </div>

            {/* Right: Action */}
            <div className="flex shrink-0 items-center gap-2 text-xs font-bold text-foreground">
                <span className="hidden sm:inline text-[11px] text-muted-foreground group-hover:text-foreground transition-colors">
                    {isConnected ? "Configure" : "Connect"}
                </span>
                <div className="flex size-6 items-center justify-center rounded-full bg-secondary text-muted-foreground transition-all duration-200 group-hover:bg-foreground group-hover:text-background group-hover:translate-x-0.5 group-hover:-translate-y-0.5 shadow-2xs">
                    <ArrowUpRight className="size-3.5 stroke-[2.2]" />
                </div>
            </div>
        </Link>
    );
}
