import { useState } from "react";
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
} from "@/components/ui/sheet";

export interface ConnectionFormInput {
    name: string;
    baseUrl?: string;
    apiKey?: string;
}

interface ConnectionFormProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    providerName: string;
    defaultBaseUrl?: string;
    isSaving: boolean;
    error?: string | null;
    onSubmit: (payload: ConnectionFormInput) => void;
}

export function ConnectionForm({
    open,
    onOpenChange,
    providerName,
    defaultBaseUrl,
    isSaving,
    error,
    onSubmit,
}: ConnectionFormProps) {
    const [formName, setFormName] = useState("");
    const [formBaseUrl, setFormBaseUrl] = useState("");
    const [formApiKey, setFormApiKey] = useState("");
    const [formError, setFormError] = useState("");

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!formName.trim()) {
            setFormError("Connection name is required");
            return;
        }

        setFormError("");
        onSubmit({
            name: formName.trim(),
            baseUrl: formBaseUrl.trim() || defaultBaseUrl || undefined,
            apiKey: formApiKey.trim() || undefined,
        });
    };

    const displayError = error || formError;

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent side="right" className="sm:max-w-md w-full p-6 space-y-5 overflow-y-auto">
                <SheetHeader className="p-0 border-b border-border/60 pb-3">
                    <SheetTitle className="text-base font-bold text-foreground">
                        Add Connection for {providerName}
                    </SheetTitle>
                    <SheetDescription className="text-xs text-muted-foreground">
                        Simpan API Key / Access Token baru ke dalam database SQLite.
                    </SheetDescription>
                </SheetHeader>

                {displayError && (
                    <div className="rounded border border-destructive/40 bg-destructive/10 p-2.5 text-xs font-mono text-destructive">
                        {displayError}
                    </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-4 text-xs">
                    <div className="space-y-1">
                        <label htmlFor="conn-name" className="font-medium text-foreground block">
                            Connection Label / Account Name *
                        </label>
                        <input
                            id="conn-name"
                            type="text"
                            placeholder="e.g. Work Account, Primary API Key"
                            value={formName}
                            onChange={(e) => setFormName(e.target.value)}
                            className="w-full rounded border border-border/60 bg-secondary/30 px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                            required
                        />
                    </div>

                    <div className="space-y-1">
                        <label htmlFor="conn-url" className="font-medium text-foreground block">
                            Custom Base Endpoint URL (Optional)
                        </label>
                        <input
                            id="conn-url"
                            type="text"
                            placeholder={defaultBaseUrl || "https://api.openai.com/v1"}
                            value={formBaseUrl}
                            onChange={(e) => setFormBaseUrl(e.target.value)}
                            className="w-full rounded border border-border/60 bg-secondary/30 px-3 py-1.5 text-xs font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                        />
                    </div>

                    <div className="space-y-1">
                        <label htmlFor="conn-key" className="font-medium text-foreground block">
                            API Key / Access Token *
                        </label>
                        <input
                            id="conn-key"
                            type="password"
                            placeholder="sk-..."
                            value={formApiKey}
                            onChange={(e) => setFormApiKey(e.target.value)}
                            className="w-full rounded border border-border/60 bg-secondary/30 px-3 py-1.5 text-xs font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                        />
                    </div>

                    <div className="pt-3 border-t border-border/60 flex items-center justify-end gap-2">
                        <button
                            type="button"
                            onClick={() => onOpenChange(false)}
                            className="rounded border border-border/60 px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={isSaving}
                            className="rounded bg-orange-500 hover:bg-orange-600 text-white px-4 py-1.5 text-xs font-bold disabled:opacity-50"
                        >
                            {isSaving ? "Saving…" : "Save Connection"}
                        </button>
                    </div>
                </form>
            </SheetContent>
        </Sheet>
    );
}
