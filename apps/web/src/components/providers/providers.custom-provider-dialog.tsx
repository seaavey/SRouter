import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plug, CheckCircle2, Globe, Key, X } from "lucide-react";
import { toast } from "sonner";
import type { ProviderDefinition, ProviderProtocol } from "@srouter/types";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle
} from "@/components/ui/dialog";
import { api } from "@/lib/api";

interface VerifyResponse {
    success: boolean;
    message: string;
    modelsCount?: number;
}

type VerifyStatus = "idle" | "testing" | "success" | "error";

const PROTOCOLS: { value: ProviderProtocol; label: string }[] = [
    { value: "openai", label: "OpenAI" },
    { value: "anthropic", label: "Anthropic" }
];

interface CustomProviderDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export function CustomProviderDialog({ open, onOpenChange }: CustomProviderDialogProps) {
    const queryClient = useQueryClient();
    const [name, setName] = useState("");
    const [alias, setAlias] = useState("");
    const [baseUrl, setBaseUrl] = useState("");
    const [apiKey, setApiKey] = useState("");
    const [protocol, setProtocol] = useState<ProviderProtocol>("openai");
    const [showKey, setShowKey] = useState(false);
    const [formError, setFormError] = useState("");
    const [verifyStatus, setVerifyStatus] = useState<VerifyStatus>("idle");

    useEffect(() => {
        if (open) {
            setName("");
            setAlias("");
            setBaseUrl("");
            setApiKey("");
            setProtocol("openai");
            setShowKey(false);
            setFormError("");
            setVerifyStatus("idle");
        }
    }, [open]);

    const invalidateCatalog = () => {
        void queryClient.invalidateQueries({ queryKey: ["providers", "catalog"] });
        void queryClient.invalidateQueries({ queryKey: ["models"] });
    };

    const saveMutation = useMutation({
        mutationFn: (payload: Record<string, unknown>) =>
            api.post<ProviderDefinition>("/v1/providers", payload),
        onSuccess: (provider) => {
            invalidateCatalog();
            toast.success(`Provider "${provider.name}" added`);
            onOpenChange(false);
        },
        onError: (err: Error) => {
            const msg = err.message || "Failed to add provider";
            setFormError(msg);
            toast.error(msg);
        }
    });

    const handleTest = async () => {
        if (!baseUrl.trim()) {
            setFormError("Base URL is required");
            return;
        }
        if (!apiKey.trim()) {
            setFormError("API key is required");
            return;
        }
        setFormError("");
        setVerifyStatus("testing");
        try {
            const res = await api.post<VerifyResponse>("/v1/providers/verify", {
                protocol,
                base_url: baseUrl.trim(),
                api_key: apiKey.trim()
            });
            if (res.success) {
                setVerifyStatus("success");
                toast.success(res.message || "Connection verified.");
            } else {
                setVerifyStatus("error");
                toast.error(res.message || "Connection test failed.");
            }
        } catch (err) {
            setVerifyStatus("error");
            toast.error(err instanceof Error ? err.message : "Failed to test connection.");
        }
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const trimmedName = name.trim();
        if (!trimmedName) {
            setFormError("Provider name is required");
            return;
        }
        const trimmedAlias = alias.trim().toLowerCase();
        if (!/^[a-z0-9_-]{1,32}$/.test(trimmedAlias)) {
            setFormError("Alias must be 1-32 chars: lowercase letters, numbers, - or _");
            return;
        }
        if (!baseUrl.trim()) {
            setFormError("Base URL is required");
            return;
        }
        if (!apiKey.trim()) {
            setFormError("API key is required");
            return;
        }
        if (verifyStatus !== "success") {
            setFormError("Test the connection first — it must pass before saving.");
            toast.error("Test the connection first — it must pass before saving.");
            return;
        }
        setFormError("");
        saveMutation.mutate({
            name: trimmedName,
            alias: trimmedAlias,
            protocol,
            base_url: baseUrl.trim(),
            api_key: apiKey.trim()
        });
    };

