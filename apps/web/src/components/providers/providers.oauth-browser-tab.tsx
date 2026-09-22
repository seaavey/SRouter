import type { SubmitEvent } from "react";
import { Check, Copy, ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { OAuthConnectState } from "@/hooks/useOAuthConnect";
import { INPUT_FIELD, OAuthFormActions } from "./providers.oauth-shared";

interface OAuthBrowserTabProps {
    providerName: string;
    isPolling: boolean;
    waitingLabel: string;
    connect: OAuthConnectState;
    onCancel: () => void;
}

export default function OAuthBrowserTab({
    providerName,
    isPolling,
    waitingLabel,
    connect,
    onCancel
}: OAuthBrowserTabProps) {
    const {
        isLoadingUrl,
        authUrl,
        userCode,
        copied,
        callbackUrlInput,
        setCallbackUrlInput,
        isCallbackPending,
        openPopup,
        copyAuthUrl,
        submitCallback
    } = connect;

    const handleSubmit = (event: SubmitEvent<HTMLFormElement>) => {
        event.preventDefault();
        submitCallback();
    };

    return (
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
                        {isLoadingUrl ? "Generating authorization session…" : waitingLabel}
                    </p>
                    <p className="text-xs text-text-muted mt-0.5">
                        {userCode
                            ? `Enter code ${userCode} in the browser if requested.`
                            : "Complete authorization in your browser window to link."}
                    </p>
                </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4 text-xs">
                <div className="space-y-2">
                    <label className="font-semibold text-ink block text-xs">
                        Step 1: Open authorization in browser
                    </label>
                    <Button
                        type="button"
                        onClick={openPopup}
                        disabled={!authUrl || isLoadingUrl}
                        className="w-full h-10 rounded-full text-xs font-semibold gap-2 shadow-none cursor-pointer"
                    >
                        <ExternalLink className="size-3.5" aria-hidden="true" />
                        <span>Open {providerName} Login Page</span>
                    </Button>
                </div>
                <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                        <span className="text-text-muted">Or copy authorization URL</span>
                        <button
                            type="button"
                            onClick={() => void copyAuthUrl()}
                            disabled={!authUrl}
                            className="inline-flex items-center gap-1 font-semibold text-text-muted hover:text-ink transition-colors cursor-pointer disabled:opacity-50"
                        >
                            {copied ? (
                                <>
                                    <Check className="size-3 text-emerald-500" aria-hidden="true" />
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

                        <OAuthFormActions
                            submitLabel="Connect"
                            isPending={isCallbackPending}
                            onCancel={onCancel}
                        />
                    </>
                )}
            </form>
        </>
    );
}
