import type { Column, ColumnDef } from "@tanstack/react-table";
import {
    AlertCircle,
    ArrowDown,
    ArrowDownToLine,
    ArrowUp,
    ArrowUpDown,
    ArrowUpFromLine,
    CheckCircle2,
    ChevronRight,
    Database
} from "lucide-react";
import type { RequestLogEntry } from "@srouter/types";
import { formatTime } from "@/utils/format";
import { parseUserAgent } from "@/utils/agent-detector";
import { cn } from "@/lib/utils";

interface LogColumnsOptions {
    requireApiKey: boolean;
    onSelect: (log: RequestLogEntry) => void;
}

function SortableColumnHeader<TData, TValue>({
    column,
    label
}: {
    column: Column<TData, TValue>;
    label: string;
}) {
    const isSorted = column.getIsSorted();

    return (
        <button
            type="button"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
            className="flex min-h-11 items-center gap-1.5 transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink cursor-pointer select-none"
        >
            <span>{label}</span>
            {isSorted === "asc" ? (
                <ArrowUp className="size-3 text-ink" aria-hidden="true" />
            ) : isSorted === "desc" ? (
                <ArrowDown className="size-3 text-ink" aria-hidden="true" />
            ) : (
                <ArrowUpDown className="size-3 opacity-40 hover:opacity-100" aria-hidden="true" />
            )}
        </button>
    );
}