    const canSave = verifyStatus === "success" && !saveMutation.isPending;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="w-[calc(100%-1rem)] max-w-2xl gap-0 overflow-y-auto rounded-3xl border border-hairline-soft bg-canvas p-4 font-sans text-ink shadow-none max-h-[calc(100dvh-1rem)] sm:w-[calc(100%-2rem)] sm:p-6 md:max-h-[calc(100dvh-2rem)]">
                <div className="flex items-start justify-between gap-4 border-b border-hairline-soft pb-4">
                    <div className="flex min-w-0 items-start gap-3">
                        <div className="flex size-9 shrink-0 items-center justify-center rounded-2xl bg-canvas-soft text-text-muted">
                            <Globe className="size-4" aria-hidden="true" />
                        </div>
                        <div className="min-w-0">
                            <h2 className="text-base font-bold tracking-tight text-ink sm:text-lg">
                                Add custom provider
                            </h2>
                            <p className="mt-1 text-xs leading-relaxed text-text-muted">
                                Connect an OpenAI- or Anthropic-compatible endpoint.
                            </p>
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
                </div>

                <DialogHeader className="sr-only p-0">
                    <DialogTitle className="sr-only">Add Custom Provider</DialogTitle>
                    <DialogDescription className="text-xs text-text-muted">
                        Verify the connection before saving.
                    </DialogDescription>
                </DialogHeader>

                {formError && (
                    <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
                        {formError}
                    </div>
                )}

                <form onSubmit={handleSubmit} className="flex flex-col gap-5 pt-5 text-xs">
                    <section
                        className="flex flex-col gap-3"
                        aria-labelledby="custom-provider-identity"
                    >
                        <div>
                            <h3
                                id="custom-provider-identity"
                                className="text-sm font-semibold text-ink"
                            >
                                Provider identity
                            </h3>
                            <p className="mt-1 text-xs text-text-muted">
                                Choose how this connection appears in the catalog.
                            </p>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                            <div className="flex flex-col gap-1.5">
                                <label
                                    htmlFor="cp-name"
                                    className="font-semibold text-ink block text-xs"
                                >
                                    Provider Name *
                                </label>
                                <input
                                    id="cp-name"
                                    type="text"
                                    placeholder="e.g. My Gateway"
                                    value={name}
                                    onChange={(e) => {
                                        setName(e.target.value);
                                        if (formError) setFormError("");
                                    }}
                                    required
                                    className="w-full rounded-2xl border-0 bg-field px-4 py-2.5 text-xs text-ink placeholder:text-text-faint focus-visible:ring-2 focus-visible:ring-ink focus-visible:outline-none shadow-none"
                                />
                            </div>

                            <div className="flex flex-col gap-1.5">
                                <label
                                    htmlFor="cp-alias"
                                    className="font-semibold text-ink block text-xs"
                                >
                                    Alias (model prefix) *
                                </label>
                                <input
                                    id="cp-alias"
                                    type="text"
                                    placeholder="e.g. mygateway"
                                    value={alias}
                                    onChange={(e) => {
                                        setAlias(e.target.value);
                                        if (formError) setFormError("");
                                    }}
                                    className="w-full rounded-2xl border-0 bg-field px-4 py-2.5 text-xs text-ink placeholder:text-text-faint focus-visible:ring-2 focus-visible:ring-ink focus-visible:outline-none shadow-none font-mono"
                                />
                            </div>
                        </div>
                        <p className="text-xs text-text-muted">
                            Model prefix example:{" "}
                            <code className="text-ink font-mono">mygateway/gpt-4</code>. Use
                            lowercase letters, numbers, hyphens, or underscores.
                        </p>
                    </section>

