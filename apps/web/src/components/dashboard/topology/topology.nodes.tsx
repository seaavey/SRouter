import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { ProviderIcon } from "@/components/providers";
import { Zap } from "lucide-react";
import type { CoreNodeData, ProviderNodeData } from "./topology.typed";

export function CentralCoreHubNode({
    data,
    selected
}: NodeProps<Node<CoreNodeData, "centralCore">>) {
    const has_active_traffic = Boolean(data.has_active_traffic);

    return (
        <div
            className={`group relative rounded-2xl border bg-canvas p-4 font-mono text-left w-60 shadow-none transition-colors cursor-pointer ${
                selected
                    ? "border-ink ring-1 ring-ink/20"
                    : has_active_traffic
                      ? "border-ink ring-1 ring-ink/20"
                      : "border-hairline-soft hover:border-hairline"
            }`}
        >
            <Handle
                type="source"
                position={Position.Top}
                id="core-out-top"
                className="!bg-ink !w-2 !h-2 !border-2 !border-canvas"
            />
            <Handle
                type="source"
                position={Position.Right}
                id="core-out-right"
                className="!bg-ink !w-2 !h-2 !border-2 !border-canvas"
            />
            <Handle
                type="source"
                position={Position.Bottom}
                id="core-out-bottom"
                className="!bg-ink !w-2 !h-2 !border-2 !border-canvas"
            />
            <Handle
                type="source"
                position={Position.Left}
                id="core-out-left"
                className="!bg-ink !w-2 !h-2 !border-2 !border-canvas"
            />

            <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-hairline-soft">
                <div className="flex items-center gap-2.5 min-w-0">
                    <div
                        className={`flex size-7 shrink-0 items-center justify-center rounded-full transition-colors ${
                            has_active_traffic
                                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                                : "bg-canvas-soft text-ink"
                        }`}
                    >
                        <Zap className="size-3.5" strokeWidth={2} />
                    </div>
                    <div className="min-w-0">
                        <span className="block text-[9px] font-semibold uppercase tracking-wider text-text-muted">
                            Central Hub
                        </span>
                        <h3 className="text-xs font-bold text-ink truncate font-sans">
                            SRouter Core
                        </h3>
                    </div>
                </div>
                <span
                    className={`rounded-full border px-2 py-0.5 text-[9px] font-mono font-semibold transition-colors ${
                        has_active_traffic
                            ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                            : "border-hairline-soft bg-canvas-soft text-text-muted"
                    }`}
                >
                    {has_active_traffic ? "ACTIVE" : "GATEWAY"}
                </span>
            </div>

            <div className="mt-3 space-y-1.5 text-[10.5px]">
                <div className="flex items-center justify-between rounded-xl bg-canvas-soft/60 px-2.5 py-1.5">
                    <span className="text-text-muted font-sans">Circuit Breaker</span>
                    <span className="flex items-center gap-1.5 font-medium text-ink">
                        <span className="size-1.5 rounded-full bg-emerald-500" />
                        Nominal
                    </span>
                </div>
                <div className="flex items-center justify-between rounded-xl bg-canvas-soft/60 px-2.5 py-1.5">
                    <span className="text-text-muted font-sans">Token Saver</span>
                    <span className="font-medium text-ink">Active</span>
                </div>
            </div>
        </div>
    );
}

export function OrbitProviderNode({
    data,
    selected
}: NodeProps<Node<ProviderNodeData, "orbitProvider">>) {
    const { id, name, is_online, is_receiving_request, last_latency, handle_pos } = data;

    return (
        <div
            className={`group relative rounded-2xl border bg-canvas p-3 font-mono text-left w-44 shadow-none transition-colors cursor-pointer ${
                selected
                    ? "border-ink ring-1 ring-ink/20"
                    : is_receiving_request
                      ? "border-ink ring-1 ring-ink/30"
                      : is_online
                        ? "border-hairline-soft hover:border-hairline"
                        : "border-hairline-soft/60 opacity-60 hover:opacity-100"
            }`}
        >
            <Handle
                type="target"
                position={handle_pos}
                className="!w-2 !h-2 !border-2 !border-canvas !bg-ink transition-colors"
            />

            <div className="flex items-center justify-between gap-1.5">
                <div className="flex items-center gap-2 min-w-0">
                    <div
                        className={`flex size-7 shrink-0 items-center justify-center rounded-[30%] p-1 transition-colors ${
                            is_receiving_request
                                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                                : "bg-canvas-soft text-ink"
                        }`}
                    >
                        <ProviderIcon providerId={id} className="size-3.5" />
                    </div>
                    <div className="min-w-0">
                        <span className="block text-xs font-semibold text-ink truncate font-sans">
                            {name}
                        </span>
                        <span className="block text-[9px] text-text-muted uppercase truncate">
                            {id}
                        </span>
                    </div>
                </div>

                {is_receiving_request && (
                    <span className="rounded-full px-2 py-0.5 text-[8.5px] font-mono font-bold flex items-center gap-1 bg-ink text-canvas">
                        <span className="size-1 rounded-full bg-emerald-400" />
                        {last_latency !== null ? `${last_latency}ms` : "LIVE"}
                    </span>
                )}
            </div>
        </div>
    );
}
