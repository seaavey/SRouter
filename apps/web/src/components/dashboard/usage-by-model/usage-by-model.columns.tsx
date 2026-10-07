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
            accessorKey: "total_requests",
            header: ({ column }) => <SortableHeader column={column} label="Requests" />,
            cell: ({ row }) => (
                <NumberCell
                    value={row.original.total_requests}
                    title={`Requests: ${row.original.total_requests.toLocaleString()}`}
                    emphasized
                />
            )
        },
        {
            accessorKey: "total_input_tokens",
            header: ({ column }) => <SortableHeader column={column} label="Input" />,
            cell: ({ row }) => (
                <NumberCell
                    value={row.original.total_input_tokens}
                    title={`Prompt Tokens: ${row.original.total_input_tokens.toLocaleString()}`}
                />
            )
        },
        {
            accessorKey: "total_output_tokens",
            header: ({ column }) => <SortableHeader column={column} label="Output" />,
            cell: ({ row }) => (
                <NumberCell
                    value={row.original.total_output_tokens}
                    title={`Completion Tokens: ${row.original.total_output_tokens.toLocaleString()}`}
                />
            )
        },
        {
            accessorKey: "total_cached_tokens",
            header: ({ column }) => <SortableHeader column={column} label="Cached" />,
            cell: ({ row }) => (
                <NumberCell
                    value={row.original.total_cached_tokens}
                    title={`Cached Tokens: ${row.original.total_cached_tokens.toLocaleString()}`}
                />
            )
        },
        {
            id: "total",
            accessorFn: (row) => row.total_input_tokens + row.total_output_tokens,
            header: ({ column }) => <SortableHeader column={column} label="Total" />,
            cell: ({ row }) => {
                const total = row.original.total_input_tokens + row.original.total_output_tokens;
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
            accessorKey: "est_cost",
            header: ({ column }) => <SortableHeader column={column} label="Est. cost" />,
            cell: ({ row }) => (
                <span className="font-mono text-xs font-semibold text-ink tabular-nums">
                    ${row.original.est_cost.toFixed(4)}
                </span>
            )
        }
    ];
}
