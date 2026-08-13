import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { api } from "@/lib/api";
import type { ListResponse, RequestLogEntry } from "@/lib/types";
import { Skeleton } from "@/components/ui/skeleton";
import { useLogs } from "@/hooks/useLogs";
import { LogTable } from "@/components/logs/LogTable";
import { LogDetailSheet } from "@/components/logs/LogDetailSheet";

export const Route = createFileRoute("/logs")({
    staticData: { title: "Logs" },
    component: LogsPage,
});

function LogsPage() {
    const [selectedLog, setSelectedLog] = useState<RequestLogEntry | null>(null);

    const { data, isLoading, error } = useQuery({
        queryKey: ["logs"],
        queryFn: () => api.get<ListResponse<RequestLogEntry>>("/v1/logs?limit=100"),
    });

    const logs: RequestLogEntry[] = data?.data ?? [];
    const filter = useLogs(logs);

    if (isLoading) {
        return (
            <div className="space-y-6">
                <Skeleton className="h-8 w-48" />
                <Skeleton className="h-96 rounded-xl" />
            </div>
        );
    }

    if (error || !data) {
        return (
            <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
                Gagal memuat log aktivitas:{" "}
                {error instanceof Error ? error.message : "Unknown error"}
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-6">
            <div>
                <h1 className="text-2xl font-bold tracking-tight text-foreground">
                    Request Audit Logs
                </h1>
                <p className="mt-1 text-sm text-muted-foreground">
                    Riwayat 100 request API gateway terbaru beserta token usage & latency.
                </p>
            </div>

            {/* Filter Toolbar */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 border-b border-border/60 pb-4">
                <div className="relative flex-1 max-w-md">
                    <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
                    <input
                        type="text"
                        placeholder="Search by ID, Model, or Provider…"
                        value={filter.searchQuery}
                        onChange={(e) => filter.setSearchQuery(e.target.value)}
                        className="w-full rounded-lg border border-border/60 bg-secondary/30 pl-9 pr-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                </div>

                <div className="flex items-center gap-1.5">
                    <button
                        type="button"
                        onClick={() => filter.setStatusFilter("all")}
                        className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                            filter.statusFilter === "all"
                                ? "bg-foreground text-background font-semibold"
                                : "bg-secondary/30 text-muted-foreground hover:text-foreground"
                        }`}
                    >
                        All ({logs.length})
                    </button>

                    <button
                        type="button"
                        onClick={() => filter.setStatusFilter("success")}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                            filter.statusFilter === "success"
                                ? "bg-emerald-500 text-white shadow-2xs"
                                : "bg-secondary/30 text-muted-foreground hover:text-foreground"
                        }`}
                    >
                        Success (2xx)
                    </button>
                    <button
                        type="button"
                        onClick={() => filter.setStatusFilter("error")}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                            filter.statusFilter === "error"
                                ? "bg-rose-500 text-white shadow-2xs"
                                : "bg-secondary/30 text-muted-foreground hover:text-foreground"
                        }`}
                    >
                        Errors (4xx/5xx)
                    </button>
                </div>
            </div>

            {filter.filteredLogs.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border/60 bg-secondary/10 p-12 text-center text-xs text-muted-foreground">
                    Tidak ada log request yang cocok dengan filter saat ini.
                </div>
            ) : (
                <LogTable logs={filter.filteredLogs} onSelect={setSelectedLog} />
            )}

            <LogDetailSheet log={selectedLog} onClose={() => setSelectedLog(null)} />
        </div>
    );
}
