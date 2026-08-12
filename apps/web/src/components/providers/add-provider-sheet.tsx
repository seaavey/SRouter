import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { TriangleAlert } from "lucide-react";
import { api } from "@/lib/api";
import type { ProviderCategory, ProviderDefinition, ProviderProtocol } from "@srouter/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetFooter,
    SheetHeader,
    SheetTitle,
} from "@/components/ui/sheet";

type AddProviderSheetProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
};

type CreateProviderPayload = {
    id?: string;
    name: string;
    category: ProviderCategory;
    protocol: ProviderProtocol;
    baseUrl?: string;
    apiKey?: string;
};

const selectClassName =
    "h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

type FieldProps = {
    htmlFor: string;
    label: string;
    hint?: string;
    children: React.ReactNode;
};

function Field({ htmlFor, label, hint, children }: FieldProps) {
    return (
        <div className="space-y-1.5">
            <label htmlFor={htmlFor} className="block text-xs font-medium text-foreground">
                {label}
            </label>
            {children}
            {hint ? <p className="text-[11px] leading-relaxed text-muted-foreground">{hint}</p> : null}
        </div>
    );
}

export function AddProviderSheet({ open, onOpenChange }: AddProviderSheetProps) {
    const queryClient = useQueryClient();

    const [name, setName] = useState("");
    const [id, setId] = useState("");
    const [category, setCategory] = useState<ProviderCategory>("custom");
    const [protocol, setProtocol] = useState<ProviderProtocol>("openai");
    const [baseUrl, setBaseUrl] = useState("");
    const [apiKey, setApiKey] = useState("");
    const [formError, setFormError] = useState("");

    const addMutation = useMutation({
        mutationFn: (payload: CreateProviderPayload) => api.post<ProviderDefinition>("/v1/providers", payload),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: ["providers"] });
            setName("");
            setId("");
            setBaseUrl("");
            setApiKey("");
            setFormError("");
            onOpenChange(false);
        },
        onError: (error: Error) => {
            setFormError(error.message || "Failed to add provider.");
        },
    });

    function handleSubmit(event: React.FormEvent) {
        event.preventDefault();
        if (!name.trim()) {
            setFormError("Provider name is required.");
            return;
        }
        setFormError("");
        addMutation.mutate({
            id: id.trim() || undefined,
            name: name.trim(),
            category,
            protocol,
            baseUrl: baseUrl.trim() || undefined,
            apiKey: apiKey.trim() || undefined,
        });
    }

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent side="right" className="w-full gap-0 sm:max-w-md">
                <SheetHeader className="shrink-0 border-b border-border/70 p-4 pr-12">
                    <SheetTitle className="text-sm">Add custom provider</SheetTitle>
                    <SheetDescription className="text-xs">
                        Register an OpenAI- or Anthropic-compatible endpoint as a new gateway route.
                    </SheetDescription>
                </SheetHeader>

                <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
                    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
                        {formError ? (
                            <div
                                role="alert"
                                className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-2.5 text-xs text-destructive"
                            >
                                <TriangleAlert className="mt-px size-3.5 shrink-0" strokeWidth={1.75} />
                                <span>{formError}</span>
                            </div>
                        ) : null}

                        <Field htmlFor="provider-name" label="Provider name">
                            <Input
                                id="provider-name"
                                value={name}
                                onChange={(event) => setName(event.target.value)}
                                placeholder="Groq Cloud, Ollama Local…"
                                className="text-sm"
                                required
                            />
                        </Field>

                        <div className="grid grid-cols-2 gap-3">
                            <Field htmlFor="provider-category" label="Category">
                                <select
                                    id="provider-category"
                                    value={category}
                                    onChange={(event) => setCategory(event.target.value as ProviderCategory)}
                                    className={selectClassName}
                                >
                                    <option value="custom">Custom</option>
                                    <option value="api_key">API key</option>
                                    <option value="free_tier">Free tier</option>
                                </select>
                            </Field>

                            <Field htmlFor="provider-protocol" label="Protocol">
                                <select
                                    id="provider-protocol"
                                    value={protocol}
                                    onChange={(event) => setProtocol(event.target.value as ProviderProtocol)}
                                    className={selectClassName}
                                >
                                    <option value="openai">OpenAI compatible</option>
                                    <option value="anthropic">Anthropic messages</option>
                                </select>
                            </Field>
                        </div>

                        <Field
                            htmlFor="provider-id"
                            label="Provider ID"
                            hint="Optional. Generated from a timestamp when left empty."
                        >
                            <Input
                                id="provider-id"
                                value={id}
                                onChange={(event) => setId(event.target.value)}
                                placeholder="custom-groq"
                                className="font-mono text-xs"
                            />
                        </Field>

                        <Field htmlFor="provider-base-url" label="Base URL" hint="Root endpoint used for every request.">
                            <Input
                                id="provider-base-url"
                                value={baseUrl}
                                onChange={(event) => setBaseUrl(event.target.value)}
                                placeholder="https://api.groq.com/openai/v1"
                                className="font-mono text-xs"
                            />
                        </Field>

                        <Field
                            htmlFor="provider-api-key"
                            label="API key"
                            hint="Stored locally in the gateway database and never sent anywhere else."
                        >
                            <Input
                                id="provider-api-key"
                                type="password"
                                value={apiKey}
                                onChange={(event) => setApiKey(event.target.value)}
                                placeholder="gsk_…"
                                className="font-mono text-xs"
                            />
                        </Field>
                    </div>

                    <SheetFooter className="shrink-0 flex-row justify-end gap-2 border-t border-border/70 p-4">
                        <Button type="button" variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
                            Cancel
                        </Button>
                        <Button type="submit" size="sm" disabled={addMutation.isPending}>
                            {addMutation.isPending ? "Saving…" : "Save provider"}
                        </Button>
                    </SheetFooter>
                </form>
            </SheetContent>
        </Sheet>
    );
}
