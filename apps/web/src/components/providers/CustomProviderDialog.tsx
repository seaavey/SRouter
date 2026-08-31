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

function SlugifyName(Name: string): string {
    return Name
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

interface CustomProviderDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export function CustomProviderDialog({ open, onOpenChange }: CustomProviderDialogProps) {
    const queryClient = useQueryClient();
    const [name, setName] = useState("");
    const [baseUrl, setBaseUrl] = useState("");
    const [apiKey, setApiKey] = useState("");
    const [protocol, setProtocol] = useState<ProviderProtocol>("openai");
    const [showKey, setShowKey] = useState(false);
    const [formError, setFormError] = useState("");
    const [verifyStatus, setVerifyStatus] = useState<VerifyStatus>("idle");

    useEffect(() => {
        if (open) {
            setName("");
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
        if (!baseUrl.trim()) {
            setFormError("Base URL is required");
            return;
        }
        if (verifyStatus !== "success") {
            setFormError("Test the connection first — it must pass before saving.");
            return;
        }
        setFormError("");
        const Slug = SlugifyName(trimmedName);
        saveMutation.mutate({
            id: Slug || undefined,
            name: trimmedName,
            category: "api_key",
            protocol,
            base_url: baseUrl.trim(),
            api_key: apiKey.trim()
        });
    };

    const canSave = verifyStatus === "success" && !saveMutation.isPending;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md w-full p-5 space-y-4 shadow-xl font-mono">
                <div className="flex items-center justify-between border-b border-[var(--line)] pb-3">
                    <h2 className="font-bold text-sm text-[var(--ink)] flex items-center gap-1.5">
                        <Globe className="size-3.5 text-orange-500" />
                        <span>Add Custom Provider</span>
                    </h2>
                    <button
                        type="button"
                        onClick={() => onOpenChange(false)}
                        className="text-[var(--ink-3)] hover:text-[var(--ink)] p-1 rounded hover:bg-[var(--field)] transition-colors cursor-pointer"
                    >
                        <X className="size-4" />
                    </button>
                </div>

                <DialogHeader className="p-0 space-y-1">
                    <DialogTitle className="sr-only">Add Custom Provider</DialogTitle>
                    <DialogDescription className="text-xs text-[var(--ink-3)]">
                        Register any OpenAI- or Anthropic-compatible endpoint as a new provider
                        driver. Verify the connection before saving.
                    </DialogDescription>
                </DialogHeader>

                {formError && (
                    <div className="rounded-[8px] border border-rose-500/40 bg-rose-500/10 p-2.5 text-xs text-rose-500">
                        {formError}
                    </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-4 text-xs">
                    <div className="space-y-1.5">
                        <label htmlFor="cp-name" className="font-medium text-[var(--ink)] block">
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
                            autoFocus
                            required
                            className="w-full rounded-[8px] border border-[var(--line)] bg-[var(--field)] px-3 py-2 text-xs text-[var(--ink)] placeholder:text-[var(--ink-3)] focus:outline-none focus:ring-1 focus:ring-[var(--ink)]"
                        />
                    </div>

                    <div className="space-y-1.5">
                        <span className="font-medium text-[var(--ink)] block">Protocol *</span>
                        <div className="flex gap-1.5">
                            {PROTOCOLS.map((p) => (
                                <button
                                    key={p.value}
                                    type="button"
                                    onClick={() => {
                                        setProtocol(p.value);
                                        if (verifyStatus !== "idle") setVerifyStatus("idle");
                                    }}
                                    className={`rounded-[6px] border px-3 py-1.5 font-semibold transition-colors cursor-pointer ${
                                        protocol === p.value
                                            ? "border-orange-500 bg-orange-500/10 text-orange-500"
                                            : "border-[var(--line)] text-[var(--ink-3)] hover:text-[var(--ink)]"
                                    }`}
                                >
                                    {p.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="space-y-1.5">
                        <label htmlFor="cp-base-url" className="font-medium text-[var(--ink)] block">
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
                            className="w-full rounded-[8px] border border-[var(--line)] bg-[var(--field)] px-3 py-2 text-xs text-[var(--ink)] placeholder:text-[var(--ink-3)] focus:outline-none focus:ring-1 focus:ring-[var(--ink)]"
                        />
                    </div>

                    <div className="space-y-1.5">
                        <label htmlFor="cp-api-key" className="font-medium text-[var(--ink)] block">
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
                                className="w-full rounded-[8px] border border-[var(--line)] bg-[var(--field)] px-3 py-2 pr-9 text-xs text-[var(--ink)] placeholder:text-[var(--ink-3)] focus:outline-none focus:ring-1 focus:ring-[var(--ink)]"
                            />
                            <button
                                type="button"
                                onClick={() => setShowKey(!showKey)}
                                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--ink-3)] hover:text-[var(--ink)] cursor-pointer"
                                tabIndex={-1}
                            >
                                <Key className="size-3.5" />
                            </button>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={() => void handleTest()}
                            disabled={verifyStatus === "testing" || saveMutation.isPending}
                            className="inline-flex items-center gap-1.5 rounded-[6px] border border-[var(--line)] px-3 py-1.5 text-xs font-semibold text-[var(--ink)] hover:bg-[var(--field)] disabled:opacity-50 transition-colors cursor-pointer"
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
                            <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-500">
                                <CheckCircle2 className="size-3.5" />
                                Verified
                            </span>
                        )}
                    </div>

                    <div className="pt-3 border-t border-[var(--line)] flex items-center justify-end gap-2">
                        <button
                            type="button"
                            onClick={() => onOpenChange(false)}
                            className="rounded-[6px] border border-[var(--line)] px-3 py-1.5 text-xs font-medium text-[var(--ink-3)] hover:text-[var(--ink)] transition-colors cursor-pointer"
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
                            className="rounded-[6px] bg-orange-500 hover:bg-orange-600 text-white px-4 py-1.5 text-xs font-bold disabled:opacity-50 disabled:cursor-not-allowed transition-all cursor-pointer shadow-xs"
                        >
                            {saveMutation.isPending ? "Saving…" : "Add Provider"}
                        </button>
                    </div>
                </form>
            </DialogContent>
        </Dialog>
    );
}