export default function createLogColumns({
    requireApiKey,
    onSelect
}: LogColumnsOptions): ColumnDef<RequestLogEntry>[] {
    const columns: ColumnDef<RequestLogEntry>[] = [
        {
            accessorKey: "createdAt",
            header: ({ column }) => <SortableColumnHeader column={column} label="Time" />,
            cell: ({ row }) => {
                const client = parseUserAgent(row.original.userAgent);
                return (
                    <div className="whitespace-nowrap flex flex-col font-mono leading-tight">
                        <span className="text-xs font-medium text-ink">
                            {formatTime(row.original.createdAt, true)}
                        </span>
                        <span
                            className="mt-0.5 max-w-[100px] truncate text-[10px] text-text-muted"
                            title={row.original.userAgent || row.original.ipAddress || "127.0.0.1"}
                        >
                            {client.isKnownAgent
                                ? client.name
                                : row.original.ipAddress || "127.0.0.1"}
                        </span>
                    </div>
                );
            }
        },
        {
            accessorKey: "statusCode",
            header: "Status",
            cell: ({ row }) => {
                const status = row.original.statusCode;
                const is2xx = status >= 200 && status < 300;

                return (
                    <span
                        className={cn(
                            "inline-flex items-center gap-1 font-mono text-[11px] tabular-nums font-semibold px-2.5 py-0.5 rounded-full border",
                            is2xx
                                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                                : "bg-destructive/10 text-destructive border-destructive/20 font-bold"
                        )}
                    >
                        {is2xx ? (
                            <CheckCircle2
                                className="size-3 text-emerald-500 shrink-0"
                                aria-hidden="true"
                            />
                        ) : (
                            <AlertCircle
                                className="size-3 text-destructive shrink-0"
                                aria-hidden="true"
                            />
                        )}
                        {status}
                    </span>
                );
            }
        },
        {
            accessorKey: "model",
            header: ({ column }) => <SortableColumnHeader column={column} label="Route" />,
            cell: ({ row }) => {
                const model = row.original.model;
                const provider = row.original.providerId;
                const resolved = row.original.resolvedModel;

                return (
                    <div className="flex flex-col min-w-0 max-w-sm leading-tight">
                        <div className="flex items-center gap-1.5 truncate">
                            <span className="text-xs font-medium text-ink truncate font-sans">
                                {model}
                            </span>
                            {row.original.fallbackOccurred && (
                                <span className="shrink-0 text-[9px] text-text-muted bg-canvas-soft border border-hairline-soft px-1.5 py-0.2 rounded-full font-mono">
                                    fallback
                                </span>
                            )}
                        </div>
                        <span className="text-[10px] text-text-muted truncate font-mono mt-0.5">
                            {provider}
                            {resolved && resolved !== model ? ` ↳ ${resolved}` : ""}
                        </span>
                    </div>
                );
            }
        }
    ];

    if (requireApiKey) {
        columns.push({
            accessorKey: "apiKeyId",
            header: "Key",
            cell: ({ row }) => {
                const keyName = row.original.apiKeyName;
                const keyId = row.original.apiKeyId;
                if (!keyId) {
                    return <span className="font-mono text-xs text-text-faint">—</span>;
                }
                return (
                    <span
                        className="font-mono text-xs text-text-muted truncate block max-w-[120px]"
                        title={keyName || keyId}
                    >
                        {keyName || `${keyId.slice(0, 8)}…`}
                    </span>
                );
            }
        });
    }

    columns.push(
        {
            accessorKey: "totalTokens",
            header: ({ column }) => <SortableColumnHeader column={column} label="Tokens" />,
            cell: ({ row }) => {
                const {
                    promptTokens,
                    completionTokens,
                    totalTokens,
                    cachedTokens = 0
                } = row.original;
                const inputTokens = Math.max(0, promptTokens - cachedTokens);

                return (
                    <div
                        className="flex flex-col font-mono leading-tight tabular-nums"
                        title={`${totalTokens.toLocaleString()} total · ${inputTokens.toLocaleString()} input · ${completionTokens.toLocaleString()} output · ${cachedTokens.toLocaleString()} cached`}
                    >
                        <span className="text-xs font-medium text-ink">
                            {totalTokens.toLocaleString()}
                        </span>
                        <span className="mt-1 flex items-center gap-1.5 text-[10px] text-text-muted">
                            <span className="inline-flex shrink-0 items-center gap-0.5">
                                <ArrowDownToLine className="size-2.5" aria-hidden="true" />
                                {inputTokens.toLocaleString()}
                            </span>
                            <span className="text-text-faint">·</span>
                            <span className="inline-flex shrink-0 items-center gap-0.5">
                                <ArrowUpFromLine className="size-2.5" aria-hidden="true" />
                                {completionTokens.toLocaleString()}
                            </span>
                            <span className="text-text-faint">·</span>
                            <span className="inline-flex shrink-0 items-center gap-0.5">
                                <Database className="size-2.5" aria-hidden="true" />
                                {cachedTokens.toLocaleString()}
                            </span>
                        </span>
                    </div>
                );
            }
        },
        {
            accessorKey: "latencyMs",
            header: ({ column }) => <SortableColumnHeader column={column} label="Latency" />,
            cell: ({ row }) => {
                const ms = row.original.latencyMs;
                const display = ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
                return (
                    <span className="font-mono text-xs text-text-muted tabular-nums">
                        {display}
                    </span>
                );
            }
        },
        {
            accessorKey: "estimatedCost",
            header: "Cost",
            cell: ({ row }) => {
                const totalCost =
                    row.original.costBreakdown?.totalCost ?? row.original.estimatedCost ?? 0;
                return (
                    <span
                        className="font-mono text-xs text-ink tabular-nums"
                        title={`$${totalCost.toFixed(4)}`}
                    >
                        ${totalCost.toFixed(4)}
                    </span>
                );
            }
        },
        {
            id: "details",
            header: () => null,
            cell: ({ row }) => (
                <div className="text-right">
                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation();
                            onSelect(row.original);
                        }}
                        className="inline-flex size-11 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-canvas-soft hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink cursor-pointer"
                        aria-label="Inspect log details"
                        title="Inspect log details"
                    >
                        <ChevronRight className="size-4" aria-hidden="true" />
                    </button>
                </div>
            )
        }
    );

    return columns;
}
