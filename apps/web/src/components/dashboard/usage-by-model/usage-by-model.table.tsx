import { useMemo, useState } from "react";
import {
    getCoreRowModel,
    getPaginationRowModel,
    getSortedRowModel,
    useReactTable,
    type PaginationState,
    type SortingState
} from "@tanstack/react-table";
import { Database, Search } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
    Empty,
    EmptyDescription,
    EmptyHeader,
    EmptyMedia,
    EmptyTitle
} from "@/components/ui/empty";
import { CreateUsageByModelColumns } from "./usage-by-model.columns";
import { UsageByModelDesktop } from "./usage-by-model.desktop";
import { UsageByModelMobile } from "./usage-by-model.mobile";
import { UsageByModelPagination } from "./usage-by-model.pagination";
import { UsageByModelToolbar } from "./usage-by-model.toolbar";
import type { UsageByModelTableProps } from "./usage-by-model.typed";

export function UsageByModelTable({ models }: UsageByModelTableProps) {
    const [search_model, set_search_model] = useState("");
    const [sorting, set_sorting] = useState<SortingState>([{ id: "totalRequests", desc: true }]);
    const [pagination, set_pagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 10 });

    const filtered_models = useMemo(() => {
        const query = search_model.trim().toLowerCase();
        return query ? models.filter((model) => model.model.toLowerCase().includes(query)) : models;
    }, [models, search_model]);

    const columns = useMemo(() => CreateUsageByModelColumns(), []);
    const table = useReactTable({
        data: filtered_models,
        columns,
        state: { sorting, pagination },
        onSortingChange: set_sorting,
        onPaginationChange: set_pagination,
        getCoreRowModel: getCoreRowModel(),
        getSortedRowModel: getSortedRowModel(),
        getPaginationRowModel: getPaginationRowModel(),
        autoResetPageIndex: true
    });

    const has_usage = models.length > 0;

    return (
        <Card className="min-w-0 gap-0 overflow-hidden p-0 border border-hairline-soft bg-canvas shadow-none">
            <CardHeader className="flex flex-col justify-between gap-4 border-b border-hairline-soft p-6 sm:flex-row sm:items-center">
                <div className="flex min-w-0 items-center gap-3">
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-canvas-soft text-ink">
                        <Database className="size-4" strokeWidth={1.75} aria-hidden="true" />
                    </div>
                    <div className="min-w-0">
                        <CardTitle className="font-heading text-base font-semibold text-ink">
                            Usage by Model.
                        </CardTitle>
                        <CardDescription className="text-xs text-text-muted">
                            Exact token usage and estimated spend for every model
                        </CardDescription>
                    </div>
                </div>
                <UsageByModelToolbar
                    search_model={search_model}
                    on_search_model_change={set_search_model}
                />
            </CardHeader>
            <CardContent className="p-0">
                {filtered_models.length === 0 ? (
                    <Empty className="min-h-44 p-8">
                        <EmptyHeader>
                            <EmptyMedia variant="icon">
                                <Search className="size-5" strokeWidth={1.5} aria-hidden="true" />
                            </EmptyMedia>
                            <EmptyTitle>
                                {has_usage ? "No matching models" : "No model usage yet"}
                            </EmptyTitle>
                            <EmptyDescription>
                                {has_usage
                                    ? `No models match “${search_model.trim()}”. Try a different search.`
                                    : "Usage details will appear after the gateway handles its first request."}
                            </EmptyDescription>
                        </EmptyHeader>
                    </Empty>
                ) : (
                    <>
                        <UsageByModelMobile rows={table.getRowModel().rows} />
                        <UsageByModelDesktop table={table} />
                        <UsageByModelPagination table={table} total_rows={filtered_models.length} />
                    </>
                )}
            </CardContent>
        </Card>
    );
}
