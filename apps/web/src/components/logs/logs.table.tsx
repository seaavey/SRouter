import { useMemo, useState } from "react";
import {
    type SortingState,
    type PaginationState,
    flexRender,
    getCoreRowModel,
    getPaginationRowModel,
    getSortedRowModel,
    useReactTable
} from "@tanstack/react-table";
import type { LogTableProps } from "./logs.typed";
import createLogColumns from "./logs.columns";
import LogPagination from "./logs.pagination";

export default function LogTable({
    logs,
    requireApiKey = false,
    onSelect,
    page,
    pageSize = 25,
    pageCount: serverPageCount,
    totalRows: serverTotalRows,
    onPageChange
}: LogTableProps) {
    const isServerPaginated = page !== undefined && onPageChange !== undefined;

    const [sorting, setSorting] = useState<SortingState>([{ id: "createdAt", desc: true }]);
    const [clientPagination, setClientPagination] = useState<PaginationState>({
        pageIndex: 0,
        pageSize: 25
    });

    const pagination = isServerPaginated ? { pageIndex: page - 1, pageSize } : clientPagination;

    const columns = useMemo(
        () => createLogColumns({ requireApiKey, onSelect }),
        [requireApiKey, onSelect]
    );

    const table = useReactTable({
        data: logs,
        columns,
        state: {
            sorting,
            pagination
        },
        onSortingChange: setSorting,
        onPaginationChange: (updater) => {
            if (isServerPaginated) {
                const nextState = typeof updater === "function" ? updater(pagination) : updater;
                onPageChange(nextState.pageIndex + 1);
            } else {
                setClientPagination(updater);
            }
        },
        manualPagination: isServerPaginated,
        pageCount: isServerPaginated ? serverPageCount : undefined,
        getCoreRowModel: getCoreRowModel(),
        getSortedRowModel: getSortedRowModel(),
        getPaginationRowModel: isServerPaginated ? undefined : getPaginationRowModel()
    });

    const pageCount = isServerPaginated ? (serverPageCount ?? 1) : table.getPageCount();
    const currentPage = isServerPaginated ? (page ?? 1) - 1 : table.getState().pagination.pageIndex;
    const effectivePageSize = isServerPaginated ? pageSize : table.getState().pagination.pageSize;
    const totalCount = isServerPaginated ? (serverTotalRows ?? logs.length) : logs.length;

    return (
        <div className="flex flex-col gap-4 font-sans">
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
                                    onKeyDown={(event) => {
                                        if (event.key === "Enter" || event.key === " ") {
                                            event.preventDefault();
                                            onSelect(row.original);
                                        }
                                    }}
                                    tabIndex={0}
                                    className="cursor-pointer transition-colors hover:bg-canvas-soft/50 focus-visible:bg-canvas-soft/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ink group"
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
            <LogPagination
                table={table}
                pageCount={pageCount}
                currentPage={currentPage}
                pageSize={effectivePageSize}
                totalCount={totalCount}
                isServerPaginated={isServerPaginated}
                onPageChange={onPageChange}
            />
        </div>
    );
}
