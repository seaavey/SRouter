import { Link } from "@tanstack/react-router";
import { ExternalLink, Play, X, Zap } from "lucide-react";
import { ProviderIcon } from "@/components/providers";
import { getGatewayBaseUrl } from "@/lib/api";
import type { SelectedNodeInfo } from "./topology.typed";

export function NodeDetailInspector({
    selectedNode,
    onClose,
    onTriggerTestRequest
}: {
    selectedNode: SelectedNodeInfo | null;
    onClose: () => void;
    onTriggerTestRequest?: (providerId: string) => void;
}) {
    if (!selectedNode) return null;

    const apiBase = getGatewayBaseUrl();

    return (
        <aside
            aria-label="Node Inspector"
            className="absolute inset-x-3 bottom-3 z-30 max-h-[calc(100%-1.5rem)] rounded-3xl border border-hairline-soft bg-canvas p-4 font-mono shadow-none flex flex-col justify-between overflow-hidden md:inset-x-auto md:right-3 md:top-3 md:bottom-3 md:w-80 md:p-6"
        >
            <div>
                <div className="flex items-center justify-between pb-3 border-b border-hairline-soft">
                    <div className="flex items-center gap-2">
                        <span className="size-2 rounded-full bg-ink" />
                        <h3 className="text-xs font-bold uppercase tracking-wider text-ink font-sans">
                            Node Telemetry
                        </h3>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-full p-1 text-text-muted hover:bg-canvas-soft hover:text-ink transition-colors cursor-pointer"
                        title="Close Inspector"
                    >
                        <X className="size-3.5" aria-hidden="true" />
                    </button>
                </div>

                <div className="mt-4 space-y-3 overflow-y-auto max-h-[260px] pr-1">
                    {selectedNode.type === "core" && (
                        <div className="space-y-3">
                            <div className="flex items-center gap-2">
                                <Zap className="size-3.5 text-ink" aria-hidden="true" />
                                <span className="text-xs font-bold text-ink font-sans">
                                    SRouter Core Gateway
                                </span>
                            </div>
                            <p className="text-xs text-text-muted leading-relaxed font-sans">
                                High-speed proxy middleware hub dispatching requests directly to
                                surrounding upstream providers.
                            </p>

                            <div className="space-y-2 rounded-2xl border border-hairline-soft bg-canvas-soft/50 p-3 text-[11px]">
                                <div className="flex justify-between">
                                    <span className="text-text-muted font-sans">
                                        Base Gateway URL:
                                    </span>
                                    <code className="text-ink font-semibold text-[10px] truncate max-w-[120px]">
                                        {apiBase}
                                    </code>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-text-muted font-sans">
                                        Token Compression:
                                    </span>
                                    <span className="font-semibold text-ink">Active</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-text-muted font-sans">
                                        Circuit Breaker:
                                    </span>
                                    <span className="font-semibold text-ink">Nominal</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-text-muted font-sans">
                                        Overhead Latency:
                                    </span>
                                    <span className="font-semibold text-ink">&lt; 1.2ms</span>
                                </div>
                            </div>
                        </div>
                    )}

                    {selectedNode.type === "provider" && (
                        <div className="space-y-3">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <ProviderIcon
                                        providerId={selectedNode.data.id}
                                        className="size-4"
                                    />
                                    <span className="text-xs font-bold text-ink font-sans">
                                        {selectedNode.data.name}
                                    </span>
                                </div>
                                {onTriggerTestRequest && (
                                    <button
                                        type="button"
                                        onClick={() => onTriggerTestRequest(selectedNode.data.id)}
                                        className="inline-flex items-center gap-1 rounded-full border border-hairline bg-canvas px-2.5 py-1 text-[9px] font-bold text-ink hover:bg-canvas-soft transition-colors cursor-pointer"
                                        title="Simulate 5-Second Request Glow"
                                    >
                                        <Play className="size-2.5" aria-hidden="true" />
                                        <span>Ping (5s)</span>
                                    </button>
                                )}
                            </div>
                            <p className="text-xs text-text-muted leading-relaxed font-sans">
                                Upstream inference endpoint orbiting the central gateway core.
                            </p>

                            <div className="space-y-2 rounded-2xl border border-hairline-soft bg-canvas-soft/50 p-3 text-[11px]">
                                <div className="flex justify-between">
                                    <span className="text-text-muted font-sans">Status:</span>
                                    <span className="font-semibold text-ink capitalize">
                                        {selectedNode.data.is_online
                                            ? "Connected & Online"
                                            : "Standby"}
                                    </span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-text-muted font-sans">
                                        Connected Keys:
                                    </span>
                                    <span className="font-semibold text-ink">
                                        {selectedNode.data.count}
                                    </span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-text-muted font-sans">
                                        Supported Models:
                                    </span>
                                    <span className="font-semibold text-ink">
                                        {selectedNode.data.model_count}
                                    </span>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            <div className="pt-3 border-t border-hairline-soft">
                {selectedNode.type === "core" ? (
                    <Link
                        to="/settings"
                        className="flex w-full items-center justify-center gap-1.5 rounded-full border border-hairline bg-canvas px-4 py-2 text-xs font-semibold text-ink hover:bg-canvas-soft transition-colors"
                    >
                        <span>Configure Settings</span>
                        <ExternalLink className="size-3 text-text-muted" aria-hidden="true" />
                    </Link>
                ) : (
                    <Link
                        to="/providers/$providerId"
                        params={{ providerId: selectedNode.data.id }}
                        className="flex w-full items-center justify-center gap-1.5 rounded-full border border-hairline bg-canvas px-4 py-2 text-xs font-semibold text-ink hover:bg-canvas-soft transition-colors"
                    >
                        <span>Provider Settings</span>
                        <ExternalLink className="size-3 text-text-muted" aria-hidden="true" />
                    </Link>
                )}
            </div>
        </aside>
    );
}
