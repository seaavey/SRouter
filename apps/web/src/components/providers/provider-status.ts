import type { ProviderDefinition } from "@srouter/types";

export function getConnectedCount(provider: ProviderDefinition): number {
    return provider.status.connectedCount ?? (provider.status.state === "connected" ? 1 : 0);
}

export function isProviderConnected(provider: ProviderDefinition): boolean {
    return getConnectedCount(provider) > 0;
}

export function getActiveConnectionCount(provider: ProviderDefinition): number {
    return getConnectedCount(provider);
}
