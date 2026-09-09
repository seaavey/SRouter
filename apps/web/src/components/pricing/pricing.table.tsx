import { useEffect, useState } from "react";
import type { ModelPricingItem } from "@srouter/types";
import { Coins } from "lucide-react";
import { CapabilityIcons, ModalityIcons } from "./pricing.icons";
import {
    Empty,
    EmptyDescription,
    EmptyHeader,
    EmptyMedia,
    EmptyTitle
} from "@/components/ui/empty";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from "@/components/ui/table";
import {
    Pagination,
    PaginationContent,
    PaginationItem,
    PaginationLink,
    PaginationNext,
    PaginationPrevious
} from "@/components/ui/pagination";

interface PricingTableProps {
    models: ModelPricingItem[];
}

function formatRate(value?: number): string {
    if (value === undefined) return "-";
    if (value === 0) return "Free";
    if (value < 0.01) return `$${value.toFixed(4)}`;
    return `$${value.toFixed(2)}`;
}

function formatTokens(count?: number): string {
    if (count === undefined) return "-";
    if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(count % 1_000_000 === 0 ? 0 : 1)}M`;
    if (count >= 1_000) return `${Math.round(count / 1_000)}k`;
    return String(count);
}

function getPaginationItems(currentPage: number, pageCount: number): Array<number | "ellipsis"> {
    if (pageCount <= 4) {
        return Array.from({ length: pageCount }, (_, index) => index);
    }

    if (currentPage <= 1) {
        return [0, 1, 2, "ellipsis"];
    }

    if (currentPage >= pageCount - 2) {
        return [0, "ellipsis", pageCount - 3, pageCount - 2, pageCount - 1];
    }

    return [0, "ellipsis", currentPage - 1, currentPage, currentPage + 1, "ellipsis"];
}

export function PricingTable({ models }: PricingTableProps) {
    const [pageIndex, setPageIndex] = useState(0);
    const [pageSize, setPageSize] = useState(25);

    useEffect(() => {
        setPageIndex(0);
    }, [models]);

    if (models.length === 0) {
        return (
            <Empty className="min-h-56 rounded-lg border border-dashed border-border/70 bg-card/60 p-12">
                <EmptyHeader>
                    <EmptyMedia className="mb-1 size-10 rounded-md border border-border/70 bg-secondary/50 text-muted-foreground">
                        <Coins className="size-5" />
                    </EmptyMedia>
                    <EmptyTitle>No models match your filters</EmptyTitle>
                    <EmptyDescription>Try broadening your search or adjusting filters.</EmptyDescription>
                </EmptyHeader>
            </Empty>
        );
    }

    const pageCount = Math.ceil(models.length / pageSize);
    const currentPage = Math.min(pageIndex, pageCount - 1);
    const startRow = currentPage * pageSize;
    const visibleModels = models.slice(startRow, startRow + pageSize);
    const endRow = Math.min(startRow + visibleModels.length, models.length);
    const pageItems = getPaginationItems(currentPage, pageCount);

    return (
        <div className="space-y-3">
            <div className="overflow-hidden rounded-lg border border-border/80 bg-card font-mono shadow-2xs">
            <Table className="border-collapse">
                <TableHeader>
                    <TableRow className="text-[11px] uppercase tracking-wider">
                        <TableHead className="px-3.5">Model</TableHead>
                        <TableHead className="px-3 text-right">Input / 1M</TableHead>
                        <TableHead className="px-3 text-right">Output / 1M</TableHead>
                        <TableHead className="px-3 text-right">Cache Read</TableHead>
                        <TableHead className="px-3 text-right">Reasoning</TableHead>
                        <TableHead className="px-3 text-center">Context / Max Out</TableHead>
                        <TableHead className="px-3 text-center">Modalities (I/O)</TableHead>
                        <TableHead className="px-3 text-center">Features</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {visibleModels.map((item) => {
                        const isFree = item.cost.input === 0 && item.cost.output === 0;
                        return (
                            <TableRow key={item.id}>
                                <TableCell className="min-w-[200px] max-w-[320px] px-3.5">
                                    <div className="flex flex-col">
                                        <div className="flex items-center gap-1.5">
                                            <span className="truncate font-semibold text-foreground">{item.name}</span>
                                            {isFree && (
                                                <span className="rounded border border-emerald-500/30 bg-emerald-500/10 px-1 py-0.5 text-[9px] font-bold text-emerald-500">
                                                    FREE
                                                </span>
                                            )}
                                        </div>
                                        <span className="truncate text-[10px] text-muted-foreground/80">{item.id}</span>
                                    </div>
                                </TableCell>
                                <TableCell className="whitespace-nowrap px-3 text-right tabular-nums">
                                    <span className={item.cost.input === 0 ? "font-medium text-emerald-500" : "text-foreground"}>
                                        {formatRate(item.cost.input)}
                                    </span>
                                </TableCell>
                                <TableCell className="whitespace-nowrap px-3 text-right tabular-nums">
                                    <span className={item.cost.output === 0 ? "font-medium text-emerald-500" : "text-foreground"}>
                                        {formatRate(item.cost.output)}
                                    </span>
                                </TableCell>
                                <TableCell className="whitespace-nowrap px-3 text-right tabular-nums text-muted-foreground">
                                    {formatRate(item.cost.cache_read)}
                                </TableCell>
                                <TableCell className="whitespace-nowrap px-3 text-right tabular-nums text-muted-foreground">
                                    {formatRate(item.cost.reasoning)}
                                </TableCell>
                                <TableCell className="whitespace-nowrap px-3 text-center text-[11px] tabular-nums text-muted-foreground">
                                    {item.limit?.context !== undefined
                                        ? `${formatTokens(item.limit.context)}${item.limit.output !== undefined ? ` / ${formatTokens(item.limit.output)}` : ""}`
                                        : "-"}
                                </TableCell>
                                <TableCell className="whitespace-nowrap px-3 text-center">
                                    <div className="flex justify-center">
                                        <ModalityIcons input={item.modalities?.input} output={item.modalities?.output} />
                                    </div>
                                </TableCell>
                                <TableCell className="whitespace-nowrap px-3 text-center">
                                    <div className="flex justify-center">
                                        <CapabilityIcons
                                            reasoning={item.reasoning}
                                            toolCall={item.tool_call}
                                            structuredOutput={item.structured_output}
                                            openWeights={item.open_weights}
                                            attachment={item.attachment}
                                        />
                                    </div>
                                </TableCell>
                            </TableRow>
                        );
                    })}
                </TableBody>
                </Table>
            </div>

            <div className="flex flex-col gap-3 px-1 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
                <div>
                    Showing <span className="font-semibold text-foreground">{startRow + 1}-{endRow}</span> of{" "}
                    <span className="font-semibold text-foreground">{models.length}</span> models
                </div>

                <div className="flex items-center gap-3 self-end sm:self-auto">
                    <label className="flex items-center gap-1.5">
                        <span>Rows:</span>
                        <select
                            value={pageSize}
                            onChange={(event) => {
                                setPageSize(Number(event.target.value));
                                setPageIndex(0);
                            }}
                            className="rounded border border-border/80 bg-card px-2 py-0.5 text-xs text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
                        >
                            <option value={25}>25</option>
                            <option value={50}>50</option>
                            <option value={100}>100</option>
                        </select>
                    </label>

                    <Pagination className="mx-0 w-auto">
                        <PaginationContent>
                            <PaginationItem>
                                <PaginationPrevious
                                    onClick={() => setPageIndex((page) => Math.max(0, page - 1))}
                                    disabled={currentPage === 0}
                                />
                            </PaginationItem>
                            {pageItems.map((item, index) =>
                                item === "ellipsis" ? (
                                    <PaginationItem key={`ellipsis-${index}`}>
                                        <span className="flex size-7 items-center justify-center text-muted-foreground">
                                            ...
                                        </span>
                                    </PaginationItem>
                                ) : (
                                    <PaginationItem key={item}>
                                        <PaginationLink
                                            type="button"
                                            isActive={item === currentPage}
                                            onClick={() => setPageIndex(item)}
                                            aria-label={`Go to page ${item + 1}`}
                                        >
                                            {item + 1}
                                        </PaginationLink>
                                    </PaginationItem>
                                )
                            )}
                            <PaginationItem>
                                <PaginationNext
                                    onClick={() => setPageIndex((page) => Math.min(pageCount - 1, page + 1))}
                                    disabled={currentPage === pageCount - 1}
                                />
                            </PaginationItem>
                        </PaginationContent>
                    </Pagination>
                </div>
            </div>
        </div>
    );
}
