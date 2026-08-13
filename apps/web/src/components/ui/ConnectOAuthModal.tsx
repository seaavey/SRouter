import { useState, useEffect } from "react";
import { Loader2, Copy, Check, X } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { ProviderDefinition } from "@srouter/types";
import { Dialog, DialogContent } from "@/components/ui/dialog";

interface ConnectOAuthModalProps {
    provider: ProviderDefinition | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

interface OAuthLoginResponse {
    authorizeUrl: string;
    state: string;
    codeVerifier: string;
    redirectUri: string;
}

export function ConnectOAuthModal({ provider, open, onOpenChange }: ConnectOAuthModalProps) {
    const queryClient = useQueryClient();
    const [copied, setCopied] = useState(false);
    const [callbackUrlInput, setCallbackUrlInput] = useState("");
    const [error, setError] = useState("");
    const [authUrl, setAuthUrl] = useState("");
    const [isLoadingUrl, setIsLoadingUrl] = useState(false);

    // Fetch backend-registered PKCE OAuth session & open popup
    useEffect(() => {
        if (!open || !provider) {
            setAuthUrl("");
            setError("");
            setCallbackUrlInput("");
            return;
        }

        setIsLoadingUrl(true);
        setError("");

        const providerEndpoint = provider.id.includes("antigravity")
            ? "/v1/auth/antigravity/login?format=json"
            : "/v1/auth/openai/login?format=json";

        api.get<OAuthLoginResponse>(providerEndpoint)
            .then((res) => {
                setAuthUrl(res.authorizeUrl);
                setIsLoadingUrl(false);
                try {
                    window.open(
                        res.authorizeUrl,
                        "_blank",
                        "width=600,height=700,status=yes,scrollbars=yes",
                    );
                } catch {
                    // Popup blocked
                }
            })
            .catch((err: Error) => {
                setIsLoadingUrl(false);
                setError(err.message || "Failed to initiate OAuth login session");
            });
    }, [open, provider]);

    // Listen for postMessage from auto-closing popup window
    useEffect(() => {
        if (!open || !provider) return;

        const handleMessage = (event: MessageEvent) => {
            if (
                event.data &&
                typeof event.data === "object" &&
                event.data.type === "SROUTER_OAUTH_SUCCESS"
            ) {
                void queryClient.invalidateQueries({ queryKey: ["providers", provider.id] });
                void queryClient.invalidateQueries({ queryKey: ["providers", "catalog"] });
                onOpenChange(false);
                setCallbackUrlInput("");
                setError("");
            }
        };

        window.addEventListener("message", handleMessage);
        return () => window.removeEventListener("message", handleMessage);
    }, [open, provider, queryClient, onOpenChange]);

    // Poll for provider connections while modal is open as fallback
    useEffect(() => {
        if (!open || !provider) return;

        const interval = setInterval(() => {
            void queryClient.invalidateQueries({ queryKey: ["providers", provider.id] });
        }, 2000);

        return () => clearInterval(interval);
    }, [open, provider, queryClient]);

    const callbackMutation = useMutation({
        mutationFn: (payload: { callbackUrl: string }) => {
            const endpoint = provider?.id.includes("antigravity")
                ? "/v1/auth/antigravity/callback"
                : "/v1/auth/openai/callback";
            return api.post(endpoint, payload);
        },
        onSuccess: () => {
            if (provider) {
                void queryClient.invalidateQueries({ queryKey: ["providers", provider.id] });
                void queryClient.invalidateQueries({ queryKey: ["providers", "catalog"] });
            }
            onOpenChange(false);
            setCallbackUrlInput("");
            setError("");
        },
        onError: (err: Error) => {
            setError(err.message || "Failed to process callback URL");
        },
    });

    const handleCopy = async () => {
        if (!authUrl) return;
        await navigator.clipboard.writeText(authUrl);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    };

    const handleConnect = (e: React.FormEvent) => {
        e.preventDefault();
        if (!provider) return;

        const input = callbackUrlInput.trim();
        if (!input) {
            setError("Please paste the callback URL from your browser.");
            return;
        }

        setError("");
        callbackMutation.mutate({ callbackUrl: input });
    };

    if (!provider) return null;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md w-full p-5 bg-card border border-border/80 rounded-xl space-y-4 shadow-xl">
                {/* Window Header (macOS control dots + title) */}
                <div className="flex items-center justify-between border-b border-border/60 pb-3">
                    <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1.5">
                            <span className="size-3 rounded-full bg-red-500/80 inline-block" />
                            <span className="size-3 rounded-full bg-amber-500/80 inline-block" />
                            <span className="size-3 rounded-full bg-emerald-500/80 inline-block" />
                        </div>
                        <h2 className="font-bold text-sm text-foreground ml-2">
                            Connect {provider.name}
                        </h2>
                    </div>

                    <button
                        type="button"
                        onClick={() => onOpenChange(false)}
                        className="text-muted-foreground hover:text-foreground p-1 rounded hover:bg-secondary transition-colors"
                    >
                        <X className="size-4" />
                    </button>
                </div>

                {/* Waiting State Banner */}
                <div className="flex items-center gap-3 rounded-lg border border-border/60 bg-secondary/30 p-3 text-xs font-mono text-foreground">
                    <Loader2 className="size-4 text-orange-500 animate-spin shrink-0" />
                    <span>
                        {isLoadingUrl
                            ? "Generating PKCE session…"
                            : "Waiting for popup authorization..."}
                    </span>
                </div>

                {/* Divider */}
                <div className="relative flex items-center justify-center my-2">
                    <div className="absolute inset-0 flex items-center">
                        <div className="w-full border-t border-border/60" />
                    </div>
                    <span className="relative bg-card px-2 text-[10px] font-mono uppercase text-muted-foreground tracking-wider">
                        Or Paste Callback URL Manually
                    </span>
                </div>

                {error && (
                    <div className="rounded border border-destructive/40 bg-destructive/10 p-2.5 text-xs font-mono text-destructive">
                        {error}
                    </div>
                )}

                <form onSubmit={handleConnect} className="space-y-4 text-xs font-mono">
                    {/* Step 1 */}
                    <div className="space-y-1.5">
                        <label className="font-semibold text-foreground block font-sans text-xs">
                            Step 1: Open this URL in your browser
                        </label>
                        <div className="flex items-center gap-2">
                            <input
                                type="text"
                                readOnly
                                value={authUrl || "Generating authorization URL..."}
                                className="w-full rounded-lg border border-border/60 bg-secondary/30 px-3 py-2 text-xs font-mono text-muted-foreground focus:outline-none truncate"
                            />
                            <button
                                type="button"
                                onClick={() => void handleCopy()}
                                disabled={!authUrl}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-secondary/60 hover:bg-secondary px-3 py-2 text-xs font-semibold text-foreground transition-all shrink-0 disabled:opacity-50"
                            >
                                {copied ? (
                                    <Check className="size-3.5 text-emerald-500" />
                                ) : (
                                    <Copy className="size-3.5" />
                                )}
                                <span>Copy</span>
                            </button>
                        </div>
                    </div>

                    {/* Step 2 */}
                    <div className="space-y-1.5">
                        <label className="font-semibold text-foreground block font-sans text-xs">
                            Step 2: Paste the callback URL here
                        </label>
                        <p className="text-[11px] text-muted-foreground font-sans">
                            After authorization, copy the full URL from your browser.
                        </p>
                        <input
                            type="text"
                            placeholder="http://localhost:1455/auth/callback?code=...&state=..."
                            value={callbackUrlInput}
                            onChange={(e) => setCallbackUrlInput(e.target.value)}
                            className="w-full rounded-lg border border-border/60 bg-secondary/30 px-3 py-2 text-xs font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                        />
                    </div>

                    {/* Modal Actions */}
                    <div className="pt-3 border-t border-border/60 flex items-center justify-end gap-3 font-sans">
                        <button
                            type="button"
                            onClick={() => onOpenChange(false)}
                            className="px-4 py-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={callbackMutation.isPending}
                            className="rounded-lg bg-secondary hover:bg-foreground hover:text-background border border-border/60 text-foreground px-5 py-2 text-xs font-bold transition-all disabled:opacity-50"
                        >
                            {callbackMutation.isPending ? "Connecting…" : "Connect"}
                        </button>
                    </div>
                </form>
            </DialogContent>
        </Dialog>
    );
}
