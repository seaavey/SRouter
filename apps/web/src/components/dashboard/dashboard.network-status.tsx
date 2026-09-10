import { useState } from "react";
import { Check, Code2, Copy, ArrowUpRight } from "lucide-react";
import { toast } from "sonner";
import { getGatewayBaseUrl } from "@/lib/api";
import { useTunnelStatus, useTunnelActions } from "@/hooks/useTunnel";
import { TunnelModal } from "@/components/dashboard";

function CloudflareIcon({ className = "size-3.5" }: { className?: string }) {
    return (
        <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
            <path d="M16.91 9.87a5.53 5.53 0 0 0-4.66-2.58 5.57 5.57 0 0 0-5.32 3.86 4.3 4.3 0 0 0-3.9 4.22c0 2.37 1.94 4.3 4.32 4.3h9.6a4.4 4.4 0 0 0 4.4-4.4c0-2.31-1.78-4.2-4.04-4.38a5.52 5.52 0 0 0-.4-.02v-.02zm-9.65 8.3c-1.55 0-2.82-1.26-2.82-2.8a2.82 2.82 0 0 1 2.82-2.82c.26 0 .52.04.77.12l.68.21.22-.68a4.07 4.07 0 0 1 3.98-2.9c1.9 0 3.5 1.3 3.93 3.14l.2.85.87.05c1.6.1 2.86 1.44 2.86 3.03 0 1.68-1.37 3.05-3.05 3.05h-9.46v-.25z" />
        </svg>
    );
}

function TailscaleIcon({ className = "size-3.5" }: { className?: string }) {
    return (
        <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
            <circle cx="12" cy="6" r="2.2" />
            <circle cx="6" cy="12" r="2.2" />
            <circle cx="12" cy="12" r="2.2" />
            <circle cx="18" cy="12" r="2.2" />
            <circle cx="12" cy="18" r="2.2" />
        </svg>
    );
}

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
            className="flex h-full min-w-0 flex-col rounded-lg border border-border/80 bg-card p-3 sm:p-4"
        >
            {/* Top: API Integration & Base URL */}
            <div className="flex flex-col gap-4">
                {/* Header */}
                <header className="flex items-center justify-between gap-3 pb-3 border-b border-border/60">
                    <div className="flex min-w-0 items-center gap-2.5">
                        <div className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border/80 bg-secondary text-foreground">
                            <Code2 className="size-3.5" strokeWidth={1.75} />
                        </div>
                        <div className="min-w-0">
                            <h2
                                id="api-integration-title"
                                className="text-xs font-bold tracking-tight text-foreground uppercase"
                            >
                                API Integration
                            </h2>
                            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                                OpenAI and Anthropic compatible endpoint
                            </p>
                        </div>
                    </div>
                </header>

                {/* Base URL Card */}
                <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground">
                        <span>Gateway Base URL</span>
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
                        className="group flex items-center justify-between gap-2.5 rounded-md border border-border/80 bg-secondary/30 px-3 py-2 transition-colors hover:border-foreground/30 hover:bg-secondary/50 cursor-pointer"
                    >
                        <div className="flex items-center gap-2 min-w-0">
                            <code className="truncate font-mono text-xs text-foreground font-medium select-all">
                                {apiBase}
                            </code>
                        </div>

                        <button
                            type="button"
                            aria-label="Copy base URL"
                            className="inline-flex size-6 shrink-0 items-center justify-center rounded border border-border/70 bg-background text-muted-foreground transition-colors group-hover:text-foreground hover:border-foreground/40 cursor-pointer"
                        >
                            {copied ? (
                                <Check className="size-3 text-foreground" />
                            ) : (
                                <Copy className="size-3" />
                            )}
                        </button>
                    </div>
                </div>
            </div>

            {/* Bottom: Private Access / Tunneling */}
            <div className="mt-4 border-t border-border/60 pt-3">
                <div className="flex items-center justify-between gap-3 mb-2">
                    <div>
                        <h3 className="text-xs font-bold text-foreground">Private Access</h3>
                        <p className="mt-0.5 text-[10.5px] text-muted-foreground">
                            Encrypted tunnels for remote client connectivity
                        </p>
                    </div>
                </div>

                <div className="space-y-2">
                    {/* Cloudflare Tunnel Row */}
                    <div className="flex items-center justify-between gap-3 rounded-md border border-border/70 bg-secondary/20 p-2.5 transition-colors hover:border-foreground/20">
                        <div className="flex items-center gap-2.5 min-w-0">
                            <div className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border/80 bg-secondary text-foreground">
                                <CloudflareIcon className="size-3.5" />
                            </div>
                            <div className="min-w-0">
                                <div className="flex items-center gap-1.5">
                                    <p className="text-xs font-semibold text-foreground">
                                        Cloudflare Tunnel
                                    </p>
                                    {tunnel?.running && (
                                        <span className="flex items-center gap-1 text-[10px] font-semibold text-foreground font-mono">
                                            <span className="size-1.5 rounded-full bg-foreground" />
                                            Live
                                        </span>
                                    )}
                                </div>
                                <p className="mt-0.5 truncate text-[10.5px] text-muted-foreground font-mono">
                                    {tunnel?.running
                                        ? (tunnel.domain ?? "Active tunnel")
                                        : "Expose gateway without opening inbound ports"}
                                </p>
                            </div>
                        </div>

                        <button
                            type="button"
                            onClick={() => setModalOpen(true)}
                            className="inline-flex h-7 shrink-0 items-center gap-1 rounded border border-border/80 bg-background px-2.5 font-mono text-[11px] font-medium text-foreground transition-colors hover:bg-secondary cursor-pointer"
                        >
                            <span>{tunnel?.running ? "Manage" : "Configure"}</span>
                            <ArrowUpRight className="size-3 opacity-60" />
                        </button>
                    </div>

                    {/* Tailscale Row */}
                    <div className="flex items-center justify-between gap-3 rounded-md border border-border/50 bg-secondary/10 p-2.5 opacity-70">
                        <div className="flex items-center gap-2.5 min-w-0">
                            <div className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border/60 bg-secondary/40 text-foreground">
                                <TailscaleIcon className="size-3.5" />
                            </div>
                            <div className="min-w-0">
                                <p className="text-xs font-semibold text-foreground">Tailscale</p>
                                <p className="mt-0.5 truncate text-[10.5px] text-muted-foreground">
                                    Private mesh network access
                                </p>
                            </div>
                        </div>

                        <span className="text-[10px] font-mono uppercase text-muted-foreground/80">
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
            />
        </section>
    );
}
