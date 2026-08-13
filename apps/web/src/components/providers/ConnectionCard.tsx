import { Key, Lock, Plus, RefreshCw, Trash2 } from "lucide-react";
import type { ProviderConfig } from "@srouter/types";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface ConnectionCardProps {
    providerName: string;
    connections: ProviderConfig[];
    roundRobin: boolean;
    isDeleting: boolean;
    onToggleRoundRobin: () => void;
    onRefresh: () => void;
    onAdd: () => void;
    onDelete: (connectionId: string) => void;
}

export function ConnectionCard({
    providerName,
    connections,
    roundRobin,
    isDeleting,
    onToggleRoundRobin,
    onRefresh,
    onAdd,
    onDelete,
}: ConnectionCardProps) {
    return (
        <Card className="p-5 border border-border/70 bg-card space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border/60 pb-3">
                <div className="flex items-center gap-2">
                    <h2 className="text-base font-bold text-foreground">
                        Connections ({connections.length})
                    </h2>
                </div>

                <div className="flex items-center gap-3">
                    <button
                        type="button"
                        onClick={onRefresh}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-secondary/40 hover:bg-secondary px-3 py-1.5 text-xs font-medium font-mono text-foreground transition-all"
                    >
                        <RefreshCw className="size-3.5 text-muted-foreground" />
                        <span>Test Connection</span>
                    </button>

                    <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground">
                        <span>Round Robin</span>
                        <button
                            type="button"
                            onClick={onToggleRoundRobin}
                            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${
                                roundRobin ? "bg-orange-500" : "bg-secondary"
                            }`}
                        >
                            <span
                                className={`pointer-events-none inline-block size-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                                    roundRobin ? "translate-x-4" : "translate-x-0"
                                }`}
                            />
                        </button>
                    </div>
                </div>
            </div>

            {connections.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border/60 p-8 text-center space-y-3">
                    <div className="flex size-10 items-center justify-center rounded-full bg-secondary/50 mx-auto text-muted-foreground">
                        <Key className="size-5" />
                    </div>
                    <p className="text-xs font-mono text-muted-foreground">
                        Belum ada koneksi terhubung untuk provider{" "}
                        <span className="text-foreground font-semibold">{providerName}</span> di
                        database.
                    </p>
                    <button
                        type="button"
                        onClick={onAdd}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 text-xs font-bold transition-all shadow-xs"
                    >
                        <Plus className="size-4" />
                        <span>Add Connection</span>
                    </button>
                </div>
            ) : (
                <div className="space-y-3">
                    <div className="space-y-2">
                        {connections.map((connection, index) => (
                            <div
                                key={connection.id}
                                className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-border/60 bg-secondary/20 p-3 hover:border-foreground/20 transition-all text-xs"
                            >
                                <div className="flex items-center gap-3 min-w-0 flex-1">
                                    <Lock className="size-3.5 text-muted-foreground shrink-0" />
                                    <div className="flex items-center gap-2 min-w-0 flex-1 flex-wrap">
                                        <span className="font-mono font-semibold text-foreground truncate">
                                            {connection.name}
                                        </span>

                                        <Badge
                                            variant={connection.enabled ? "emerald" : "secondary"}
                                            className="font-mono text-[10px] px-1.5 py-0.2"
                                        >
                                            ● {connection.enabled ? "active" : "disabled"}
                                        </Badge>

                                        {connection.apiKey && (
                                            <Badge
                                                variant="outline"
                                                className="font-mono text-[10px] px-1.5 py-0.2 text-muted-foreground"
                                            >
                                                API Key ({connection.apiKey.slice(0, 4)}***)
                                            </Badge>
                                        )}

                                        <span className="font-mono text-[10px] text-muted-foreground">
                                            #{index + 1}
                                        </span>
                                    </div>
                                </div>

                                <div className="flex items-center gap-3 self-end sm:self-auto">
                                    <button
                                        type="button"
                                        onClick={() => onDelete(connection.id)}
                                        disabled={isDeleting}
                                        className="inline-flex items-center gap-1 text-xs text-destructive hover:text-destructive/80 font-mono disabled:opacity-50"
                                    >
                                        <Trash2 className="size-3" />
                                        <span>Delete</span>
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>

                    <div className="pt-2">
                        <button
                            type="button"
                            onClick={onAdd}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 text-xs font-bold transition-all shadow-xs"
                        >
                            <Plus className="size-4" />
                            <span>Add Connection</span>
                        </button>
                    </div>
                </div>
            )}
        </Card>
    );
}
