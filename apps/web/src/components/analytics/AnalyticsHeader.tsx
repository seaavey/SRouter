import { type AnalyticsWindow } from "@srouter/types";

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
        <header className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end border-b border-border/80 pb-5">
            <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/80">
                    Monitoring & Analytics
                </p>
                <h1 className="mt-1.5 text-2xl font-bold tracking-tight text-foreground">
                    Analytics
                </h1>
            </div>
            <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 rounded-lg border border-border/60 bg-secondary/30 p-0.5">
                    {windows.map((w) => (
                        <button
                            key={w.value}
                            type="button"
                            onClick={() => onWindowChange(w.value)}
                            className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                                window === w.value
                                    ? "bg-foreground text-background font-semibold"
                                    : "text-muted-foreground hover:text-foreground"
                            }`}
                        >
                            {w.label}
                        </button>
                    ))}
                </div>
                {lastUpdated && (
                    <span className="text-[10px] text-muted-foreground/70 font-mono whitespace-nowrap">
                        Updated {new Date(lastUpdated).toLocaleTimeString()}
                    </span>
                )}
            </div>
        </header>
    );
}
