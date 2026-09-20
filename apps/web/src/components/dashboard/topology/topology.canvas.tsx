import { useState, useMemo, useCallback, useEffect } from "react";
import {
    ReactFlow,
    Background,
    Position,
    type Edge,
    type NodeMouseHandler,
    type NodeTypes,
    BackgroundVariant
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { LayoutGrid, Orbit, Workflow } from "lucide-react";
import { ReactFlowProvider } from "@xyflow/react";
import { useCatalog } from "@/hooks/useCatalog";
import { useLogsStream } from "@/hooks/useLogsStream";
import { isProviderConnected, getConnectedCount } from "@/utils/provider.utils";

import { CentralCoreHubNode, OrbitProviderNode } from "./topology.nodes";
import { NodeDetailInspector } from "./topology.node-inspector";
import { AutoCenterOnMount } from "./topology.auto-center";
import { CanvasControls } from "./topology.canvas-controls";
import { ProviderMatrixView } from "./topology.provider-matrix";
import type {
    CoreNodeData,
    ProviderNodeData,
    SelectedNodeInfo,
    TopologyNode
} from "./topology.typed";

const nodeTypes: NodeTypes = {
    centralCore: CentralCoreHubNode,
    orbitProvider: OrbitProviderNode
};

function GatewayTopologyCanvas() {
    const { allProviders } = useCatalog();

    const [selectedNode, setSelectedNode] = useState<SelectedNodeInfo | null>(null);
    const [viewMode, setViewMode] = useState<"graph" | "matrix">(() => {
        if (typeof window === "undefined") return "graph";
        return window.matchMedia("(max-width: 767px)").matches ? "matrix" : "graph";
    });

    const [activePings, setActivePings] = useState<
        Record<string, { latency: number; expires_at: number }>
    >({});

    useLogsStream({
        onEvent: (event) => {
            if (event.type !== "request.logged") return;

            setActivePings((prev) => ({
                ...prev,
                [event.log.providerId.toLowerCase()]: {
                    latency: event.log.latencyMs,
                    expires_at: Date.now() + 5000
                }
            }));
        }
    });

    useEffect(() => {
        const interval = setInterval(() => {
            const now = Date.now();
            setActivePings((prev) => {
                let hasExpired = false;
                const next: Record<string, { latency: number; expires_at: number }> = {};
                for (const [id, item] of Object.entries(prev)) {
                    if (item.expires_at > now) {
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
                expires_at: Date.now() + 5000
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
                has_active_traffic: hasAnyActiveTraffic
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
            const is_online = isZen || isProviderConnected(provider);
            const conn_count = getConnectedCount(provider) || (isZen ? 1 : 0);

            const activeTraffic = activePings[provider.id.toLowerCase()];
            const is_receiving_request = Boolean(activeTraffic);

            const angle =
                providerCount === 1 ? 0 : (index / providerCount) * 2 * Math.PI - Math.PI / 2;

            const posX = Math.round(centerX + radiusX * Math.cos(angle) - 88);
            const posY = Math.round(centerY + radiusY * Math.sin(angle) - 25);

            const cosA = Math.cos(angle);
            const sinA = Math.sin(angle);

            let handle_pos: Position = Position.Left;
            let sourceHandleId = "core-out-right";

            if (Math.abs(cosA) >= Math.abs(sinA)) {
                if (cosA > 0) {
                    handle_pos = Position.Left;
                    sourceHandleId = "core-out-right";
                } else {
                    handle_pos = Position.Right;
                    sourceHandleId = "core-out-left";
                }
            } else {
                if (sinA < 0) {
                    handle_pos = Position.Bottom;
                    sourceHandleId = "core-out-top";
                } else {
                    handle_pos = Position.Top;
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
                    is_online,
                    is_receiving_request,
                    last_latency: activeTraffic?.latency ?? null,
                    count: conn_count,
                    model_count: provider.models?.length ?? 0,
                    handle_pos
                }
            });

            edgeList.push({
                id: `edge-core-${provider.id}`,
                source: "node-core",
                sourceHandle: sourceHandleId,
                target: nodeId,
                type: "smoothstep",
                animated: is_receiving_request,
                style: {
                    stroke: is_receiving_request
                        ? "var(--ink)"
                        : is_online
                          ? "var(--hairline)"
                          : "var(--hairline-soft)",
                    strokeWidth: is_receiving_request ? 2 : 1,
                    strokeDasharray: is_receiving_request ? "4 3" : undefined,
                    opacity: is_receiving_request ? 1 : is_online ? 0.9 : 0.4
                }
            });
        });

        return { nodes: nodeList, edges: edgeList };
    }, [displayedProviders, activePings, hasAnyActiveTraffic]);

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
            className="p-4 font-mono relative overflow-hidden sm:p-5 lg:p-6"
        >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-hairline-soft pb-4 mb-4">
                <div className="flex items-center gap-3">
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-canvas text-ink border border-hairline-soft">
                        <Orbit className="size-4" strokeWidth={1.75} aria-hidden="true" />
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
                        <Workflow className="size-3" aria-hidden="true" />
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
                        <LayoutGrid className="size-3" aria-hidden="true" />
                        <span>Provider Grid</span>
                    </button>
                </div>
            </div>

            {viewMode === "graph" ? (
                <div className="h-[min(62dvh,380px)] w-full rounded-2xl border border-hairline-soft bg-canvas overflow-hidden relative md:h-[420px] lg:h-[480px]">
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
                        onTriggerTestRequest={triggerTestRequest}
                    />
                </div>
            ) : (
                <ProviderMatrixView
                    displayedProviders={displayedProviders}
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
