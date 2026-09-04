import { useMemo } from "react";
import {
    type ColumnDef,
    flexRender,
    getCoreRowModel,
    useReactTable
} from "@tanstack/react-table";
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
                    <span className="font-semibold text-[var(--ink)] truncate max-w-xs block">
                        {row.original.model}
                    </span>
                )
            },
            {
                accessorKey: "totalRequests",
                header: () => <div className="text-right">Requests</div>,
                cell: ({ row }) => (
                    <div className="text-right tabular-nums text-[var(--ink)]">
                        {row.original.totalRequests.toLocaleString()}
                    </div>
                )
            },
            {
                accessorKey: "promptTokens",
                header: () => <div className="text-right">Prompt Tokens</div>,
                cell: ({ row }) => (
                    <div className="text-right tabular-nums text-[var(--ink-3)]">
                        {row.original.promptTokens.toLocaleString()}
                    </div>
                )
            },
            {
                accessorKey: "completionTokens",
                header: () => <div className="text-right">Completion</div>,
                cell: ({ row }) => (
                    <div className="text-right tabular-nums text-[var(--ink-3)]">
                        {row.original.completionTokens.toLocaleString()}
                    </div>
                )
            },
            {
                accessorKey: "totalTokens",
                header: () => <div className="text-right">Total Tokens</div>,
                cell: ({ row }) => (
                    <div className="text-right tabular-nums font-bold text-[var(--ink)]">
                        {row.original.totalTokens.toLocaleString()}
                    </div>
                )
            },
            {
                accessorKey: "lastUsedAt",
                header: () => <div className="text-right hidden sm:block">Last Used</div>,
                cell: ({ row }) => (
                    <div className="text-right text-[10.5px] text-[var(--ink-3)] hidden sm:block">
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
        <div className="overflow-x-auto rounded-[8px] border border-[var(--line)] font-mono text-xs">
            <Table>
                <TableHeader>
                    {table.getHeaderGroups().map((headerGroup) => (
                        <TableRow
                            key={headerGroup.id}
                            className="border-b border-[var(--line)] bg-[var(--field)]/50 text-[10px] uppercase font-bold text-[var(--ink-3)] hover:bg-transparent"
                        >
                            {headerGroup.headers.map((header) => (
                                <TableHead
                                    key={header.id}
                                    className="py-2 px-3 h-8 text-[var(--ink-3)] font-bold"
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
                <TableBody className="divide-y divide-[var(--line)]">
                    {table.getRowModel().rows.map((row) => (
                        <TableRow
                            key={row.id}
                            className="border-b border-[var(--line)] hover:bg-[var(--hover)]/30 transition-colors"
                        >
                            {row.getVisibleCells().map((cell) => (
                                <TableCell key={cell.id} className="py-2 px-3">
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
