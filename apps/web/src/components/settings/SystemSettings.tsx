import { useState } from "react";
import {
    Cpu,
    Activity,
    ExternalLink,
    Zap,
    Layers,
    Server,
    Database,
    Clock,
    CheckCircle2,
    RefreshCw,
    Loader2,
    ArrowUpCircle,
    Copy,
    Check,
    GitBranch,
    Terminal
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { useVersion, GITHUB_REPO } from "@/hooks/useVersion";
import { SettingsSection, SettingsRow, ValueBadge } from "./settings-ui";

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
            const duration = Math.round(performance.now() - start);
            setPingLatency(duration);
            setLastPingTime(new Date().toLocaleTimeString());
        } catch {
            setPingLatency(-1);
            setLastPingTime(new Date().toLocaleTimeString());
        } finally {
            setIsPinging(false);
        }
    };

    const handleCheckUpdates = () => {
        refetchVersion();
        toast.info("Checking GitHub for the latest SRouter tags...");
    };

    const handleCopyUpdateCommand = async () => {
        try {
            await navigator.clipboard.writeText("git pull origin main && pnpm install");
            setCopiedCommand(true);
            toast.success("Update command copied to clipboard");
            setTimeout(() => setCopiedCommand(false), 2000);
        } catch {
            toast.error("Failed to copy command");
        }
    };

    return (
        <div className="space-y-5">
            <SettingsSection
                title="System Diagnostics & Runtime"
                description="Inspect core runtime engine, database storage architecture, and gateway connection health."
                icon={<Cpu className="size-4" />}
            >
                {/* Diagnostic Specs Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    <div className="p-4 rounded-xl border border-border/70 bg-muted/20 space-y-2">
                        <div className="flex items-center justify-between">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                                Gateway Core Version
                            </span>
                            <button
                                type="button"
                                onClick={handleCheckUpdates}
                                disabled={isChecking}
                                className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                                title="Check for GitHub tag updates"
                            >
                                <RefreshCw
                                    className={`size-3 ${isChecking ? "animate-spin text-cyan-500" : ""}`}
                                />
                                <span>{isChecking ? "Checking..." : "Check update"}</span>
                            </button>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-foreground font-mono">
                                {currentVersion}
                            </span>
                            <span className="inline-flex items-center rounded-md border border-cyan-500/30 bg-cyan-500/10 px-1.5 py-0.2 text-[9px] font-semibold text-cyan-500">
                                Release Candidate
                            </span>
                            {isChecking ? (
                                <span className="inline-flex items-center gap-1 rounded-md border border-border bg-muted px-1.5 py-0.2 text-[9px] text-muted-foreground animate-pulse">
                                    Checking GitHub...
                                </span>
                            ) : hasUpdate ? (
                                <a
                                    href={releaseUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/15 hover:bg-amber-500/25 px-2 py-0.5 text-[9px] font-bold text-amber-500 transition-colors"
                                >
                                    <ArrowUpCircle className="size-2.5" />
                                    {latestVersion}
                                    <ExternalLink className="size-2" />
                                </a>
                            ) : latestVersion ? (
                                <span className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.2 text-[9px] font-semibold text-emerald-500">
                                    <CheckCircle2 className="size-2.5" />
                                    Up to date
                                </span>
                            ) : null}
                        </div>
                        {lastChecked && (
                            <div className="text-[10px] font-mono text-muted-foreground/70">
                                Checked at {lastChecked.toLocaleTimeString()}
                            </div>
                        )}
                    </div>

                    <div className="p-4 rounded-xl border border-border/70 bg-muted/20 space-y-1.5">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                            Persistence
                        </span>
                        <div className="font-bold text-foreground flex items-center gap-1.5">
                            <Database className="size-3.5 text-amber-500" />
                            <span>SQLite WAL Mode</span>
                        </div>
                    </div>

                    <div className="p-4 rounded-xl border border-border/70 bg-muted/20 space-y-1.5">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                            Framework
                        </span>
                        <div className="font-bold text-foreground flex items-center gap-1.5">
                            <Server className="size-3.5 text-blue-500" />
                            <span>Hono (Node.js)</span>
                        </div>
                    </div>

                    <div className="p-4 rounded-xl border border-border/70 bg-muted/20 space-y-1.5">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                            Compatibility
                        </span>
                        <div className="font-bold text-emerald-500 flex items-center gap-1.5">
                            <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
                            <span>OpenAI v1 + Anthropic SSE</span>
                        </div>
                    </div>
                </div>

                {/* Update Banner */}
                {hasUpdate && (
                    <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 space-y-3">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                                <ArrowUpCircle className="size-4 text-amber-500 shrink-0" />
                                <div>
                                    <span className="text-xs font-bold text-foreground">
                                        New Version Available ({latestVersion})
                                    </span>
                                    <p className="text-[11px] text-muted-foreground mt-0.5">
                                        A newer release tag has been published on GitHub.
                                    </p>
                                </div>
                            </div>
                            <a
                                href={releaseUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500 text-black px-3 py-1.5 text-xs font-bold hover:bg-amber-400 transition-colors shrink-0"
                            >
                                View Release
                                <ExternalLink className="size-3" />
                            </a>
                        </div>
                        <div className="rounded-xl bg-background/80 border border-border/70 p-2.5 flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0 font-mono text-[11px] text-foreground overflow-x-auto">
                                <Terminal className="size-3.5 text-muted-foreground shrink-0" />
                                <code>git pull origin main && pnpm install</code>
                            </div>
                            <button
                                type="button"
                                onClick={handleCopyUpdateCommand}
                                className="flex items-center gap-1 px-2 py-1 rounded bg-muted hover:bg-muted/80 text-[10px] font-semibold text-foreground transition-colors shrink-0 cursor-pointer"
                            >
                                {copiedCommand ? (
                                    <Check className="size-3 text-emerald-500" />
                                ) : (
                                    <Copy className="size-3" />
                                )}
                                <span>{copiedCommand ? "Copied" : "Copy"}</span>
                            </button>
                        </div>
                    </div>
                )}

                {/* Live Gateway Health */}
                <div className="rounded-xl border border-border/70 bg-muted/20 p-4 space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="space-y-0.5">
                            <div className="text-xs font-bold text-foreground flex items-center gap-1.5">
                                <Activity className="size-3.5 text-emerald-500" />
                                <span>Live Gateway Latency Check</span>
                            </div>
                            <p className="text-[11px] text-muted-foreground">
                                Measure roundtrip HTTP ping latency from browser to the SRouter API
                                daemon.
                            </p>
                        </div>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={isPinging}
                            onClick={handlePing}
                            className="shrink-0 font-semibold cursor-pointer"
                        >
                            {isPinging ? (
                                <Loader2 className="size-3.5 animate-spin" />
                            ) : (
                                <RefreshCw className="size-3.5" />
                            )}
                            <span>{isPinging ? "Pinging..." : "Test Latency"}</span>
                        </Button>
                    </div>
                    {pingLatency !== null && (
                        <div className="flex items-center justify-between p-3 rounded-xl border border-border/70 bg-background text-xs">
                            <div className="flex items-center gap-2">
                                {pingLatency >= 0 ? (
                                    <span className="flex items-center gap-1.5 font-bold text-emerald-500">
                                        <CheckCircle2 className="size-4" />
                                        <span>Gateway Healthy</span>
                                    </span>
                                ) : (
                                    <span className="font-bold text-destructive">
                                        Gateway Offline
                                    </span>
                                )}
                            </div>
                            <div className="flex items-center gap-3 text-muted-foreground text-[11px] font-mono">
                                {pingLatency >= 0 && (
                                    <span className="text-foreground font-bold tabular-nums">
                                        Roundtrip:{" "}
                                        <span className="text-emerald-500">{pingLatency}ms</span>
                                    </span>
                                )}
                                {lastPingTime && <span>at {lastPingTime}</span>}
                            </div>
                        </div>
                    )}
                </div>
            </SettingsSection>

            {/* Quick Reference Links */}
            <div className="rounded-2xl border border-border/70 bg-card p-5">
                <span className="text-xs font-bold text-foreground block mb-3">
                    Quick Reference
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <a
                        href={`https://github.com/${GITHUB_REPO}`}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center justify-between p-3 rounded-xl border border-border/70 bg-background hover:bg-muted/40 text-xs font-medium text-foreground transition-colors group"
                    >
                        <span className="flex items-center gap-2">
                            <Layers className="size-3.5 text-muted-foreground group-hover:text-foreground" />
                            <span>GitHub Repository</span>
                        </span>
                        <ExternalLink className="size-3 text-muted-foreground group-hover:text-foreground" />
                    </a>
                    <a
                        href={tagsUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center justify-between p-3 rounded-xl border border-border/70 bg-background hover:bg-muted/40 text-xs font-medium text-foreground transition-colors group"
                    >
                        <span className="flex items-center gap-2">
                            <GitBranch className="size-3.5 text-muted-foreground group-hover:text-foreground" />
                            <span>Releases &amp; Tags</span>
                        </span>
                        <ExternalLink className="size-3 text-muted-foreground group-hover:text-foreground" />
                    </a>
                </div>
            </div>
        </div>
    );
}
