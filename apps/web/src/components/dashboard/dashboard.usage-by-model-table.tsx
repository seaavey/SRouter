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
    ArrowDown,
    ArrowUp,
    ArrowUpDown,
    ChevronLeft,
    ChevronRight,
    Database,
    Search,
    X
} from "lucide-react";
import type { UsageStats } from "@srouter/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from "@/components/ui/empty";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from "@/components/ui/table";
import { useDebounce } from "@/hooks/useDebounce";
import { formatCompactNumber } from "@/lib/utils";

type ModelUsageItem = UsageStats["byModel"][number];

type UsageByModelTableProps = {
    models: UsageStats["byModel"];
};

export function UsageByModelTable({ models }: UsageByModelTableProps) {
    const [searchModel, setSearchModel] = useState("");
    const debouncedSearch = useDebounce(searchModel, 150);
    const [sorting, setSorting] = useState<SortingState>([{ id: "totalRequests", desc: true }]);
    const [pagination, setPagination] = useState<PaginationState>({
        pageIndex: 0,
        pageSize: 10
    });

    const filteredModels = useMemo(() => {
        const query = debouncedSearch.trim().toLowerCase();
        if (!query) return models;
        return models.filter((model) => model.model.toLowerCase().includes(query));
    }, [models, debouncedSearch]);
    const hasUsage = models.length > 0;

    const columns = useMemo<ColumnDef<ModelUsageItem>[]>(
        () => [
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
                cell: ({ row }) => (
                    <span
                        className="block max-w-64 truncate font-mono font-medium text-foreground"
                        title={row.original.model}
                    >
                        {row.original.model}
                    </span>
                )
            },
            {
                accessorKey: "totalRequests",
                header: ({ column }) => {
                    const isSorted = column.getIsSorted();
                    return (
                        <button
                            type="button"
                            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
                            className="flex items-center justify-end gap-1.5 ml-auto hover:text-foreground transition-colors cursor-pointer"
                        >
                            <span>Requests</span>
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
                        className="font-mono text-foreground tabular-nums cursor-default"
                        title={`Requests: ${row.original.totalRequests.toLocaleString()}`}
                    >
                        {formatCompactNumber(row.original.totalRequests)}
                    </span>
                )
            },
            {
                accessorKey: "totalInputTokens",
                header: ({ column }) => {
                    const isSorted = column.getIsSorted();
                    return (
                        <button
                            type="button"
                            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
                            className="flex items-center justify-end gap-1.5 ml-auto hover:text-foreground transition-colors cursor-pointer"
                        >
                            <span>Input</span>
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
                        className="font-mono text-muted-foreground tabular-nums cursor-default"
                        title={`Prompt Tokens: ${row.original.totalInputTokens.toLocaleString()}`}
                    >
                        {formatCompactNumber(row.original.totalInputTokens)}
                    </span>
                )
            },
            {
                accessorKey: "totalOutputTokens",
                header: ({ column }) => {
                    const isSorted = column.getIsSorted();
                    return (
                        <button
                            type="button"
                            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
                            className="flex items-center justify-end gap-1.5 ml-auto hover:text-foreground transition-colors cursor-pointer"
                        >
                            <span>Output</span>
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
                        className="font-mono text-muted-foreground tabular-nums cursor-default"
                        title={`Completion Tokens: ${row.original.totalOutputTokens.toLocaleString()}`}
                    >
                        {formatCompactNumber(row.original.totalOutputTokens)}
                    </span>
                )
            },
            {
                accessorKey: "totalCachedTokens",
                header: ({ column }) => {
                    const isSorted = column.getIsSorted();
                    return (
                        <button
                            type="button"
                            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
                            className="flex items-center justify-end gap-1.5 ml-auto hover:text-foreground transition-colors cursor-pointer"
                        >
                            <span>Cached</span>
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
                        className="font-mono text-muted-foreground tabular-nums cursor-default"
                        title={`Cached Tokens: ${row.original.totalCachedTokens.toLocaleString()}`}
                    >
                        {formatCompactNumber(row.original.totalCachedTokens)}
                    </span>
                )
            },
            {
                id: "total",
                accessorFn: (row) => row.totalInputTokens + row.totalOutputTokens,
                header: ({ column }) => {
                    const isSorted = column.getIsSorted();
                    return (
                        <button
                            type="button"
                            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
                            className="flex items-center justify-end gap-1.5 ml-auto hover:text-foreground transition-colors cursor-pointer"
                        >
                            <span>Total</span>
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
                    const total = row.original.totalInputTokens + row.original.totalOutputTokens;
                    return (
                        <span
                            className="font-mono font-medium text-foreground tabular-nums cursor-default"
                            title={`Total Tokens: ${total.toLocaleString()} (${row.original.totalInputTokens.toLocaleString()} in · ${row.original.totalOutputTokens.toLocaleString()} out)`}
                        >
                            {formatCompactNumber(total)}
                        </span>
                    );
                }
            },
            {
                accessorKey: "estCost",
                header: ({ column }) => {
                    const isSorted = column.getIsSorted();
                    return (
                        <button
                            type="button"
                            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
                            className="flex items-center justify-end gap-1.5 ml-auto hover:text-foreground transition-colors cursor-pointer"
                        >
                            <span>Est. cost</span>
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
                    <span className="font-mono font-semibold text-foreground tabular-nums">
                        ${row.original.estCost.toFixed(4)}
                    </span>
                )
            }
        ],
        []
    );

    const table = useReactTable({
        data: filteredModels,
        columns,
        state: {
            sorting,
            pagination
        },
        onSortingChange: setSorting,
        onPaginationChange: setPagination,
        getCoreRowModel: getCoreRowModel(),
        getSortedRowModel: getSortedRowModel(),
        getPaginationRowModel: getPaginationRowModel(),
        autoResetPageIndex: true
    });

    const pageCount = table.getPageCount();
    const currentPage = table.getState().pagination.pageIndex;
    const pageSize = table.getState().pagination.pageSize;
    const totalRows = filteredModels.length;
    const startRow = totalRows === 0 ? 0 : currentPage * pageSize + 1;
    const endRow = Math.min((currentPage + 1) * pageSize, totalRows);

    return (
        <Card className="min-w-0 gap-0 overflow-hidden p-0 border border-border/70 bg-transparent shadow-xs">
            <CardHeader className="flex flex-col justify-between gap-3 border-b border-border/60 px-4 py-3.5 sm:flex-row sm:items-center">
                <div className="flex min-w-0 items-center gap-2.5">
                    <div className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-muted/40 text-foreground">
                        <Database className="size-3.5" strokeWidth={1.75} />
                    </div>
                    <div className="min-w-0">
                        <CardTitle className="text-sm font-semibold tracking-tight text-foreground">Usage by model</CardTitle>
                        <CardDescription className="text-[11px] text-muted-foreground">
                            Exact token usage and estimated spend for every model.
                        </CardDescription>
                    </div>
                </div>

                <div className="relative w-full sm:w-64">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        type="text"
                        placeholder="Search models…"
                        value={searchModel}
                        onChange={(event) => setSearchModel(event.target.value)}
                        className="h-8 pl-8 pr-7 font-mono text-xs bg-muted/20 border-border/60 focus-visible:ring-1"
                    />
                    {searchModel && (
                        <button
                            type="button"
                            onClick={() => setSearchModel("")}
                            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-xs p-0.5 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                            aria-label="Clear search"
                        >
                            <X className="size-3" />
                        </button>
                    )}
                </div>
            </CardHeader>

            <CardContent className="p-0">
                {filteredModels.length === 0 ? (
                    <Empty className="min-h-44">
                        <EmptyHeader>
                            <EmptyMedia variant="icon">
                                <Search className="size-5" strokeWidth={1.5} />
                            </EmptyMedia>
                            <EmptyTitle>{hasUsage ? "No matching models" : "No model usage yet"}</EmptyTitle>
                            <EmptyDescription>
                                {hasUsage
                                    ? `No models match “${searchModel.trim()}”. Try a different search.`
                                    : "Usage details will appear after the gateway handles its first request."}
                            </EmptyDescription>
                        </EmptyHeader>
                    </Empty>
                ) : (
                    <>
                        <Table className="min-w-[900px]">
                            <TableHeader>
                                {table.getHeaderGroups().map((headerGroup) => (
                                    <TableRow key={headerGroup.id}>
                                        {headerGroup.headers.map((header) => (
                                            <TableHead
                                                key={header.id}
                                                className={
                                                    header.id !== "model" ? "text-right" : ""
                                                }
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
                                    <TableRow key={row.id}>
                                        {row.getVisibleCells().map((cell) => (
                                            <TableCell
                                                key={cell.id}
                                                className={
                                                    cell.column.id !== "model" ? "text-right" : ""
                                                }
                                            >
                                                {flexRender(
                                                    cell.column.columnDef.cell,
                                                    cell.getContext()
                                                )}
                                            </TableCell>
                                        ))}
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>

                        {totalRows > 10 && (
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-t border-border/60 bg-muted/15 px-4 py-2.5 text-xs text-muted-foreground font-mono">
                                <div className="flex items-center gap-2 text-[11px]">
                                    <span>Showing</span>
                                    <span className="font-semibold text-foreground">
                                        {startRow}-{endRow}
                                    </span>
                                    <span>of</span>
                                    <span className="font-semibold text-foreground">
                                        {totalRows}
                                    </span>
                                    <span>models</span>
                                </div>

                                <div className="flex items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={() => table.previousPage()}
                                        disabled={!table.getCanPreviousPage()}
                                        className="flex size-6 items-center justify-center rounded-md border border-border/70 bg-background text-foreground hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-colors shadow-2xs"
                                        title="Previous page"
                                    >
                                        <ChevronLeft className="size-3.5" />
                                    </button>
                                    <span className="px-1 text-[11px] text-foreground font-medium">
                                        {currentPage + 1} / {pageCount}
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => table.nextPage()}
                                        disabled={!table.getCanNextPage()}
                                        className="flex size-6 items-center justify-center rounded-md border border-border/70 bg-background text-foreground hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-colors shadow-2xs"
                                        title="Next page"
                                    >
                                        <ChevronRight className="size-3.5" />
                                    </button>
                                </div>
                            </div>
                        )}
                    </>
                )}
            </CardContent>
        </Card>
    );
}
