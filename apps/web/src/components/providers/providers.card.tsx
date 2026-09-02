import { Link } from "@tanstack/react-router";
import { ArrowUpRight, CheckCircle2, Cpu, Layers } from "lucide-react";
import type { ProviderDefinition } from "@srouter/types";
import { ProviderIcon } from "@/components/providers/providers.icon";
import { getConnectedCount } from "@/utils/provider.utils";
import { CATEGORY_LABELS } from "@srouter/constants";

const protocolLabels: Record<string, string> = {
    openai: "OpenAI v1",
    anthropic: "Anthropic v1",
    gemini: "Gemini v1",
    custom: "Custom"
};

export function ProviderCard({ provider }: { provider: ProviderDefinition }) {
    const connectedCount = getConnectedCount(provider);
    const isConnected = connectedCount > 0;
    const modelCount = provider.models?.length ?? 0;

    return (
        <Link
            to="/providers/$providerId"
            params={{ providerId: provider.id }}
            className="group relative flex flex-col justify-between rounded-xl border border-border/80 bg-card/60 p-4 transition-all duration-200 hover:border-foreground/30 hover:bg-card hover:shadow-xs active:scale-[0.99] font-mono cursor-pointer"
        >
            {/* Top: Icon + Name & Status */}
            <div>
                <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                        {/* Machine-bezel Icon Box */}
                        <div className="relative flex size-10 shrink-0 items-center justify-center rounded-lg border border-border/80 bg-secondary/60 p-2 shadow-2xs group-hover:border-border transition-colors">
                            <ProviderIcon providerId={provider.id} className="size-5.5" />
                        </div>
                        <div className="min-w-0">
                            <h3 className="truncate text-xs font-bold text-foreground group-hover:text-foreground">
                                {provider.name}
                            </h3>
                            <div className="flex items-center gap-1.5 mt-0.5">
                                <span className="text-[10px] text-muted-foreground/80 font-medium">
                                    {provider.id}
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* Status Pill */}
                    {isConnected ? (
                        <div className="shrink-0 inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-[9.5px] font-semibold text-emerald-600 dark:text-emerald-400">
                            <span className="relative flex size-1.5">
                                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                                <span className="relative inline-flex size-1.5 rounded-full bg-emerald-500" />
                            </span>
                            <span>{connectedCount} live</span>
                        </div>
                    ) : (
                        <div className="shrink-0 rounded-full border border-border/60 bg-secondary/50 px-2 py-0.5 text-[9.5px] text-muted-foreground font-medium">
                            Ready
                        </div>
                    )}
                </div>

            </div>

            {/* Bottom: Action & Model Telemetry */}
            <div className="mt-4 pt-3 border-t border-border/60 flex items-center justify-between text-xs">
                <div className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
                    {modelCount > 0 ? (
                        <>
                            <Layers className="size-3 text-muted-foreground/70" />
                            <span>
                                {modelCount} {modelCount === 1 ? "model" : "models"}
                            </span>
                        </>
                    ) : (
                        <span className="text-muted-foreground/60">
                            {isConnected ? "Connected Driver" : "Driver Ready"}
                        </span>
                    )}
                </div>

                {/* Button-in-Button Action */}
                <div className="inline-flex items-center gap-1 text-[11px] font-bold text-foreground group-hover:text-foreground">
                    <span>{isConnected ? "Configure" : "Connect"}</span>
                    <div className="flex size-5 items-center justify-center rounded-full bg-secondary text-muted-foreground transition-all duration-200 group-hover:bg-foreground group-hover:text-background group-hover:translate-x-0.5 group-hover:-translate-y-0.5">
                        <ArrowUpRight className="size-3 stroke-[2.2]" />
                    </div>
                </div>
            </div>
        </Link>
    );
}
