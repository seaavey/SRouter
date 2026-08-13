import { CheckCircle2, AlertCircle, ChevronRight } from "lucide-react";
import type { RequestLogEntry } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import {
    Table,
    TableHeader,
    TableBody,
    TableHead,
    TableRow,
    TableCell,
} from "@/components/ui/table";

function formatTime(ms: number): string {
    return new Date(ms).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
    });
}

function formatDate(ms: number): string {
    return new Date(ms).toLocaleDateString();
}

interface LogTableProps {
    logs: RequestLogEntry[];
    onSelect: (log: RequestLogEntry) => void;
}

export function LogTable({ logs, onSelect }: LogTableProps) {
    return (
        <div className="rounded-xl border border-border/80 bg-card shadow-2xs overflow-hidden">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>Timestamp</TableHead>
                        <TableHead>Provider</TableHead>
                        <TableHead>Model</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Tokens</TableHead>
                        <TableHead>Latency</TableHead>
                        <TableHead>Cost</TableHead>
                        <TableHead className="text-right">Details</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {logs.map((log) => {
                        const isOk = log.statusCode >= 200 && log.statusCode < 300;
                        return (
                            <TableRow
                                key={log.id}
                                onClick={() => onSelect(log)}
                                className="cursor-pointer group"
                            >
                                <TableCell className="whitespace-nowrap">
                                    <div className="font-mono text-xs font-medium text-foreground">
                                        {formatTime(log.createdAt)}
                                    </div>
                                    <div className="text-[10px] text-muted-foreground">
                                        {formatDate(log.createdAt)}
                                    </div>
                                </TableCell>
                                <TableCell className="font-mono text-xs text-muted-foreground">
                                    {log.providerId}
                                </TableCell>
                                <TableCell className="font-mono text-xs font-semibold text-foreground">
                                    {log.model}
                                </TableCell>
                                <TableCell>
                                    <Badge
                                        variant={isOk ? "emerald" : "destructive"}
                                        className="font-mono text-[10px]"
                                    >
                                        {isOk ? (
                                            <CheckCircle2 className="size-3" />
                                        ) : (
                                            <AlertCircle className="size-3" />
                                        )}
                                        {log.statusCode}
                                    </Badge>
                                </TableCell>
                                <TableCell className="font-mono text-xs text-foreground">
                                    {log.totalTokens.toLocaleString()}
                                    <span className="text-[10px] text-muted-foreground ml-1">
                                        ({log.promptTokens} in / {log.completionTokens} out)
                                    </span>
                                </TableCell>
                                <TableCell className="font-mono text-xs">
                                    <span
                                        className={
                                            log.latencyMs > 1000
                                                ? "text-amber-500"
                                                : "text-emerald-500"
                                        }
                                    >
                                        {log.latencyMs}ms
                                    </span>
                                </TableCell>
                                <TableCell className="font-mono text-xs text-emerald-500">
                                    {log.estimatedCost ? `$${log.estimatedCost.toFixed(4)}` : "—"}
                                </TableCell>
                                <TableCell className="text-right">
                                    <button
                                        type="button"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onSelect(log);
                                        }}
                                        className="inline-flex size-6 items-center justify-center rounded-md border border-border/50 bg-secondary/20 group-hover:bg-accent group-hover:text-white transition-colors"
                                    >
                                        <ChevronRight className="size-3.5" />
                                    </button>
                                </TableCell>
                            </TableRow>
                        );
                    })}
                </TableBody>
            </Table>
        </div>
    );
}
