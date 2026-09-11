import { useState } from "react";
import {
    AlertCircle,
    Check,
    CheckCircle2,
    Copy,
    Cpu,
    Coins,
    KeyRound,
    Network,
    ScrollText,
    Zap,
    X,
    Calendar,
    Server,
    Globe,
    Code2,
    ChevronDown,
    ChevronRight,
    Bot
} from "lucide-react";
import type { RequestLogEntry } from "@srouter/types";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { formatTime } from "@/utils/format";
import { parseUserAgent } from "@/utils/agent-detector";

interface LogDetailModalProps {
    log: RequestLogEntry | null;
    requireApiKey?: boolean;
    onClose: () => void;
}

export function LogDetailModal({ log, requireApiKey = false, onClose }: LogDetailModalProps) {
    const [copied, setCopied] = useState(false);
    const [showRawJson, setShowRawJson] = useState(false);

    const isOk = (log?.statusCode ?? 0) >= 200 && (log?.statusCode ?? 0) < 300;
    const clientInfo = parseUserAgent(log?.userAgent);

    const handleCopyPayload = async () => {
        if (!log) return;
        try {
            await navigator.clipboard.writeText(JSON.stringify(log, null, 2));
            setCopied(true);
            toast.success("Log payload copied");
            setTimeout(() => setCopied(false), 1600);
        } catch {
            toast.error("Failed to copy payload");
        }
    };

    const costBreakdown = log?.costBreakdown;
    const totalCost = costBreakdown?.totalCost ?? log?.estimatedCost ?? 0;
    const inputCost = costBreakdown?.inputCost ?? 0;
    const outputCost = costBreakdown?.outputCost ?? 0;
    const cacheReadCost = costBreakdown?.cacheReadCost ?? 0;
    const cacheCreationCost = costBreakdown?.cacheCreationCost ?? 0;

    const cachedTokens = log?.cachedTokens ?? 0;
    const cacheCreationTokens = log?.cacheCreationTokens ?? 0;
    const reasoningTokens = log?.reasoningTokens ?? 0;

    return (
        <Dialog open={!!log} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="max-w-2xl max-h-[85vh] p-0 flex flex-col font-sans gap-0 overflow-hidden border border-hairline-soft shadow-none bg-canvas rounded-3xl">
                {log && (
                    <>
                        <div className="flex items-center justify-between px-6 py-5 border-b border-hairline-soft bg-canvas-soft/40 shrink-0">
                            <div className="flex items-center gap-3 min-w-0">
                                <div className="flex size-9 items-center justify-center rounded-full bg-canvas border border-hairline-soft text-ink shrink-0">
                                    <ScrollText className="size-4" />
                                </div>
                                <div className="min-w-0">
                                    <DialogTitle className="text-base font-semibold text-ink truncate font-sans">
                                        Request Details
                                    </DialogTitle>
                                    <p className="text-xs text-text-muted font-mono truncate mt-0.5">
                                        {log.id}
                                    </p>
                                </div>
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                                <span
                                    className={[
                                        "font-mono text-xs px-3 py-1 rounded-full border font-semibold tabular-nums inline-flex items-center gap-1.5",
                                        isOk
                                            ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                                            : "bg-destructive/10 text-destructive border-destructive/20"
                                    ].join(" ")}
                                >
                                    {isOk ? (
                                        <CheckCircle2 className="size-3.5" />
                                    ) : (
                                        <AlertCircle className="size-3.5" />
                                    )}
                                    {log.statusCode} {isOk ? "OK" : "ERROR"}
                                </span>
                                <button
                                    type="button"
                                    onClick={onClose}
                                    className="size-8 inline-flex items-center justify-center rounded-full text-text-muted hover:text-ink hover:bg-canvas-soft cursor-pointer transition-colors"
                                >
                                    <X className="size-4" />
                                </button>
                            </div>
                        </div>
                        <div className="p-6 overflow-y-auto space-y-4 text-xs">
                            <div className="rounded-2xl border border-hairline-soft bg-canvas-soft/30 divide-y divide-hairline-soft">
                                <div className="flex items-center justify-between px-4 py-3 text-xs font-sans">
                                    <span className="text-text-muted flex items-center gap-2">
                                        <Calendar className="size-3.5 text-text-muted" /> Timestamp
                                    </span>
                                    <span className="text-ink font-medium font-mono">
                                        {new Date(log.createdAt).toLocaleDateString()}{" "}
                                        {formatTime(log.createdAt, true)}
                                    </span>
                                </div>
                                <div className="flex items-center justify-between px-4 py-3 text-xs font-sans">
                                    <span className="text-text-muted flex items-center gap-2">
                                        <Server className="size-3.5 text-text-muted" /> Provider &
                                        Model
                                    </span>
                                    <div className="flex items-center gap-2 text-right">
                                        <span className="px-2 py-0.5 rounded-full bg-field text-text-muted text-[10px] font-mono">
                                            {log.providerId}
                                        </span>
                                        <span className="text-ink font-medium font-sans">
                                            {log.model}
                                        </span>
                                    </div>
                                </div>
                                <div className="flex items-center justify-between px-4 py-3 text-xs font-sans">
                                    <span className="text-text-muted flex items-center gap-2">
                                        <Bot className="size-3.5 text-text-muted" /> Client Agent
                                    </span>
                                    <div className="flex items-center gap-2 max-w-[280px]">
                                        <span
                                            className={[
                                                "font-medium truncate font-sans",
                                                clientInfo.isKnownAgent
                                                    ? "text-ink font-semibold"
                                                    : "text-ink"
                                            ].join(" ")}
                                            title={clientInfo.raw || clientInfo.name}
                                        >
                                            {clientInfo.name}
                                        </span>
                                        {clientInfo.isKnownAgent && (
                                            <span className="text-[10px] uppercase px-2 py-0.5 rounded-full border border-hairline-soft bg-canvas text-text-muted font-mono font-semibold shrink-0">
                                                Agent
                                            </span>
                                        )}
                                    </div>
                                </div>
                                <div className="flex items-center justify-between px-4 py-3 text-xs font-sans">
                                    <span className="text-text-muted flex items-center gap-2">
                                        <Globe className="size-3.5 text-text-muted" /> Client IP &
                                        Latency
                                    </span>
                                    <div className="flex items-center gap-2 font-mono">
                                        <span className="text-text-muted">
                                            {log.ipAddress || "127.0.0.1"}
                                        </span>
                                        <span className="text-text-faint">·</span>
                                        <span className="text-ink font-semibold tabular-nums">
                                            {log.latencyMs} ms
                                        </span>
                                    </div>
                                </div>
                                {(requireApiKey || log.apiKeyId) && (
                                    <div className="flex items-center justify-between px-4 py-3 text-xs font-sans">
                                        <span className="text-text-muted flex items-center gap-2">
                                            <KeyRound className="size-3.5 text-text-muted" /> Auth
                                            Key
                                        </span>
                                        <div className="flex items-center gap-2">
                                            <span className="text-ink font-medium font-sans">
                                                {log.apiKeyName || "Virtual Key"}
                                            </span>
                                            <span className="text-[11px] text-text-muted font-mono">
                                                ({log.apiKeyId || "bypass"})
                                            </span>
                                        </div>
                                    </div>
                                )}
                            </div>
                            {log.resolvedModel && log.resolvedModel !== log.model && (
                                <div className="rounded-2xl border border-hairline-soft bg-canvas-soft/40 p-4 space-y-1">
                                    <div className="flex items-center gap-2 font-semibold text-ink text-xs font-sans">
                                        <Zap className="size-3.5 text-accent" />
                                        Auto-Routing
                                    </div>
                                    <p className="text-xs text-text-muted font-mono">
                                        Requested <span className="text-ink">{log.model}</span> ↳
                                        routed to{" "}
                                        <span className="font-semibold text-ink">
                                            {log.resolvedModel}
                                        </span>
                                    </p>
                                </div>
                            )}

                            {log.fallbackOccurred && (
                                <div className="rounded-2xl border border-hairline-soft bg-canvas-soft/40 p-4 space-y-1">
                                    <div className="flex items-center gap-2 font-semibold text-ink text-xs font-sans">
                                        <Network className="size-3.5 text-accent" />
                                        Cascade Fallback
                                    </div>
                                    {log.fallbackReason && (
                                        <p className="text-xs text-text-muted font-mono italic">
                                            {log.fallbackReason}
                                        </p>
                                    )}
                                </div>
                            )}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div className="rounded-2xl border border-hairline-soft bg-canvas-soft/30 p-4 space-y-3">
                                    <div className="flex items-center justify-between border-b border-hairline-soft pb-2.5">
                                        <span className="font-medium text-xs text-text-muted flex items-center gap-2 font-sans">
                                            <Cpu className="size-3.5" /> Token Consumption
                                        </span>
                                        <span className="font-bold text-ink font-mono tabular-nums">
                                            {log.totalTokens.toLocaleString()}
                                        </span>
                                    </div>
                                    <div className="space-y-1.5 text-xs font-mono">
                                        <div className="flex justify-between">
                                            <span className="text-text-muted">Prompt Input</span>
                                            <span className="tabular-nums text-ink">
                                                {log.promptTokens.toLocaleString()}
                                            </span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-text-muted">
                                                Completion Output
                                            </span>
                                            <span className="tabular-nums text-ink">
                                                {log.completionTokens.toLocaleString()}
                                            </span>
                                        </div>
                                        {cachedTokens > 0 && (
                                            <div className="flex justify-between">
                                                <span className="text-text-muted">Cache Read</span>
                                                <span className="tabular-nums text-ink">
                                                    {cachedTokens.toLocaleString()}
                                                </span>
                                            </div>
                                        )}
                                        {cacheCreationTokens > 0 && (
                                            <div className="flex justify-between">
                                                <span className="text-text-muted">Cache Write</span>
                                                <span className="tabular-nums text-ink">
                                                    {cacheCreationTokens.toLocaleString()}
                                                </span>
                                            </div>
                                        )}
                                        {reasoningTokens > 0 && (
                                            <div className="flex justify-between">
                                                <span className="text-text-muted">
                                                    Reasoning (CoT)
                                                </span>
                                                <span className="tabular-nums text-ink">
                                                    {reasoningTokens.toLocaleString()}
                                                </span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                                <div className="rounded-2xl border border-hairline-soft bg-canvas-soft/30 p-4 space-y-3">
                                    <div className="flex items-center justify-between border-b border-hairline-soft pb-2.5">
                                        <span className="font-medium text-xs text-text-muted flex items-center gap-2 font-sans">
                                            <Coins className="size-3.5" /> Cost Accounting
                                        </span>
                                        <span className="font-bold text-ink font-mono tabular-nums">
                                            ${totalCost.toFixed(5)}
                                        </span>
                                    </div>
                                    <div className="space-y-1.5 text-xs font-mono">
                                        <div className="flex justify-between">
                                            <span className="text-text-muted">Input</span>
                                            <span className="tabular-nums text-ink">
                                                ${inputCost.toFixed(5)}
                                            </span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-text-muted">Output</span>
                                            <span className="tabular-nums text-ink">
                                                ${outputCost.toFixed(5)}
                                            </span>
                                        </div>
                                        {cacheReadCost > 0 && (
                                            <div className="flex justify-between">
                                                <span className="text-text-muted">Cache Read</span>
                                                <span className="tabular-nums text-ink">
                                                    ${cacheReadCost.toFixed(5)}
                                                </span>
                                            </div>
                                        )}
                                        {cacheCreationCost > 0 && (
                                            <div className="flex justify-between">
                                                <span className="text-text-muted">
                                                    Cache Creation
                                                </span>
                                                <span className="tabular-nums text-ink">
                                                    ${cacheCreationCost.toFixed(5)}
                                                </span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                            <div className="rounded-2xl border border-hairline-soft bg-canvas-soft/20 overflow-hidden">
                                <button
                                    type="button"
                                    onClick={() => setShowRawJson(!showRawJson)}
                                    className="w-full flex items-center justify-between px-4 py-3 text-xs font-medium text-text-muted hover:text-ink cursor-pointer transition-colors font-sans"
                                >
                                    <span className="flex items-center gap-2">
                                        <Code2 className="size-3.5" />
                                        Developer Payload
                                    </span>
                                    <div className="flex items-center gap-2">
                                        <button
                                            type="button"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                void handleCopyPayload();
                                            }}
                                            className="inline-flex items-center gap-1.5 rounded-full border border-hairline-soft bg-canvas px-3 py-1 text-[11px] text-text-muted hover:text-ink transition-colors cursor-pointer"
                                        >
                                            {copied ? (
                                                <Check className="size-3 text-emerald-500" />
                                            ) : (
                                                <Copy className="size-3" />
                                            )}
                                            <span>{copied ? "Copied" : "Copy"}</span>
                                        </button>
                                        {showRawJson ? (
                                            <ChevronDown className="size-4" />
                                        ) : (
                                            <ChevronRight className="size-4" />
                                        )}
                                    </div>
                                </button>
                                {showRawJson && (
                                    <pre className="p-4 border-t border-hairline-soft bg-canvas-soft/40 font-mono text-[11px] text-text-muted overflow-x-auto max-h-52 leading-relaxed">
                                        <code>{JSON.stringify(log, null, 2)}</code>
                                    </pre>
                                )}
                            </div>
                        </div>
                    </>
                )}
            </DialogContent>
        </Dialog>
    );
}
