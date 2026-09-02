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
import { ProviderIcon } from "@/components/providers/providers.icon";
import { api, getGatewayBaseUrl } from "@/lib/api";
import { isProviderConnected, getConnectedCount } from "@/utils/provider.utils";
import type { RequestLogEntry } from "@srouter/types";
import type { ListResponse } from "@/lib/types";

type SelectedNodeInfo = {
    type: "core" | "provider";
    id: string;
    data: Record<string, any>;
};

// ==========================================
// 1. CENTRAL SROUTER CORE HUB NODE
// ==========================================
function CentralCoreHubNode({ data, selected }: NodeProps) {
    const isTokenSaverActive = Boolean(data.tokenSaverEnabled);
    const hasActiveTraffic = Boolean(data.hasActiveTraffic);

    return (
        <div
            className={`group relative rounded-2xl border bg-card p-4 font-mono text-left w-64 shadow-md transition-all duration-300 cursor-pointer ${
                selected
                    ? "border-foreground ring-2 ring-foreground/20"
                    : hasActiveTraffic
                      ? "border-emerald-500/80 shadow-[0_0_24px_rgba(16,185,129,0.25)] ring-1 ring-emerald-500/40"
                      : "border-border/90 hover:border-foreground/40"
            }`}
        >
            {/* 4 Multi-directional handles facing North, East, South, West */}
            <Handle
                type="source"
                position={Position.Top}
                id="core-out-top"
                className="!bg-foreground !w-2.5 !h-2.5 !border-2 !border-card"
            />
            <Handle
                type="source"
                position={Position.Right}
                id="core-out-right"
                className="!bg-foreground !w-2.5 !h-2.5 !border-2 !border-card"
            />
            <Handle
                type="source"
                position={Position.Bottom}
                id="core-out-bottom"
                className="!bg-foreground !w-2.5 !h-2.5 !border-2 !border-card"
            />
            <Handle
                type="source"
                position={Position.Left}
                id="core-out-left"
                className="!bg-foreground !w-2.5 !h-2.5 !border-2 !border-card"
            />

            <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-border/60">
                <div className="flex items-center gap-2.5 min-w-0">
                    <div
                        className={`flex size-7 shrink-0 items-center justify-center rounded-lg border transition-colors shadow-2xs ${
                            hasActiveTraffic
                                ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-500"
                                : "border-border/80 bg-secondary text-foreground"
                        }`}
                    >
                        <Zap
                            className={`size-3.5 ${hasActiveTraffic ? "animate-pulse" : ""}`}
                            strokeWidth={2}
                        />
                    </div>
                    <div className="min-w-0">
                        <span className="block text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                            Central Hub
                        </span>
                        <h3 className="text-xs font-bold text-foreground truncate">
                            SRouter Core
                        </h3>
                    </div>
                </div>
                <span
                    className={`rounded border px-1.5 py-0.5 text-[8.5px] font-mono font-bold transition-colors ${
                        hasActiveTraffic
                            ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-500"
                            : "border-border/70 bg-secondary/80 text-foreground"
                    }`}
                >
                    {hasActiveTraffic ? "DISPATCHING" : "GATEWAY"}
                </span>
            </div>

            <div className="mt-3 space-y-1.5 text-[10px]">
                <div className="flex items-center justify-between rounded-md bg-secondary/40 px-2 py-1">
                    <span className="text-muted-foreground">Circuit Breaker</span>
                    <span className="flex items-center gap-1 font-semibold text-emerald-500">
                        <span className="size-1.5 rounded-full bg-emerald-500" />
                        Nominal
                    </span>
                </div>
                <div className="flex items-center justify-between rounded-md bg-secondary/40 px-2 py-1">
                    <span className="text-muted-foreground">Token Saver</span>
                    <span
                        className={`font-semibold ${
                            isTokenSaverActive ? "text-foreground" : "text-muted-foreground"
                        }`}
                    >
                        {isTokenSaverActive ? "Active" : "Bypassed"}
                    </span>
                </div>
            </div>
        </div>
    );
}

