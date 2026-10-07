import type { ReactNode } from "react";
import type { RequestLog } from "@/generated/api";
import { formatTime } from "@/utils/format";
import { parseUserAgent } from "@/utils/agent-detector";

interface DetailRowProps {
    label: string;
    children: ReactNode;
}

function DetailRow({ label, children }: DetailRowProps) {
    return (
        <div className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <dt className="text-xs text-text-muted">{label}</dt>
            <dd className="m-0 min-w-0">{children}</dd>
        </div>
    );
}

export function LogOverview({ log, requireApiKey }: { log: RequestLog; requireApiKey: boolean }) {
    const clientInfo = parseUserAgent(log.user_agent);

    return (
        <dl className="divide-y divide-hairline-soft rounded-2xl border border-hairline-soft">
            <DetailRow label="Timestamp">
                <span className="font-mono text-xs text-ink tabular-nums">
                    {new Date(log.created_at).toLocaleDateString()}{" "}
                    {formatTime(log.created_at, true)}
                </span>
            </DetailRow>
            <DetailRow label="Provider and model">
                <span className="font-mono text-xs text-ink">
                    {log.provider} / {log.model}
                </span>
            </DetailRow>
            <DetailRow label="Client">
                <span
                    className="max-w-full truncate text-xs text-ink"
                    title={clientInfo.raw || clientInfo.name}
                >
                    {clientInfo.name}
                    {clientInfo.isKnownAgent ? " (agent)" : ""} · {log.ip_address || "127.0.0.1"}
                </span>
            </DetailRow>
            {(requireApiKey || log.api_key_id) && (
                <DetailRow label="Key">
                    <span className="font-mono text-xs text-ink">{log.api_key_id || "bypass"}</span>
                </DetailRow>
            )}
        </dl>
    );
}

export function LogRoutingNotices({ log }: { log: RequestLog }) {
    return (
        <div className="flex flex-col gap-3">
            {log.resolved_model && log.resolved_model !== log.model && (
                <p className="rounded-2xl border border-hairline-soft px-4 py-3 font-mono text-xs leading-relaxed text-text-muted">
                    Requested <span className="text-ink">{log.model}</span> routed to{" "}
                    <span className="text-ink">{log.resolved_model}</span>
                </p>
            )}
            {log.fallback_occurred && (
                <div className="flex flex-col gap-1 rounded-2xl border border-hairline-soft px-4 py-3">
                    <p className="text-xs font-medium text-ink">Used a fallback provider</p>
                    {log.fallback_reason && (
                        <p className="font-mono text-xs leading-relaxed text-text-muted">
                            {log.fallback_reason}
                        </p>
                    )}
                </div>
            )}
        </div>
    );
}

function formatCost(value: number): string {
    return value.toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 4,
        maximumFractionDigits: 4
    });
}

interface MixSegment {
    key: string;
    label: string;
    tokens: number;
    widthPct: number;
}

export function LogTokenMix({ log }: { log: RequestLog }) {
    const cachedTokens = log.cached_tokens ?? 0;
    const reasoningTokens = log.reasoning_tokens ?? 0;
    const input_tokens = log.input_tokens ?? 0;
    const output_tokens = log.output_tokens ?? 0;
    const plainInput = Math.max(0, input_tokens - cachedTokens);
    const total = Math.max(1, log.total_tokens ?? 0);
    const segments: MixSegment[] = [
        { key: "input", label: "Input", tokens: plainInput, widthPct: (plainInput / total) * 100 },
        {
            key: "cache",
            label: "Cache read",
            tokens: cachedTokens,
            widthPct: (cachedTokens / total) * 100
        },
        {
            key: "output",
            label: "Output",
            tokens: output_tokens,
            widthPct: (output_tokens / total) * 100
        },
        {
            key: "reasoning",
            label: "Reasoning",
            tokens: reasoningTokens,
            widthPct: (reasoningTokens / total) * 100
        }
    ].filter((segment) => segment.tokens > 0);
    const largest = segments.reduce(
        (winner, segment) => (segment.tokens > winner.tokens ? segment : winner),
        segments[0] ?? { key: "none", label: "No tokens", tokens: 0, widthPct: 0 }
    );
    const cacheShare = total > 0 ? Math.round((cachedTokens / total) * 100) : 0;

    return (
        <div className="flex flex-col gap-2 rounded-2xl border border-hairline-soft p-4">
            <div className="flex items-baseline justify-between gap-3">
                <span className="text-xs text-text-muted">Token mix</span>
                <span className="font-mono text-xs text-text-muted tabular-nums">
                    {(log.total_tokens ?? 0).toLocaleString()} total
                </span>
            </div>
            <div
                className="flex h-2.5 w-full overflow-hidden rounded-full bg-canvas-soft"
                role="img"
                aria-label={`Token mix: ${segments.map((segment) => `${segment.label} ${segment.tokens.toLocaleString()}`).join(", ")}`}
            >
                {segments.map((segment, index) => (
                    <span
                        key={segment.key}
                        title={`${segment.label}: ${segment.tokens.toLocaleString()}`}
                        style={{ width: `${segment.widthPct}%` }}
                        className={
                            index === 0
                                ? "h-full bg-ink"
                                : index === 1
                                  ? "h-full bg-ink/60"
                                  : index === 2
                                    ? "h-full bg-ink/35"
                                    : "h-full bg-ink/20"
                        }
                    />
                ))}
            </div>
            <p className="font-mono text-[11px] leading-relaxed text-text-muted">
                Mostly {largest.label.toLowerCase()} · {cacheShare}% cache read
            </p>
        </div>
    );
}

