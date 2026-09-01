import { useState } from "react";
import { Check, Copy, KeyRound, Plus, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import type { ProviderConfig } from "@srouter/types";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useCopy } from "@/hooks/useCopy";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";

interface ConnectionCardProps {
    providerName: string;
    connections: ProviderConfig[];
    roundRobin: boolean;
    isDeleting: boolean;
    onToggleRoundRobin: (enabled: boolean) => void;
    onRefresh: () => void;
    onAdd: () => void;
    onDelete: (connectionId: string) => void;
}

function getConnectionDisplayTitle(connection: ProviderConfig): string {
    if (connection.name && connection.name.includes("@")) {
        return connection.name;
    }
    const token = connection.accessToken || connection.apiKey;
    if (token && token.startsWith("eyJ")) {
        try {
            const parts = token.split(".");
            if (parts.length >= 2) {
                const payloadBase64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
                const payload = JSON.parse(atob(payloadBase64));
                const email =
                    payload.email ||
                    payload["https://api.openai.com/profile"]?.email ||
                    payload.user_metadata?.email ||
                    (typeof payload.preferred_username === "string" && payload.preferred_username.includes("@")
                        ? payload.preferred_username
                        : undefined) ||
                    (typeof payload.unique_name === "string" && payload.unique_name.includes("@")
                        ? payload.unique_name
                        : undefined);
                if (email) {
                    return email;
                }
            }
        } catch {}
    }
    return connection.name;
}

