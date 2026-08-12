import { useState } from "react";
import { Check, Cloud, Copy, Network, Code2 } from "lucide-react";

const API_BASE = `${typeof window !== "undefined" ? window.location.origin : "http://localhost:3000"}/v1`;

function CopyButton({ text }: { text: string }) {
    const [copied, setCopied] = useState(false);

    async function handleCopy() {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    }

    return (
        <button
            type="button"
            onClick={() => void handleCopy()}
            aria-label="Copy snippet"
            className="flex items-center gap-1.5 rounded border border-border/60 bg-secondary/50 px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
            {copied ? (
                <>
                    <Check className="size-3 text-emerald-500" />
                    <span className="text-emerald-500">Copied</span>
                </>
            ) : (
                <>
                    <Copy className="size-3" />
                    <span>Copy</span>
                </>
            )}
        </button>
    );
}

export function NetworkStatus() {
    const [activeTab, setActiveTab] = useState<"curl" | "node" | "python">("curl");

    const snippets = {
        curl: `curl ${API_BASE}/chat/completions \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gpt-4o-mini",
    "messages": [{"role": "user", "content": "Hello SRouter!"}]
  }'`,
        node: `import OpenAI from "openai";

const openai = new OpenAI({
  baseURL: "${API_BASE}",
  apiKey: "srouter-key",
});

const response = await openai.chat.completions.create({
  model: "gpt-4o-mini",
  messages: [{ role: "user", content: "Hello SRouter!" }],
});`,
        python: `from openai import OpenAI

client = OpenAI(
    base_url="${API_BASE}",
    api_key="srouter-key"
)

response = client.chat.completions.create(
    model="gpt-4o-mini",
    messages=[{"role": "user", "content": "Hello SRouter!"}]
)`,
    };

    return (
        <div className="rounded-lg border border-border/70 bg-card overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border/60 bg-secondary/30 px-4 py-3">
                <div className="flex items-center gap-2">
                    <Code2 className="size-4 text-muted-foreground" />
                    <span className="text-xs font-semibold text-foreground">API Integration & Endpoint</span>
                    <span className="font-mono text-[10px] text-muted-foreground border border-border/60 px-1.5 py-0.2 rounded">
                        OpenAI-compatible
                    </span>
                </div>

                <CopyButton text={API_BASE} />
            </div>

            <div className="p-4 space-y-4">
                {/* Integration Code Tabs */}
                <div className="rounded border border-border/60 bg-secondary/20 overflow-hidden">
                    <div className="flex items-center justify-between border-b border-border/50 px-3 py-1.5 bg-secondary/40">
                        <div className="flex items-center gap-1 font-mono text-xs">
                            <button
                                type="button"
                                onClick={() => setActiveTab("curl")}
                                className={`px-2 py-0.5 rounded text-xs transition-colors ${
                                    activeTab === "curl"
                                        ? "bg-background text-foreground font-semibold border border-border/60"
                                        : "text-muted-foreground hover:text-foreground"
                                }`}
                            >
                                cURL
                            </button>
                            <button
                                type="button"
                                onClick={() => setActiveTab("node")}
                                className={`px-2 py-0.5 rounded text-xs transition-colors ${
                                    activeTab === "node"
                                        ? "bg-background text-foreground font-semibold border border-border/60"
                                        : "text-muted-foreground hover:text-foreground"
                                }`}
                            >
                                Node.js
                            </button>
                            <button
                                type="button"
                                onClick={() => setActiveTab("python")}
                                className={`px-2 py-0.5 rounded text-xs transition-colors ${
                                    activeTab === "python"
                                        ? "bg-background text-foreground font-semibold border border-border/60"
                                        : "text-muted-foreground hover:text-foreground"
                                }`}
                            >
                                Python
                            </button>
                        </div>
                        <CopyButton text={snippets[activeTab]} />
                    </div>

                    <pre className="p-3 overflow-x-auto text-xs font-mono text-foreground leading-relaxed">
                        <code>{snippets[activeTab]}</code>
                    </pre>
                </div>

                {/* Network Tunnels Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                    <div className="flex items-center justify-between gap-3 rounded border border-border/60 bg-secondary/20 p-3">
                        <div className="flex items-center gap-2.5">
                            <Cloud className="size-4 text-muted-foreground" />
                            <div>
                                <div className="font-medium text-foreground">Cloudflare Tunnel</div>
                                <div className="text-[11px] text-muted-foreground">Expose gateway ke internet publik.</div>
                            </div>
                        </div>
                        <span className="font-mono text-[10px] text-muted-foreground">Off</span>
                    </div>

                    <div className="flex items-center justify-between gap-3 rounded border border-border/60 bg-secondary/20 p-3">
                        <div className="flex items-center gap-2.5">
                            <Network className="size-4 text-muted-foreground" />
                            <div>
                                <div className="font-medium text-foreground">Tailscale</div>
                                <div className="text-[11px] text-muted-foreground">Internal mesh VPN router.</div>
                            </div>
                        </div>
                        <span className="font-mono text-[10px] text-muted-foreground">Off</span>
                    </div>
                </div>
            </div>
        </div>
    );
}
