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
import { Badge } from "@/components/ui/badge";
import {
    Table,
    TableHeader,
    TableBody,
    TableHead,
    TableRow,
    TableCell
} from "@/components/ui/table";

function formatTime(ms: number): string {
    return new Date(ms).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
    });
}

function formatDate(ms: number): string {
    return new Date(ms).toLocaleDateString();
}

interface LogTableProps {
    logs: RequestLogEntry[];
    onSelect: (log: RequestLogEntry) => void;
}

export function LogTable({ logs, onSelect }: LogTableProps) {
    const [sorting, setSorting] = useState<SortingState>([{ id: "createdAt", desc: true }]);
    const [pagination, setPagination] = useState<PaginationState>({
        pageIndex: 0,
        pageSize: 25
    });

    const columns = useMemo<ColumnDef<RequestLogEntry>[]>(
        () => [
            {
                accessorKey: "createdAt",
                header: ({ column }) => {
                    const isSorted = column.getIsSorted();
                    return (
                        <button
                            type="button"
                            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
                            className="flex items-center gap-1.5 hover:text-foreground transition-colors cursor-pointer"
                        >
                            <span>Timestamp</span>
                            {isSorted === "asc" ? (
                                <ArrowUp className="size-3 text-amber-500" />
                            ) : isSorted === "desc" ? (
                                <ArrowDown className="size-3 text-amber-500" />
                            ) : (
                                <ArrowUpDown className="size-3 opacity-40 hover:opacity-100" />
                            )}
                        </button>
                    );
                },
                cell: ({ row }) => (
                    <div className="whitespace-nowrap">
                        <div className="font-mono text-xs font-medium text-foreground">
                            {formatTime(row.original.createdAt)}
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                            {formatDate(row.original.createdAt)}
                        </div>
                    </div>
                )
            },
            {
                accessorKey: "providerId",
                header: ({ column }) => {
                    const isSorted = column.getIsSorted();
                    return (
                        <button
                            type="button"
                            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
                            className="flex items-center gap-1.5 hover:text-foreground transition-colors cursor-pointer"
                        >
                            <span>Provider</span>
                            {isSorted === "asc" ? (
                                <ArrowUp className="size-3 text-amber-500" />
                            ) : isSorted === "desc" ? (
                                <ArrowDown className="size-3 text-amber-500" />
                            ) : (
                                <ArrowUpDown className="size-3 opacity-40 hover:opacity-100" />
                            )}
                        </button>
                    );
                },
                cell: ({ row }) => (
                    <span className="font-mono text-xs text-muted-foreground">
                        {row.original.providerId}
                    </span>
                )
            },
            {
                accessorKey: "model",
                header: ({ column }) => {
                    const isSorted = column.getIsSorted();
                    return (
                        <button
                            type="button"
                            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
                            className="flex items-center gap-1.5 hover:text-foreground transition-colors cursor-pointer"
                        >
                            <span>Model</span>
                            {isSorted === "asc" ? (
                                <ArrowUp className="size-3 text-amber-500" />
                            ) : isSorted === "desc" ? (
                                <ArrowDown className="size-3 text-amber-500" />
                            ) : (
                                <ArrowUpDown className="size-3 opacity-40 hover:opacity-100" />
                            )}
                        </button>
                    );
                },
                cell: ({ row }) => {
                    const model = row.original.model;
                    const isAuto =
                        model === "auto" ||
                        model === "srouter/auto" ||
                        model === "srouter/smart" ||
                        model.startsWith("auto/");
                    const resolved = row.original.resolvedModel;

                    return (
                        <div className="flex flex-col gap-0.5 max-w-xs">
                            <div className="flex items-center gap-1.5">
                                <span className="font-mono text-xs font-semibold text-foreground truncate block">
                                    {model}
                                </span>
                                {isAuto && (
                                    <span className="shrink-0 inline-flex items-center rounded px-1 py-0.2 text-[9px] font-mono font-bold bg-indigo-500/15 text-indigo-400 border border-indigo-500/30">
                                        Auto
                                    </span>
                                )}
                                {row.original.fallbackOccurred && (
                                    <span className="shrink-0 inline-flex items-center rounded px-1 py-0.2 text-[9px] font-mono font-bold bg-amber-500/15 text-amber-500 border border-amber-500/30">
                                        Fallback
                                    </span>
                                )}
                            </div>
                            {resolved && resolved !== model && (
                                <span
                                    className="font-mono text-[10px] text-muted-foreground truncate flex items-center gap-1"
                                    title={`Dispatched to: ${resolved}`}
                                >
                                    <span className="text-indigo-400">↳</span>
                                    <span>{resolved}</span>
                                </span>
                            )}
                        </div>
                    );
                }
            },
            {
                accessorKey: "statusCode",
                header: "Status",
                cell: ({ row }) => {
                    const isOk = row.original.statusCode >= 200 && row.original.statusCode < 300;
                    return (
                        <Badge
                            variant={isOk ? "emerald" : "destructive"}
                            className="font-mono text-[10px]"
                        >
                            {isOk ? (
                                <CheckCircle2 className="size-3" />
                            ) : (
                                <AlertCircle className="size-3" />
                            )}
                            {row.original.statusCode}
                        </Badge>
                    );
                }
            },
            {
                accessorKey: "totalTokens",
                header: ({ column }) => {
                    const isSorted = column.getIsSorted();
                    return (
                        <button
                            type="button"
                            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
                            className="flex items-center gap-1.5 hover:text-foreground transition-colors cursor-pointer"
                        >
                            <span>Tokens</span>
                            {isSorted === "asc" ? (
                                <ArrowUp className="size-3 text-amber-500" />
                            ) : isSorted === "desc" ? (
                                <ArrowDown className="size-3 text-amber-500" />
                            ) : (
                                <ArrowUpDown className="size-3 opacity-40 hover:opacity-100" />
                            )}
                        </button>
                    );
                },
                cell: ({ row }) => (
                    <span className="font-mono text-xs text-foreground">
                        {row.original.totalTokens.toLocaleString()}
                        <span className="text-[10px] text-muted-foreground ml-1">
                            ({row.original.promptTokens} in / {row.original.completionTokens} out)
                        </span>
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
                            className="flex items-center gap-1.5 hover:text-foreground transition-colors cursor-pointer"
                        >
                            <span>Latency</span>
                            {isSorted === "asc" ? (
                                <ArrowUp className="size-3 text-amber-500" />
                            ) : isSorted === "desc" ? (
                                <ArrowDown className="size-3 text-amber-500" />
                            ) : (
                                <ArrowUpDown className="size-3 opacity-40 hover:opacity-100" />
                            )}
                        </button>
                    );
                },
                cell: ({ row }) => (
                    <span
                        className={`font-mono text-xs ${
                            row.original.latencyMs > 1000 ? "text-amber-500" : "text-emerald-500"
                        }`}
                    >
                        {row.original.latencyMs}ms
                    </span>
                )
            },
            {
                accessorKey: "estimatedCost",
                header: "Cost",
                cell: ({ row }) => (
                    <span className="font-mono text-xs text-emerald-500">
                        {row.original.estimatedCost
                            ? `$${row.original.estimatedCost.toFixed(4)}`
                            : "—"}
                    </span>
                )
            },
            {
                id: "details",
                header: () => <div className="text-right">Details</div>,
                cell: ({ row }) => (
                    <div className="text-right">
                        <button
                            type="button"
                            onClick={(e) => {
                                e.stopPropagation();
                                onSelect(row.original);
                            }}
                            className="inline-flex size-6 items-center justify-center rounded-md border border-border/50 bg-secondary/20 group-hover:bg-accent group-hover:text-white transition-colors cursor-pointer"
                        >
                            <ChevronRight className="size-3.5" />
                        </button>
                    </div>
                )
            }
        ],
        [onSelect]
    );

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
        <div className="space-y-3 font-mono">
            <div className="rounded-xl border border-border/80 bg-card shadow-2xs overflow-hidden">
                <Table>
                    <TableHeader>
                        {table.getHeaderGroups().map((headerGroup) => (
                            <TableRow key={headerGroup.id}>
                                {headerGroup.headers.map((header) => (
                                    <TableHead
                                        key={header.id}
                                        className={header.id === "details" ? "text-right" : ""}
                                    >
                                        {header.isPlaceholder
                                            ? null
                                            : flexRender(
                                                  header.column.columnDef.header,
                                                  header.getContext()
                                              )}
                                    </TableHead>
                                ))}
                            </TableRow>
                        ))}
                    </TableHeader>
                    <TableBody>
                        {table.getRowModel().rows.map((row) => (
                            <TableRow
                                key={row.id}
                                onClick={() => onSelect(row.original)}
                                className="cursor-pointer group hover:bg-secondary/30"
                            >
                                {row.getVisibleCells().map((cell) => (
                                    <TableCell
                                        key={cell.id}
                                        className={cell.column.id === "details" ? "text-right" : ""}
                                    >
                                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                    </TableCell>
                                ))}
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>

            {/* Pagination Controls */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-1 text-xs text-muted-foreground">
                <div className="flex items-center gap-2 text-[11px]">
                    <span>Showing</span>
                    <span className="font-semibold text-foreground">
                        {totalRows === 0 ? 0 : `${startRow}-${endRow}`}
                    </span>
                    <span>of</span>
                    <span className="font-semibold text-foreground">{totalRows}</span>
                    <span>logs</span>
                </div>

                <div className="flex items-center gap-3 self-end sm:self-auto">
                    <div className="flex items-center gap-1.5 text-[11px]">
                        <span>Rows:</span>
                        <select
                            value={pageSize}
                            onChange={(e) => table.setPageSize(Number(e.target.value))}
                            className="rounded-[4px] border border-border bg-secondary/30 px-2 py-0.5 text-[11px] text-foreground focus:outline-none cursor-pointer"
                        >
                            <option value={10}>10</option>
                            <option value={25}>25</option>
                            <option value={50}>50</option>
                            <option value={100}>100</option>
                        </select>
                    </div>

                    <div className="flex items-center gap-1">
                        <button
                            type="button"
                            onClick={() => table.previousPage()}
                            disabled={!table.getCanPreviousPage()}
                            className="flex size-6 items-center justify-center rounded-[4px] border border-border bg-secondary/30 text-foreground hover:bg-secondary disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-colors"
                            title="Previous page"
                        >
                            <ChevronLeft className="size-3.5" />
                        </button>
                        <span className="px-2 text-[11px] text-foreground">
                            {pageCount === 0 ? 1 : currentPage + 1} / {Math.max(1, pageCount)}
                        </span>
                        <button
                            type="button"
                            onClick={() => table.nextPage()}
                            disabled={!table.getCanNextPage()}
                            className="flex size-6 items-center justify-center rounded-[4px] border border-border bg-secondary/30 text-foreground hover:bg-secondary disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-colors"
                            title="Next page"
                        >
                            <ChevronRight className="size-3.5" />
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