export function ConnectionCard({
    providerName,
    connections,
    roundRobin,
    isDeleting,
    onToggleRoundRobin,
    onRefresh,
    onAdd,
    onDelete
}: ConnectionCardProps) {
    const { copied, copy } = useCopy();
    const [isTesting, setIsTesting] = useState(false);

    const handleTestConnection = async () => {
        setIsTesting(true);
        try {
            await onRefresh();
            toast.success(`Connected credentials for ${providerName} verified!`);
        } catch {
            toast.error(`Connection check failed for ${providerName}`);
        } finally {
            setTimeout(() => setIsTesting(false), 600);
        }
    };

    const activeCount = connections.filter((c) => c.enabled).length;

    return (
        <TooltipProvider>
            <div className="rounded-xl border border-border/70 bg-card p-5 font-mono shadow-xs space-y-4">
                {/* Header Row */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border/60 pb-3.5">
                    <div className="flex items-center gap-2.5">
                        <div className="flex size-7 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                            <KeyRound className="size-3.5" />
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                            <h2 className="text-xs font-bold uppercase tracking-wider text-foreground">
                                Active Credentials
                            </h2>
                            <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold border border-border/60 bg-secondary/50 text-muted-foreground">
                                <span
                                    className={`size-1.5 rounded-full ${
                                        activeCount > 0
                                            ? "bg-emerald-500 animate-pulse"
                                            : "bg-muted-foreground"
                                    }`}
                                />
                                <span>
                                    {activeCount}/{connections.length} Active
                                </span>
                            </span>
                        </div>
                    </div>

                    <div className="flex items-center gap-2.5 flex-wrap">
                        {/* Round Robin Balancing Switch */}
                        <Tooltip>
                            <TooltipTrigger
                                render={
                                    <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-secondary/30 px-2.5 py-1 text-xs text-muted-foreground cursor-pointer hover:border-border hover:bg-secondary/50 transition-colors" />
                                }
                            >
                                <span className="text-[11px] font-medium text-foreground">
                                    Round Robin
                                </span>
                                <Switch
                                    checked={roundRobin}
                                    onCheckedChange={onToggleRoundRobin}
                                    aria-label="Toggle round-robin load balancing"
                                />
                            </TooltipTrigger>
                            <TooltipContent side="top">
                                <p className="text-xs font-sans">
                                    Distribute API requests sequentially across all active
                                    credentials.
                                </p>
                            </TooltipContent>
                        </Tooltip>

                        {/* Test Connection Button */}
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={handleTestConnection}
                            disabled={isTesting || connections.length === 0}
                            className="h-7.5 text-xs font-semibold cursor-pointer gap-1.5 shadow-2xs"
                        >
                            <RefreshCw
                                className={`size-3 text-muted-foreground ${
                                    isTesting ? "animate-spin text-foreground" : ""
                                }`}
                            />
                            <span>{isTesting ? "Testing…" : "Test Connection"}</span>
                        </Button>

                        {/* Add Connection Action in Header */}
                        <Button
                            type="button"
                            size="sm"
                            onClick={onAdd}
                            className="h-7.5 text-xs font-semibold cursor-pointer shadow-2xs gap-1.5"
                        >
                            <Plus className="size-3.5" />
                            <span>Add Key</span>
                        </Button>
                    </div>
                </div>

                {/* Body / Credentials List */}
                {connections.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-border/80 bg-secondary/15 p-8 text-center space-y-3">
                        <div className="flex size-10 items-center justify-center rounded-xl bg-secondary mx-auto text-muted-foreground border border-border/60">
                            <KeyRound className="size-4.5" strokeWidth={1.75} />
                        </div>
                        <div className="space-y-1">
                            <p className="text-xs font-semibold text-foreground">
                                No active credentials configured
                            </p>
                            <p className="text-[11.5px] text-muted-foreground max-w-sm mx-auto leading-relaxed">
                                Add an API key or OAuth session for{" "}
                                <span className="text-foreground font-semibold">
                                    {providerName}
                                </span>{" "}
                                to enable live routing.
                            </p>
                        </div>
                        <Button
                            type="button"
                            size="sm"
                            onClick={onAdd}
                            className="h-8 text-xs font-semibold cursor-pointer shadow-xs gap-1.5 mt-2"
                        >
                            <Plus className="size-3.5" />
                            <span>Add Connection</span>
                        </Button>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 gap-2.5">
                        {connections.map((connection, index) => {
                            const maskedKey = connection.apiKey
                                ? `${connection.apiKey.slice(0, 4)}••••${connection.apiKey.slice(-4)}`
                                : connection.accessToken
                                  ? `${connection.accessToken.slice(0, 4)}••••`
                                  : null;

                            return (
                                <div
                                    key={connection.id}
                                    className="group relative flex flex-col sm:flex-row sm:items-center justify-between gap-3.5 rounded-lg border border-border/60 bg-secondary/20 hover:bg-secondary/40 hover:border-border/80 p-3.5 transition-all text-xs shadow-2xs"
                                >
                                    <div className="flex items-center gap-3 min-w-0 flex-1">
                                        <div className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border/70 bg-background/80 text-muted-foreground group-hover:text-foreground group-hover:border-border transition-colors">
                                            <ShieldCheck className="size-4 text-emerald-500" />
                                        </div>

                                        <div className="flex flex-col gap-1 min-w-0 flex-1">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span className="font-semibold text-foreground text-xs">
                                                    {getConnectionDisplayTitle(connection)}
                                                </span>

                                                <span
                                                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9.5px] font-semibold ${
                                                        connection.enabled
                                                            ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30"
                                                            : "bg-secondary text-muted-foreground border border-border/60"
                                                    }`}
                                                >
                                                    <span
                                                        className={`size-1 rounded-full ${
                                                            connection.enabled
                                                                ? "bg-emerald-500 animate-pulse"
                                                                : "bg-muted-foreground"
                                                        }`}
                                                    />
                                                    <span>
                                                        {connection.enabled ? "Active" : "Disabled"}
                                                    </span>
                                                </span>

                                                <span className="rounded-[4px] border border-border/60 bg-secondary/60 px-1.5 py-0.5 text-[9.5px] font-semibold text-muted-foreground">
                                                    Slot #{index + 1}
                                                </span>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
                                        <button
                                            type="button"
                                            onClick={() => onDelete(connection.id)}
                                            disabled={isDeleting}
                                            className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10 disabled:opacity-50 cursor-pointer transition-all border border-transparent hover:border-destructive/20"
                                            title="Delete this credential"
                                        >
                                            <Trash2 className="size-3.5" />
                                            <span>Remove</span>
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </TooltipProvider>
    );
}
