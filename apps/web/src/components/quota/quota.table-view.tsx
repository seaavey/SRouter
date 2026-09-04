import { useMemo } from "react";
import {
    type ColumnDef,
    flexRender,
    getCoreRowModel,
    useReactTable
} from "@tanstack/react-table";
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
                    <span className="font-semibold text-[var(--ink)]">
                        {row.original.name}
                    </span>
                )
            },
            {
                accessorKey: "status",
                header: () => <div className="text-center">Status</div>,
                cell: ({ row }) => {
                    const status = row.original.status;
                    const is_exhausted = status === "exhausted";
                    const is_warning = status === "warning";

                    return (
                        <div className="text-center">
                            <span
                                className={`inline-flex items-center gap-1 rounded-[4px] px-1.5 py-0.2 text-[${
                                    dense ? "9px" : "9.5px"
                                }] font-semibold uppercase ${
                                    is_exhausted
                                        ? "bg-rose-500/10 text-rose-500 border border-rose-500/30"
                                        : is_warning
                                          ? "bg-amber-500/10 text-amber-500 border border-amber-500/30"
                                          : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30"
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
                    <div className="text-right tabular-nums text-[var(--ink-2)]">
                        {row.original.used.toLocaleString()} / {row.original.limit.toLocaleString()}
                    </div>
                )
            },
            {
                accessorKey: "percentage",
                header: () => <div className="text-right">Remaining</div>,
                cell: ({ row }) => (
                    <div className="text-right tabular-nums font-semibold text-[var(--ink)]">
                        {row.original.percentage}
                    </div>
                )
            },
            {
                id: "capacity",
                header: "Capacity",
                cell: ({ row }) => {
                    const is_exhausted = row.original.status === "exhausted";
                    const is_warning = row.original.status === "warning";

                    return (
                        <div className="h-1.5 w-full rounded-full bg-[var(--line)] overflow-hidden">
                            <div
                                className={`h-full rounded-full transition-all duration-300 ${
                                    is_exhausted
                                        ? "bg-rose-500"
                                        : is_warning
                                          ? "bg-amber-500"
                                          : "bg-emerald-500"
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
                    <div className="text-right tabular-nums text-[var(--ink-2)] font-medium">
                        {row.original.resetIn || "—"}
                    </div>
                )
            },
            {
                accessorKey: "resetTime",
                header: () => <div className="text-right hidden md:block">Reset Time</div>,
                cell: ({ row }) => (
                    <div className="text-right text-[var(--ink-3)] hidden md:block">
                        {row.original.resetTime ? formatResetTime(row.original.resetTime) : "—"}
                    </div>
                )
            }
        ],
        [dense]
    );

    const table = useReactTable({
        data: quotas,
        columns,
        getCoreRowModel: getCoreRowModel()
    });

    if (quotas.length === 0) return null;

    return (
        <div
            className={`overflow-x-auto border border-[var(--line)] font-mono text-xs ${
                dense ? "rounded-[6px] bg-[var(--surface)]" : "rounded-[8px]"
            }`}
        >
            <Table>
                <TableHeader>
                    {table.getHeaderGroups().map((headerGroup) => (
                        <TableRow
                            key={headerGroup.id}
                            className={`border-b border-[var(--line)] bg-[var(--field)]/${
                                dense ? "60" : "50"
                            } text-[${dense ? "9.5px" : "10px"}] uppercase font-bold text-[var(--ink-3)] hover:bg-transparent`}
                        >
                            {headerGroup.headers.map((header) => (
                                <TableHead
                                    key={header.id}
                                    className={`${dense ? "py-2 px-3 h-8" : "py-2.5 px-3.5 h-9"} text-[var(--ink-3)] font-bold`}
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
