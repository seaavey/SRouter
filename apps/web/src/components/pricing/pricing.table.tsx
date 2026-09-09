import type { ModelPricingItem } from "@srouter/types";
import { ModalityIcons, CapabilityIcons } from "./pricing.icons";
import { Coins } from "lucide-react";

interface PricingTableProps {
    models: ModelPricingItem[];
}

function formatRate(value?: number): string {
    if (value === undefined || value === null) return "-";
    if (value === 0) return "Free";
    if (value < 0.01) return `$${value.toFixed(4)}`;
    return `$${value.toFixed(2)}`;
}

function formatTokens(count?: number): string {
    if (!count) return "-";
    if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(count % 1_000_000 === 0 ? 0 : 1)}M`;
    if (count >= 1_000) return `${Math.round(count / 1_000)}k`;
    return String(count);
}

export function PricingTable({ models }: PricingTableProps) {
    if (models.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center p-12 text-center font-mono border border-border/70 rounded-lg bg-card/60">
                <Coins className="size-8 text-muted-foreground/50 mb-3" />
                <p className="text-sm font-semibold text-foreground">No models match your filters</p>
                <p className="text-xs text-muted-foreground mt-1">Try broadening your search or adjusting filters.</p>
            </div>
        );
    }

    return (
        <div className="rounded-lg border border-border/80 bg-card overflow-hidden font-mono shadow-2xs">
            <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                    <thead>
                        <tr className="border-b border-border/80 bg-secondary/40 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                            <th className="py-2.5 px-3.5">Model</th>
                            <th className="py-2.5 px-3 text-right">Input / 1M</th>
                            <th className="py-2.5 px-3 text-right">Output / 1M</th>
                            <th className="py-2.5 px-3 text-right">Cache Read</th>
                            <th className="py-2.5 px-3 text-center">Context / Max Out</th>
                            <th className="py-2.5 px-3 text-center">Modalities (I/O)</th>
                            <th className="py-2.5 px-3 text-center">Features</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                        {models.map((item) => {
                            const isFree = item.cost.input === 0 && item.cost.output === 0;

                            return (
                                <tr
                                    key={item.id}
                                    className="hover:bg-secondary/30 transition-colors group"
                                >
                                    {/* Model details */}
                                    <td className="py-2.5 px-3.5 min-w-[200px] max-w-[320px]">
                                        <div className="flex flex-col">
                                            <div className="flex items-center gap-1.5">
                                                <span className="font-semibold text-foreground truncate">
                                                    {item.name}
                                                </span>
                                                {isFree && (
                                                    <span className="text-[9px] px-1 py-0.2 rounded border border-emerald-500/30 bg-emerald-500/10 text-emerald-500 font-bold">
                                                        FREE
                                                    </span>
                                                )}
                                            </div>
                                            <span className="text-[10px] text-muted-foreground/80 truncate">
                                                {item.id}
                                            </span>
                                        </div>
                                    </td>

                                    {/* Input Price */}
                                    <td className="py-2.5 px-3 text-right tabular-nums whitespace-nowrap">
                                        <span className={item.cost.input === 0 ? "text-emerald-500 font-medium" : "text-foreground"}>
                                            {formatRate(item.cost.input)}
                                        </span>
                                    </td>

                                    {/* Output Price */}
                                    <td className="py-2.5 px-3 text-right tabular-nums whitespace-nowrap">
                                        <span className={item.cost.output === 0 ? "text-emerald-500 font-medium" : "text-foreground"}>
                                            {formatRate(item.cost.output)}
                                        </span>
                                    </td>

                                    {/* Cache Read */}
                                    <td className="py-2.5 px-3 text-right tabular-nums whitespace-nowrap text-muted-foreground">
                                        {formatRate(item.cost.cache_read)}
                                    </td>

                                    {/* Context & Limits */}
                                    <td className="py-2.5 px-3 text-center tabular-nums whitespace-nowrap text-muted-foreground text-[11px]">
                                        {item.limit?.context ? (
                                            <span>
                                                {formatTokens(item.limit.context)}
                                                {item.limit.output ? ` / ${formatTokens(item.limit.output)}` : ""}
                                            </span>
                                        ) : (
                                            "-"
                                        )}
                                    </td>

                                    {/* Modalities with icons */}
                                    <td className="py-2.5 px-3 text-center whitespace-nowrap">
                                        <div className="flex justify-center">
                                            <ModalityIcons
                                                input={item.modalities?.input}
                                                output={item.modalities?.output}
                                            />
                                        </div>
                                    </td>

                                    {/* Capabilities icons */}
                                    <td className="py-2.5 px-3 text-center whitespace-nowrap">
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
    );
}
