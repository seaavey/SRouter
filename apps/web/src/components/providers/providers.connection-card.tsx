import { useState } from "react";
import { Check, Copy, KeyRound, Plus, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import type { ProviderConfig } from "@srouter/types";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useCopy } from "@/hooks/useCopy";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import {
    Empty,
    EmptyContent,
    EmptyHeader,
    EmptyMedia,
    EmptyTitle,
    EmptyDescription
} from "@/components/ui/empty";

interface ConnectionCardProps {
    providerName: string;
    connections: ProviderConfig[];
    roundRobin: boolean;
    isDeleting: boolean;
    requiresOAuth?: boolean;
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
                    (typeof payload.preferred_username === "string" &&
                    payload.preferred_username.includes("@")
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
    requiresOAuth = false,
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
            <div className="rounded-3xl border border-hairline-soft bg-canvas p-5 sm:p-6 font-sans shadow-none space-y-5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3.5 border-b border-hairline-soft pb-4">
                    <div className="flex items-center gap-3">
                        <div className="flex size-9 items-center justify-center rounded-[30%] bg-canvas-soft text-ink border border-hairline-soft">
                            <KeyRound className="size-4" />
                        </div>
                        <div className="flex items-center gap-2.5 flex-wrap">
                            <h2 className="text-base font-bold tracking-tight text-ink font-sans">
                                Active Credentials.
                            </h2>
                            <span className="inline-flex items-center gap-1.5 text-xs font-mono text-text-muted">
                                <span
                                    className={`size-1.5 rounded-full ${
                                        activeCount > 0 ? "bg-emerald-500" : "bg-text-muted/40"
                                    }`}
                                />
                                <span>
                                    {activeCount}/{connections.length} Active
                                </span>
                            </span>
                        </div>
                    </div>

                    <div className="flex items-center gap-2.5 flex-wrap">
                        <Tooltip>
                            <TooltipTrigger
                                render={
                                    <div className="flex items-center gap-2 rounded-full border border-hairline-soft bg-canvas-soft px-3 py-1.5 text-xs text-ink cursor-pointer hover:border-hairline transition-colors" />
                                }
                            >
                                <span className="text-xs font-medium text-ink">Round Robin</span>
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
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={handleTestConnection}
                            disabled={isTesting || connections.length === 0}
                            className="rounded-full px-4 h-8 text-xs font-semibold cursor-pointer gap-1.5 shadow-none border-hairline bg-canvas hover:bg-canvas-soft text-ink"
                        >
                            <RefreshCw
                                className={`size-3.5 text-text-muted ${
                                    isTesting ? "animate-spin text-ink" : ""
                                }`}
                            />
                            <span>{isTesting ? "Testing…" : "Test Connection"}</span>
                        </Button>
                        <Button
                            type="button"
                            size="sm"
                            onClick={onAdd}
                            className="rounded-full px-4 h-8 text-xs font-semibold cursor-pointer shadow-none gap-1.5"
                        >
                            <Plus className="size-3.5" />
                            <span>{requiresOAuth ? "Add Connection" : "Add Key"}</span>
                        </Button>
                    </div>
                </div>
                {connections.length === 0 ? (
                    <Empty className="p-8">
                        <EmptyHeader>
                            <EmptyMedia variant="icon">
                                <KeyRound className="size-5" strokeWidth={1.75} />
                            </EmptyMedia>
                            <EmptyTitle>No active credentials configured</EmptyTitle>
                            <EmptyDescription>
                                Add an API key or OAuth session for{" "}
                                <span className="text-ink font-semibold">{providerName}</span> to
                                enable live routing.
                            </EmptyDescription>
                        </EmptyHeader>
                        <EmptyContent>
                            <Button
                                type="button"
                                size="sm"
                                onClick={onAdd}
                                className="rounded-full px-5 h-9 text-xs font-semibold cursor-pointer shadow-none gap-1.5"
                            >
                                <Plus className="size-3.5" />
                                <span>Add Connection</span>
                            </Button>
                        </EmptyContent>
                    </Empty>
                ) : (
                    <div className="grid grid-cols-1 gap-3">
                        {connections.map((connection, index) => {
                            return (
                                <div
                                    key={connection.id}
                                    className="group relative flex flex-col sm:flex-row sm:items-center justify-between gap-3.5 rounded-2xl border border-hairline-soft bg-canvas-soft hover:border-hairline p-4 transition-all text-xs shadow-none"
                                >
                                    <div className="flex items-center gap-3.5 min-w-0 flex-1">
                                        <div className="flex size-9 shrink-0 items-center justify-center rounded-[30%] border border-hairline-soft bg-canvas text-text-muted group-hover:border-hairline transition-colors">
                                            <ShieldCheck className="size-4.5 text-emerald-500" />
                                        </div>

                                        <div className="flex flex-col gap-1 min-w-0 flex-1">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span className="font-semibold text-ink text-xs font-sans">
                                                    {getConnectionDisplayTitle(connection)}
                                                </span>

                                                {connection.enabled ? (
                                                    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                                                        <span className="size-1.5 rounded-full bg-emerald-500" />
                                                        Active
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center gap-1.5 rounded-full bg-canvas px-2.5 py-0.5 text-xs text-text-muted font-medium">
                                                        <span className="size-1.5 rounded-full bg-text-muted/40" />
                                                        Disabled
                                                    </span>
                                                )}

                                                <span className="rounded-full border border-hairline-soft bg-canvas px-2 py-0.5 text-[10px] font-mono text-text-muted">
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
                                            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs text-text-muted hover:text-destructive hover:bg-destructive/10 disabled:opacity-50 cursor-pointer transition-all border border-transparent hover:border-destructive/20"
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
