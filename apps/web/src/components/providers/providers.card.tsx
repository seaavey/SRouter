import { Link } from "@tanstack/react-router";
import { ArrowUpRight, Layers } from "lucide-react";
import type { ProviderDefinition } from "@srouter/types";
import { ProviderIcon } from "@/components/providers";
import { getConnectedCount } from "@/utils/provider.utils";

export function ProviderCard({ provider }: { provider: ProviderDefinition }) {
    const connectedCount = getConnectedCount(provider);
    const isConnected = connectedCount > 0;
    const modelCount = provider.models?.length ?? 0;

    return (
        <Link
            to="/providers/$providerId"
            params={{ providerId: provider.id }}
            className="group relative flex flex-col justify-between rounded-3xl border border-hairline-soft bg-canvas p-5 sm:p-6 transition-all duration-150 hover:border-hairline font-sans cursor-pointer shadow-none"
        >
            {/* Top: Icon + Name & Status */}
            <div>
                <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3.5 min-w-0">
                        {/* 30% Squircle Icon Box */}
                        <div className="relative flex size-11 shrink-0 items-center justify-center rounded-[30%] border border-hairline-soft bg-canvas-soft p-2 transition-colors group-hover:border-hairline">
                            <ProviderIcon providerId={provider.id} className="size-6" />
                        </div>
                        <div className="min-w-0">
                            <h3 className="truncate text-sm font-semibold text-ink tracking-tight">
                                {provider.name}
                            </h3>
                            <div className="flex items-center gap-1.5 mt-0.5">
                                <span className="text-xs text-text-muted font-mono">
                                    {provider.id}
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* Status Pill */}
                    <div className="shrink-0 flex items-center">
                        {isConnected ? (
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                                <span className="size-1.5 rounded-full bg-emerald-500" />
                                <span>{connectedCount} live</span>
                            </span>
                        ) : (
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-canvas-soft px-2.5 py-0.5 text-xs text-text-muted font-medium">
                                <span className="size-1.5 rounded-full bg-text-muted/40" />
                                <span>Ready</span>
                            </span>
                        )}
                    </div>
                </div>
            </div>

            {/* Bottom: Action & Model Telemetry */}
            <div className="mt-5 pt-4 border-t border-hairline-soft flex items-center justify-between text-xs">
                <div className="flex items-center gap-1.5 text-xs text-text-muted font-mono">
                    {modelCount > 0 ? (
                        <>
                            <Layers className="size-3.5 text-text-muted/70" />
                            <span>
                                {modelCount} {modelCount === 1 ? "model" : "models"}
                            </span>
                        </>
                    ) : (
                        <span className="text-text-muted/60">
                            {isConnected ? "Connected Driver" : "Driver Ready"}
                        </span>
                    )}
                </div>

                {/* Stadium-Pill Action Indicator */}
                <div className="inline-flex items-center gap-1 rounded-full bg-canvas-soft px-3.5 py-1.5 text-xs font-semibold text-ink group-hover:bg-ink group-hover:text-canvas transition-colors">
                    <span>{isConnected ? "Configure" : "Connect"}</span>
                    <ArrowUpRight className="size-3.5 stroke-[2] transition-transform duration-150 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                </div>
            </div>
        </Link>
    );
}
