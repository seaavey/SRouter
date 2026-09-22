import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AuthPollStatus, type ProviderConfig, type ProviderDefinition } from "@srouter/types";
import { api } from "@/lib/api";
import resolveOAuthFlow, {
    type OAuthFlowConfig
} from "@/components/providers/providers.oauth-flow";
import { authProviderIdOf, splitTokenLines } from "@/utils/provider-oauth.utils";

interface UseOAuthConnectOptions {
    provider: ProviderDefinition | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

interface OAuthDeviceResponse {
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

export type ConnectTab = "oauth" | "pat" | "bulk";

const POLL_INTERVAL_MS = 2000;
const POPUP_FEATURES = "width=600,height=700,status=yes,scrollbars=yes";

function invalidateProviderQueries(queryClient: QueryClient, providerId?: string) {
    void queryClient.invalidateQueries({ queryKey: ["providers"] });
    void queryClient.invalidateQueries({ queryKey: ["providers", providerId] });
    void queryClient.invalidateQueries({ queryKey: ["providers", "catalog"] });
    void queryClient.invalidateQueries({ queryKey: ["models"] });
}

function closePopupIfOpen(popupRef: RefObject<Window | null>) {
    if (popupRef.current && !popupRef.current.closed) {
        popupRef.current.close();
    }
}

export function useOAuthConnect({ provider, open, onOpenChange }: UseOAuthConnectOptions) {
    const queryClient = useQueryClient();
    const [copied, setCopied] = useState(false);
    const [callbackUrlInput, setCallbackUrlInput] = useState("");
    const [patInput, setPatInput] = useState("");
    const [bulkInput, setBulkInput] = useState("");
    const [activeTab, setActiveTab] = useState<ConnectTab>("oauth");
    const [error, setError] = useState("");
    const [authUrl, setAuthUrl] = useState("");
    const [oauthState, setOauthState] = useState("");
    const [userCode, setUserCode] = useState("");
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
    const tabsCount = supportsBulk ? 3 : isPolling ? 2 : 1;

    const completeConnection = useCallback(() => {
        closePopupIfOpen(popupRef);
        invalidateProviderQueries(queryClient, providerId);
        toast.success(`${providerName ?? "Provider"} connected successfully!`);
        onOpenChange(false);
        setCallbackUrlInput("");
        setError("");
    }, [queryClient, providerId, providerName, onOpenChange]);

    useEffect(() => {
        if (!open || !providerId) {
            setAuthUrl("");
            setOauthState("");
            setUserCode("");
            setError("");
            setCopied(false);
            setCallbackUrlInput("");
            setPatInput("");
            setBulkInput("");
            closePopupIfOpen(popupRef);
            return;
        }

        setActiveTab("oauth");
        setIsLoadingUrl(true);
        setError("");

        let cancelled = false;
        api.get<OAuthDeviceResponse | OAuthLoginResponse>(flow.loginEndpoint)
            .then((res) => {
                if (cancelled) return;
                setAuthUrl(res.authorizeUrl);
                setOauthState(res.state);
                setUserCode("userCode" in res ? res.userCode : "");
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

    useEffect(() => {
        if (!open || !providerId) return;

        const handleMessage = (event: MessageEvent) => {
            if (
                event.data &&
                typeof event.data === "object" &&
                event.data.type === "SROUTER_OAUTH_SUCCESS"
            ) {
                completeConnection();
            }
        };

        window.addEventListener("message", handleMessage);
        return () => window.removeEventListener("message", handleMessage);
    }, [open, providerId, completeConnection]);

    useEffect(() => {
        if (!open || !providerId || !flow.pollEndpoint || !oauthState) return;

        const pollEndpoint = flow.pollEndpoint;
        const interval = setInterval(async () => {
            try {
                const res = await api.get<{ status: AuthPollStatus; provider?: ProviderConfig }>(
                    `${pollEndpoint}?state=${encodeURIComponent(oauthState)}`
                );
                if (res && res.status === AuthPollStatus.OK) {
                    completeConnection();
                }
            } catch {}
        }, POLL_INTERVAL_MS);

        return () => clearInterval(interval);
    }, [open, providerId, flow, oauthState, completeConnection]);

    const callbackMutation = useMutation({
        mutationFn: (payload: { callback_url: string }) =>
            api.post(flow.callbackEndpoint ?? "/v1/auth/openai/callback", payload),
        onSuccess: completeConnection,
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

    const openPopup = () => {
        if (!authUrl) return;
        const popup = window.open(authUrl, "_blank", POPUP_FEATURES);
        popupRef.current = popup;
        if (!popup) {
            setError("Popup blocked by the browser — use Copy link to open the authorization URL.");
        }
    };

    const copyAuthUrl = async () => {
        if (!authUrl) return;
        await navigator.clipboard.writeText(authUrl);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    };

    const submitCallback = () => {
        if (!provider) return;

        const input = callbackUrlInput.trim();
        if (!input) {
            setError("Please paste the callback URL from your browser.");
            return;
        }

        setError("");
        callbackMutation.mutate({ callback_url: input });
    };

    const submitPat = () => {
        if (!provider) return;

        const token = patInput.trim();
        if (!token) {
            setError("Please enter your token.");
            return;
        }

        setError("");
        patMutation.mutate({ access_token: token });
    };

    const submitBulk = () => {
        if (splitTokenLines(bulkInput).length === 0) {
            setError("Paste at least one token, one per line.");
            return;
        }

        setError("");
        bulkMutation.mutate(bulkInput);
    };

    return {
        flow,
        hasTabs,
        isPolling,
        tabsCount,
        activeTab,
        setActiveTab,
        error,
        authUrl,
        userCode,
        isLoadingUrl,
        copied,
        callbackUrlInput,
        setCallbackUrlInput,
        patInput,
        setPatInput,
        bulkInput,
        setBulkInput,
        isCallbackPending: callbackMutation.isPending,
        isPatPending: patMutation.isPending,
        isBulkPending: bulkMutation.isPending,
        openPopup,
        copyAuthUrl,
        submitCallback,
        submitPat,
        submitBulk
    };
}

export type OAuthConnectState = ReturnType<typeof useOAuthConnect>;
