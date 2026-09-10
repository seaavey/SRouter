import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";

export interface TunnelInstallStatus {
    inProgress: boolean;
    done: boolean;
    error?: string;
    platform?: string;
    arch?: string;
    target?: string;
    downloadedBytes?: number;
    totalBytes?: number;
    cloudflaredAvailable: boolean;
}

export interface TunnelStatus {
    running: boolean;
    pid?: number;
    startedAt?: number;
    error?: string;
    domain?: string;
    cloudflaredAvailable: boolean;
    tokenConfigured?: boolean;
    install?: TunnelInstallStatus;
}

export function useTunnelStatus() {
    const [status, setStatus] = useState<TunnelStatus | null>(null);
    const [loading, setLoading] = useState(true);

    const fetchStatus = useCallback(async () => {
        try {
            const json = await api.get<TunnelStatus & { ok: boolean }>("/v1/tunnel/status");
            setStatus(json);
        } catch (err) {
            console.error("Failed to fetch tunnel status:", err);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        // Initial snapshot, then live updates via SSE.
        void fetchStatus();
        if (typeof window === "undefined" || typeof window.EventSource === "undefined") {
            const id = setInterval(() => void fetchStatus(), 10000);
            return () => clearInterval(id);
        }

        const source = new EventSource("/v1/tunnel/events");
        source.onmessage = (event) => {
            try {
                setStatus(JSON.parse(event.data) as TunnelStatus);
            } catch (err) {
                console.error("Failed to parse tunnel event:", err);
            } finally {
                setLoading(false);
            }
        };
        source.onerror = () => {
            // SSE dropped — fall back to polling until it reconnects.
            void fetchStatus();
        };
        return () => source.close();
    }, [fetchStatus]);

    return { status, loading, fetchStatus };
}

export function useTunnelActions() {
    const startTunnel = useCallback(async (payload: { token?: string; domain?: string }) => {
        try {
            await api.post("/v1/tunnel/start", {
                token: payload.token,
                domain: payload.domain
            });
            toast.success("Cloudflare Tunnel started", {
                description: payload.domain
                    ? `Custom domain: ${payload.domain}`
                    : "Gateway is now reachable through the tunnel."
            });
            return true;
        } catch (err) {
            const msg = err instanceof Error ? err.message : "Failed to start tunnel";
            toast.error(msg);
            return false;
        }
    }, []);

    const stopTunnel = useCallback(async () => {
        try {
            await api.post("/v1/tunnel/stop");
            toast.success("Cloudflare Tunnel stopped");
            return true;
        } catch (err) {
            const msg = err instanceof Error ? err.message : "Failed to stop tunnel";
            toast.error(msg);
            return false;
        }
    }, []);

    const installCloudflared = useCallback(async () => {
        try {
            await api.post("/v1/tunnel/install");
            toast.success("Installing cloudflared…", {
                description: "Downloading the official binary. Watch the status below."
            });
            return true;
        } catch (err) {
            const msg = err instanceof Error ? err.message : "Failed to install cloudflared";
            toast.error(msg);
            return false;
        }
    }, []);

    return { startTunnel, stopTunnel, installCloudflared };
}
