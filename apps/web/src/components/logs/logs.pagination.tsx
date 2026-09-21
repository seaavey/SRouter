import { useEffect, useState } from "react";
import type { PaginationState, Table } from "@tanstack/react-table";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { RequestLogEntry } from "@srouter/types";

interface LogPaginationProps {
    table: Table<RequestLogEntry>;
    pageCount: number;
    currentPage: number;
    pageSize: number;
    totalCount: number;
    isServerPaginated: boolean;
    onPageChange?: (page: number) => void;
}

export default function LogPagination({
    table,
    pageCount,
    currentPage,
    pageSize,
    totalCount,
    isServerPaginated,
    onPageChange
}: LogPaginationProps) {
    const startRow = totalCount === 0 ? 0 : currentPage * pageSize + 1;
    const endRow = Math.min((currentPage + 1) * pageSize, totalCount);
    const [targetPageInput, setTargetPageInput] = useState(String(currentPage + 1));

    useEffect(() => {
        setTargetPageInput(String(currentPage + 1));
    }, [currentPage]);

    const handleJumpPage = (e?: React.FormEvent) => {
        e?.preventDefault();
        const parsed = parseInt(targetPageInput, 10);
        if (Number.isNaN(parsed) || parsed < 1) {
            setTargetPageInput(String(currentPage + 1));
            return;
        }

        const target = Math.max(1, Math.min(pageCount, parsed));
        setTargetPageInput(String(target));
        if (target === currentPage + 1) return;

        if (isServerPaginated) {
            onPageChange?.(target);
        } else {
            table.setPageIndex(target - 1);
        }
    };

    if (totalCount <= pageSize) return null;

    return (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-2 text-xs text-text-muted font-sans">
            <div>
                Showing <span className="text-ink font-semibold font-mono">{startRow}</span>–
                <span className="text-ink font-semibold font-mono">{endRow}</span> of{" "}
                <span className="text-ink font-semibold font-mono">{totalCount}</span> logs
            </div>
            <div className="flex items-center gap-1.5">
                <button
                    type="button"
                    onClick={() => table.previousPage()}
                    disabled={!table.getCanPreviousPage()}
                    className="group relative inline-flex size-11 items-center justify-center text-ink transition-colors disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink cursor-pointer"
                    aria-label="Previous page"
                >
                    <span
                        aria-hidden="true"
                        className="pointer-events-none absolute size-9 rounded-full border border-hairline-soft bg-canvas transition-colors group-hover:bg-canvas-soft"
                    />
                    <ChevronLeft className="relative size-4" aria-hidden="true" />
                </button>
                <form onSubmit={handleJumpPage} className="flex items-center gap-1.5">
                    <div className="relative flex h-11 w-14 items-center justify-center">
                        <span
                            aria-hidden="true"
                            className="pointer-events-none absolute h-9 w-12 rounded-xl border border-hairline-soft bg-field"
                        />
                        <input
                            type="number"
                            min={1}
                            max={pageCount}
                            value={targetPageInput}
                            onChange={(e) => setTargetPageInput(e.target.value)}
                            onBlur={() => handleJumpPage()}
                            aria-label="Target page number"
                            className="relative z-10 h-11 w-14 rounded-xl border border-transparent bg-transparent px-2 text-center font-mono text-xs text-ink focus:border-transparent focus:outline-none focus:ring-2 focus:ring-ink [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        />
                    </div>
                    <span className="font-mono text-xs text-text-muted tabular-nums">
                        / {pageCount}
                    </span>
                </form>
                <button
                    type="button"
                    onClick={() => table.nextPage()}
                    disabled={!table.getCanNextPage()}
                    className="group relative inline-flex size-11 items-center justify-center text-ink transition-colors disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink cursor-pointer"
                    aria-label="Next page"
                >
                    <span
                        aria-hidden="true"
                        className="pointer-events-none absolute size-9 rounded-full border border-hairline-soft bg-canvas transition-colors group-hover:bg-canvas-soft"
                    />
                    <ChevronRight className="relative size-4" aria-hidden="true" />
                </button>
            </div>
        </div>
    );
}
