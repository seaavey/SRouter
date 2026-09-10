import { useMemo } from "react";
import { type ColumnDef, flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";
import type { LiveModelQuotaItem } from "@srouter/types";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from "@/components/ui/table";
import { formatResetTime } from "./quota.utils";

export interface QuotaTableViewProps {
    quotas?: LiveModelQuotaItem[];
    dense?: boolean;
}

export function QuotaTableView({ quotas = [], dense = false }: QuotaTableViewProps) {
    const columns = useMemo<ColumnDef<LiveModelQuotaItem>[]>(
        () => [
            {
                accessorKey: "name",
                header: "Quota",
                cell: ({ row }) => (
                    <span className="font-medium text-ink font-sans text-xs">
                        {row.original.name}
                    </span>
                )
            },
            {
                accessorKey: "status",
                header: () => <div className="text-center">Status</div>,
                cell: ({ row }) => {
                    const status = row.original.status;
                    const isExhausted = status === "exhausted";
                    const isWarning = status === "warning";

                    return (
                        <div className="text-center">
                            <span
                                className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider font-mono ${
                                    isExhausted
                                        ? "bg-rose-500/10 text-rose-600 dark:text-rose-400"
                                        : isWarning
                                          ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                                          : "bg-accent/10 text-accent"
                                }`}
                            >
                                {status}
                            </span>
                        </div>
                    );
                }
            },
            {
                id: "used_limit",
                header: () => <div className="text-right">Used / Limit</div>,
                cell: ({ row }) => (
                    <div className="text-right font-mono text-xs text-text-muted tabular-nums">
                        {row.original.used.toLocaleString()} / {row.original.limit.toLocaleString()}
                    </div>
                )
            },
            {
                accessorKey: "percentage",
                header: () => <div className="text-right">Remaining</div>,
                cell: ({ row }) => (
                    <div className="text-right font-mono text-xs font-semibold text-ink tabular-nums">
                        {row.original.percentage}
                    </div>
                )
            },
            {
                id: "capacity",
                header: "Capacity",
                cell: ({ row }) => {
                    const isExhausted = row.original.status === "exhausted";
                    const isWarning = row.original.status === "warning";

                    return (
                        <div className="h-1.5 w-full min-w-[80px] rounded-full bg-canvas-soft overflow-hidden">
                            <div
                                className={`h-full rounded-full transition-all duration-300 ${
                                    isExhausted
                                        ? "bg-rose-500"
                                        : isWarning
                                          ? "bg-amber-500"
                                          : "bg-accent"
                                }`}
                                style={{
                                    width: `${Math.min(100, row.original.percentageValue)}%`
                                }}
                            />
                        </div>
                    );
                }
            },
            {
                accessorKey: "resetIn",
                header: () => <div className="text-right">Resets In</div>,
                cell: ({ row }) => (
                    <div className="text-right font-mono text-xs text-text-muted tabular-nums">
                        {row.original.resetIn || "—"}
                    </div>
                )
            },
            {
                accessorKey: "resetTime",
                header: () => <div className="text-right hidden md:block">Reset Time</div>,
                cell: ({ row }) => (
                    <div className="text-right font-mono text-xs text-text-muted hidden md:block tabular-nums">
                        {row.original.resetTime ? formatResetTime(row.original.resetTime) : "—"}
                    </div>
                )
            }
        ],
        []
    );

    const table = useReactTable({
        data: quotas,
        columns,
        getCoreRowModel: getCoreRowModel()
    });

    if (quotas.length === 0) return null;

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
                                    className={`${dense ? "py-2 px-3 h-8" : "py-2.5 px-3.5 h-9"} font-mono text-[11px] font-semibold uppercase tracking-wider text-text-muted`}
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
                                <TableCell
                                    key={cell.id}
                                    className={dense ? "py-2 px-3" : "py-2.5 px-3.5"}
                                >
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
