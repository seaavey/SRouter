import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import {
    ReactFlow,
    Background,
    Handle,
    Position,
    ReactFlowProvider,
    useReactFlow,
    type Node,
    type Edge,
    type NodeProps,
    type NodeMouseHandler,
    type NodeTypes,
    BackgroundVariant
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
    Zap,
    Boxes,
    ExternalLink,
    X,
    Maximize2,
    ZoomIn,
    ZoomOut,
    Orbit,
    LayoutGrid,
    Workflow,
    Server,
    Radio,
    Play,
    Activity
} from "lucide-react";
import { useCatalog } from "@/hooks/useCatalog";
import { useTokenSaver } from "@/hooks/useTokenSaver";
import { ProviderIcon } from "@/components/providers";
import { api, getGatewayBaseUrl } from "@/lib/api";
import { isProviderConnected, getConnectedCount } from "@/utils/provider.utils";
import type { ProviderDefinition, TokenSaverSettings, RequestLogEntry } from "@srouter/types";
import type { ListResponse } from "@/lib/types";

type CoreNodeData = {
    tokenSaverEnabled?: boolean;
    hasActiveTraffic?: boolean;
};

type ProviderNodeData = {
    id: string;
    name: string;
    isOnline: boolean;
    isReceivingRequest: boolean;
    lastLatency: number | null;
    count: number;
    modelCount: number;
    handlePos: Position;
};

type TopologyNode = Node<CoreNodeData, "centralCore"> | Node<ProviderNodeData, "orbitProvider">;

type SelectedNodeInfo =
    | { type: "core"; id: string; data: CoreNodeData }
    | { type: "provider"; id: string; data: ProviderNodeData };

function CentralCoreHubNode({ data, selected }: NodeProps<Node<CoreNodeData, "centralCore">>) {
    const isTokenSaverActive = Boolean(data.tokenSaverEnabled);
    const hasActiveTraffic = Boolean(data.hasActiveTraffic);

    return (
        <div
            className={`group relative rounded-2xl border bg-canvas p-4 font-mono text-left w-60 shadow-none transition-colors cursor-pointer ${
                selected
                    ? "border-ink ring-1 ring-ink/20"
                    : hasActiveTraffic
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
                            hasActiveTraffic
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
                        hasActiveTraffic
                            ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                            : "border-hairline-soft bg-canvas-soft text-text-muted"
                    }`}
                >
                    {hasActiveTraffic ? "ACTIVE" : "GATEWAY"}
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
                    <span
                        className={`font-medium ${
                            isTokenSaverActive ? "text-ink" : "text-text-muted"
                        }`}
                    >
                        {isTokenSaverActive ? "Active" : "Bypassed"}
                    </span>
                </div>
            </div>
        </div>
    );
}

