import { useState } from "react";
import { Database, Search } from "lucide-react";
import type { UsageStats } from "@/lib/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type UsageByModelTableProps = {
    models: UsageStats["byModel"];
};

export function UsageByModelTable({ models }: UsageByModelTableProps) {
    const [searchModel, setSearchModel] = useState("");
    const normalizedSearch = searchModel.trim().toLowerCase();
    const filteredModels = models.filter((model) => model.model.toLowerCase().includes(normalizedSearch));
    const hasUsage = models.length > 0;

    return (
        <Card className="min-w-0 gap-0 overflow-hidden p-0 shadow-none">
            <CardHeader className="flex flex-col justify-between gap-3 border-b border-border/60 px-4 py-3 sm:flex-row sm:items-center">
                <div className="flex min-w-0 items-center gap-2">
                    <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-secondary text-muted-foreground">
                        <Database className="size-3.5" strokeWidth={1.75} />
                    </div>
                    <div className="min-w-0">
                        <CardTitle className="text-sm">Usage by model</CardTitle>
                        <CardDescription>Exact token usage and estimated spend for every model.</CardDescription>
                    </div>
                </div>

                <label className="relative w-full sm:w-64">
                    <span className="sr-only">Search models</span>
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        type="search"
                        placeholder="Search models…"
                        value={searchModel}
                        onChange={(event) => setSearchModel(event.target.value)}
                        className="pl-8 font-mono text-xs"
                    />
                </label>
            </CardHeader>

            <CardContent className="p-0">
                {filteredModels.length === 0 ? (
                    <div className="flex min-h-44 flex-col items-center justify-center px-6 text-center">
                        <Search className="mb-3 size-5 text-muted-foreground" strokeWidth={1.5} />
                        <p className="text-sm font-medium text-foreground">
                            {hasUsage ? "No matching models" : "No model usage yet"}
                        </p>
                        <p className="mt-1 max-w-sm text-xs text-muted-foreground">
                            {hasUsage
                                ? `No models match “${searchModel.trim()}”. Try a different search.`
                                : "Usage details will appear after the gateway handles its first request."}
                        </p>
                    </div>
                ) : (
                    <Table className="min-w-[900px]">
                        <TableHeader>
                            <TableRow>
                                <TableHead>Model</TableHead>
                                <TableHead className="text-right">Requests</TableHead>
                                <TableHead className="text-right">Input</TableHead>
                                <TableHead className="text-right">Output</TableHead>
                                <TableHead className="text-right">Cached</TableHead>
                                <TableHead className="text-right">Total</TableHead>
                                <TableHead className="text-right">Est. cost</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {filteredModels.map((model) => {
                                const totalTokens = model.totalInputTokens + model.totalOutputTokens;

                                return (
                                    <TableRow key={model.model}>
                                        <TableCell className="max-w-64 font-mono font-medium text-foreground">
                                            <span className="block truncate" title={model.model}>
                                                {model.model}
                                            </span>
                                        </TableCell>
                                        <TableCell className="text-right font-mono text-foreground tabular-nums">
                                            {model.totalRequests.toLocaleString()}
                                        </TableCell>
                                        <TableCell className="text-right font-mono text-muted-foreground tabular-nums">
                                            {model.totalInputTokens.toLocaleString()}
                                        </TableCell>
                                        <TableCell className="text-right font-mono text-muted-foreground tabular-nums">
                                            {model.totalOutputTokens.toLocaleString()}
                                        </TableCell>
                                        <TableCell className="text-right font-mono text-muted-foreground tabular-nums">
                                            {model.totalCachedTokens.toLocaleString()}
                                        </TableCell>
                                        <TableCell className="text-right font-mono font-medium text-foreground tabular-nums">
                                            {totalTokens.toLocaleString()}
                                        </TableCell>
                                        <TableCell className="text-right font-mono font-semibold text-foreground tabular-nums">
                                            ${model.estCost.toFixed(4)}
                                        </TableCell>
                                    </TableRow>
                                );
                            })}
                        </TableBody>
                    </Table>
                )}
            </CardContent>
        </Card>
    );
}
