type UsageEventListener = () => void;

const listeners = new Set<UsageEventListener>();

export function onUsageUpdated(listener: UsageEventListener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

export function publishUsageUpdated(): void {
    for (const listener of listeners) {
        listener();
    }
}
