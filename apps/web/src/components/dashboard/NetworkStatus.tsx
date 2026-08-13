import { useState } from "react";
import { Check, Cloud, Code2, Copy, Network } from "lucide-react";
import { toast } from "sonner";

const API_BASE = `${typeof window !== "undefined" ? window.location.origin : "http://localhost:3000"}/v1`;

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
    const [copied, setCopied] = useState(false);

    async function handleCopy() {
        try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            toast.success("Base URL copied", {
                description: "Paste it into any OpenAI-compatible client.",
            });
            setTimeout(() => setCopied(false), 1500);
        } catch {
            toast.error("Could not copy Base URL");
        }
    }

    return (
        <button
            type="button"
            onClick={() => void handleCopy()}
            aria-label={`${label} to clipboard`}
            className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-border/70 bg-background/70 px-2.5 text-[11px] font-semibold text-muted-foreground transition-[color,background-color,transform] hover:bg-secondary hover:text-foreground active:translate-y-px"
        >
            {copied ? <Check className="size-3 text-emerald-500" /> : <Copy className="size-3" />}
            <span className={copied ? "text-emerald-500" : undefined}>
                {copied ? "Copied" : label}
            </span>
        </button>
    );
}

export function NetworkStatus() {
    return (
        <section
            aria-labelledby="api-integration-title"
            className="flex min-w-0 flex-col overflow-hidden bg-card/30"
        >
            <div className="p-4">
                <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-secondary/45 shadow-xs">
                            <Code2 className="size-4 text-foreground" strokeWidth={1.75} />
                        </div>
                        <div className="min-w-0">
                            <h2
                                id="api-integration-title"
                                className="text-xs font-semibold tracking-tight text-foreground"
                            >
                                API integration
                            </h2>
                            <p className="mt-0.5 text-[10px] text-muted-foreground">
                                Connect any OpenAI-compatible client
                            </p>
                        </div>
                    </div>
                    <span className="shrink-0 rounded-full border border-border/60 bg-secondary/30 px-2 py-1 font-mono text-[9px] text-muted-foreground">
                        OpenAI
                    </span>
                </div>

                <div className="mt-4 rounded-lg border border-border/60 bg-background/60 p-3 shadow-xs">
                    <div className="flex items-center justify-between gap-3">
                        <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                            Base URL
                        </span>
                        <CopyButton text={API_BASE} label="Copy" />
                    </div>
                    <code className="mt-3 block truncate font-mono text-[11px] text-foreground">
                        {API_BASE}
                    </code>
                </div>
            </div>

            <div className="border-t border-border/60 px-4 pb-4 pt-3.5">
                <div className="mb-2.5 flex items-center justify-between gap-3 px-0.5">
                    <div>
                        <h3 className="text-[11px] font-semibold text-foreground">
                            Private access
                        </h3>
                        <p className="mt-0.5 text-[9px] text-muted-foreground">
                            Secure routes for remote clients
                        </p>
                    </div>
                    <span className="font-mono text-[8px] uppercase tracking-[0.14em] text-muted-foreground">
                        Optional
                    </span>
                </div>

                <div className="overflow-hidden rounded-lg border border-border/60 bg-background/35">
                    <div className="group flex items-center gap-3 px-3 py-3 transition-colors hover:bg-secondary/25">
                        <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-secondary/50 text-muted-foreground transition-colors group-hover:text-foreground">
                            <Cloud className="size-3.5" strokeWidth={1.75} />
                        </div>
                        <div className="min-w-0 flex-1">
                            <p className="text-[11px] font-medium text-foreground">
                                Cloudflare Tunnel
                            </p>
                            <p className="mt-0.5 truncate text-[9px] text-muted-foreground">
                                Expose the gateway without opening ports
                            </p>
                        </div>
                        <span className="flex shrink-0 items-center gap-1.5 rounded-full border border-border/60 bg-secondary/20 px-2 py-1 font-mono text-[8px] text-muted-foreground">
                            <span
                                className="size-1 rounded-full bg-muted-foreground/50"
                                aria-hidden="true"
                            />
                            Off
                        </span>
                    </div>

                    <div className="group flex items-center gap-3 border-t border-border/50 px-3 py-3 transition-colors hover:bg-secondary/25">
                        <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-secondary/50 text-muted-foreground transition-colors group-hover:text-foreground">
                            <Network className="size-3.5" strokeWidth={1.75} />
                        </div>
                        <div className="min-w-0 flex-1">
                            <p className="text-[11px] font-medium text-foreground">Tailscale</p>
                            <p className="mt-0.5 truncate text-[9px] text-muted-foreground">
                                Reach SRouter through your private mesh
                            </p>
                        </div>
                        <span className="flex shrink-0 items-center gap-1.5 rounded-full border border-border/60 bg-secondary/20 px-2 py-1 font-mono text-[8px] text-muted-foreground">
                            <span
                                className="size-1 rounded-full bg-muted-foreground/50"
                                aria-hidden="true"
                            />
                            Off
                        </span>
                    </div>
                </div>
            </div>
        </section>
    );
}
