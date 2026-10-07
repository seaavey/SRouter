import type { ProviderEntry } from "@/generated/api";

export function getConnectedCount(provider: ProviderEntry): number {
    if (provider.enabled === false) return 0;
    return provider.status.connected_count ?? (provider.status.state === "connected" ? 1 : 0);
}

export function isProviderEnabled(provider: ProviderEntry): boolean {
    return provider.enabled !== false;
}

export function isProviderConnected(provider: ProviderEntry): boolean {
    return getConnectedCount(provider) > 0;
}

export function getActiveConnectionCount(provider: ProviderEntry): number {
    return getConnectedCount(provider);
}