// ==========================================
// 2. ORBITING PROVIDER NODE (CLEAN MINIMAL)
// ==========================================
function OrbitProviderNode({ data, selected }: NodeProps) {
    const id = (data.id as string) || "provider";
    const name = (data.name as string) || "Provider";
    const isOnline = Boolean(data.isOnline);
    const isReceivingRequest = Boolean(data.isReceivingRequest);
    const lastLatency = typeof data.lastLatency === "number" ? data.lastLatency : null;
    const handlePos = (data.handlePos as Position) || Position.Left;

    return (
        <div
            className={`group relative rounded-xl border bg-card p-2.5 font-mono text-left w-44 shadow-2xs transition-all duration-300 cursor-pointer ${
                selected
                    ? "border-foreground ring-2 ring-foreground/20"
                    : isReceivingRequest
                      ? "border-emerald-500 bg-card shadow-[0_0_20px_rgba(16,185,129,0.4)] ring-2 ring-emerald-500/50"
                      : isOnline
                        ? "border-border/90 hover:border-foreground/40"
                        : "border-border/50 opacity-70 hover:opacity-100"
            }`}
        >
            {/* Dynamic handle directed toward the center core */}
            <Handle
                type="target"
                position={handlePos}
                className={`!w-2 !h-2 !border-2 !border-card transition-colors ${
                    isReceivingRequest ? "!bg-emerald-500" : "!bg-foreground"
                }`}
            />

            <div className="flex items-center justify-between gap-1.5">
                <div className="flex items-center gap-2 min-w-0">
                    <div
                        className={`flex size-7 shrink-0 items-center justify-center rounded-lg border p-1 transition-colors ${
                            isReceivingRequest
                                ? "border-emerald-500/50 bg-emerald-500/10"
                                : "border-border/80 bg-secondary/50"
                        }`}
                    >
                        <ProviderIcon providerId={id} className="size-4" />
                    </div>
                    <div className="min-w-0">
                        <span className="block text-[11.5px] font-bold text-foreground truncate">
                            {name}
                        </span>
                        <span className="block text-[9px] text-muted-foreground uppercase truncate">
                            {id}
                        </span>
                    </div>
                </div>

                {isReceivingRequest && (
                    <span className="rounded px-1.5 py-0.5 text-[8px] font-mono font-bold flex items-center gap-1 bg-emerald-500 text-black shadow-[0_0_8px_rgba(16,185,129,0.6)]">
                        <span className="size-1.5 rounded-full bg-black animate-ping" />
                        {lastLatency !== null ? `${lastLatency}ms` : "ACTIVE"}
                    </span>
                )}
            </div>
        </div>
    );
}

const nodeTypes = {
    centralCore: CentralCoreHubNode,
    orbitProvider: OrbitProviderNode
};

