import { useState, useEffect, useRef } from "react";
import {
    Loader2,
    Copy,
    Check,
    X,
    Key,
    Globe,
    ExternalLink,
    Layers,
    AlertCircle
} from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { AuthPollStatus, type ProviderConfig, type ProviderDefinition } from "@srouter/types";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ProviderIcon } from "@/components/providers";

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
    const [bulkInput, setBulkInput] = useState("");
    const [activeTab, setActiveTab] = useState<"oauth" | "pat" | "bulk">("oauth");
    const [error, setError] = useState("");
    const [authUrl, setAuthUrl] = useState("");
    const [oauthState, setOauthState] = useState("");
    const [isLoadingUrl, setIsLoadingUrl] = useState(false);
    const popupRef = useRef<Window | null>(null);

    const baseId = provider?.id.split("_")[0]?.split("-")[0] ?? provider?.id ?? "";
    const authProviderId = provider?.id === "codebuddy-cn" ? "codebuddy-cn" : baseId;
    const isQoder = baseId === "qoder";
    const isCodeBuddy = baseId === "codebuddy";
    const isCodex = baseId === "openai";
    const isPolling = isQoder || isCodeBuddy;
    const supportsBulk = isQoder || isCodex;

    // Fetch backend-registered PKCE OAuth session without auto-opening popup
    useEffect(() => {
        if (!open || !provider) {
            setAuthUrl("");
            setOauthState("");
            setError("");
            setCallbackUrlInput("");
            setPatInput("");
            setBulkInput("");
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
                toast.success(`${provider.name} connected successfully!`);
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
                    toast.success(`${provider.name} connected successfully!`);
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
                toast.success(`${provider.name} connected successfully!`);
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
            // Schema requires snake_case; handler mappers read camelCase (passthrough).
            return api.post(endpoint, {
                access_token: payload.accessToken,
                accessToken: payload.accessToken
            });
        },
        onSuccess: () => {
            if (provider) {
                void queryClient.invalidateQueries({ queryKey: ["providers"] });
                void queryClient.invalidateQueries({ queryKey: ["providers", provider.id] });
                void queryClient.invalidateQueries({ queryKey: ["providers", "catalog"] });
                toast.success(`Token for ${provider.name} saved successfully!`);
            }
            onOpenChange(false);
            setPatInput("");
            setError("");
        },
        onError: (err: Error) => {
            setError(err.message || "Failed to save token");
        }
    });

    const bulkMutation = useMutation({
        mutationFn: async (rawText: string) => {
            const lines = rawText
                .split(/\r?\n/)
                .map((l) => l.trim())
                .filter(Boolean);
            const results = await Promise.allSettled(
                lines.map((line) => {
                    // Codex lines may carry an optional refresh token: "<access>,<refresh>"
                    const [accessToken, refreshToken] = isCodex
                        ? line.split(",").map((s) => s.trim())
                        : [line];
                    return api.post(`/v1/auth/${authProviderId}/token`, {
                        access_token: accessToken,
                        accessToken,
                        ...(refreshToken
                            ? { refresh_token: refreshToken, refreshToken }
                            : {})
                    });
                })
            );
            const failed = results.filter((r) => r.status === "rejected").length;
            return { total: lines.length, failed };
        },
        onSuccess: ({ total, failed }) => {
            if (provider) {
                void queryClient.invalidateQueries({ queryKey: ["providers"] });
                void queryClient.invalidateQueries({ queryKey: ["providers", provider.id] });
                void queryClient.invalidateQueries({ queryKey: ["providers", "catalog"] });
            }
            const added = total - failed;
            if (added > 0) {
                toast.success(
                    `${added} account${added === 1 ? "" : "s"} added${failed ? ` · ${failed} failed` : ""}`
                );
            }
            if (failed === 0) {
                onOpenChange(false);
                setBulkInput("");
                setError("");
            } else if (added === 0) {
                setError(`All ${failed} token${failed === 1 ? "" : "s"} failed to import.`);
            }
        },
        onError: (err: Error) => {
            setError(err.message || "Bulk import failed");
        }
    });

    const handleBulkSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const lines = bulkInput
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter(Boolean);
        if (lines.length === 0) {
            setError("Paste at least one token, one per line.");
            return;
        }
        setError("");
        bulkMutation.mutate(bulkInput);
    };

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

    const tabsCount = (supportsBulk ? 3 : isQoder || isCodeBuddy ? 2 : 1);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md w-full p-6 bg-card border border-border/80 rounded-2xl space-y-4 shadow-2xl">
                {/* Header */}
                <DialogHeader className="flex flex-row items-center justify-between pb-3 border-b border-border/60">
                    <div className="flex items-center gap-2.5">
                        <ProviderIcon providerId={provider.id} className="size-6 rounded-md shadow-2xs" />
                        <div>
                            <DialogTitle className="text-sm font-bold tracking-tight text-foreground">
                                Connect {provider.name}
                            </DialogTitle>
                            <DialogDescription className="text-[11px] text-muted-foreground">
                                Authenticate and link your account
                            </DialogDescription>
                        </div>
                    </div>

                    <button
                        type="button"
                        onClick={() => onOpenChange(false)}
                        className="inline-flex size-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors cursor-pointer"
                        aria-label="Close dialog"
                    >
                        <X className="size-4" />
                    </button>
                </DialogHeader>

                {/* Segmented Tab Switcher */}
                {(isQoder || isCodeBuddy || supportsBulk) && (
                    <div
                        className={`grid w-full gap-1 rounded-lg border border-border/60 bg-secondary/30 p-1 text-xs ${
                            tabsCount === 3 ? "grid-cols-3" : "grid-cols-2"
                        }`}
                    >
                        <button
                            type="button"
                            onClick={() => setActiveTab("oauth")}
                            className={`flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-md font-medium transition-all cursor-pointer ${
                                activeTab === "oauth"
                                    ? "bg-card text-foreground shadow-xs font-semibold"
                                    : "text-muted-foreground hover:text-foreground"
                            }`}
                        >
                            <Globe className="size-3.5 shrink-0" />
                            <span className="truncate">Browser Login</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => setActiveTab("pat")}
                            className={`flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-md font-medium transition-all cursor-pointer ${
                                activeTab === "pat"
                                    ? "bg-card text-foreground shadow-xs font-semibold"
                                    : "text-muted-foreground hover:text-foreground"
                            }`}
                        >
                            <Key className="size-3.5 shrink-0" />
                            <span className="truncate">
                                {isCodeBuddy ? "Access Token" : "PAT Token"}
                            </span>
                        </button>
                        {supportsBulk && (
                            <button
                                type="button"
                                onClick={() => setActiveTab("bulk")}
                                className={`flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-md font-medium transition-all cursor-pointer ${
                                    activeTab === "bulk"
                                        ? "bg-card text-foreground shadow-xs font-semibold"
                                        : "text-muted-foreground hover:text-foreground"
                                }`}
                            >
                                <Layers className="size-3.5 shrink-0" />
                                <span className="truncate">Bulk Add</span>
                            </button>
                        )}
                    </div>
                )}

                {/* Error Banner */}
                {error && (
                    <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
                        <AlertCircle className="size-4 shrink-0 mt-0.5" />
                        <span className="font-mono">{error}</span>
                    </div>
                )}

                {activeTab === "bulk" ? (
                    /* Bulk Add Tab */
                    <form onSubmit={handleBulkSubmit} className="space-y-4 text-xs">
                        <div className="space-y-1.5">
                            <div className="flex items-center justify-between">
                                <label className="font-semibold text-foreground text-xs">
                                    Bulk {isCodex ? "Access Tokens" : "PATs"}
                                </label>
                                {bulkInput.split(/\r?\n/).filter((l) => l.trim()).length > 0 && (
                                    <span className="rounded-md bg-secondary px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
                                        {bulkInput.split(/\r?\n/).filter((l) => l.trim()).length} detected
                                    </span>
                                )}
                            </div>
                            <p className="text-[11px] text-muted-foreground leading-relaxed">
                                {isCodex ? (
                                    <>
                                        Paste one Codex access token per line. Format:{" "}
                                        <code className="rounded bg-secondary px-1 py-0.5 text-[10px] font-mono">
                                            access_token,refresh_token
                                        </code>
                                    </>
                                ) : (
                                    <>
                                        Paste multiple Qoder PATs (`pt-...`) from{" "}
                                        <a
                                            href="https://qoder.com/account/integrations"
                                            target="_blank"
                                            rel="noreferrer"
                                            className="underline text-foreground hover:text-primary transition-colors"
                                        >
                                            qoder.com/account/integrations
                                        </a>
                                        , one per line.
                                    </>
                                )}
                            </p>
                            <textarea
                                rows={5}
                                placeholder={isCodex ? "eyJhbGciOi...\neyJhbGciOi..." : "pt-xxx...\npt-yyy..."}
                                value={bulkInput}
                                onChange={(e) => setBulkInput(e.target.value)}
                                className="w-full resize-y rounded-lg border border-border/60 bg-secondary/20 px-3 py-2 text-xs font-mono text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring"
                            />
                        </div>

                        <div className="pt-2 border-t border-border/60 flex items-center justify-end gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => onOpenChange(false)}
                                className="h-8 text-xs cursor-pointer"
                            >
                                Cancel
                            </Button>
                            <Button
                                type="submit"
                                size="sm"
                                disabled={bulkMutation.isPending}
                                className="h-8 text-xs font-semibold cursor-pointer gap-1.5"
                            >
                                {bulkMutation.isPending && <Loader2 className="size-3.5 animate-spin" />}
                                {bulkMutation.isPending ? "Importing…" : "Import Accounts"}
                            </Button>
                        </div>
                    </form>
                ) : activeTab === "oauth" ? (
                    <>
                        {/* Live Waiting Status Banner */}
                        <div className="flex items-center gap-3 rounded-xl border border-amber-500/25 bg-amber-500/5 px-3.5 py-2.5 text-xs">
                            {isLoadingUrl ? (
                                <Loader2 className="size-4 text-amber-500 animate-spin shrink-0" />
                            ) : (
                                <div className="relative flex size-3 items-center justify-center shrink-0">
                                    <span className="absolute size-full rounded-full bg-amber-500/40 animate-ping" />
                                    <span className="size-2 rounded-full bg-amber-500" />
                                </div>
                            )}
                            <div className="flex-1 min-w-0">
                                <p className="font-medium text-foreground text-xs truncate">
                                    {isLoadingUrl
                                        ? "Generating authorization session…"
                                        : isQoder
                                          ? "Waiting for Qoder browser authorization…"
                                          : isCodeBuddy
                                            ? "Waiting for CodeBuddy browser authorization…"
                                            : "Waiting for browser authorization…"}
                                </p>
                                <p className="text-[10.5px] text-muted-foreground mt-0.5">
                                    Complete authorization in your browser window to link.
                                </p>
                            </div>
                        </div>

                        <form onSubmit={handleConnect} className="space-y-3.5 text-xs">
                            {/* Step 1: Open in Browser */}
                            <div className="space-y-2">
                                <label className="font-semibold text-foreground block text-xs">
                                    Step 1: Open authorization in browser
                                </label>
                                <Button
                                    type="button"
                                    onClick={handleOpenPopup}
                                    disabled={!authUrl || isLoadingUrl}
                                    className="w-full h-9 text-xs font-semibold gap-2 shadow-xs cursor-pointer"
                                >
                                    <ExternalLink className="size-3.5" />
                                    <span>Open {provider.name} Login Page</span>
                                </Button>
                            </div>

                            {/* Link Copy Box */}
                            <div className="space-y-1.5">
                                <div className="flex items-center justify-between text-[11px]">
                                    <span className="text-muted-foreground">Or copy authorization URL</span>
                                    <button
                                        type="button"
                                        onClick={() => void handleCopy()}
                                        disabled={!authUrl}
                                        className="inline-flex items-center gap-1 font-medium text-muted-foreground hover:text-foreground transition-colors cursor-pointer disabled:opacity-50"
                                    >
                                        {copied ? (
                                            <>
                                                <Check className="size-3 text-emerald-500" />
                                                <span className="text-emerald-500">Copied</span>
                                            </>
                                        ) : (
                                            <>
                                                <Copy className="size-3" />
                                                <span>Copy link</span>
                                            </>
                                        )}
                                    </button>
                                </div>
                                <div className="relative flex items-center">
                                    <input
                                        type="text"
                                        readOnly
                                        value={authUrl || "Generating authorization URL..."}
                                        className="w-full rounded-lg border border-border/60 bg-secondary/20 px-3 py-2 text-[11px] font-mono text-muted-foreground focus:outline-none select-all truncate"
                                    />
                                </div>
                            </div>

                            {!isPolling && (
                                <>
                                    {/* Step 2 for redirect-based OAuth */}
                                    <div className="space-y-1.5 pt-2 border-t border-border/60">
                                        <label className="font-semibold text-foreground block text-xs">
                                            Step 2: Paste callback URL (if not auto-closed)
                                        </label>
                                        <input
                                            type="text"
                                            placeholder="http://localhost:1455/auth/callback?code=...&state=..."
                                            value={callbackUrlInput}
                                            onChange={(e) => setCallbackUrlInput(e.target.value)}
                                            className="w-full rounded-lg border border-border/60 bg-secondary/20 px-3 py-2 text-xs font-mono text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring"
                                        />
                                    </div>

                                    <div className="pt-2 border-t border-border/60 flex items-center justify-end gap-2">
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            onClick={() => onOpenChange(false)}
                                            className="h-8 text-xs cursor-pointer"
                                        >
                                            Cancel
                                        </Button>
                                        <Button
                                            type="submit"
                                            size="sm"
                                            disabled={callbackMutation.isPending}
                                            className="h-8 text-xs font-semibold cursor-pointer gap-1.5"
                                        >
                                            {callbackMutation.isPending && (
                                                <Loader2 className="size-3.5 animate-spin" />
                                            )}
                                            {callbackMutation.isPending ? "Connecting…" : "Connect"}
                                        </Button>
                                    </div>
                                </>
                            )}
                        </form>
                    </>
                ) : (
                    /* PAT Tab */
                    <form onSubmit={handlePatSubmit} className="space-y-4 text-xs">
                        <div className="space-y-1.5">
                            <label className="font-semibold text-foreground block text-xs">
                                {isCodeBuddy
                                    ? "CodeBuddy Access Token"
                                    : isCodex
                                      ? "Codex Access Token"
                                      : "Personal Access Token (PAT)"}
                            </label>
                            <p className="text-[11px] text-muted-foreground leading-relaxed">
                                {isCodeBuddy ? (
                                    "Masukkan Access Token / Bearer Token dari akun CodeBuddy Anda."
                                ) : isCodex ? (
                                    "Paste an OpenAI Codex access token (from ~/.codex/auth.json)."
                                ) : (
                                    <>
                                        Generate your PAT (`pt-...`) from{" "}
                                        <a
                                            href="https://qoder.com/account/integrations"
                                            target="_blank"
                                            rel="noreferrer"
                                            className="underline text-foreground hover:text-primary transition-colors"
                                        >
                                            qoder.com/account/integrations
                                        </a>
                                    </>
                                )}
                            </p>
                            <input
                                type="password"
                                placeholder={
                                    isCodeBuddy || isCodex ? "eyJhbGciOi..." : "pt-..."
                                }
                                value={patInput}
                                onChange={(e) => setPatInput(e.target.value)}
                                className="w-full rounded-lg border border-border/60 bg-secondary/20 px-3 py-2 text-xs font-mono text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring"
                            />
                        </div>

                        <div className="pt-2 border-t border-border/60 flex items-center justify-end gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => onOpenChange(false)}
                                className="h-8 text-xs cursor-pointer"
                            >
                                Cancel
                            </Button>
                            <Button
                                type="submit"
                                size="sm"
                                disabled={patMutation.isPending}
                                className="h-8 text-xs font-semibold cursor-pointer gap-1.5"
                            >
                                {patMutation.isPending && (
                                    <Loader2 className="size-3.5 animate-spin" />
                                )}
                                {patMutation.isPending
                                    ? "Connecting…"
                                    : isCodeBuddy
                                      ? "Connect CodeBuddy"
                                      : "Connect PAT"}
                            </Button>
                        </div>
                    </form>
                )}
            </DialogContent>
        </Dialog>
    );
}
