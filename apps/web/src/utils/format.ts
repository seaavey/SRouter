export function formatTimeUnit(intervalMs: number): string {
    if (intervalMs >= 86_400_000) return "day";
    if (intervalMs >= 3_600_000) return "hour";
    return "min";
}