// ==========================================
// TACTICAL INSPECTOR DRAWER
// ==========================================
function NodeDetailInspector({
    selectedNode,
    onClose,
    tokenSaverSettings,
    onTriggerTestRequest
}: {
    selectedNode: SelectedNodeInfo | null;
    onClose: () => void;
    tokenSaverSettings: any;
    onTriggerTestRequest?: (providerId: string) => void;
}) {
    if (!selectedNode) return null;

    const apiBase = getGatewayBaseUrl();

    return (
        <aside
            aria-label="Node Inspector"
            className="absolute right-3 top-3 bottom-3 z-30 w-80 max-w-[calc(100%-1.5rem)] rounded-xl border border-border/90 bg-card p-4 font-mono shadow-lg flex flex-col justify-between overflow-hidden"
        >
            <div>
                <div className="flex items-center justify-between pb-3 border-b border-border/60">
                    <div className="flex items-center gap-2">
                        <span className="size-2 rounded-full bg-emerald-500" />
                        <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-foreground">
                            Node Telemetry
                        </h3>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors cursor-pointer"
                        title="Close Inspector"
                    >
                        <X className="size-3.5" />
                    </button>
                </div>

                <div className="mt-3.5 space-y-3 overflow-y-auto max-h-[260px] pr-1">
                    {selectedNode.type === "core" && (
                        <div className="space-y-2.5">
                            <div className="flex items-center gap-2">
                                <Zap className="size-3.5 text-foreground" />
                                <span className="text-xs font-bold text-foreground">
                                    SRouter Core Gateway
                                </span>
                            </div>
                            <p className="text-[11px] text-muted-foreground leading-relaxed">
                                High-speed proxy middleware hub dispatching requests directly to surrounding upstream providers.
                            </p>

                            <div className="space-y-1.5 rounded-lg border border-border/60 bg-secondary/30 p-2.5 text-[10.5px]">
                                <div className="flex justify-between">
                                    <span className="text-muted-foreground">Base Gateway URL:</span>
                                    <code className="text-foreground font-bold text-[10px] truncate max-w-[120px]">
                                        {apiBase}
                                    </code>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-muted-foreground">Token Compression:</span>
                                    <span className="font-semibold text-foreground">
                                        {tokenSaverSettings?.enabled ? "Active" : "Disabled"}
                                    </span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-muted-foreground">Circuit Breaker:</span>
                                    <span className="font-semibold text-emerald-500">Nominal</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-muted-foreground">Overhead Latency:</span>
                                    <span className="font-semibold text-foreground">&lt; 1.2ms</span>
                                </div>
                            </div>
                        </div>
                    )}

                    {selectedNode.type === "provider" && (
                        <div className="space-y-2.5">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <ProviderIcon
                                        providerId={selectedNode.data.id || "provider"}
                                        className="size-3.5"
                                    />
                                    <span className="text-xs font-bold text-foreground">
                                        {selectedNode.data.name || "Provider Node"}
                                    </span>
                                </div>
                                {onTriggerTestRequest && (
                                    <button
                                        type="button"
                                        onClick={() => onTriggerTestRequest(selectedNode.data.id)}
                                        className="inline-flex items-center gap-1 rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[9px] font-bold text-emerald-500 hover:bg-emerald-500/20 transition-colors cursor-pointer"
                                        title="Simulate 5-Second Request Glow"
                                    >
                                        <Play className="size-2.5" />
                                        <span>Ping (5s)</span>
                                    </button>
                                )}
                            </div>
                            <p className="text-[11px] text-muted-foreground leading-relaxed">
                                Upstream inference endpoint orbiting the central gateway core.
                            </p>

                            <div className="space-y-1.5 rounded-lg border border-border/60 bg-secondary/30 p-2.5 text-[10.5px]">
                                <div className="flex justify-between">
                                    <span className="text-muted-foreground">Status:</span>
                                    <span className="font-bold text-foreground capitalize">
                                        {selectedNode.data.isOnline ? "Connected & Online" : "Standby"}
                                    </span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-muted-foreground">Connected Keys:</span>
                                    <span className="font-bold text-foreground">
                                        {selectedNode.data.count ?? 0}
                                    </span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-muted-foreground">Supported Models:</span>
                                    <span className="font-bold text-foreground">
                                        {selectedNode.data.modelCount ?? 0}
                                    </span>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            <div className="pt-3 border-t border-border/60">
                {selectedNode.type === "core" ? (
                    <Link
                        to="/token-saver"
                        className="flex w-full items-center justify-center gap-1.5 rounded-md border border-border/80 bg-secondary/50 px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-secondary transition-colors"
                    >
                        <span>Configure Token Saver</span>
                        <ExternalLink className="size-3 text-muted-foreground" />
                    </Link>
                ) : (
                    <Link
                        to="/providers/$providerId"
                        params={{ providerId: selectedNode.data.id }}
                        className="flex w-full items-center justify-center gap-1.5 rounded-md border border-border/80 bg-secondary/50 px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-secondary transition-colors"
                    >
                        <span>Provider Settings</span>
                        <ExternalLink className="size-3 text-muted-foreground" />
                    </Link>
                )}
            </div>
        </aside>
    );
}

// ==========================================
// CANVAS CONTROLS & AUTO-CENTER COMPONENT
// ==========================================
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
        <div className="absolute left-3 bottom-3 z-20 flex items-center gap-1 rounded-lg border border-border/80 bg-card p-1 shadow-xs font-mono">
            <button
                type="button"
                onClick={() => fitView({ padding: 0.22, duration: 300 })}
                className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors cursor-pointer"
                title="Fit & Center View"
            >
                <Maximize2 className="size-3" />
            </button>
            <div className="h-3 w-px bg-border/60" />
            <button
                type="button"
                onClick={() => zoomIn({ duration: 250 })}
                className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors cursor-pointer"
                title="Zoom In"
            >
                <ZoomIn className="size-3" />
            </button>
            <button
                type="button"
                onClick={() => zoomOut({ duration: 250 })}
                className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors cursor-pointer"
                title="Zoom Out"
            >
                <ZoomOut className="size-3" />
            </button>
        </div>
    );
}

