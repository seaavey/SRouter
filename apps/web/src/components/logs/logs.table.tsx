import { useState, useMemo } from "react";
import {
    type ColumnDef,
    type SortingState,
    type PaginationState,
    flexRender,
    getCoreRowModel,
    getPaginationRowModel,
    getSortedRowModel,
    useReactTable
} from "@tanstack/react-table";
import {
    AlertCircle,
    ArrowDown,
    ArrowUp,
    ArrowUpDown,
    CheckCircle2,
    ChevronLeft,
    ChevronRight
} from "lucide-react";
import type { RequestLogEntry } from "@srouter/types";
import { formatTime } from "@/utils/format";
import { parseUserAgent } from "@/utils/agent-detector";

interface LogTableProps {
    logs: RequestLogEntry[];
    requireApiKey?: boolean;
    onSelect: (log: RequestLogEntry) => void;
}

export function LogTable({ logs, requireApiKey = false, onSelect }: LogTableProps) {
    const [sorting, setSorting] = useState<SortingState>([{ id: "createdAt", desc: true }]);
    const [pagination, setPagination] = useState<PaginationState>({
        pageIndex: 0,
        pageSize: 25
    });

    const columns = useMemo<ColumnDef<RequestLogEntry>[]>(() => {
        const cols: ColumnDef<RequestLogEntry>[] = [
            {
                accessorKey: "createdAt",
                header: ({ column }) => {
                    const isSorted = column.getIsSorted();
                    return (
                        <button
                            type="button"
                            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
                            className="flex items-center gap-1.5 hover:text-ink transition-colors cursor-pointer select-none"
                        >
                            <span>Time</span>
                            {isSorted === "asc" ? (
                                <ArrowUp className="size-3 text-ink" />
                            ) : isSorted === "desc" ? (
                                <ArrowDown className="size-3 text-ink" />
                            ) : (
                                <ArrowUpDown className="size-3 opacity-40 hover:opacity-100" />
                            )}
                        </button>
                    );
                },
                cell: ({ row }) => {
                    const client = parseUserAgent(row.original.userAgent);
                    return (
                        <div className="whitespace-nowrap flex flex-col font-mono leading-tight">
                            <span className="text-xs font-medium text-ink">
                                {formatTime(row.original.createdAt, true)}
                            </span>
                            <span
                                className="text-[10px] text-text-muted truncate max-w-[100px] mt-0.5"
                                title={
                                    row.original.userAgent || row.original.ipAddress || "127.0.0.1"
                                }
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
                            className={[
                                "inline-flex items-center gap-1 font-mono text-[11px] tabular-nums font-semibold px-2.5 py-0.5 rounded-full border",
                                is2xx
                                    ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                                    : "bg-destructive/10 text-destructive border-destructive/20 font-bold"
                            ].join(" ")}
                        >
                            {is2xx ? (
                                <CheckCircle2 className="size-3 text-emerald-500 shrink-0" />
                            ) : (
                                <AlertCircle className="size-3 text-destructive shrink-0" />
                            )}
                            {status}
                        </span>
                    );
                }
            },
            {
                accessorKey: "model",
                header: ({ column }) => {
                    const isSorted = column.getIsSorted();
                    return (
                        <button
                            type="button"
                            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
                            className="flex items-center gap-1.5 hover:text-ink transition-colors cursor-pointer select-none"
                        >
                            <span>Route</span>
                            {isSorted === "asc" ? (
                                <ArrowUp className="size-3 text-ink" />
                            ) : isSorted === "desc" ? (
                                <ArrowDown className="size-3 text-ink" />
                            ) : (
                                <ArrowUpDown className="size-3 opacity-40 hover:opacity-100" />
                            )}
                        </button>
                    );
                },
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
            cols.push({
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

        cols.push(
            {
                accessorKey: "totalTokens",
                header: ({ column }) => {
                    const isSorted = column.getIsSorted();
                    return (
                        <button
                            type="button"
                            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
                            className="flex items-center gap-1.5 hover:text-ink transition-colors cursor-pointer select-none"
                        >
                            <span>Tokens</span>
                            {isSorted === "asc" ? (
                                <ArrowUp className="size-3 text-ink" />
                            ) : isSorted === "desc" ? (
                                <ArrowDown className="size-3 text-ink" />
                            ) : (
                                <ArrowUpDown className="size-3 opacity-40 hover:opacity-100" />
                            )}
                        </button>
                    );
                },
                cell: ({ row }) => (
                    <span className="font-mono text-xs text-ink tabular-nums">
                        {row.original.totalTokens.toLocaleString()}
                    </span>
                )
            },
            {
                accessorKey: "latencyMs",
                header: ({ column }) => {
                    const isSorted = column.getIsSorted();
                    return (
                        <button
                            type="button"
                            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
                            className="flex items-center gap-1.5 hover:text-ink transition-colors cursor-pointer select-none"
                        >
                            <span>Latency</span>
                            {isSorted === "asc" ? (
                                <ArrowUp className="size-3 text-ink" />
                            ) : isSorted === "desc" ? (
                                <ArrowDown className="size-3 text-ink" />
                            ) : (
                                <ArrowUpDown className="size-3 opacity-40 hover:opacity-100" />
                            )}
                        </button>
                    );
                },
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
                        <span className="font-mono text-xs text-ink tabular-nums">
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
                            className="inline-flex size-7 items-center justify-center rounded-full text-text-muted hover:text-ink hover:bg-canvas-soft transition-colors cursor-pointer"
                            title="Inspect log details"
                        >
                            <ChevronRight className="size-4" />
                        </button>
                    </div>
                )
            }
        );

        return cols;
    }, [requireApiKey, onSelect]);

    const table = useReactTable({
        data: logs,
        columns,
        state: {
            sorting,
            pagination
        },
        onSortingChange: setSorting,
        onPaginationChange: setPagination,
        getCoreRowModel: getCoreRowModel(),
        getSortedRowModel: getSortedRowModel(),
        getPaginationRowModel: getPaginationRowModel()
    });

    const pageCount = table.getPageCount();
    const currentPage = table.getState().pagination.pageIndex;
    const pageSize = table.getState().pagination.pageSize;
    const totalRows = logs.length;
    const startRow = totalRows === 0 ? 0 : currentPage * pageSize + 1;
    const endRow = Math.min((currentPage + 1) * pageSize, totalRows);

    return (
        <div className="space-y-4 font-sans">
            <div className="overflow-hidden rounded-3xl border border-hairline-soft bg-canvas shadow-none">
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                        <thead className="border-b border-hairline-soft bg-canvas-soft text-[11px] uppercase font-mono tracking-wider text-text-muted">
                            {table.getHeaderGroups().map((headerGroup) => (
                                <tr key={headerGroup.id}>
                                    {headerGroup.headers.map((header) => (
                                        <th
                                            key={header.id}
                                            className="h-10 px-5 font-semibold text-text-muted"
                                        >
                                            {header.isPlaceholder
                                                ? null
                                                : flexRender(
                                                      header.column.columnDef.header,
                                                      header.getContext()
                                                  )}
                                        </th>
                                    ))}
                                </tr>
                            ))}
                        </thead>
                        <tbody className="divide-y divide-hairline-soft">
                            {table.getRowModel().rows.map((row) => (
                                <tr
                                    key={row.id}
                                    onClick={() => onSelect(row.original)}
                                    className="cursor-pointer hover:bg-canvas-soft/50 transition-colors group"
                                >
                                    {row.getVisibleCells().map((cell) => (
                                        <td key={cell.id} className="py-3 px-5 text-xs">
                                            {flexRender(
                                                cell.column.columnDef.cell,
                                                cell.getContext()
                                            )}
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Pagination Controls */}
            {totalRows > pageSize && (
                <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-2 text-xs text-text-muted font-sans">
                    <div>
                        Showing <span className="text-ink font-semibold font-mono">{startRow}</span>
                        –<span className="text-ink font-semibold font-mono">{endRow}</span> of{" "}
                        <span className="text-ink font-semibold font-mono">{totalRows}</span> logs
                    </div>
                    <div className="flex items-center gap-1.5">
                        <button
                            type="button"
                            onClick={() => table.previousPage()}
                            disabled={!table.getCanPreviousPage()}
                            className="inline-flex size-8 items-center justify-center rounded-full border border-hairline-soft bg-canvas text-ink hover:bg-canvas-soft disabled:opacity-40 disabled:pointer-events-none transition-colors cursor-pointer"
                            aria-label="Previous page"
                        >
                            <ChevronLeft className="size-4" />
                        </button>
                        <span className="px-3 text-xs font-mono text-text-muted tabular-nums">
                            {currentPage + 1} / {pageCount}
                        </span>
                        <button
                            type="button"
                            onClick={() => table.nextPage()}
                            disabled={!table.getCanNextPage()}
                            className="inline-flex size-8 items-center justify-center rounded-full border border-hairline-soft bg-canvas text-ink hover:bg-canvas-soft disabled:opacity-40 disabled:pointer-events-none transition-colors cursor-pointer"
                            aria-label="Next page"
                        >
                            <ChevronRight className="size-4" />
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
