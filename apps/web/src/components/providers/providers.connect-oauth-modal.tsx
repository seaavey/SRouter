import { useEffect, useMemo, useRef, useState } from "react";
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
import { type OAuthFlowConfig, default as resolveOAuthFlow } from "./providers.oauth-flow";

interface ConnectOAuthModalProps {
    provider: ProviderDefinition | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

interface ClineDeviceResponse {
    authorizeUrl: string;
    state: string;
    userCode: string;
    expiresIn: number;
    interval: number;
}

interface OAuthLoginResponse {
    authorizeUrl: string;
    state: string;
    codeVerifier: string;
    redirectUri: string;
}

const BTN_SECONDARY =
    "rounded-full px-4 h-9 text-xs font-semibold cursor-pointer border-hairline bg-canvas hover:bg-canvas-soft text-ink shadow-none";
const BTN_PRIMARY =
    "rounded-full px-5 h-9 text-xs font-semibold cursor-pointer gap-1.5 shadow-none";
const INPUT_FIELD =
    "w-full rounded-2xl border-0 bg-field px-4 py-2.5 text-xs font-mono text-ink placeholder:text-text-faint focus-visible:ring-2 focus-visible:ring-ink focus-visible:outline-none shadow-none";
const POLL_INTERVAL_MS = 2000;

/** Query keys yang dibersihkan setiap kali status koneksi provider berubah. */
function invalidateProviderQueries(
    queryClient: ReturnType<typeof useQueryClient>,
    providerId?: string
) {
    void queryClient.invalidateQueries({ queryKey: ["providers"] });
    void queryClient.invalidateQueries({ queryKey: ["providers", providerId] });
    void queryClient.invalidateQueries({ queryKey: ["providers", "catalog"] });
    void queryClient.invalidateQueries({ queryKey: ["models"] });
}

/** ID dasar untuk pemetaan alur auth; "codebuddy-cn" dipertahankan utuh. */
function authProviderIdOf(providerId: string): string {
    return providerId === "codebuddy-cn" ? "codebuddy-cn" : providerId.split("_")[0].split("-")[0];
}

type ConnectTab = "oauth" | "pat" | "bulk";

function closePopupIfOpen(popupRef: React.RefObject<Window | null>) {
    if (popupRef.current && !popupRef.current.closed) {
        popupRef.current.close();
    }
}

function splitTokenLines(rawText: string): string[] {
    return rawText
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
}

export default function ConnectOAuthModal({
    provider,
    open,
    onOpenChange
}: ConnectOAuthModalProps) {
    const queryClient = useQueryClient();
    const [copied, setCopied] = useState(false);
    const [callbackUrlInput, setCallbackUrlInput] = useState("");
    const [patInput, setPatInput] = useState("");
    const [bulkInput, setBulkInput] = useState("");
    const [activeTab, setActiveTab] = useState<ConnectTab>("oauth");
    const [error, setError] = useState("");
    const [authUrl, setAuthUrl] = useState("");
    const [oauthState, setOauthState] = useState("");
    const [clineUserCode, setClineUserCode] = useState("");
    const [isLoadingUrl, setIsLoadingUrl] = useState(false);
    const popupRef = useRef<Window | null>(null);

    const providerId = provider?.id;
    const providerName = provider?.name;
    const flow: OAuthFlowConfig = useMemo(
        () => resolveOAuthFlow(providerId ? authProviderIdOf(providerId) : ""),
        [providerId]
    );
    const isPolling = Boolean(flow.pollEndpoint);
    const supportsBulk = Boolean(flow.bulkTab);
    const hasTabs = isPolling || supportsBulk;

    // Fetch backend-registered PKCE OAuth session without auto-opening popup
    useEffect(() => {
        if (!open || !providerId) {
            setAuthUrl("");
            setOauthState("");
            setClineUserCode("");
            setError("");
            setCallbackUrlInput("");
            setPatInput("");
            setBulkInput("");
            closePopupIfOpen(popupRef);
            return;
        }

        // Tab dan input direset per sesi modal; "bulk"/"pat" hanya valid bila provider mendukungnya.
        setActiveTab("oauth");
        setIsLoadingUrl(true);
        setError("");

        // Effect-scope cancelled flag: sesi modal dibatalkan saat modal ditutup atau provider berganti.
        let cancelled = false;
        api.get<ClineDeviceResponse | OAuthLoginResponse>(flow.loginEndpoint)
            .then((res) => {
                if (cancelled) return;
                setAuthUrl(res.authorizeUrl);
                setOauthState(res.state);
                setClineUserCode("userCode" in res ? res.userCode : "");
                setIsLoadingUrl(false);
            })
            .catch((err: unknown) => {
                if (cancelled) return;
                setIsLoadingUrl(false);
                setError(
                    err instanceof Error ? err.message : "Failed to initiate OAuth login session"
                );
            });
        return () => {
            cancelled = true;
        };
    }, [open, providerId, flow]);

    const handleOpenPopup = () => {
        if (!authUrl) return;
        const popup = window.open(
            authUrl,
            "_blank",
            "width=600,height=700,status=yes,scrollbars=yes"
        );
        popupRef.current = popup;
        if (!popup) {
            setError("Popup blocked by the browser — use Copy link to open the authorization URL.");
        }
    };

    // Listen for postMessage from auto-closing popup window (for redirect-based OAuth)
    useEffect(() => {
        if (!open || !providerId) return;

        const handleMessage = (event: MessageEvent) => {
            if (
                event.data &&
                typeof event.data === "object" &&
                event.data.type === "SROUTER_OAUTH_SUCCESS"
            ) {
                closePopupIfOpen(popupRef);
                invalidateProviderQueries(queryClient, providerId);
                toast.success(`${providerName ?? "Provider"} connected successfully!`);
                onOpenChange(false);
                setCallbackUrlInput("");
                setError("");
            }
        };

        window.addEventListener("message", handleMessage);
        return () => window.removeEventListener("message", handleMessage);
    }, [open, providerId, providerName, queryClient, onOpenChange]);

    // Active polling for device/OAuth flows (Qoder, CodeBuddy, Cline)
    useEffect(() => {
        if (!open || !providerId || !flow.pollEndpoint || !oauthState) return;

        const interval = setInterval(async () => {
            try {
                const res = await api.get<{ status: AuthPollStatus; provider?: ProviderConfig }>(
                    `${flow.pollEndpoint}?state=${encodeURIComponent(oauthState)}`
                );
                if (res && res.status === AuthPollStatus.OK) {
                    closePopupIfOpen(popupRef);
                    invalidateProviderQueries(queryClient, providerId);
                    toast.success(`${providerName ?? "Provider"} connected successfully!`);
                    onOpenChange(false);
                    setError("");
                }
            } catch {
                // Ignore poll errors until user completes flow
            }
        }, POLL_INTERVAL_MS);

        return () => clearInterval(interval);
    }, [open, providerId, providerName, flow, oauthState, queryClient, onOpenChange]);

    const callbackMutation = useMutation({
        mutationFn: (payload: { callback_url: string }) =>
            api.post(flow.callbackEndpoint ?? "/v1/auth/openai/callback", payload),
        onSuccess: () => {
            closePopupIfOpen(popupRef);
            if (provider) {
                invalidateProviderQueries(queryClient, provider.id);
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
        mutationFn: (payload: { access_token: string }) => {
            const endpoint = `/v1/auth/${authProviderIdOf(provider?.id ?? "")}/token`;
            return api.post(endpoint, payload);
        },
        onSuccess: () => {
            if (provider) {
                invalidateProviderQueries(queryClient, provider.id);
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
            const lines = splitTokenLines(rawText);
            const tokenEndpoint = `/v1/auth/${authProviderIdOf(provider?.id ?? "")}/token`;
            const results = await Promise.allSettled(
                lines.map((line) => {
                    // Baris dapat membawa refresh token opsional: "<access>,<refresh>" (Codex).
                    const [access_token, refresh_token] = flow.bulkTab?.parsePair
                        ? line.split(",").map((s) => s.trim())
                        : [line];
                    return api.post(tokenEndpoint, {
                        access_token,
                        ...(refresh_token ? { refresh_token } : {})
                    });
                })
            );
            const failed = results.filter((r) => r.status === "rejected").length;
            return { total: lines.length, failed };
        },
        onSuccess: ({ total, failed }) => {
            if (provider) {
                invalidateProviderQueries(queryClient, provider.id);
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
        if (splitTokenLines(bulkInput).length === 0) {
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
        callbackMutation.mutate({ callback_url: input });
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
        patMutation.mutate({ access_token: token });
    };

    if (!provider) return null;

    const tabsCount = supportsBulk ? 3 : isPolling ? 2 : 1;
    const bulkLines = splitTokenLines(bulkInput).length;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md w-full p-6 md:p-8 bg-canvas border border-hairline-soft rounded-3xl space-y-5 shadow-none overflow-y-auto max-h-[calc(100dvh-2rem)] font-sans">
                <DialogHeader className="flex flex-row items-center justify-between pb-3.5 border-b border-hairline-soft">
                    <div className="flex items-center gap-3">
                        <ProviderIcon
                            providerId={provider.id}
                            providerUrl={
                                provider.category === "custom_provider"
                                    ? provider.default_base_url
                                    : undefined
                            }
                            className="size-7 rounded-[30%]"
                        />
                        <div>
                            <DialogTitle className="text-base font-bold tracking-tight text-ink font-sans">
                                Connect {provider.name}.
                            </DialogTitle>
                            <DialogDescription className="text-xs text-text-muted">
                                Authenticate and link your account
                            </DialogDescription>
                        </div>
                    </div>

                    <button
                        type="button"
                        onClick={() => onOpenChange(false)}
                        className="inline-flex size-8 items-center justify-center rounded-full text-text-muted hover:bg-canvas-soft hover:text-ink transition-colors cursor-pointer"
                        aria-label="Close dialog"
                    >
                        <X className="size-4" aria-hidden="true" />
                    </button>
                </DialogHeader>
                {hasTabs && (
                    <div
                        className={`grid w-full gap-1 rounded-full border border-hairline-soft bg-canvas-soft p-1 text-xs ${
                            tabsCount === 3 ? "grid-cols-3" : "grid-cols-2"
                        }`}
                    >
                        <button
                            type="button"
                            onClick={() => setActiveTab("oauth")}
                            className={`flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-full font-medium transition-all cursor-pointer ${
                                activeTab === "oauth"
                                    ? "bg-ink text-canvas font-semibold shadow-none"
                                    : "text-text-muted hover:text-ink hover:bg-canvas/40"
                            }`}
                        >
                            <Globe className="size-3.5 shrink-0" aria-hidden="true" />
                            <span className="truncate">Browser Login</span>
                        </button>
                        {flow.patTab && (
                            <button
                                type="button"
                                onClick={() => setActiveTab("pat")}
                                className={`flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-full font-medium transition-all cursor-pointer ${
                                    activeTab === "pat"
                                        ? "bg-ink text-canvas font-semibold shadow-none"
                                        : "text-text-muted hover:text-ink hover:bg-canvas/40"
                                }`}
                            >
                                <Key className="size-3.5 shrink-0" aria-hidden="true" />
                                <span className="truncate">{flow.patTab.tabLabel}</span>
                            </button>
                        )}
                        {supportsBulk && (
                            <button
                                type="button"
                                onClick={() => setActiveTab("bulk")}
                                className={`flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-full font-medium transition-all cursor-pointer ${
                                    activeTab === "bulk"
                                        ? "bg-ink text-canvas font-semibold shadow-none"
                                        : "text-text-muted hover:text-ink hover:bg-canvas/40"
                                }`}
                            >
                                <Layers className="size-3.5 shrink-0" aria-hidden="true" />
                                <span className="truncate">Bulk Add</span>
                            </button>
                        )}
                    </div>
                )}
                {error && (
                    <div className="flex items-start gap-2.5 rounded-2xl border border-destructive/30 bg-destructive/10 p-3.5 text-xs text-destructive">
                        <AlertCircle className="size-4 shrink-0 mt-0.5" aria-hidden="true" />
                        <span className="font-mono">{error}</span>
                    </div>
                )}

                {activeTab === "bulk" && flow.bulkTab ? (
                    /* Bulk Add Tab */
                    <form onSubmit={handleBulkSubmit} className="space-y-4 text-xs">
                        <div className="space-y-1.5">
                            <div className="flex items-center justify-between">
                                <label className="font-semibold text-ink text-xs">
                                    {flow.bulkTab.fieldLabel}
                                </label>
                                {bulkLines > 0 && (
                                    <span className="rounded-full bg-field px-2 py-0.5 text-[10px] font-mono text-text-muted">
                                        {bulkLines} detected
                                    </span>
                                )}
                            </div>
                            <p className="text-xs text-text-muted leading-relaxed">
                                {flow.bulkTab.description}
                            </p>
                            <textarea
                                rows={5}
                                placeholder={flow.bulkTab.placeholder}
                                value={bulkInput}
                                onChange={(e) => setBulkInput(e.target.value)}
                                className={INPUT_FIELD}
                            />
                        </div>

                        <div className="pt-3 border-t border-hairline-soft flex items-center justify-end gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => onOpenChange(false)}
                                className={BTN_SECONDARY}
                            >
                                Cancel
                            </Button>
                            <Button
                                type="submit"
                                size="sm"
                                disabled={bulkMutation.isPending}
                                className={BTN_PRIMARY}
                            >
                                {bulkMutation.isPending && (
                                    <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                                )}
                                {bulkMutation.isPending ? "Importing…" : "Import Accounts"}
                            </Button>
                        </div>
                    </form>
                ) : activeTab === "oauth" || !flow.patTab ? (
                    <>
                        <div className="flex items-center gap-3 rounded-2xl border border-amber-500/25 bg-amber-500/5 px-4 py-3 text-xs">
                            {isLoadingUrl ? (
                                <Loader2
                                    className="size-4 text-amber-500 animate-spin shrink-0"
                                    aria-hidden="true"
                                />
                            ) : (
                                <div className="relative flex size-3 items-center justify-center shrink-0">
                                    <span className="absolute size-full rounded-full bg-amber-500/40 animate-ping" />
                                    <span className="size-2 rounded-full bg-amber-500" />
                                </div>
                            )}
                            <div className="flex-1 min-w-0">
                                <p className="font-semibold text-ink text-xs truncate">
                                    {isLoadingUrl
                                        ? "Generating authorization session…"
                                        : flow.waitingLabel}
                                </p>
                                <p className="text-xs text-text-muted mt-0.5">
                                    {clineUserCode
                                        ? `Enter code ${clineUserCode} in the browser if requested.`
                                        : "Complete authorization in your browser window to link."}
                                </p>
                            </div>
                        </div>

                        <form onSubmit={handleConnect} className="space-y-4 text-xs">
                            <div className="space-y-2">
                                <label className="font-semibold text-ink block text-xs">
                                    Step 1: Open authorization in browser
                                </label>
                                <Button
                                    type="button"
                                    onClick={handleOpenPopup}
                                    disabled={!authUrl || isLoadingUrl}
                                    className="w-full h-10 rounded-full text-xs font-semibold gap-2 shadow-none cursor-pointer"
                                >
                                    <ExternalLink className="size-3.5" aria-hidden="true" />
                                    <span>Open {provider.name} Login Page</span>
                                </Button>
                            </div>
                            <div className="space-y-1.5">
                                <div className="flex items-center justify-between text-xs">
                                    <span className="text-text-muted">
                                        Or copy authorization URL
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => void handleCopy()}
                                        disabled={!authUrl}
                                        className="inline-flex items-center gap-1 font-semibold text-text-muted hover:text-ink transition-colors cursor-pointer disabled:opacity-50"
                                    >
                                        {copied ? (
                                            <>
                                                <Check
                                                    className="size-3 text-emerald-500"
                                                    aria-hidden="true"
                                                />
                                                <span className="text-emerald-500">Copied</span>
                                            </>
                                        ) : (
                                            <>
                                                <Copy className="size-3" aria-hidden="true" />
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
                                        className="w-full rounded-2xl border-0 bg-field px-4 py-2.5 text-xs font-mono text-text-muted focus:outline-none select-all truncate"
                                    />
                                </div>
                            </div>

                            {!isPolling && (
                                <>
                                    <div className="space-y-1.5 pt-3 border-t border-hairline-soft">
                                        <label className="font-semibold text-ink block text-xs">
                                            Step 2: Paste callback URL (if not auto-closed)
                                        </label>
                                        <input
                                            type="text"
                                            placeholder="http://localhost:1455/auth/callback?code=...&state=..."
                                            value={callbackUrlInput}
                                            onChange={(e) => setCallbackUrlInput(e.target.value)}
                                            className={INPUT_FIELD}
                                        />
                                    </div>

                                    <div className="pt-3 border-t border-hairline-soft flex items-center justify-end gap-2">
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            onClick={() => onOpenChange(false)}
                                            className={BTN_SECONDARY}
                                        >
                                            Cancel
                                        </Button>
                                        <Button
                                            type="submit"
                                            size="sm"
                                            disabled={callbackMutation.isPending}
                                            className={BTN_PRIMARY}
                                        >
                                            {callbackMutation.isPending && (
                                                <Loader2
                                                    className="size-3.5 animate-spin"
                                                    aria-hidden="true"
                                                />
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
                                {flow.patTab.fieldLabel}
                            </label>
                            <p className="text-[11px] text-muted-foreground leading-relaxed">
                                {flow.patTab.description}
                            </p>
                            <input
                                type="password"
                                autoComplete="off"
                                autoCorrect="off"
                                autoCapitalize="off"
                                spellCheck={false}
                                placeholder={flow.patTab.placeholder}
                                value={patInput}
                                onChange={(e) => setPatInput(e.target.value)}
                                className={INPUT_FIELD}
                            />
                        </div>

                        <div className="pt-3 border-t border-hairline-soft flex items-center justify-end gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => onOpenChange(false)}
                                className={BTN_SECONDARY}
                            >
                                Cancel
                            </Button>
                            <Button
                                type="submit"
                                size="sm"
                                disabled={patMutation.isPending}
                                className={BTN_PRIMARY}
                            >
                                {patMutation.isPending && (
                                    <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                                )}
                                {patMutation.isPending ? "Connecting…" : flow.patTab.submitLabel}
                            </Button>
                        </div>
                    </form>
                )}
            </DialogContent>
        </Dialog>
    );
}