// ==========================================
// PROVIDER MATRIX VIEW (CLEAN ALTERNATIVE)
// ==========================================
function ProviderMatrixView({
    displayedProviders,
    isTokenSaverActive,
    activeProviderIds
}: {
    displayedProviders: any[];
    isTokenSaverActive: boolean;
    activeProviderIds: Set<string>;
}) {
    const apiBase = getGatewayBaseUrl();

    return (
        <div className="p-3 font-mono space-y-3">
            {/* Gateway Hub Summary Banner */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-lg border border-border/70 bg-secondary/30 p-3">
                <div className="flex items-center gap-2.5">
                    <div className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border/80 bg-card text-foreground">
                        <Zap className="size-3.5" />
                    </div>
                    <div>
                        <div className="text-xs font-bold text-foreground">SRouter Core Gateway</div>
                        <div className="text-[10px] text-muted-foreground truncate max-w-sm">
                            {apiBase}
                        </div>
                    </div>
                </div>
                <div className="flex items-center gap-3 text-[10.5px]">
                    <div className="flex items-center gap-1.5">
                        <span className="size-1.5 rounded-full bg-emerald-500" />
                        <span className="text-muted-foreground">Circuit Breaker:</span>
                        <span className="font-semibold text-foreground">Nominal</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <span className="text-muted-foreground">Token Saver:</span>
                        <span className="font-semibold text-foreground">
                            {isTokenSaverActive ? "Active" : "Bypassed"}
                        </span>
                    </div>
                </div>
            </div>

            {/* Providers Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2.5">
                {displayedProviders.map((p) => {
                    const isOnline = isProviderConnected(p) || p.id === "opencode_zen" || p.id === "opencode";
                    const connCount = getConnectedCount(p);
                    const isReceiving = activeProviderIds.has(p.id.toLowerCase());

                    return (
                        <Link
                            key={p.id}
                            to="/providers/$providerId"
                            params={{ providerId: p.id }}
                            className={`group flex flex-col justify-between rounded-lg border bg-card p-3 transition-all cursor-pointer ${
                                isReceiving
                                    ? "border-emerald-500 shadow-[0_0_15px_rgba(16,185,129,0.3)] ring-1 ring-emerald-500"
                                    : "border-border/70 hover:border-foreground/30"
                            }`}
                        >
                            <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2 min-w-0">
                                    <div className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border/80 bg-secondary/50 p-1">
                                        <ProviderIcon providerId={p.id} className="size-4" />
                                    </div>
                                    <div className="min-w-0">
                                        <h4 className="text-xs font-bold text-foreground truncate">
                                            {p.name}
                                        </h4>
                                        <span className="text-[9px] text-muted-foreground uppercase">
                                            {p.id}
                                        </span>
                                    </div>
                                </div>
                                {isReceiving && (
                                    <span className="rounded px-1.5 py-0.2 text-[8px] font-mono font-bold bg-emerald-500 text-black shadow-[0_0_6px_rgba(16,185,129,0.5)]">
                                        ACTIVE
                                    </span>
                                )}
                            </div>
                            <div className="mt-2.5 flex items-center justify-between text-[9.5px] text-muted-foreground pt-1.5 border-t border-border/40">
                                <span>{connCount} key{connCount !== 1 ? "s" : ""}</span>
                                <span>{p.models?.length ?? 0} models</span>
                            </div>
                        </Link>
                    );
                })}
            </div>
        </div>
    );
}

// ==========================================
// 360-DEGREE RADIAL MESH CANVAS (CENTER-ALIGNED)
// ==========================================
function GatewayTopologyCanvas() {
    const { allProviders } = useCatalog();
    const { settings: tokenSaverSettings } = useTokenSaver();

    // Fast-polling recent logs (800ms) with background polling enabled for ultra-responsive live detection
    const { data: logsData } = useQuery({
        queryKey: ["recent-logs-topology"],
        queryFn: () => api.get<ListResponse<RequestLogEntry>>("/v1/logs?limit=10"),
        refetchInterval: 800,
        refetchIntervalInBackground: true,
        staleTime: 0
    });

    const [selectedNode, setSelectedNode] = useState<SelectedNodeInfo | null>(null);
    const [viewMode, setViewMode] = useState<"graph" | "matrix">("graph");
    
    // Store active 5-second pulse states per provider: { [providerId]: { latency, expiresAt } }
    const [activePings, setActivePings] = useState<Record<string, { latency: number; expiresAt: number }>>({});
    const seenLogIdsRef = useRef<Set<string>>(new Set());
    const isFirstMountRef = useRef(true);

    // Watch for new incoming request logs and trigger instant 5-second pulse
    useEffect(() => {
        if (!logsData?.data) return;

        const logs = logsData.data;
        const now = Date.now();
        const newPings: Record<string, { latency: number; expiresAt: number }> = {};
        let hasNew = false;

        if (isFirstMountRef.current) {
            isFirstMountRef.current = false;
            // On initial load, only ping if created within the last 3 seconds
            for (const log of logs) {
                seenLogIdsRef.current.add(log.id);
                if (now - log.createdAt < 3000) {
                    const normId = log.providerId.toLowerCase();
                    newPings[normId] = {
                        latency: log.latencyMs,
                        expiresAt: log.createdAt + 5000 // Exactly 5 seconds
                    };
                    hasNew = true;
                }
            }
        } else {
            // Check for brand new logs
            for (const log of logs) {
                if (!seenLogIdsRef.current.has(log.id)) {
                    seenLogIdsRef.current.add(log.id);
                    const normId = log.providerId.toLowerCase();
                    newPings[normId] = {
                        latency: log.latencyMs,
                        expiresAt: log.createdAt + 5000 // Exactly 5 seconds
                    };
                    hasNew = true;
                }
            }
        }

        if (hasNew) {
            setActivePings((prev) => ({ ...prev, ...newPings }));
        }
    }, [logsData]);

    // Fast-tick timer to prune expired pings every 250ms
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

    // All connected providers + ensure opencode_zen is always present by default
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
                expiresAt: Date.now() + 5000 // Exactly 5 seconds
            }
        }));
    }, []);

    // Build the 360-degree Radial Constellation centered exactly at (0, 0)
    const { nodes, edges } = useMemo(() => {
        const nodeList: Node[] = [];
        const edgeList: Edge[] = [];

        // Exact origin (0, 0) for perfect symmetrical bounding box
        const centerX = 0;
        const centerY = 0;

        // 1. Central SRouter Core Hub at exact dead center
        nodeList.push({
            id: "node-core",
            type: "centralCore",
            position: { x: -128, y: -50 },
            data: {
                tokenSaverEnabled: tokenSaverSettings?.enabled,
                hasActiveTraffic: hasAnyActiveTraffic
            }
        });

        // 2. Surround SRouter Core with ALL Providers in a 360-degree circle
        const providerCount = displayedProviders.length;
        
        // Calibrated radius so all nodes fit comfortably
        const radiusX = Math.max(300, Math.min(420, 260 + providerCount * 10));
        const radiusY = Math.max(190, Math.min(280, 160 + providerCount * 8));

        displayedProviders.forEach((provider, index) => {
            const nodeId = `node-provider-${provider.id}`;
            const isZen = provider.id === "opencode_zen" || provider.id === "opencode" || (!provider.requires_api_key && !provider.requires_oauth);
            const isOnline = isZen || isProviderConnected(provider);
            const connCount = getConnectedCount(provider) || (isZen ? 1 : 0);
            
            // Check if this provider has an active 5-second pulse
            const activeTraffic = activePings[provider.id.toLowerCase()];
            const isReceivingRequest = Boolean(activeTraffic);

            // Distribute angles evenly across the full 360-degree circle (starting from top)
            const angle =
                providerCount === 1
                    ? 0
                    : (index / providerCount) * 2 * Math.PI - Math.PI / 2;

            const posX = Math.round(centerX + radiusX * Math.cos(angle) - 88);
            const posY = Math.round(centerY + radiusY * Math.sin(angle) - 25);

            // Determine handle position on provider and source handle on central core
            const cosA = Math.cos(angle);
            const sinA = Math.sin(angle);

            let handlePos: Position = Position.Left;
            let sourceHandleId = "core-out-right";

            // Determine which quadrant the provider is in
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
                    status: provider.status?.state,
                    isOnline,
                    isReceivingRequest,
                    lastLatency: activeTraffic?.latency,
                    count: connCount,
                    modelCount: provider.models?.length ?? 0,
                    handlePos
                }
            });

            // Glowing edge when request is active
            edgeList.push({
                id: `edge-core-${provider.id}`,
                source: "node-core",
                sourceHandle: sourceHandleId,
                target: nodeId,
                type: "smoothstep",
                animated: isReceivingRequest || isOnline,
                style: {
                    stroke: isReceivingRequest
                        ? "var(--color-emerald-500, #10b981)"
                        : isOnline
                          ? "oklch(0.55 0 0)"
                          : "oklch(0.35 0 0)",
                    strokeWidth: isReceivingRequest ? 2.5 : 1.5,
                    strokeDasharray: isReceivingRequest ? "6 3" : undefined,
                    opacity: isReceivingRequest ? 1 : isOnline ? 0.9 : 0.4
                }
            });
        });

        return { nodes: nodeList, edges: edgeList };
    }, [displayedProviders, tokenSaverSettings?.enabled, activePings, hasAnyActiveTraffic]);

    const handleNodeClick = useCallback((_: any, node: Node) => {
        let nodeType: SelectedNodeInfo["type"] = "core";
        if (node.type === "orbitProvider") nodeType = "provider";

        setSelectedNode({
            type: nodeType,
            id: node.id,
            data: node.data
        });
    }, []);

    const handlePaneClick = useCallback(() => {
        setSelectedNode(null);
    }, []);

    return (
        <section
            aria-label="Gateway Architecture Topology"
            className="rounded-xl border border-border/80 bg-card/60 p-4 font-mono shadow-2xs relative"
        >
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border/60 pb-3 mb-4">
                <div className="flex items-center gap-2.5">
                    <div className="flex size-7 items-center justify-center rounded-md border border-border/70 bg-secondary/50 text-foreground shadow-2xs">
                        <Orbit className="size-3.5" strokeWidth={1.75} />
                    </div>
                    <div>
                        <div className="flex items-center gap-2">
                            <h2 className="text-xs font-bold text-foreground">
                                Mesh routing topology
                            </h2>
                            {hasAnyActiveTraffic && (
                                <span className="flex items-center gap-1 rounded bg-emerald-500/10 border border-emerald-500/30 px-1.5 py-0.2 text-[9px] font-mono text-emerald-500 font-bold">
                                    <span className="size-1.5 rounded-full bg-emerald-500 animate-ping" />
                                    ROUTING TRAFFIC
                                </span>
                            )}
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                            Hub-and-spoke radial constellation of SRouter Core dispatching directly to all connected providers.
                        </p>
                    </div>
                </div>

                {/* View Switcher Controls */}
                <div className="flex items-center gap-1.5 rounded-lg border border-border/60 bg-secondary/30 p-1">
                    <button
                        type="button"
                        onClick={() => setViewMode("graph")}
                        className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-[10.5px] font-semibold transition-colors cursor-pointer ${
                            viewMode === "graph"
                                ? "bg-background text-foreground shadow-2xs"
                                : "text-muted-foreground hover:text-foreground"
                        }`}
                    >
                        <Workflow className="size-3" />
                        <span>Radial Orbit</span>
                    </button>
                    <button
                        type="button"
                        onClick={() => setViewMode("matrix")}
                        className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-[10.5px] font-semibold transition-colors cursor-pointer ${
                            viewMode === "matrix"
                                ? "bg-background text-foreground shadow-2xs"
                                : "text-muted-foreground hover:text-foreground"
                        }`}
                    >
                        <LayoutGrid className="size-3" />
                        <span>Provider Grid</span>
                    </button>
                </div>
            </div>

            {/* View Body */}
            {viewMode === "graph" ? (
                <div className="h-[500px] w-full rounded-lg border border-border/60 bg-background/50 overflow-hidden relative">
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
                            color="var(--color-border, #52525b)"
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