                    <section
                        className="flex flex-col gap-3"
                        aria-labelledby="custom-provider-connection"
                    >
                        <div>
                            <h3
                                id="custom-provider-connection"
                                className="text-sm font-semibold text-ink"
                            >
                                Connection
                            </h3>
                            <p className="mt-1 text-xs text-text-muted">
                                Set the protocol and credentials used to reach the endpoint.
                            </p>
                        </div>
                        <div className="flex flex-col gap-1.5">
                            <span className="block text-xs font-semibold text-ink">Protocol *</span>
                            <div className="grid grid-cols-2 gap-1 rounded-2xl border border-hairline-soft bg-canvas-soft p-1">
                                {PROTOCOLS.map((p) => (
                                    <button
                                        key={p.value}
                                        type="button"
                                        onClick={() => {
                                            setProtocol(p.value);
                                            if (verifyStatus !== "idle") setVerifyStatus("idle");
                                        }}
                                        className={`min-h-9 rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                                            protocol === p.value
                                                ? "bg-ink text-canvas shadow-none"
                                                : "text-text-muted hover:text-ink hover:bg-canvas/50"
                                        }`}
                                    >
                                        {p.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="flex flex-col gap-1.5">
                            <label
                                htmlFor="cp-base-url"
                                className="font-semibold text-ink block text-xs"
                            >
                                Base URL *
                            </label>
                            <input
                                id="cp-base-url"
                                type="url"
                                placeholder="https://api.example.com/v1"
                                value={baseUrl}
                                onChange={(e) => {
                                    setBaseUrl(e.target.value);
                                    if (formError) setFormError("");
                                    if (verifyStatus !== "idle") setVerifyStatus("idle");
                                }}
                                required
                                className="w-full rounded-2xl border-0 bg-field px-4 py-2.5 text-xs text-ink placeholder:text-text-faint focus-visible:ring-2 focus-visible:ring-ink focus-visible:outline-none shadow-none font-mono"
                            />
                        </div>

                        <div className="flex flex-col gap-1.5">
                            <label
                                htmlFor="cp-api-key"
                                className="font-semibold text-ink block text-xs"
                            >
                                API Key *
                            </label>
                            <div className="relative">
                                <input
                                    id="cp-api-key"
                                    type={showKey ? "text" : "password"}
                                    placeholder="sk-..."
                                    value={apiKey}
                                    onChange={(e) => {
                                        setApiKey(e.target.value);
                                        if (formError) setFormError("");
                                        if (verifyStatus !== "idle") setVerifyStatus("idle");
                                    }}
                                    required
                                    className="w-full rounded-2xl border-0 bg-field px-4 py-2.5 pr-10 text-xs text-ink placeholder:text-text-faint focus-visible:ring-2 focus-visible:ring-ink focus-visible:outline-none shadow-none font-mono"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowKey(!showKey)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-ink cursor-pointer"
                                    aria-label={showKey ? "Hide API key" : "Show API key"}
                                >
                                    <Key className="size-3.5" aria-hidden="true" />
                                </button>
                            </div>
                        </div>
                    </section>

                    <div className="flex flex-col items-stretch gap-2 pt-1 sm:flex-row sm:items-center">
                        <button
                            type="button"
                            onClick={() => void handleTest()}
                            disabled={verifyStatus === "testing" || saveMutation.isPending}
                            className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl border border-hairline bg-canvas px-4 py-2 text-xs font-semibold text-ink shadow-none transition-colors hover:bg-canvas-soft disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer sm:min-h-9 sm:py-1.5"
                        >
                            {verifyStatus === "testing" ? (
                                <>
                                    <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                                    Testing…
                                </>
                            ) : (
                                <>
                                    <Plug className="size-3.5" aria-hidden="true" />
                                    Test Connection
                                </>
                            )}
                        </button>
                        {verifyStatus === "success" && (
                            <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                                <CheckCircle2 className="size-3.5" aria-hidden="true" />
                                Verified
                            </span>
                        )}
                    </div>

                    <div className="flex flex-col-reverse gap-2 border-t border-hairline-soft pt-4 sm:flex-row sm:items-center sm:justify-end">
                        <button
                            type="button"
                            onClick={() => onOpenChange(false)}
                            className="min-h-10 rounded-xl border border-hairline bg-canvas px-4 py-2 text-xs font-semibold text-ink shadow-none transition-colors hover:bg-canvas-soft cursor-pointer sm:min-h-9"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={!canSave}
                            title={
                                verifyStatus === "success"
                                    ? undefined
                                    : "Test the connection successfully before saving"
                            }
                            className="min-h-10 rounded-xl bg-ink px-5 py-2 text-xs font-semibold text-canvas shadow-none transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer sm:min-h-9"
                        >
                            {saveMutation.isPending ? "Saving…" : "Add Provider"}
                        </button>
                    </div>
                </form>
            </DialogContent>
        </Dialog>
    );
}