export function LogUsageSummary({ log }: { log: RequestLog }) {
    // The Rust build records one estimated total per request; the per-category
    // split Node logged is not part of the contract, so only the total is known.
    const totalCost = log.estimated_cost ?? 0;
    const UNPRICED = {
        cost: "—",
        costTitle: "Not recorded by this build"
    } as const;
    const cachedTokens = log.cached_tokens ?? 0;
    const cacheCreationTokens = log.cache_creation_tokens ?? 0;
    const reasoningTokens = log.reasoning_tokens ?? 0;

    const rows: { label: string; tokens: string; cost: string; costTitle: string }[] = [
        {
            label: "Input",
            tokens: (log.input_tokens ?? 0).toLocaleString(),
            ...UNPRICED
        },
        {
            label: "Output",
            tokens: (log.output_tokens ?? 0).toLocaleString(),
            ...UNPRICED
        }
    ];
    if (cachedTokens > 0) {
        rows.push({
            label: "Cache read",
            tokens: cachedTokens.toLocaleString(),
            ...UNPRICED
        });
    }
    if (cacheCreationTokens > 0) {
        rows.push({
            label: "Cache write",
            tokens: cacheCreationTokens.toLocaleString(),
            ...UNPRICED
        });
    }
    if (reasoningTokens > 0) {
        rows.push({
            label: "Reasoning",
            tokens: reasoningTokens.toLocaleString(),
            ...UNPRICED
        });
    }

    return (
        <section aria-label="Token and cost breakdown" className="flex flex-col gap-3">
            <div className="overflow-hidden rounded-2xl border border-hairline-soft">
                <table className="w-full font-mono text-xs">
                    <caption className="sr-only">Token and cost breakdown</caption>
                    <thead>
                        <tr className="border-b border-hairline-soft text-left">
                            <th
                                scope="col"
                                className="px-4 py-3 font-sans text-xs font-normal text-text-muted"
                            >
                                Tokens
                            </th>
                            <th
                                scope="col"
                                className="px-4 py-3 text-right text-sm font-semibold text-ink tabular-nums"
                            >
                                {(log.total_tokens ?? 0).toLocaleString()}
                            </th>
                            <th
                                scope="col"
                                className="px-4 py-3 font-sans text-xs font-normal text-text-muted"
                            >
                                Cost
                            </th>
                            <th
                                scope="col"
                                className="px-4 py-3 text-right text-sm font-semibold text-ink tabular-nums"
                            >
                                {formatCost(totalCost)}
                            </th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-hairline-soft">
                        {rows.map((row) => (
                            <tr key={row.label}>
                                <th
                                    scope="row"
                                    className="px-4 py-2 text-left font-normal text-text-muted"
                                >
                                    {row.label}
                                </th>
                                <td className="px-4 py-2 text-right text-ink tabular-nums">
                                    {row.tokens}
                                </td>
                                <th
                                    scope="row"
                                    className="px-4 py-2 text-left font-normal text-text-muted"
                                >
                                    {row.label}
                                </th>
                                <td
                                    className="px-4 py-2 text-right text-ink tabular-nums"
                                    title={row.costTitle}
                                >
                                    {row.cost}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </section>
    );
}
