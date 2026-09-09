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

export function PricingTable({ models }: PricingTableProps) {
    if (models.length === 0) {
        return (
            <Empty className="rounded-lg border border-dashed border-border/70 bg-card/60 p-12">
                <EmptyHeader>
                    <EmptyMedia variant="icon">
                        <Coins className="text-muted-foreground/60" />
                    </EmptyMedia>
                    <EmptyTitle>No models match your filters</EmptyTitle>
                    <EmptyDescription>Try broadening your search or adjusting filters.</EmptyDescription>
                </EmptyHeader>
            </Empty>
        );
    }

    return (
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
                    {models.map((item) => {
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
    );
}
