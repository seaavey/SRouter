import { useEffect, useState } from "react";
import { Key, X, Eye, EyeOff, Loader2, Plug, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import type { ProviderProtocol } from "@srouter/types";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription
} from "@/components/ui/dialog";
import { api } from "@/lib/api";

export interface ConnectionFormInput {
    name?: string;
    base_url?: string;
    baseUrl?: string;
    apiKey: string;
}

type VerifyResponse = {
    success: boolean;
    message: string;
    modelsCount?: number;
};

type VerifyStatus = "idle" | "testing" | "success" | "error";

interface ConnectionFormProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    providerName: string;
    protocol: ProviderProtocol;
    defaultBaseUrl?: string;
    isSaving: boolean;
    error?: string | null;
    onSubmit: (payload: ConnectionFormInput) => void;
}

export function ConnectionForm({
    open,
    onOpenChange,
    providerName,
    protocol,
    defaultBaseUrl,
    isSaving,
    error,
    onSubmit
}: ConnectionFormProps) {
    const [apiKey, setApiKey] = useState("");
    const [showKey, setShowKey] = useState(false);
    const [formError, setFormError] = useState("");
    const [verifyStatus, setVerifyStatus] = useState<VerifyStatus>("idle");

    useEffect(() => {
        if (open) {
            setApiKey("");
            setShowKey(false);
            setFormError("");
            setVerifyStatus("idle");
        }
    }, [open]);

    const handleTest = async () => {
        const trimmedKey = apiKey.trim();
        if (!trimmedKey) {
            setFormError("API key is required");
            return;
        }

        setFormError("");
        setVerifyStatus("testing");
        try {
            const res = await api.post<VerifyResponse>("/v1/providers/verify", {
                protocol,
                base_url: defaultBaseUrl || undefined,
                api_key: trimmedKey
            });
            if (res.success) {
                setVerifyStatus("success");
                toast.success(res.message || "API key valid.");
            } else {
                setVerifyStatus("error");
                toast.error(res.message || "API key test failed.");
            }
        } catch (err) {
            setVerifyStatus("error");
            toast.error(err instanceof Error ? err.message : "Gagal menguji koneksi API key.");
        }
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const trimmedKey = apiKey.trim();
        if (!trimmedKey) {
            setFormError("API key is required");
            return;
        }
        // Enforce a successful test before saving.
        if (verifyStatus !== "success") {
            setFormError("Test the API key first — it must pass before saving.");
            toast.error("Test the API key first — it must pass before saving.");
            return;
        }

        setFormError("");
        onSubmit({
            name: `${providerName} Key`,
            base_url: defaultBaseUrl || undefined,
            apiKey: trimmedKey
        });
    };

    const displayError = error || formError;
    const canSave = verifyStatus === "success" && !isSaving;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md w-full p-6 md:p-8 bg-canvas border border-hairline-soft rounded-3xl space-y-5 shadow-none font-sans max-h-[calc(100dvh-2rem)] overflow-y-auto">
                {/* Header */}
                <div className="flex items-center justify-between border-b border-hairline-soft pb-3.5">
                    <h2 className="font-bold text-base text-ink flex items-center gap-2">
                        <Key className="size-4 text-text-muted" />
                        <span>Add API Key for {providerName}.</span>
                    </h2>

                    <button
                        type="button"
                        onClick={() => onOpenChange(false)}
                        className="inline-flex size-8 items-center justify-center rounded-full text-text-muted hover:bg-canvas-soft hover:text-ink transition-colors cursor-pointer"
                        aria-label="Close dialog"
                    >
                        <X className="size-4" />
                    </button>
                </div>

                <DialogHeader className="p-0 space-y-1">
                    <DialogTitle className="sr-only">Add API Key for {providerName}</DialogTitle>
                    <DialogDescription className="text-xs text-text-muted">
                        Enter credentials for {providerName} and verify the upstream connection
                        before saving.
                    </DialogDescription>
                </DialogHeader>

                {displayError && (
                    <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
                        {displayError}
                    </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-4 text-xs">
                    <div className="space-y-1.5">
                        <label
                            htmlFor="conn-api-key"
                            className="font-semibold text-ink block text-xs"
                        >
                            API Key / Access Token *
                        </label>
                        <div className="relative">
                            <input
                                id="conn-api-key"
                                type={showKey ? "text" : "password"}
                                placeholder="sk-..."
                                value={apiKey}
                                onChange={(e) => {
                                    setApiKey(e.target.value);
                                    if (formError) setFormError("");
                                    // Any edit invalidates a prior test result.
                                    if (verifyStatus !== "idle") {
                                        setVerifyStatus("idle");
                                    }
                                }}
                                required
                                className="w-full rounded-2xl border-0 bg-field px-4 py-2.5 pr-10 text-xs text-ink placeholder:text-text-faint focus-visible:ring-2 focus-visible:ring-ink focus-visible:outline-none shadow-none font-mono"
                            />
                            <button
                                type="button"
                                onClick={() => setShowKey(!showKey)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-ink cursor-pointer"
                                tabIndex={-1}
                            >
                                {showKey ? (
                                    <EyeOff className="size-4" />
                                ) : (
                                    <Eye className="size-4" />
                                )}
                            </button>
                        </div>
                    </div>

                    {/* Test connection row */}
                    <div className="flex items-center gap-2.5 pt-1">
                        <button
                            type="button"
                            onClick={() => void handleTest()}
                            disabled={verifyStatus === "testing" || !apiKey.trim() || isSaving}
                            className="inline-flex items-center gap-1.5 rounded-full border border-hairline px-4 py-1.5 text-xs font-semibold text-ink hover:bg-canvas-soft disabled:opacity-50 transition-colors cursor-pointer bg-canvas shadow-none"
                        >
                            {verifyStatus === "testing" ? (
                                <>
                                    <Loader2 className="size-3.5 animate-spin" />
                                    Testing…
                                </>
                            ) : (
                                <>
                                    <Plug className="size-3.5" />
                                    Test Connection
                                </>
                            )}
                        </button>

                        {verifyStatus === "success" && (
                            <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                                <CheckCircle2 className="size-3.5" />
                                Verified
                            </span>
                        )}
                    </div>

                    <div className="pt-3 border-t border-hairline-soft flex items-center justify-end gap-2">
                        <button
                            type="button"
                            onClick={() => onOpenChange(false)}
                            className="rounded-full border border-hairline px-4 py-2 text-xs font-semibold text-ink hover:bg-canvas-soft transition-colors cursor-pointer bg-canvas shadow-none"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={!canSave}
                            title={
                                verifyStatus === "success"
                                    ? undefined
                                    : "Test the API key successfully before saving"
                            }
                            className="rounded-full bg-ink hover:opacity-90 text-canvas px-5 py-2 text-xs font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition-all cursor-pointer shadow-none"
                        >
                            {isSaving ? "Saving…" : "Save API Key"}
                        </button>
                    </div>
                </form>
            </DialogContent>
        </Dialog>
    );
}
