import type { Column, ColumnDef } from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { formatCompactNumber } from "@/lib/utils";
import type { ModelUsageItem } from "./usage-by-model.typed";

function SortIcon({ column }: { column: Column<ModelUsageItem> }) {
    const direction = column.getIsSorted();
    if (direction === "asc") return <ArrowUp className="size-3 text-ink" aria-hidden="true" />;
    if (direction === "desc") return <ArrowDown className="size-3 text-ink" aria-hidden="true" />;
    return <ArrowUpDown className="size-3 opacity-40 hover:opacity-100" aria-hidden="true" />;
}

function SortableHeader({ column, label }: { column: Column<ModelUsageItem>; label: string }) {
    return (
        <button
            type="button"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
            className="flex items-center justify-end gap-1.5 ml-auto text-text-muted transition-colors hover:text-ink cursor-pointer select-none"
        >
            <span>{label}</span>
            <SortIcon column={column} />
        </button>
    );
}

function NumberCell({
    value,
    title,
    emphasized = false
}: {
    value: number;
    title: string;
    emphasized?: boolean;
}) {
    return (
        <span
            className={`font-mono text-xs tabular-nums cursor-default ${emphasized ? "font-semibold text-ink" : "text-text-muted"}`}
            title={title}
        >
            {formatCompactNumber(value)}
        </span>
    );
}

export function CreateUsageByModelColumns(): ColumnDef<ModelUsageItem>[] {
    return [
        {
            accessorKey: "model",
            header: ({ column }) => (
                <button
                    type="button"
                    onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
                    className="flex items-center gap-1.5 text-text-muted transition-colors hover:text-ink cursor-pointer select-none"
                >
                    <span>Model</span>
                    <SortIcon column={column} />
                </button>
            ),
            cell: ({ row }) => (
                <span
                    className="block max-w-64 truncate font-sans text-sm font-medium text-ink"
                    title={row.original.model}
                >
                    {row.original.model}
                </span>
            )
        },
        {
            accessorKey: "totalRequests",
            header: ({ column }) => <SortableHeader column={column} label="Requests" />,
            cell: ({ row }) => (
                <NumberCell
                    value={row.original.totalRequests}
                    title={`Requests: ${row.original.totalRequests.toLocaleString()}`}
                    emphasized
                />
            )
        },
        {
            accessorKey: "totalInputTokens",
            header: ({ column }) => <SortableHeader column={column} label="Input" />,
            cell: ({ row }) => (
                <NumberCell
                    value={row.original.totalInputTokens}
                    title={`Prompt Tokens: ${row.original.totalInputTokens.toLocaleString()}`}
                />
            )
        },
        {
            accessorKey: "totalOutputTokens",
            header: ({ column }) => <SortableHeader column={column} label="Output" />,
            cell: ({ row }) => (
                <NumberCell
                    value={row.original.totalOutputTokens}
                    title={`Completion Tokens: ${row.original.totalOutputTokens.toLocaleString()}`}
                />
            )
        },
        {
            accessorKey: "totalCachedTokens",
            header: ({ column }) => <SortableHeader column={column} label="Cached" />,
            cell: ({ row }) => (
                <NumberCell
                    value={row.original.totalCachedTokens}
                    title={`Cached Tokens: ${row.original.totalCachedTokens.toLocaleString()}`}
                />
            )
        },
        {
            id: "total",
            accessorFn: (row) => row.totalInputTokens + row.totalOutputTokens,
            header: ({ column }) => <SortableHeader column={column} label="Total" />,
            cell: ({ row }) => {
                const total = row.original.totalInputTokens + row.original.totalOutputTokens;
                return (
                    <NumberCell
                        value={total}
                        emphasized
                        title={`Total Tokens: ${total.toLocaleString()}`}
                    />
                );
            }
        },
        {
            accessorKey: "estCost",
            header: ({ column }) => <SortableHeader column={column} label="Est. cost" />,
            cell: ({ row }) => (
                <span className="font-mono text-xs font-semibold text-ink tabular-nums">
                    ${row.original.estCost.toFixed(4)}
                </span>
            )
        }
    ];
}