function OrbitProviderNode({ data, selected }: NodeProps<Node<ProviderNodeData, "orbitProvider">>) {
    const { id, name, isOnline, isReceivingRequest, lastLatency, handlePos } = data;

    return (
        <div
            className={`group relative rounded-2xl border bg-canvas p-3 font-mono text-left w-44 shadow-none transition-colors cursor-pointer ${
                selected
                    ? "border-ink ring-1 ring-ink/20"
                    : isReceivingRequest
                      ? "border-ink ring-1 ring-ink/30"
                      : isOnline
                        ? "border-hairline-soft hover:border-hairline"
                        : "border-hairline-soft/60 opacity-60 hover:opacity-100"
            }`}
        >
            <Handle
                type="target"
                position={handlePos}
                className="!w-2 !h-2 !border-2 !border-canvas !bg-ink transition-colors"
            />

            <div className="flex items-center justify-between gap-1.5">
                <div className="flex items-center gap-2 min-w-0">
                    <div
                        className={`flex size-7 shrink-0 items-center justify-center rounded-[30%] p-1 transition-colors ${
                            isReceivingRequest
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

                {isReceivingRequest && (
                    <span className="rounded-full px-2 py-0.5 text-[8.5px] font-mono font-bold flex items-center gap-1 bg-ink text-canvas">
                        <span className="size-1 rounded-full bg-emerald-400" />
                        {lastLatency !== null ? `${lastLatency}ms` : "LIVE"}
                    </span>
                )}
            </div>
        </div>
    );
}

const nodeTypes: NodeTypes = {
    centralCore: CentralCoreHubNode,
    orbitProvider: OrbitProviderNode
};

function NodeDetailInspector({
    selectedNode,
    onClose,
    tokenSaverSettings,
    onTriggerTestRequest
}: {
    selectedNode: SelectedNodeInfo | null;
    onClose: () => void;
    tokenSaverSettings: TokenSaverSettings;
    onTriggerTestRequest?: (providerId: string) => void;
}) {
    if (!selectedNode) return null;

    const apiBase = getGatewayBaseUrl();

    return (
        <aside
            aria-label="Node Inspector"
            className="absolute right-3 top-3 bottom-3 z-30 w-80 max-w-[calc(100%-1.5rem)] rounded-3xl border border-hairline-soft bg-canvas p-6 font-mono shadow-none flex flex-col justify-between overflow-hidden"
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
                        <X className="size-3.5" />
                    </button>
                </div>

                <div className="mt-4 space-y-3 overflow-y-auto max-h-[260px] pr-1">
                    {selectedNode.type === "core" && (
                        <div className="space-y-3">
                            <div className="flex items-center gap-2">
                                <Zap className="size-3.5 text-ink" />
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
                                    <span className="font-semibold text-ink">
                                        {tokenSaverSettings.enabled ? "Active" : "Disabled"}
                                    </span>
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
                                        <Play className="size-2.5" />
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
                                        {selectedNode.data.isOnline
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
                                        {selectedNode.data.modelCount}
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
                        <ExternalLink className="size-3 text-text-muted" />
                    </Link>
                ) : (
                    <Link
                        to="/providers/$providerId"
                        params={{ providerId: selectedNode.data.id }}
                        className="flex w-full items-center justify-center gap-1.5 rounded-full border border-hairline bg-canvas px-4 py-2 text-xs font-semibold text-ink hover:bg-canvas-soft transition-colors"
                    >
                        <span>Provider Settings</span>
                        <ExternalLink className="size-3 text-text-muted" />
                    </Link>
                )}
            </div>
        </aside>
    );
}

function AutoCenterOnMount({ providerCount }: { providerCount: number }) {
    const { fitView } = useReactFlow();

    useEffect(() => {
        const timer1 = setTimeout(() => {
            fitView({ padding: 0.22, duration: 250 });
        }, 50);
        const timer2 = setTimeout(() => {
            fitView({ padding: 0.22 });
        }, 250);

        return () => {
            clearTimeout(timer1);
            clearTimeout(timer2);
        };
    }, [fitView, providerCount]);

    return null;
}

function CanvasControls() {
    const { zoomIn, zoomOut, fitView } = useReactFlow();

    return (
        <div className="absolute left-3 bottom-3 z-20 flex items-center gap-1 rounded-full border border-hairline-soft bg-canvas p-1 shadow-none font-mono">
            <button
                type="button"
                onClick={() => fitView({ padding: 0.22, duration: 300 })}
                className="flex size-7 items-center justify-center rounded-full text-text-muted hover:bg-canvas-soft hover:text-ink transition-colors cursor-pointer"
                title="Fit & Center View"
            >
                <Maximize2 className="size-3" />
            </button>
            <div className="h-3.5 w-px bg-hairline-soft" />
            <button
                type="button"
                onClick={() => zoomIn({ duration: 250 })}
                className="flex size-7 items-center justify-center rounded-full text-text-muted hover:bg-canvas-soft hover:text-ink transition-colors cursor-pointer"
                title="Zoom In"
            >
                <ZoomIn className="size-3" />
            </button>
            <button
                type="button"
                onClick={() => zoomOut({ duration: 250 })}
                className="flex size-7 items-center justify-center rounded-full text-text-muted hover:bg-canvas-soft hover:text-ink transition-colors cursor-pointer"
                title="Zoom Out"
            >
                <ZoomOut className="size-3" />
            </button>
        </div>
    );
}

function ProviderMatrixView({
    displayedProviders,
    isTokenSaverActive,
    activeProviderIds
}: {
    displayedProviders: ProviderDefinition[];
    isTokenSaverActive: boolean;
    activeProviderIds: Set<string>;
}) {
    const apiBase = getGatewayBaseUrl();

    return (
        <div className="p-4 font-mono space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border border-hairline-soft bg-canvas-soft/50 p-4">
                <div className="flex items-center gap-3">
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-canvas text-ink border border-hairline-soft">
                        <Zap className="size-4" />
                    </div>
                    <div>
                        <div className="text-xs font-bold text-ink font-sans">
                            SRouter Core Gateway
                        </div>
                        <div className="text-[11px] text-text-muted truncate max-w-sm font-mono">
                            {apiBase}
                        </div>
                    </div>
                </div>
                <div className="flex items-center gap-3 text-xs font-sans">
                    <div className="flex items-center gap-1.5">
                        <span className="size-2 rounded-full bg-emerald-500" />
                        <span className="text-text-muted">Circuit Breaker:</span>
                        <span className="font-semibold text-ink">Nominal</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <span className="text-text-muted">Token Saver:</span>
                        <span className="font-semibold text-ink">
                            {isTokenSaverActive ? "Active" : "Bypassed"}
                        </span>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                {displayedProviders.map((p) => {
                    const isOnline =
                        isProviderConnected(p) || p.id === "opencode_zen" || p.id === "opencode";
                    const connCount = getConnectedCount(p);
                    const isReceiving = activeProviderIds.has(p.id.toLowerCase());

                    return (
                        <Link
                            key={p.id}
                            to="/providers/$providerId"
                            params={{ providerId: p.id }}
                            className={`group flex flex-col justify-between rounded-2xl border bg-canvas p-4 transition-colors hover:border-hairline cursor-pointer shadow-none ${
                                isReceiving
                                    ? "border-ink ring-1 ring-ink/30"
                                    : "border-hairline-soft"
                            }`}
                        >
                            <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2.5 min-w-0">
                                    <div className="flex size-7 shrink-0 items-center justify-center rounded-[30%] bg-canvas-soft p-1">
                                        <ProviderIcon providerId={p.id} className="size-3.5" />
                                    </div>
                                    <div className="min-w-0">
                                        <h4 className="text-xs font-bold text-ink truncate font-sans">
                                            {p.name}
                                        </h4>
                                        <span className="text-[9px] text-text-muted uppercase">
                                            {p.id}
                                        </span>
                                    </div>
                                </div>
                                {isReceiving && (
                                    <span className="rounded-full px-2 py-0.5 text-[8.5px] font-mono font-bold bg-ink text-canvas">
                                        LIVE
                                    </span>
                                )}
                            </div>
                            <div className="mt-3 flex items-center justify-between text-[10px] text-text-muted pt-2 border-t border-hairline-soft font-mono">
                                <span>
                                    {connCount} key{connCount !== 1 ? "s" : ""}
                                </span>
                                <span>{p.models?.length ?? 0} models</span>
                            </div>
                        </Link>
                    );
                })}
            </div>
        </div>
    );
}

function GatewayTopologyCanvas() {
    const { allProviders } = useCatalog();
    const { settings: tokenSaverSettings } = useTokenSaver();

    const { data: logsData } = useQuery({
        queryKey: ["recent-logs-topology"],
        queryFn: () => api.get<ListResponse<RequestLogEntry>>("/v1/logs?limit=10"),
        refetchInterval: 800,
        refetchIntervalInBackground: true,
        staleTime: 0
    });

    const [selectedNode, setSelectedNode] = useState<SelectedNodeInfo | null>(null);
    const [viewMode, setViewMode] = useState<"graph" | "matrix">("graph");

    const [activePings, setActivePings] = useState<
        Record<string, { latency: number; expiresAt: number }>
    >({});
    const seenLogIdsRef = useRef<Set<string>>(new Set());
    const isFirstMountRef = useRef(true);

    useEffect(() => {
        if (!logsData?.data) return;

        const logs = logsData.data;
        const now = Date.now();
        const newPings: Record<string, { latency: number; expiresAt: number }> = {};
        let hasNew = false;

        if (isFirstMountRef.current) {
            isFirstMountRef.current = false;
            for (const log of logs) {
                seenLogIdsRef.current.add(log.id);
                if (now - log.createdAt < 3000) {
                    const normId = log.providerId.toLowerCase();
                    newPings[normId] = {
                        latency: log.latencyMs,
                        expiresAt: log.createdAt + 5000
                    };
                    hasNew = true;
                }
            }
        } else {
            for (const log of logs) {
                if (!seenLogIdsRef.current.has(log.id)) {
                    seenLogIdsRef.current.add(log.id);
                    const normId = log.providerId.toLowerCase();
                    newPings[normId] = {
                        latency: log.latencyMs,
                        expiresAt: log.createdAt + 5000
                    };
                    hasNew = true;
                }
            }
        }

        if (hasNew) {
            setActivePings((prev) => ({ ...prev, ...newPings }));
        }
    }, [logsData]);

    useEffect(() => {
        const interval = setInterval(() => {
            const now = Date.now();
            setActivePings((prev) => {
                let hasExpired = false;
                const next: Record<string, { latency: number; expiresAt: number }> = {};
                for (const [id, item] of Object.entries(prev)) {
                    if (item.expiresAt > now) {
                        next[id] = item;
                    } else {
                        hasExpired = true;
                    }
                }
                return hasExpired ? next : prev;
            });
        }, 250);
        return () => clearInterval(interval);
    }, []);

    const activeProviderIdsSet = useMemo(() => {
        return new Set(Object.keys(activePings));
    }, [activePings]);

    const hasAnyActiveTraffic = activeProviderIdsSet.size > 0;

    const connectedProviders = useMemo(() => {
        const list = allProviders.filter(
            (p) =>
                p.id === "opencode_zen" ||
                p.id === "opencode" ||
                (!p.requires_api_key && !p.requires_oauth) ||
                isProviderConnected(p) ||
                (p.status?.connectedCount ?? 0) > 0 ||
                p.status?.state === "connected" ||
                (p.connections && p.connections.length > 0)
        );

        const hasOpenCode = list.some((p) => p.id === "opencode_zen" || p.id === "opencode");
        if (!hasOpenCode) {
            const zen = allProviders.find((p) => p.id === "opencode_zen" || p.id === "opencode");
            if (zen) list.push(zen);
        }

        return list;
    }, [allProviders]);

    const displayedProviders = useMemo(() => {
        if (connectedProviders.length > 0) {
            return connectedProviders;
        }
        return allProviders.slice(0, 8);
    }, [connectedProviders, allProviders]);

    const triggerTestRequest = useCallback((providerId: string) => {
        setActivePings((prev) => ({
            ...prev,
            [providerId.toLowerCase()]: {
                latency: Math.floor(Math.random() * 150 + 50),
                expiresAt: Date.now() + 5000
            }
        }));
    }, []);

    const { nodes, edges } = useMemo(() => {
        const nodeList: TopologyNode[] = [];
        const edgeList: Edge[] = [];

        const centerX = 0;
        const centerY = 0;

        nodeList.push({
            id: "node-core",
            type: "centralCore",
            position: { x: -128, y: -50 },
            data: {
                tokenSaverEnabled: tokenSaverSettings?.enabled,
                hasActiveTraffic: hasAnyActiveTraffic
            }
        });

        const providerCount = displayedProviders.length;

        const radiusX = Math.max(300, Math.min(420, 260 + providerCount * 10));
        const radiusY = Math.max(190, Math.min(280, 160 + providerCount * 8));

        displayedProviders.forEach((provider, index) => {
            const nodeId = `node-provider-${provider.id}`;
            const isZen =
                provider.id === "opencode_zen" ||
                provider.id === "opencode" ||
                (!provider.requires_api_key && !provider.requires_oauth);
            const isOnline = isZen || isProviderConnected(provider);
            const connCount = getConnectedCount(provider) || (isZen ? 1 : 0);

            const activeTraffic = activePings[provider.id.toLowerCase()];
            const isReceivingRequest = Boolean(activeTraffic);

            const angle =
                providerCount === 1 ? 0 : (index / providerCount) * 2 * Math.PI - Math.PI / 2;

            const posX = Math.round(centerX + radiusX * Math.cos(angle) - 88);
            const posY = Math.round(centerY + radiusY * Math.sin(angle) - 25);

            const cosA = Math.cos(angle);
            const sinA = Math.sin(angle);

            let handlePos: Position = Position.Left;
            let sourceHandleId = "core-out-right";

            if (Math.abs(cosA) >= Math.abs(sinA)) {
                if (cosA > 0) {
                    handlePos = Position.Left;
                    sourceHandleId = "core-out-right";
                } else {
                    handlePos = Position.Right;
                    sourceHandleId = "core-out-left";
                }
            } else {
                if (sinA < 0) {
                    handlePos = Position.Bottom;
                    sourceHandleId = "core-out-top";
                } else {
                    handlePos = Position.Top;
                    sourceHandleId = "core-out-bottom";
                }
            }

            nodeList.push({
                id: nodeId,
                type: "orbitProvider",
                position: { x: posX, y: posY },
                data: {
                    id: provider.id,
                    name: provider.name,
                    isOnline,
                    isReceivingRequest,
                    lastLatency: activeTraffic?.latency ?? null,
                    count: connCount,
                    modelCount: provider.models?.length ?? 0,
                    handlePos
                }
            });

            edgeList.push({
                id: `edge-core-${provider.id}`,
                source: "node-core",
                sourceHandle: sourceHandleId,
                target: nodeId,
                type: "smoothstep",
                animated: isReceivingRequest,
                style: {
                    stroke: isReceivingRequest
                        ? "var(--ink)"
                        : isOnline
                          ? "var(--hairline)"
                          : "var(--hairline-soft)",
                    strokeWidth: isReceivingRequest ? 2 : 1,
                    strokeDasharray: isReceivingRequest ? "4 3" : undefined,
                    opacity: isReceivingRequest ? 1 : isOnline ? 0.9 : 0.4
                }
            });
        });

        return { nodes: nodeList, edges: edgeList };
    }, [displayedProviders, tokenSaverSettings?.enabled, activePings, hasAnyActiveTraffic]);

    const handleNodeClick = useCallback<NodeMouseHandler>((_, node) => {
        if (node.type === "orbitProvider") {
            setSelectedNode({ type: "provider", id: node.id, data: node.data as ProviderNodeData });
        } else if (node.type === "centralCore") {
            setSelectedNode({ type: "core", id: node.id, data: node.data as CoreNodeData });
        }
    }, []);

    const handlePaneClick = useCallback(() => {
        setSelectedNode(null);
    }, []);

    return (
        <section
            aria-label="Gateway Architecture Topology"
            className="p-6 font-mono relative overflow-hidden"
        >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-hairline-soft pb-4 mb-4">
                <div className="flex items-center gap-3">
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-canvas text-ink border border-hairline-soft">
                        <Orbit className="size-4" strokeWidth={1.75} />
                    </div>
                    <div>
                        <div className="flex items-center gap-2">
                            <h2 className="font-heading text-base font-semibold text-ink">
                                Mesh Routing Topology.
                            </h2>
                            {hasAnyActiveTraffic && (
                                <span className="flex items-center gap-1.5 text-xs font-mono text-ink font-semibold">
                                    <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
                                    Active
                                </span>
                            )}
                        </div>
                        <p className="text-xs text-text-muted mt-0.5 font-sans">
                            Radial constellation of SRouter Core dispatching directly to connected
                            providers
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-1 rounded-full border border-hairline-soft bg-canvas p-1">
                    <button
                        type="button"
                        onClick={() => setViewMode("graph")}
                        className={`flex items-center gap-1.5 rounded-full px-3.5 py-1 text-xs font-semibold transition-colors cursor-pointer ${
                            viewMode === "graph"
                                ? "bg-ink text-canvas shadow-none"
                                : "text-text-muted hover:text-ink"
                        }`}
                    >
                        <Workflow className="size-3" />
                        <span>Radial Orbit</span>
                    </button>
                    <button
                        type="button"
                        onClick={() => setViewMode("matrix")}
                        className={`flex items-center gap-1.5 rounded-full px-3.5 py-1 text-xs font-semibold transition-colors cursor-pointer ${
                            viewMode === "matrix"
                                ? "bg-ink text-canvas shadow-none"
                                : "text-text-muted hover:text-ink"
                        }`}
                    >
                        <LayoutGrid className="size-3" />
                        <span>Provider Grid</span>
                    </button>
                </div>
            </div>

            {viewMode === "graph" ? (
                <div className="h-[480px] w-full rounded-2xl border border-hairline-soft bg-canvas overflow-hidden relative">
                    <ReactFlow
                        nodes={nodes}
                        edges={edges}
                        nodeTypes={nodeTypes}
                        onNodeClick={handleNodeClick}
                        onPaneClick={handlePaneClick}
                        fitView
                        fitViewOptions={{ padding: 0.22, includeHiddenNodes: false }}
                        proOptions={{ hideAttribution: true }}
                        minZoom={0.2}
                        maxZoom={1.5}
                    >
                        <Background
                            variant={BackgroundVariant.Dots}
                            gap={16}
                            size={1}
                            color="var(--hairline, #e0e0e0)"
                        />
                        <CanvasControls />
                        <AutoCenterOnMount providerCount={displayedProviders.length} />
                    </ReactFlow>

                    <NodeDetailInspector
                        selectedNode={selectedNode}
                        onClose={() => setSelectedNode(null)}
                        tokenSaverSettings={tokenSaverSettings}
                        onTriggerTestRequest={triggerTestRequest}
                    />
                </div>
            ) : (
                <ProviderMatrixView
                    displayedProviders={displayedProviders}
                    isTokenSaverActive={Boolean(tokenSaverSettings?.enabled)}
                    activeProviderIds={activeProviderIdsSet}
                />
            )}
        </section>
    );
}

export function GatewayTopologyMap() {
    return (
        <ReactFlowProvider>
            <GatewayTopologyCanvas />
        </ReactFlowProvider>
    );
}
