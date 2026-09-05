import { useState } from "react";
import { Check, Cloud, Code2, Copy, Network, ArrowUpRight } from "lucide-react";
import { toast } from "sonner";
import { getGatewayBaseUrl } from "@/lib/api";
import { useTunnelStatus, useTunnelActions } from "@/hooks/useTunnel";
import { TunnelModal } from "@/components/dashboard";

export function NetworkStatus() {
    const apiBase = getGatewayBaseUrl();
    const { status: tunnel, fetchStatus } = useTunnelStatus();
    const { startTunnel, stopTunnel, installCloudflared } = useTunnelActions();
    const [modalOpen, setModalOpen] = useState(false);
    const [copied, setCopied] = useState(false);

    async function handleCopy() {
        try {
            await navigator.clipboard.writeText(apiBase);
            setCopied(true);
            toast.success("Base URL copied", {
                description: "Compatible with OpenAI and Anthropic SDKs."
            });
            setTimeout(() => setCopied(false), 1600);
        } catch {
            toast.error("Could not copy Base URL");
        }
    }

    return (
        <section
            aria-labelledby="api-integration-title"
            className="flex h-full min-w-0 flex-col justify-between rounded-xl border border-border/70 bg-card/50 p-4 sm:p-5 lg:p-6 shadow-xs"
        >
            {/* Top: API Integration & Base URL */}
            <div className="flex flex-col gap-4">
                {/* Header */}
                <header className="flex items-center justify-between gap-3 pb-4 border-b border-border/60">
                    <div className="flex min-w-0 items-center gap-2.5">
                        <div className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-muted/40 text-foreground">
                            <Code2 className="size-3.5" strokeWidth={1.75} />
                        </div>
                        <div className="min-w-0">
                            <h2
                                id="api-integration-title"
                                className="text-sm font-semibold tracking-tight text-foreground whitespace-nowrap"
                            >
                                API integration
                            </h2>
                            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                                OpenAI & Anthropic compatible
                            </p>
                        </div>
                    </div>
                </header>

                {/* Base URL Card */}
                <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                        <span>Base URL</span>
                        <span className="text-[10px] font-normal lowercase tracking-normal text-muted-foreground/70">
                            click to copy
                        </span>
                    </div>

                    <div
                        onClick={() => void handleCopy()}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                void handleCopy();
                            }
                        }}
                        className="group flex items-center justify-between gap-2.5 rounded-lg border border-border/60 bg-muted/30 px-3.5 py-2.5 transition-all duration-150 hover:border-border hover:bg-muted/50 cursor-pointer active:scale-[0.99]"
                    >
                        <div className="flex items-center gap-2 min-w-0">
                            <code className="truncate font-mono text-[12px] text-foreground font-medium select-all">
                                {apiBase}
                            </code>
                        </div>

                        <button
                            type="button"
                            aria-label="Copy base URL"
                            className="inline-flex size-6 shrink-0 items-center justify-center rounded-md border border-border/60 bg-background/90 text-muted-foreground transition-colors group-hover:text-foreground hover:border-border cursor-pointer"
                        >
                            {copied ? (
                                <Check className="size-3 text-emerald-500" />
                            ) : (
                                <Copy className="size-3" />
                            )}
                        </button>
                    </div>
                </div>
            </div>

            {/* Bottom: Private Access / Tunneling */}
            <div className="mt-6 pt-4 border-t border-border/50">
                <div className="flex items-center justify-between gap-3 mb-2.5">
                    <div>
                        <h3 className="text-xs font-semibold text-foreground">Private access</h3>
                        <p className="mt-0.5 text-[10.5px] text-muted-foreground">
                            Secure routes for remote clients
                        </p>
                    </div>
                    <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground font-medium">
                        Optional
                    </span>
                </div>

                <div className="space-y-2">
                    {/* Cloudflare Tunnel Row */}
                    <div className="group flex items-center justify-between gap-3 rounded-lg border border-border/50 bg-background/50 p-2.5 transition-all duration-150 hover:border-border hover:bg-muted/25">
                        <div className="flex items-center gap-2.5 min-w-0">
                            <div className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border/60 bg-muted/50 text-muted-foreground group-hover:text-foreground transition-colors">
                                <Cloud className="size-3.5" strokeWidth={1.75} />
                            </div>
                            <div className="min-w-0">
                                <div className="flex items-center gap-1.5">
                                    <p className="text-[11.5px] font-medium text-foreground">
                                        Cloudflare Tunnel
                                    </p>
                                    {tunnel?.running && (
                                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-1.5 py-0.2 text-[8.5px] font-semibold text-emerald-500 font-mono">
                                            <span className="size-1 rounded-full bg-emerald-500 animate-pulse" />
                                            Live
                                        </span>
                                    )}
                                </div>
                                <p className="mt-0.5 truncate text-[10px] text-muted-foreground font-mono">
                                    {tunnel?.running
                                        ? tunnel.domain ?? "Active tunnel"
                                        : "Expose gateway without opening ports"}
                                </p>
                            </div>
                        </div>

                        <button
                            type="button"
                            onClick={() => setModalOpen(true)}
                            className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-border/70 bg-secondary/50 px-2.5 font-mono text-[10.5px] font-medium text-foreground transition-all hover:bg-secondary hover:border-border cursor-pointer active:translate-y-px"
                        >
                            <span>{tunnel?.running ? "Manage" : "Configure"}</span>
                            <ArrowUpRight className="size-3 opacity-60" />
                        </button>
                    </div>

                    {/* Tailscale Row */}
                    <div className="flex items-center justify-between gap-3 rounded-lg border border-border/30 bg-muted/10 p-2.5 opacity-75 transition-opacity hover:opacity-100">
                        <div className="flex items-center gap-2.5 min-w-0">
                            <div className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border/40 bg-muted/40 text-muted-foreground">
                                <Network className="size-3.5" strokeWidth={1.75} />
                            </div>
                            <div className="min-w-0">
                                <p className="text-[11.5px] font-medium text-foreground">
                                    Tailscale
                                </p>
                                <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
                                    Private mesh network access
                                </p>
                            </div>
                        </div>

                        <span className="flex shrink-0 items-center gap-1.5 rounded-full border border-border/40 bg-muted/30 px-2 py-0.5 font-mono text-[8.5px] text-muted-foreground">
                            <span
                                className="size-1 rounded-full bg-muted-foreground/40"
                                aria-hidden="true"
                            />
                            Coming soon
                        </span>
                    </div>
                </div>
            </div>

            <TunnelModal
                open={modalOpen}
                onClose={() => setModalOpen(false)}
                status={tunnel}
                onStart={startTunnel}
                onStop={stopTunnel}
                onInstall={installCloudflared}
                onRefresh={fetchStatus}
            />
        </section>
    );
}
