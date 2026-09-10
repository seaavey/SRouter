import { useState } from "react";
import {
    Activity,
    ExternalLink,
    RefreshCw,
    Loader2,
    CheckCircle2,
    Copy,
    Check,
    ArrowUpCircle
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { useVersion, GITHUB_REPO } from "@/hooks/useVersion";
import { SettingsSection } from "./settings.ui";

interface SystemSettingsProps {
    apiBase: string;
}

export function SystemSettings({ apiBase: _apiBase }: SystemSettingsProps) {
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
            id="system"
            icon={Activity}
            tag="Runtime"
            title="System & Diagnostics"
            description="Mesh node status, real-time gateway latency probes, and update channels."
        >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 py-3 font-sans">
                <div className="rounded-2xl border border-hairline-soft bg-canvas-soft/30 p-4 space-y-2">
                    <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted font-mono">
                            Version
                        </span>
                        <button
                            type="button"
                            onClick={() => {
                                refetchVersion();
                                toast.info("Checking GitHub...");
                            }}
                            disabled={isChecking}
                            className="text-[11px] font-mono text-text-muted hover:text-ink cursor-pointer flex items-center gap-1"
                        >
                            <RefreshCw className={`size-3 ${isChecking ? "animate-spin" : ""}`} />{" "}
                            {isChecking ? "..." : "check"}
                        </button>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold font-mono text-sm text-ink">
                            {currentVersion}
                        </span>
                        {hasUpdate ? (
                            <a
                                href={releaseUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="flex items-center gap-1 text-[10px] font-bold text-amber-600 dark:text-amber-400 border border-amber-500/30 rounded-full px-2 py-0.5 hover:bg-amber-500/10 font-mono"
                            >
                                {latestVersion} <ExternalLink className="size-2.5" />
                            </a>
                        ) : latestVersion ? (
                            <span className="flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400 font-sans">
                                <CheckCircle2 className="size-3" /> up to date
                            </span>
                        ) : null}
                    </div>
                    {lastChecked && (
                        <div className="text-[10px] font-mono text-text-muted">
                            checked {lastChecked.toLocaleTimeString()}
                        </div>
                    )}
                </div>
                <div className="rounded-2xl border border-hairline-soft bg-canvas-soft/30 p-4 space-y-2">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted font-mono">
                        Stack
                    </span>
                    <div className="text-sm font-semibold text-ink font-sans">
                        SQLite WAL · Hono · Node.js
                    </div>
                </div>
            </div>

            {hasUpdate && (
                <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4 space-y-3 font-sans my-2">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <ArrowUpCircle className="size-4 text-amber-600 dark:text-amber-500" />
                            <span className="text-xs font-semibold text-ink">
                                Update {latestVersion} available
                            </span>
                        </div>
                        <a
                            href={releaseUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[11px] font-semibold text-amber-600 dark:text-amber-400 border border-amber-500/30 rounded-full px-3 py-1 hover:bg-amber-500/10"
                        >
                            View <ExternalLink className="size-3 inline ml-0.5" />
                        </a>
                    </div>
                    <div className="flex items-center justify-between rounded-2xl bg-canvas border border-hairline-soft p-3 font-mono">
                        <code className="text-xs text-ink">
                            git pull origin main && pnpm install
                        </code>
                        <button
                            type="button"
                            onClick={handleCopy}
                            className="flex items-center gap-1.5 text-xs text-text-muted hover:text-ink cursor-pointer font-sans"
                        >
                            {copiedCommand ? (
                                <Check className="size-3.5 text-emerald-500" />
                            ) : (
                                <Copy className="size-3.5" />
                            )}{" "}
                            <span>{copiedCommand ? "copied" : "copy"}</span>
                        </button>
                    </div>
                </div>
            )}

            <div className="rounded-2xl border border-hairline-soft bg-canvas-soft/30 p-4 space-y-3 font-sans my-2">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Activity className="size-4 text-accent" />
                        <span className="text-xs font-semibold text-ink font-sans">
                            Gateway Latency
                        </span>
                    </div>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={isPinging}
                        onClick={handlePing}
                        className="rounded-full border border-hairline-soft bg-canvas px-4 text-xs font-semibold text-ink hover:bg-canvas-soft cursor-pointer shadow-none gap-1.5"
                    >
                        {isPinging ? (
                            <Loader2 className="size-3 animate-spin" />
                        ) : (
                            <RefreshCw className="size-3" />
                        )}
                        <span>{isPinging ? "pinging..." : "ping"}</span>
                    </Button>
                </div>
                {pingLatency !== null && (
                    <div className="flex items-center justify-between text-xs font-mono">
                        {pingLatency >= 0 ? (
                            <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                                {pingLatency}ms
                            </span>
                        ) : (
                            <span className="text-destructive font-semibold">offline</span>
                        )}
                        {lastPingTime && <span className="text-text-muted">at {lastPingTime}</span>}
                    </div>
                )}
            </div>

            <div className="flex gap-2 pt-3 font-sans">
                <a
                    href={`https://github.com/${GITHUB_REPO}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-2 rounded-full border border-hairline-soft bg-canvas hover:bg-canvas-soft px-4 py-2 text-xs font-semibold text-text-muted hover:text-ink transition-colors"
                >
                    GitHub <ExternalLink className="size-3" />
                </a>
                <a
                    href={tagsUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-2 rounded-full border border-hairline-soft bg-canvas hover:bg-canvas-soft px-4 py-2 text-xs font-semibold text-text-muted hover:text-ink transition-colors"
                >
                    Releases <ExternalLink className="size-3" />
                </a>
            </div>
        </SettingsSection>
    );
}
