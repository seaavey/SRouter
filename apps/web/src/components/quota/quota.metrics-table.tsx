import { useMemo } from "react";
import { type ColumnDef, flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";
import type { ProviderUsageMetric } from "@srouter/types";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from "@/components/ui/table";
import { formatLastUsed } from "./quota.utils";

export interface UsageMetricsTableProps {
    metrics?: ProviderUsageMetric[];
}

export function UsageMetricsTable({ metrics = [] }: UsageMetricsTableProps) {
    const columns = useMemo<ColumnDef<ProviderUsageMetric>[]>(
        () => [
            {
                accessorKey: "model",
                header: "Model",
                cell: ({ row }) => (
                    <span className="font-sans font-medium text-xs text-ink truncate max-w-xs block">
                        {row.original.model}
                    </span>
                )
            },
            {
                accessorKey: "totalRequests",
                header: () => <div className="text-right">Requests</div>,
                cell: ({ row }) => (
                    <div className="text-right font-mono text-xs text-ink tabular-nums">
                        {row.original.totalRequests.toLocaleString()}
                    </div>
                )
            },
            {
                accessorKey: "promptTokens",
                header: () => <div className="text-right">Prompt Tokens</div>,
                cell: ({ row }) => (
                    <div className="text-right font-mono text-xs text-text-muted tabular-nums">
                        {row.original.promptTokens.toLocaleString()}
                    </div>
                )
            },
            {
                accessorKey: "completionTokens",
                header: () => <div className="text-right">Completion</div>,
                cell: ({ row }) => (
                    <div className="text-right font-mono text-xs text-text-muted tabular-nums">
                        {row.original.completionTokens.toLocaleString()}
                    </div>
                )
            },
            {
                accessorKey: "totalTokens",
                header: () => <div className="text-right">Total Tokens</div>,
                cell: ({ row }) => (
                    <div className="text-right font-mono text-xs font-bold text-ink tabular-nums">
                        {row.original.totalTokens.toLocaleString()}
                    </div>
                )
            },
            {
                accessorKey: "lastUsedAt",
                header: () => <div className="text-right hidden sm:block">Last Used</div>,
                cell: ({ row }) => (
                    <div className="text-right font-mono text-xs text-text-muted hidden sm:block tabular-nums">
                        {formatLastUsed(row.original.lastUsedAt)}
                    </div>
                )
            }
        ],
        []
    );

    const table = useReactTable({
        data: metrics,
        columns,
        getCoreRowModel: getCoreRowModel()
    });

    if (metrics.length === 0) return null;

    return (
        <div className="overflow-x-auto rounded-2xl border border-hairline-soft bg-canvas">
            <Table>
                <TableHeader>
                    {table.getHeaderGroups().map((headerGroup) => (
                        <TableRow
                            key={headerGroup.id}
                            className="border-b border-hairline-soft bg-canvas-soft hover:bg-canvas-soft"
                        >
                            {headerGroup.headers.map((header) => (
                                <TableHead
                                    key={header.id}
                                    className="py-2.5 px-3.5 h-9 font-mono text-[11px] font-semibold uppercase tracking-wider text-text-muted"
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
                            className="border-b border-hairline-soft hover:bg-canvas-soft/40 transition-colors last:border-b-0"
                        >
                            {row.getVisibleCells().map((cell) => (
                                <TableCell key={cell.id} className="py-2.5 px-3.5">
                                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                </TableCell>
                            ))}
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </div>
    );
}
