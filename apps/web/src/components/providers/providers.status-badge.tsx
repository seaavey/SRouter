import { cn } from "@/lib/utils";

type ProviderStatus = "disabled" | "connected" | "ready";

interface ProviderStatusBadgeProps {
    status: ProviderStatus;
    /** Jumlah koneksi aktif, ditampilkan saat status "connected" */
    count?: number;
    /** Label untuk status "connected"; default "live" */
    connectedLabel?: string;
    className?: string;
}

const LABELS: Record<Exclude<ProviderStatus, "connected">, string> = {
    disabled: "Disabled",
    ready: "Ready"
};

/**
 * Badge status provider ("live"/"Ready"/"Disabled") yang konsisten di seluruh
 * tampilan katalog dan detail. Warna dari token semantik canvas/ink + emerald
 * untuk status terhubung.
 */
export default function ProviderStatusBadge({
    status,
    count,
    connectedLabel = "live",
    className
}: ProviderStatusBadgeProps) {
    const label =
        status === "connected"
            ? count
                ? `${count} ${connectedLabel}`
                : connectedLabel
            : LABELS[status];

    return (
        <span
            className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs",
                status === "connected"
                    ? "bg-emerald-500/10 font-semibold text-emerald-600 dark:text-emerald-400"
                    : "bg-canvas-soft font-medium text-text-muted",
                className
            )}
        >
            <span
                className={cn(
                    "size-1.5 rounded-full",
                    status === "connected" ? "bg-emerald-500" : "bg-text-muted/40"
                )}
            />
            <span>{label}</span>
        </span>
    );
}
