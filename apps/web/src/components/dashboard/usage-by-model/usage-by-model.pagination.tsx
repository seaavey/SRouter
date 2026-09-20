import type { Table } from "@tanstack/react-table";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ModelUsageItem } from "./usage-by-model.typed";

type UsageByModelPaginationProps = {
    table: Table<ModelUsageItem>;
    total_rows: number;
};

export function UsageByModelPagination({ table, total_rows }: UsageByModelPaginationProps) {
    const current_page = table.getState().pagination.pageIndex;
    const page_size = table.getState().pagination.pageSize;
    const page_count = table.getPageCount();
    const start_row = total_rows === 0 ? 0 : current_page * page_size + 1;
    const end_row = Math.min((current_page + 1) * page_size, total_rows);

    if (total_rows <= 10) return null;

    return (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-t border-hairline-soft bg-canvas-soft/30 px-6 py-3.5 text-xs text-text-muted font-mono">
            <div className="flex items-center gap-2">
                <span>Showing</span>
                <span className="font-semibold text-ink">
                    {start_row}-{end_row}
                </span>
                <span>of</span>
                <span className="font-semibold text-ink">{total_rows}</span>
                <span>models</span>
            </div>
            <div className="flex items-center gap-2">
                <button
                    type="button"
                    onClick={() => table.previousPage()}
                    disabled={!table.getCanPreviousPage()}
                    className="flex size-7 items-center justify-center rounded-full border border-hairline bg-canvas text-ink hover:bg-canvas-soft disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-colors shadow-none"
                    title="Previous page"
                >
                    <ChevronLeft className="size-3.5" aria-hidden="true" />
                </button>
                <span className="px-1.5 text-xs text-ink font-medium">
                    {current_page + 1} / {page_count}
                </span>
                <button
                    type="button"
                    onClick={() => table.nextPage()}
                    disabled={!table.getCanNextPage()}
                    className="flex size-7 items-center justify-center rounded-full border border-hairline bg-canvas text-ink hover:bg-canvas-soft disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-colors shadow-none"
                    title="Next page"
                >
                    <ChevronRight className="size-3.5" aria-hidden="true" />
                </button>
            </div>
        </div>
    );
}
