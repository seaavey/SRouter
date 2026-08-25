import { useState, useEffect, useRef } from "react";
import { Loader2, Copy, Check, X, Key, Globe, ExternalLink } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { AuthPollStatus, type ProviderConfig, type ProviderDefinition } from "@srouter/types";
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
    const [patInput, setPatInput] = useState("");
    const [activeTab, setActiveTab] = useState<"oauth" | "pat">("oauth");
    const [error, setError] = useState("");
    const [authUrl, setAuthUrl] = useState("");
    const [oauthState, setOauthState] = useState("");
    const [isLoadingUrl, setIsLoadingUrl] = useState(false);
    const popupRef = useRef<Window | null>(null);

    const baseId = provider?.id.split("_")[0]?.split("-")[0] ?? provider?.id ?? "";
    const authProviderId = provider?.id === "codebuddy-cn" ? "codebuddy-cn" : baseId;
    const isQoder = baseId === "qoder";
    const isCodeBuddy = baseId === "codebuddy";
    const isPolling = isQoder || isCodeBuddy;

    // Fetch backend-registered PKCE OAuth session without auto-opening popup
    useEffect(() => {
        if (!open || !provider) {
            setAuthUrl("");
            setOauthState("");
            setError("");
            setCallbackUrlInput("");
            setPatInput("");
            if (popupRef.current && !popupRef.current.closed) {
                popupRef.current.close();
            }
            return;
        }

        setIsLoadingUrl(true);
        setError("");

        const providerEndpoint =
            baseId === "antigravity"
                ? "/v1/auth/antigravity/login?format=json"
                : baseId === "qoder"
                  ? "/v1/auth/qoder/login?format=json"
                  : baseId === "codebuddy"
                    ? `/v1/auth/${authProviderId}/login?format=json`
                    : baseId === "claude" || baseId === "anthropic"
                      ? "/v1/auth/claude/login?format=json"
                      : "/v1/auth/openai/login?format=json";

        api.get<OAuthLoginResponse>(providerEndpoint)
            .then((res) => {
                setAuthUrl(res.authorizeUrl);
                setOauthState(res.state);
                setIsLoadingUrl(false);
            })
            .catch((err: Error) => {
                setIsLoadingUrl(false);
                setError(err.message || "Failed to initiate OAuth login session");
            });
    }, [open, provider, baseId, authProviderId]);

    const handleOpenPopup = () => {
        if (!authUrl) return;
        try {
            const popup = window.open(
                authUrl,
                "_blank",
                "width=600,height=700,status=yes,scrollbars=yes"
            );
            popupRef.current = popup;
        } catch {
            // Popup blocked
        }
    };

    // Listen for postMessage from auto-closing popup window (for redirect-based OAuth)
    useEffect(() => {
        if (!open || !provider) return;

        const handleMessage = (event: MessageEvent) => {
            if (
                event.data &&
                typeof event.data === "object" &&
                event.data.type === "SROUTER_OAUTH_SUCCESS"
            ) {
                if (popupRef.current && !popupRef.current.closed) {
                    popupRef.current.close();
                }
                void queryClient.invalidateQueries({ queryKey: ["providers"] });
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

    // Active polling for Qoder and CodeBuddy Device/OAuth Flow
    useEffect(() => {
        if (!open || !provider || !isPolling || !oauthState) return;

        const interval = setInterval(async () => {
            try {
                const pollUrl =
                    baseId === "codebuddy"
                        ? `/v1/auth/${authProviderId}/poll?state=${encodeURIComponent(oauthState)}`
                        : `/v1/auth/qoder/poll?state=${encodeURIComponent(oauthState)}`;
                const res = await api.get<{ status: AuthPollStatus; provider?: ProviderConfig }>(
                    pollUrl
                );
                if (res && res.status === AuthPollStatus.OK) {
                    if (popupRef.current && !popupRef.current.closed) {
                        popupRef.current.close();
                    }
                    void queryClient.invalidateQueries({ queryKey: ["providers"] });
                    void queryClient.invalidateQueries({ queryKey: ["providers", provider.id] });
                    void queryClient.invalidateQueries({ queryKey: ["providers", "catalog"] });
                    onOpenChange(false);
                    setError("");
                }
            } catch {
                // Ignore poll errors until user completes flow
            }
        }, 2000);

        return () => clearInterval(interval);
    }, [open, provider, isPolling, baseId, authProviderId, oauthState, queryClient, onOpenChange]);

    const callbackMutation = useMutation({
        mutationFn: (payload: { callbackUrl: string }) => {
            const endpoint =
                baseId === "antigravity"
                    ? "/v1/auth/antigravity/callback"
                    : baseId === "qoder"
                      ? "/v1/auth/qoder/callback"
                      : "/v1/auth/openai/callback";
            return api.post(endpoint, payload);
        },
        onSuccess: () => {
            if (popupRef.current && !popupRef.current.closed) {
                popupRef.current.close();
            }
            if (provider) {
                void queryClient.invalidateQueries({ queryKey: ["providers"] });
                void queryClient.invalidateQueries({ queryKey: ["providers", provider.id] });
                void queryClient.invalidateQueries({ queryKey: ["providers", "catalog"] });
            }
            onOpenChange(false);
            setCallbackUrlInput("");
            setError("");
        },
        onError: (err: Error) => {
            setError(err.message || "Failed to process callback URL");
        }
    });

    const patMutation = useMutation({
        mutationFn: (payload: { accessToken: string }) => {
            const endpoint = `/v1/auth/${authProviderId}/token`;
            return api.post(endpoint, payload);
        },
        onSuccess: () => {
            if (provider) {
                void queryClient.invalidateQueries({ queryKey: ["providers"] });
                void queryClient.invalidateQueries({ queryKey: ["providers", provider.id] });
                void queryClient.invalidateQueries({ queryKey: ["providers", "catalog"] });
            }
            onOpenChange(false);
            setPatInput("");
            setError("");
        },
        onError: (err: Error) => {
            setError(err.message || "Failed to save token");
        }
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

    const handlePatSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!provider) return;

        const token = patInput.trim();
        if (!token) {
            setError("Please enter your token.");
            return;
        }

        setError("");
        patMutation.mutate({ accessToken: token });
    };

    if (!provider) return null;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md w-full p-5 bg-card border border-border/80 rounded-xl space-y-4 shadow-xl">
                {/* Window Header */}
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
                        className="text-muted-foreground hover:text-foreground p-1 rounded hover:bg-secondary transition-colors cursor-pointer"
                    >
                        <X className="size-4" />
                    </button>
                </div>

                {/* Optional Tab Switcher for Qoder or CodeBuddy */}
                {(isQoder || isCodeBuddy) && (
                    <div className="flex border-b border-border/60 text-xs font-mono">
                        <button
                            type="button"
                            onClick={() => setActiveTab("oauth")}
                            className={`flex items-center gap-1.5 px-3 py-1.5 border-b-2 transition-colors cursor-pointer ${
                                activeTab === "oauth"
                                    ? "border-foreground text-foreground font-semibold"
                                    : "border-transparent text-muted-foreground hover:text-foreground"
                            }`}
                        >
                            <Globe className="size-3.5" />
                            <span>Browser Login</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => setActiveTab("pat")}
                            className={`flex items-center gap-1.5 px-3 py-1.5 border-b-2 transition-colors cursor-pointer ${
                                activeTab === "pat"
                                    ? "border-foreground text-foreground font-semibold"
                                    : "border-transparent text-muted-foreground hover:text-foreground"
                            }`}
                        >
                            <Key className="size-3.5" />
                            <span>
                                {isCodeBuddy ? "Access Token" : "Personal Access Token (PAT)"}
                            </span>
                        </button>
                    </div>
                )}

                {error && (
                    <div className="rounded border border-destructive/40 bg-destructive/10 p-2.5 text-xs font-mono text-destructive">
                        {error}
                    </div>
                )}

                {activeTab === "oauth" ? (
                    <>
                        {/* Waiting State Banner */}
                        <div className="flex items-center gap-3 rounded-lg border border-border/60 bg-secondary/30 p-3 text-xs font-mono text-foreground">
                            <Loader2 className="size-4 text-orange-500 animate-spin shrink-0" />
                            <span>
                                {isLoadingUrl
                                    ? "Generating authorization session…"
                                    : isQoder
                                      ? "Waiting for Qoder browser authorization…"
                                      : isCodeBuddy
                                        ? "Waiting for CodeBuddy browser authorization…"
                                        : "Waiting for popup authorization…"}
                            </span>
                        </div>

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
                                        onClick={handleOpenPopup}
                                        disabled={!authUrl}
                                        className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-foreground text-background hover:opacity-90 px-3 py-2 text-xs font-semibold transition-all shrink-0 disabled:opacity-50 cursor-pointer"
                                    >
                                        <ExternalLink className="size-3.5" />
                                        <span>Open</span>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => void handleCopy()}
                                        disabled={!authUrl}
                                        className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-secondary/60 hover:bg-secondary px-3 py-2 text-xs font-semibold text-foreground transition-all shrink-0 disabled:opacity-50 cursor-pointer"
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

                            {!isPolling && (
                                <>
                                    {/* Step 2 for redirect-based OAuth */}
                                    <div className="space-y-1.5">
                                        <label className="font-semibold text-foreground block font-sans text-xs">
                                            Step 2: Paste the callback URL here (if not auto-closed)
                                        </label>
                                        <input
                                            type="text"
                                            placeholder="http://localhost:1455/auth/callback?code=...&state=..."
                                            value={callbackUrlInput}
                                            onChange={(e) => setCallbackUrlInput(e.target.value)}
                                            className="w-full rounded-lg border border-border/60 bg-secondary/30 px-3 py-2 text-xs font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                                        />
                                    </div>

                                    <div className="pt-3 border-t border-border/60 flex items-center justify-end gap-3 font-sans">
                                        <button
                                            type="button"
                                            onClick={() => onOpenChange(false)}
                                            className="px-4 py-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                                        >
                                            Cancel
                                        </button>
                                        <button
                                            type="submit"
                                            disabled={callbackMutation.isPending}
                                            className="rounded-lg bg-secondary hover:bg-foreground hover:text-background border border-border/60 text-foreground px-5 py-2 text-xs font-bold transition-all disabled:opacity-50 cursor-pointer"
                                        >
                                            {callbackMutation.isPending ? "Connecting…" : "Connect"}
                                        </button>
                                    </div>
                                </>
                            )}
                        </form>
                    </>
                ) : (
                    /* PAT Tab */
                    <form onSubmit={handlePatSubmit} className="space-y-4 text-xs font-mono">
                        <div className="space-y-1.5">
                            <label className="font-semibold text-foreground block font-sans text-xs">
                                {isCodeBuddy
                                    ? "CodeBuddy Access Token"
                                    : "Personal Access Token (PAT)"}
                            </label>
                            <p className="text-[11px] text-muted-foreground font-sans">
                                {isCodeBuddy ? (
                                    "Masukkan Access Token / Bearer Token dari akun CodeBuddy Anda."
                                ) : (
                                    <>
                                        Generate your PAT (`pt-...`) from{" "}
                                        <a
                                            href="https://qoder.com/account/integrations"
                                            target="_blank"
                                            rel="noreferrer"
                                            className="underline text-foreground"
                                        >
                                            qoder.com/account/integrations
                                        </a>
                                    </>
                                )}
                            </p>
                            <input
                                type="password"
                                placeholder={isCodeBuddy ? "eyJhbGciOi..." : "pt-..."}
                                value={patInput}
                                onChange={(e) => setPatInput(e.target.value)}
                                className="w-full rounded-lg border border-border/60 bg-secondary/30 px-3 py-2 text-xs font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                            />
                        </div>

                        <div className="pt-3 border-t border-border/60 flex items-center justify-end gap-3 font-sans">
                            <button
                                type="button"
                                onClick={() => onOpenChange(false)}
                                className="px-4 py-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                disabled={patMutation.isPending}
                                className="rounded-lg bg-secondary hover:bg-foreground hover:text-background border border-border/60 text-foreground px-5 py-2 text-xs font-bold transition-all disabled:opacity-50 cursor-pointer"
                            >
                                {patMutation.isPending
                                    ? "Connecting…"
                                    : isCodeBuddy
                                      ? "Connect CodeBuddy"
                                      : "Connect PAT"}
                            </button>
                        </div>
                    </form>
                )}
            </DialogContent>
        </Dialog>
    );
}
