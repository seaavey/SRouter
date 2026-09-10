import { Link } from "@tanstack/react-router";
import { ArrowUpRight, Layers } from "lucide-react";
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
            className="group flex items-center justify-between gap-4 px-4 py-3.5 rounded-2xl hover:bg-canvas-soft transition-colors font-sans cursor-pointer border-b border-hairline-soft last:border-b-0"
        >
            {/* Left: Icon & Info */}
            <div className="flex items-center gap-3.5 min-w-0">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-[30%] border border-hairline-soft bg-canvas-soft group-hover:border-hairline transition-colors">
                    <ProviderIcon providerId={provider.id} className="size-5" />
                </div>

                <div className="min-w-0">
                    <div className="flex items-center gap-2.5 flex-wrap">
                        <span className="truncate text-sm font-semibold text-ink">
                            {provider.name}
                        </span>

                        {isConnected ? (
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                                <span className="size-1.5 rounded-full bg-emerald-500" />
                                <span>{connectedCount} live</span>
                            </span>
                        ) : (
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-canvas-soft px-2 py-0.5 text-xs font-medium text-text-muted">
                                <span className="size-1.5 rounded-full bg-text-muted/40" />
                                <span>Ready</span>
                            </span>
                        )}
                    </div>

                    <div className="mt-0.5 flex items-center gap-2 text-xs text-text-muted font-mono">
                        <span className="truncate text-ink font-medium">{provider.id}</span>
                        <span className="text-text-faint">·</span>
                        <span>{protocolLabels[provider.protocol] ?? provider.protocol}</span>
                        <span className="text-text-faint">·</span>
                        <span>{authLabel(provider)}</span>
                        {modelCount > 0 && (
                            <>
                                <span className="text-text-faint">·</span>
                                <span className="inline-flex items-center gap-1 text-text-muted">
                                    <Layers className="size-3 text-text-muted/70" />
                                    <span>{modelCount} models</span>
                                </span>
                            </>
                        )}
                    </div>
                </div>
            </div>

            {/* Right: Stadium Action Pill */}
            <div className="flex shrink-0 items-center gap-1.5 rounded-full bg-canvas-soft px-3.5 py-1.5 text-xs font-semibold text-ink group-hover:bg-ink group-hover:text-canvas transition-colors">
                <span className="hidden sm:inline">{isConnected ? "Configure" : "Connect"}</span>
                <ArrowUpRight className="size-3.5 stroke-[2] transition-transform duration-150 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </div>
        </Link>
    );
}
