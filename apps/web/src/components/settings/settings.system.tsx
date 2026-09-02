import { useState } from "react";
import {
    Activity,
    ExternalLink,
    RefreshCw,
    Loader2,
    CheckCircle2,
    Copy,
    Check,
    Terminal,
    ArrowUpCircle
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { useVersion, GITHUB_REPO } from "@/hooks/useVersion";
import { SettingsSection, SettingsRow } from "./settings.ui";

interface SystemSettingsProps {
    apiBase: string;
}

export function SystemSettings({ apiBase }: SystemSettingsProps) {
    const [pingLatency, setPingLatency] = useState<number | null>(null);
    const [isPinging, setIsPinging] = useState(false);
    const [lastPingTime, setLastPingTime] = useState<string | null>(null);
    const [copiedCommand, setCopiedCommand] = useState(false);
    const {
        currentVersion,
        latestVersion,
        hasUpdate,
        releaseUrl,
        tagsUrl,
        isChecking,
        lastChecked,
        refetch: refetchVersion
    } = useVersion();

    const handlePing = async () => {
        setIsPinging(true);
        const start = performance.now();
        try {
            await api.get("/v1/settings");
            setPingLatency(Math.round(performance.now() - start));
            setLastPingTime(new Date().toLocaleTimeString());
        } catch {
            setPingLatency(-1);
            setLastPingTime(new Date().toLocaleTimeString());
        } finally {
            setIsPinging(false);
        }
    };

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText("git pull origin main && pnpm install");
            setCopiedCommand(true);
            toast.success("Command copied");
            setTimeout(() => setCopiedCommand(false), 2000);
        } catch {
            toast.error("Failed to copy");
        }
    };

    return (
        <SettingsSection
            index="07"
            title="System"
            description="Runtime diagnostics, version info, and health checks."
        >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 py-2">
                <div className="rounded-md border border-border/70 bg-muted/20 p-3 space-y-1.5">
                    <div className="flex items-center justify-between">
                        <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
                            Version
                        </span>
                        <button
                            type="button"
                            onClick={() => {
                                refetchVersion();
                                toast.info("Checking GitHub...");
                            }}
                            disabled={isChecking}
                            className="text-[9px] text-muted-foreground hover:text-foreground cursor-pointer"
                        >
                            <RefreshCw
                                className={`size-2.5 inline ${isChecking ? "animate-spin" : ""}`}
                            />{" "}
                            {isChecking ? "..." : "check"}
                        </button>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold font-mono text-xs text-foreground">
                            {currentVersion}
                        </span>
                        {hasUpdate ? (
                            <a
                                href={releaseUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="flex items-center gap-1 text-[9px] font-bold text-amber-500 border border-amber-500/30 rounded-sm px-1.5 py-0.5 hover:bg-amber-500/10"
                            >
                                {latestVersion} <ExternalLink className="size-2" />
                            </a>
                        ) : latestVersion ? (
                            <span className="flex items-center gap-1 text-[9px] text-emerald-500">
                                <CheckCircle2 className="size-2.5" /> up to date
                            </span>
                        ) : null}
                    </div>
                    {lastChecked && (
                        <div className="text-[9px] font-mono text-muted-foreground/70">
                            checked {lastChecked.toLocaleTimeString()}
                        </div>
                    )}
                </div>
                <div className="rounded-md border border-border/70 bg-muted/20 p-3 space-y-1">
                    <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
                        Stack
                    </span>
                    <div className="text-xs font-bold text-foreground">
                        SQLite WAL · Hono · Node.js
                    </div>
                </div>
            </div>

            {hasUpdate && (
                <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 space-y-2">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <ArrowUpCircle className="size-3.5 text-amber-500" />
                            <span className="text-xs font-bold text-foreground">
                                Update {latestVersion} available
                            </span>
                        </div>
                        <a
                            href={releaseUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[10px] font-bold text-amber-500 border border-amber-500/30 rounded px-2 py-0.5 hover:bg-amber-500/10"
                        >
                            View <ExternalLink className="size-2 inline" />
                        </a>
                    </div>
                    <div className="flex items-center justify-between rounded-md bg-background/80 border border-border/70 p-2">
                        <code className="text-[10px] font-mono text-foreground">
                            git pull origin main && pnpm install
                        </code>
                        <button
                            type="button"
                            onClick={handleCopy}
                            className="flex items-center gap-1 text-[9px] text-muted-foreground hover:text-foreground cursor-pointer"
                        >
                            {copiedCommand ? (
                                <Check className="size-2.5 text-emerald-500" />
                            ) : (
                                <Copy className="size-2.5" />
                            )}{" "}
                            {copiedCommand ? "done" : "copy"}
                        </button>
                    </div>
                </div>
            )}

            <div className="rounded-md border border-border/70 bg-muted/20 p-3 space-y-2">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Activity className="size-3.5 text-emerald-500" />
                        <span className="text-xs font-semibold text-foreground">
                            Gateway Latency
                        </span>
                    </div>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={isPinging}
                        onClick={handlePing}
                        className="cursor-pointer"
                    >
                        {isPinging ? (
                            <Loader2 className="size-3 animate-spin" />
                        ) : (
                            <RefreshCw className="size-3" />
                        )}
                        {isPinging ? "pinging..." : "ping"}
                    </Button>
                </div>
                {pingLatency !== null && (
                    <div className="flex items-center justify-between text-[11px] font-mono">
                        {pingLatency >= 0 ? (
                            <span className="text-emerald-500 font-semibold">{pingLatency}ms</span>
                        ) : (
                            <span className="text-destructive font-semibold">offline</span>
                        )}
                        {lastPingTime && (
                            <span className="text-muted-foreground">at {lastPingTime}</span>
                        )}
                    </div>
                )}
            </div>

            <div className="flex gap-2 pt-2">
                <a
                    href={`https://github.com/${GITHUB_REPO}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1.5 rounded-md border border-border/70 px-2.5 py-1.5 text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
                >
                    GitHub <ExternalLink className="size-2.5" />
                </a>
                <a
                    href={tagsUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1.5 rounded-md border border-border/70 px-2.5 py-1.5 text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
                >
                    Releases <ExternalLink className="size-2.5" />
                </a>
            </div>
        </SettingsSection>
    );
}
