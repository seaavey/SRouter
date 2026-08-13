import { Link } from "@tanstack/react-router";
import { Play } from "lucide-react";
import type { ModelObject } from "@srouter/types";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
    Table,
    TableHeader,
    TableBody,
    TableHead,
    TableRow,
    TableCell,
} from "@/components/ui/table";
import { getProviderBadgeColor, providerFor } from "./model-utils";

export function ModelTable({ models }: { models: ModelObject[] }) {
    return (
        <Card className="p-0 overflow-hidden border border-border/70">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>Model ID</TableHead>
                        <TableHead>Provider</TableHead>
                        <TableHead>Capabilities</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {models.map((model) => {
                        const provider = providerFor(model);
                        const badgeColorClass = getProviderBadgeColor(provider);
                        return (
                            <TableRow key={model.id}>
                                <TableCell className="font-mono text-xs font-semibold text-foreground">
                                    {model.id}
                                </TableCell>
                                <TableCell>
                                    <Badge
                                        variant="outline"
                                        className={`font-mono text-[10px] font-semibold uppercase px-2 py-0.5 border ${badgeColorClass}`}
                                    >
                                        {provider}
                                    </Badge>
                                </TableCell>
                                <TableCell className="text-muted-foreground text-xs font-mono">
                                    Chat, Streaming, Tools
                                </TableCell>
                                <TableCell>
                                    <span className="inline-flex items-center gap-1.5 text-emerald-500 font-mono text-xs">
                                        <span className="size-1.5 rounded-full bg-emerald-500" />
                                        Active
                                    </span>
                                </TableCell>
                                <TableCell className="text-right">
                                    <Link
                                        to="/playground"
                                        search={{ model: model.id }}
                                        className="inline-flex items-center gap-1 rounded bg-secondary text-foreground hover:bg-foreground hover:text-background px-2.5 py-1 text-xs font-semibold transition-all border border-border/60"
                                    >
                                        <Play className="size-3" />
                                        Playground
                                    </Link>
                                </TableCell>
                            </TableRow>
                        );
                    })}
                </TableBody>
            </Table>
        </Card>
    );
}
