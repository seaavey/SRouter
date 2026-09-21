import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Check, ChevronDown, ChevronRight, Copy } from "lucide-react";
import type { RequestLogEntry } from "@srouter/types";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
    LogOverview,
    LogRoutingNotices,
    LogTokenMix,
    LogUsageSummary
} from "@/components/logs/logs.detail-sections";
import { toast } from "sonner";
import { formatDuration } from "@/utils/format";

interface ServerSettingsResponse {
    require_api_key?: boolean;
    requireApiKey?: boolean;
}

type CopyTarget = "id" | "payload" | null;

export const Route = createFileRoute("/logs/$logId")({
    staticData: { title: "Log Details" },
    component: LogDetailPage
});

function LogDetailPage() {
    const { logId } = Route.useParams();
    const [showRawJson, setShowRawJson] = useState(false);
    const [copied, setCopied] = useState<CopyTarget>(null);
    const { data: log, isLoading, error, refetch } = useLogDetail(logId);
    const { data: serverSettings } = useQuerySettings();
    const requireApiKey = Boolean(serverSettings?.require_api_key ?? serverSettings?.requireApiKey);

    const copyValue = async (value: string, target: Exclude<CopyTarget, null>, message: string) => {
        try {
            await navigator.clipboard.writeText(value);
            setCopied(target);
            toast.success(message);
            setTimeout(() => setCopied(null), 1600);
        } catch {
            toast.error("Failed to copy to clipboard");
        }
    };

    if (isLoading) return <LogDetailSkeleton />;

    if (error || !log) {
        return (
            <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 pb-16 sm:px-6">
                <Link
                    to="/logs"
                    className="inline-flex min-h-11 w-fit items-center gap-2 text-xs font-medium text-text-muted transition-colors hover:text-ink"
                >
                    <ArrowLeft className="size-3.5" aria-hidden="true" />
                    Back to logs
                </Link>
                <div className="flex min-h-64 flex-col items-center justify-center rounded-2xl border border-destructive/30 px-6 py-14 text-center">
                    <h1 className="text-base font-semibold text-ink">This log is unavailable</h1>
                    <p className="mt-1.5 max-w-md font-mono text-xs leading-relaxed text-text-muted">
                        {error instanceof Error ? error.message : "Log not found."}
                    </p>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="mt-5"
                        onClick={() => void refetch()}
                    >
                        Try again
                    </Button>
                </div>
            </div>
        );
    }

    const isOk = log.statusCode >= 200 && log.statusCode < 300;
    const totalCost = log.costBreakdown?.totalCost ?? log.estimatedCost ?? 0;
    const hasRoutingNotice = Boolean(
        (log.resolvedModel && log.resolvedModel !== log.model) || log.fallbackOccurred
    );
    const occurredAt = new Date(log.createdAt);
    const occurredLabel = occurredAt.toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit"
    });
    const rawJson = JSON.stringify(log, null, 2);
    const rawLines = rawJson.split("\n").length;
    const rawKb = new Blob([rawJson]).size / 1024;
    const rawMeta = `${rawLines} lines · ${rawKb < 10 ? rawKb.toFixed(1) : Math.round(rawKb)} KB`;

    return (
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 pb-16 sm:px-6">
            <Link
                to="/logs"
                className="inline-flex min-h-11 w-fit items-center gap-2 text-xs font-medium text-text-muted transition-colors hover:text-ink"
            >
                <ArrowLeft className="size-3.5" aria-hidden="true" />
                Back to logs
            </Link>

            <header className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] lg:items-start">
                <div className="flex min-w-0 flex-col gap-3">
                    <div className="flex flex-wrap items-center gap-2.5">
                        <Badge variant={isOk ? "emerald" : "destructive"}>{log.statusCode}</Badge>
                        <span className="font-mono text-xs text-text-muted tabular-nums">
                            {occurredLabel}
                        </span>
                    </div>
                    <h1 className="text-2xl font-semibold tracking-tight text-balance text-ink sm:text-3xl">
                        {log.resolvedModel ?? log.model}
                    </h1>
                    <p className="font-mono text-xs text-text-muted">
                        {log.providerId} · {formatDuration(log.latencyMs)} ·{" "}
                        {log.totalTokens.toLocaleString()} tokens · ${totalCost.toFixed(4)}
                    </p>
                    <div className="flex max-w-full items-center gap-2">
                        <code className="min-w-0 flex-1 truncate rounded-lg border border-hairline-soft bg-field px-3 py-2 font-mono text-xs text-text-muted">
                            {log.id}
                        </code>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => void copyValue(log.id, "id", "Log ID copied")}
                            aria-label="Copy log ID"
                        >
                            {copied === "id" ? (
                                <Check className="size-3.5" aria-hidden="true" />
                            ) : (
                                <Copy className="size-3.5" aria-hidden="true" />
                            )}
                            {copied === "id" ? "Copied" : "Copy"}
                        </Button>
                    </div>
                </div>
                <LogTokenMix log={log} />
            </header>

            <LogUsageSummary log={log} />

            <div className="flex flex-col gap-8">
                {hasRoutingNotice && (
                    <section aria-labelledby="log-routing-heading" className="flex flex-col gap-3">
                        <h2 id="log-routing-heading" className="text-sm font-semibold text-ink">
                            Routing changes
                        </h2>
                        <LogRoutingNotices log={log} />
                    </section>
                )}
                <section aria-labelledby="log-context-heading" className="flex flex-col gap-3">
                    <h2 id="log-context-heading" className="text-sm font-semibold text-ink">
                        Request context
                    </h2>
                    <LogOverview log={log} requireApiKey={requireApiKey} />
                </section>
            </div>

            <section
                aria-labelledby="log-payload-heading"
                className="overflow-hidden rounded-2xl border border-hairline-soft"
            >
                <div className="flex w-full items-center justify-between gap-3 px-4 py-2 sm:px-5">
                    <button
                        type="button"
                        onClick={() => setShowRawJson((visible) => !visible)}
                        className="flex min-h-11 cursor-pointer items-center gap-2 text-xs font-medium text-text-muted transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
                        aria-expanded={showRawJson}
                        aria-controls="log-developer-payload"
                    >
                        <span id="log-payload-heading">Raw record</span>
                        <span className="font-mono text-[11px] text-text-faint tabular-nums">
                            {rawMeta}
                        </span>
                        {showRawJson ? (
                            <ChevronDown className="size-4" aria-hidden="true" />
                        ) : (
                            <ChevronRight className="size-4" aria-hidden="true" />
                        )}
                    </button>
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => void copyValue(rawJson, "payload", "Log payload copied")}
                        aria-label="Copy raw log record"
                    >
                        {copied === "payload" ? (
                            <Check className="size-3.5" aria-hidden="true" />
                        ) : (
                            <Copy className="size-3.5" aria-hidden="true" />
                        )}
                        {copied === "payload" ? "Copied" : "Copy"}
                    </Button>
                </div>
                {showRawJson && (
                    <pre
                        id="log-developer-payload"
                        className="max-h-96 overflow-x-auto border-t border-hairline-soft bg-canvas-soft/40 p-4 font-mono text-[11px] leading-relaxed text-text-muted sm:p-5"
                    >
                        <code>{rawJson}</code>
                    </pre>
                )}
            </section>
        </div>
    );
}

function useLogDetail(logId: string) {
    return useQuery<RequestLogEntry>({
        queryKey: ["logs", logId],
        queryFn: () => api.get<RequestLogEntry>(`/v1/logs/${encodeURIComponent(logId)}`),
        enabled: Boolean(logId)
    });
}

function useQuerySettings() {
    return useQuery<ServerSettingsResponse>({
        queryKey: ["server_settings"],
        queryFn: () => api.get<ServerSettingsResponse>("/v1/settings")
    });
}

function LogDetailSkeleton() {
    return (
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 pb-16 sm:px-6">
            <Skeleton className="h-4 w-24" />
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
                <div className="flex flex-col gap-3">
                    <Skeleton className="h-5 w-32" />
                    <Skeleton className="h-9 w-3/4 max-w-md" />
                    <Skeleton className="h-4 w-64 max-w-full" />
                    <Skeleton className="h-9 w-full max-w-sm rounded-lg" />
                </div>
                <Skeleton className="h-48 w-full rounded-2xl" />
            </div>
            <Skeleton className="h-64 w-full rounded-2xl" />
            <Skeleton className="h-44 w-full rounded-2xl" />
            <Skeleton className="h-12 w-full rounded-2xl" />
        </div>
    );
}
