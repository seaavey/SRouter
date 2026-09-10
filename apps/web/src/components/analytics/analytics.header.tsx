import type { AnalyticsWindow } from "@srouter/types";

const windows: { value: AnalyticsWindow; label: string }[] = [
    { value: "1h", label: "1h" },
    { value: "24h", label: "24h" },
    { value: "7d", label: "7d" },
    { value: "30d", label: "30d" }
];

interface Props {
    window: AnalyticsWindow;
    onWindowChange: (w: AnalyticsWindow) => void;
    lastUpdated: number | null;
}

export function AnalyticsHeader({ window, onWindowChange, lastUpdated }: Props) {
    return (
        <header className="flex flex-col justify-between gap-4 pb-2 sm:flex-row sm:items-end font-sans">
            <div className="min-w-0">
                <div className="flex items-center gap-2 mb-2">
                    <span className="size-2 shrink-0 rounded-full bg-ink" />
                    <p className="font-mono text-xs font-medium uppercase tracking-wider text-text-muted">
                        Monitoring & Analytics
                    </p>
                </div>
                <h1 className="text-3xl md:text-4xl font-[650] tracking-tight text-ink font-sans">
                    Usage Telemetry.
                </h1>
                <p className="mt-1 text-base font-light text-text-muted font-sans">
                    Live throughput, latency distribution, token consumption, and routing telemetry.
                </p>
            </div>

            <div className="flex flex-wrap items-center gap-3 shrink-0">
                <div className="inline-flex items-center gap-1 rounded-full bg-canvas-soft p-1 border-0">
                    {windows.map((w) => (
                        <button
                            key={w.value}
                            type="button"
                            onClick={() => onWindowChange(w.value)}
                            className={`rounded-full px-4 py-1.5 text-xs font-medium transition-all cursor-pointer ${
                                window === w.value
                                    ? "bg-canvas text-ink font-semibold shadow-none"
                                    : "text-text-muted hover:text-ink hover:bg-canvas/50"
                            }`}
                        >
                            {w.label}
                        </button>
                    ))}
                </div>

                {lastUpdated && (
                    <span className="font-mono text-xs text-text-muted whitespace-nowrap">
                        Updated{" "}
                        {new Date(lastUpdated).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                            second: "2-digit"
                        })}
                    </span>
                )}
            </div>
        </header>
    );
}
