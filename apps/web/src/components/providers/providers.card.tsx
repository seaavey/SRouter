import { Link } from "@tanstack/react-router";
import type { ProviderDefinition } from "@srouter/types";
import { ProviderIcon, ProviderStatusBadge } from "@/components/providers";
import { getConnectedCount, isProviderEnabled } from "@/utils/provider.utils";

export default function ProviderCard({ provider }: { provider: ProviderDefinition }) {
    const connectedCount = getConnectedCount(provider);
    const isConnected = connectedCount > 0;
    const isEnabled = isProviderEnabled(provider);

    return (
        <Link
            to="/providers/$providerId"
            params={{ providerId: provider.id }}
            className="group relative flex flex-col justify-between rounded-3xl border border-hairline-soft bg-canvas p-5 sm:p-6 transition-all duration-150 hover:border-hairline font-sans cursor-pointer shadow-none"
        >
            <div>
                <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3.5 min-w-0">
                        <div className="relative flex size-11 shrink-0 items-center justify-center rounded-[30%] border border-hairline-soft bg-canvas-soft p-2 transition-colors group-hover:border-hairline">
                            <ProviderIcon
                                providerId={provider.id}
                                providerUrl={
                                    provider.category === "custom_provider"
                                        ? provider.default_base_url
                                        : undefined
                                }
                                className="size-6"
                            />
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
                    <div className="shrink-0 flex items-center">
                        <ProviderStatusBadge
                            status={!isEnabled ? "disabled" : isConnected ? "connected" : "ready"}
                            count={connectedCount}
                        />
                    </div>
                </div>
            </div>
        </Link>
    );
}
