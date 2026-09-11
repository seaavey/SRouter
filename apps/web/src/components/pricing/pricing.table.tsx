import { useEffect, useState } from "react";
import type { ModelPricingItem } from "@srouter/types";
import { Coins, ChevronLeft, ChevronRight } from "lucide-react";
import { CapabilityIcons, ModalityIcons } from "./pricing.icons";
import {
    Empty,
    EmptyDescription,
    EmptyHeader,
    EmptyMedia,
    EmptyTitle
} from "@/components/ui/empty";

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
    if (count >= 1_000_000)
        return `${(count / 1_000_000).toFixed(count % 1_000_000 === 0 ? 0 : 1)}M`;
    if (count >= 1_000) return `${Math.round(count / 1_000)}k`;
    return String(count);
}

export function PricingTable({ models }: PricingTableProps) {
    const [pageIndex, setPageIndex] = useState(0);
    const [pageSize, setPageSize] = useState(25);

    useEffect(() => {
        setPageIndex(0);
    }, [models]);

    if (models.length === 0) {
        return (
            <Empty className="min-h-56 rounded-3xl border border-dashed border-hairline bg-canvas p-12">
                <EmptyHeader>
                    <EmptyMedia className="mb-2 size-12 rounded-full border border-hairline-soft bg-canvas-soft text-text-muted">
                        <Coins className="size-6" />
                    </EmptyMedia>
                    <EmptyTitle className="text-base font-semibold text-ink font-sans">
                        No models match your filters
                    </EmptyTitle>
                    <EmptyDescription className="text-xs text-text-muted font-sans font-light">
                        Try broadening your search query or adjusting active filters.
                    </EmptyDescription>
                </EmptyHeader>
            </Empty>
        );
    }

    const pageCount = Math.ceil(models.length / pageSize);
    const currentPage = Math.min(pageIndex, pageCount - 1);
    const startRow = currentPage * pageSize;
    const visibleModels = models.slice(startRow, startRow + pageSize);
    const endRow = Math.min(startRow + visibleModels.length, models.length);

    return (
        <div className="space-y-4 font-sans">
            <div className="overflow-hidden rounded-3xl border border-hairline-soft bg-canvas shadow-none">
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                        <thead className="border-b border-hairline-soft bg-canvas-soft text-[11px] uppercase font-mono tracking-wider text-text-muted">
                            <tr>
                                <th className="py-3 px-5 font-semibold">Model</th>
                                <th className="py-3 px-4 text-right font-semibold">Input / 1M</th>
                                <th className="py-3 px-4 text-right font-semibold">Output / 1M</th>
                                <th className="py-3 px-4 text-right font-semibold">Cache Read</th>
                                <th className="py-3 px-4 text-right font-semibold">Reasoning</th>
                                <th className="py-3 px-4 text-center font-semibold">
                                    Context / Max Out
                                </th>
                                <th className="py-3 px-4 text-center font-semibold">
                                    Modalities (I/O)
                                </th>
                                <th className="py-3 px-4 text-center font-semibold">Features</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-hairline-soft">
                            {visibleModels.map((item) => {
                                const isFree = item.cost.input === 0 && item.cost.output === 0;
                                return (
                                    <tr
                                        key={item.id}
                                        className="hover:bg-canvas-soft/50 transition-colors group"
                                    >
                                        <td className="min-w-[200px] max-w-[320px] py-3.5 px-5">
                                            <div className="flex flex-col">
                                                <div className="flex items-center gap-2">
                                                    <span className="truncate font-sans font-medium text-sm text-ink">
                                                        {item.name}
                                                    </span>
                                                    {isFree && (
                                                        <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[9px] font-bold text-emerald-600 dark:text-emerald-400 font-mono">
                                                            FREE
                                                        </span>
                                                    )}
                                                </div>
                                                <span className="truncate font-mono text-xs text-text-muted mt-0.5">
                                                    {item.id}
                                                </span>
                                            </div>
                                        </td>
                                        <td className="whitespace-nowrap px-4 py-3.5 text-right font-mono tabular-nums">
                                            <span
                                                className={
                                                    item.cost.input === 0
                                                        ? "font-semibold text-emerald-600 dark:text-emerald-400"
                                                        : "text-ink font-medium"
                                                }
                                            >
                                                {formatRate(item.cost.input)}
                                            </span>
                                        </td>
                                        <td className="whitespace-nowrap px-4 py-3.5 text-right font-mono tabular-nums">
                                            <span
                                                className={
                                                    item.cost.output === 0
                                                        ? "font-semibold text-emerald-600 dark:text-emerald-400"
                                                        : "text-ink font-medium"
                                                }
                                            >
                                                {formatRate(item.cost.output)}
                                            </span>
                                        </td>
                                        <td className="whitespace-nowrap px-4 py-3.5 text-right font-mono tabular-nums text-text-muted">
                                            {formatRate(item.cost.cache_read)}
                                        </td>
                                        <td className="whitespace-nowrap px-4 py-3.5 text-right font-mono tabular-nums text-text-muted">
                                            {formatRate(item.cost.reasoning)}
                                        </td>
                                        <td className="whitespace-nowrap px-4 py-3.5 text-center font-mono text-[11px] tabular-nums text-text-muted">
                                            {item.limit?.context !== undefined
                                                ? `${formatTokens(item.limit.context)}${item.limit.output !== undefined ? ` / ${formatTokens(item.limit.output)}` : ""}`
                                                : "-"}
                                        </td>
                                        <td className="whitespace-nowrap px-4 py-3.5 text-center">
                                            <div className="flex justify-center">
                                                <ModalityIcons
                                                    input={item.modalities?.input}
                                                    output={item.modalities?.output}
                                                />
                                            </div>
                                        </td>
                                        <td className="whitespace-nowrap px-4 py-3.5 text-center">
                                            <div className="flex justify-center">
                                                <CapabilityIcons
                                                    reasoning={item.reasoning}
                                                    toolCall={item.tool_call}
                                                    structuredOutput={item.structured_output}
                                                    openWeights={item.open_weights}
                                                    attachment={item.attachment}
                                                />
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>
            <div className="flex flex-col gap-3 px-2 text-xs text-text-muted sm:flex-row sm:items-center sm:justify-between font-sans">
                <div>
                    Showing{" "}
                    <span className="font-semibold text-ink font-mono">
                        {startRow + 1}-{endRow}
                    </span>{" "}
                    of <span className="font-semibold text-ink font-mono">{models.length}</span>{" "}
                    models
                </div>

                <div className="flex items-center gap-3 self-end sm:self-auto">
                    <label className="flex items-center gap-2">
                        <span>Rows:</span>
                        <select
                            value={pageSize}
                            onChange={(event) => {
                                setPageSize(Number(event.target.value));
                                setPageIndex(0);
                            }}
                            className="rounded-full border border-hairline-soft bg-field px-3 py-1 text-xs font-mono text-ink outline-none focus:ring-2 focus:ring-ink cursor-pointer"
                        >
                            <option value={25}>25</option>
                            <option value={50}>50</option>
                            <option value={100}>100</option>
                        </select>
                    </label>

                    <div className="flex items-center gap-1.5">
                        <button
                            type="button"
                            onClick={() => setPageIndex((page) => Math.max(0, page - 1))}
                            disabled={currentPage === 0}
                            className="inline-flex size-8 items-center justify-center rounded-full border border-hairline-soft bg-canvas text-ink hover:bg-canvas-soft disabled:opacity-40 disabled:pointer-events-none transition-colors cursor-pointer"
                            aria-label="Previous page"
                        >
                            <ChevronLeft className="size-4" />
                        </button>
                        <form
                            onSubmit={(e) => {
                                e.preventDefault();
                                const parsed = parseInt(String(currentPage + 1), 10);
                                if (!Number.isNaN(parsed)) {
                                    setPageIndex(Math.max(0, Math.min(pageCount - 1, parsed - 1)));
                                }
                            }}
                            className="flex items-center gap-1.5"
                        >
                            <input
                                type="number"
                                min={1}
                                max={pageCount}
                                defaultValue={currentPage + 1}
                                key={currentPage}
                                onBlur={(e) => {
                                    const parsed = parseInt(e.target.value, 10);
                                    if (!Number.isNaN(parsed)) {
                                        setPageIndex(
                                            Math.max(0, Math.min(pageCount - 1, parsed - 1))
                                        );
                                    } else {
                                        e.target.value = String(currentPage + 1);
                                    }
                                }}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                        e.currentTarget.blur();
                                    }
                                }}
                                aria-label="Target page number"
                                className="w-14 h-8 rounded-xl border border-hairline-soft bg-field px-2 text-center font-mono text-xs text-ink focus:border-hairline-strong focus:outline-none transition-colors [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                            />
                            <span className="font-mono text-xs text-text-muted tabular-nums">
                                / {pageCount}
                            </span>
                        </form>
                        <button
                            type="button"
                            onClick={() =>
                                setPageIndex((page) => Math.min(pageCount - 1, page + 1))
                            }
                            disabled={currentPage === pageCount - 1}
                            className="inline-flex size-8 items-center justify-center rounded-full border border-hairline-soft bg-canvas text-ink hover:bg-canvas-soft disabled:opacity-40 disabled:pointer-events-none transition-colors cursor-pointer"
                            aria-label="Next page"
                        >
                            <ChevronRight className="size-4" />
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
