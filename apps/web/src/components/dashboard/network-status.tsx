import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";

const API_BASE = `${typeof window !== "undefined" ? window.location.origin : "http://localhost:3000"}/v1`;

export function NetworkStatus() {
    const [copied, setCopied] = useState(false);

    async function handleCopy() {
        try {
            await navigator.clipboard.writeText(API_BASE);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
        } catch {
            setCopied(false);
        }
    }

    return (
        <section className="min-w-0 py-5 pl-0 lg:pl-6" aria-labelledby="gateway-endpoint-title">
            <header>
                <h2 id="gateway-endpoint-title" className="text-sm font-semibold text-foreground">
                    Client endpoint
                </h2>
                <p className="mt-0.5 text-[11px] text-muted-foreground">OpenAI-compatible base URL for local clients</p>
            </header>

            <div className="mt-5">
                <p className="text-[10px] font-medium text-muted-foreground">Base URL</p>
                <div className="mt-2 flex min-w-0 items-center gap-3 border-b border-border/70 pb-2">
                    <code className="min-w-0 flex-1 truncate text-xs text-foreground" title={API_BASE}>
                        {API_BASE}
                    </code>
                    <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        onClick={() => void handleCopy()}
                        aria-label="Copy gateway base URL"
                        className="font-mono text-muted-foreground hover:text-foreground"
                    >
                        {copied ? <Check className="text-emerald-500" /> : <Copy />}
                        {copied ? "Copied" : "Copy URL"}
                    </Button>
                </div>
            </div>

            <p className="mt-4 max-w-sm text-[11px] leading-relaxed text-muted-foreground">
                Set this as your SDK <code className="text-foreground">baseURL</code>, then authenticate with an SRouter API key.
            </p>
        </section>
    );
}
