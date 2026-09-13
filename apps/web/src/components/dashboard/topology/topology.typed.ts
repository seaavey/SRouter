import type { Node, Position } from "@xyflow/react";

export type CoreNodeData = {
    has_active_traffic?: boolean;
};

export type ProviderNodeData = {
    id: string;
    name: string;
    is_online: boolean;
    is_receiving_request: boolean;
    last_latency: number | null;
    count: number;
    model_count: number;
    handle_pos: Position;
};

export type TopologyNode =
    Node<CoreNodeData, "centralCore"> | Node<ProviderNodeData, "orbitProvider">;

export type SelectedNodeInfo =
    | { type: "core"; id: string; data: CoreNodeData }
    | { type: "provider"; id: string; data: ProviderNodeData };
