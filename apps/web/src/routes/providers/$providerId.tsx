import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, AlertTriangle, ExternalLink, Search } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ProviderIcon } from "@/components/ui/provider-icon";
import { ConnectOAuthModal } from "@/components/ui/connect-oauth-modal";
import { useProvider, type AddConnectionPayload } from "@/hooks/useProvider";
import { useCopy } from "@/hooks/useCopy";
import { ConnectionCard } from "@/components/providers/connection-card";
import { ConnectionForm, type ConnectionFormInput } from "@/components/providers/connection-form";
import { ProviderModelCard } from "@/components/providers/provider-model-card";

export const Route = createFileRoute("/providers/$providerId")({
    component: ProviderDetailPage,
});

function ProviderDetailPage() {
    const { providerId } = Route.useParams();
    const {
        data: provider,
        isLoading,
        error,
        refetch,
        addMutation,
        deleteMutation,
    } = useProvider(providerId);

    const [modelSearch, setModelSearch] = useState("");
    const [roundRobin, setRoundRobin] = useState(false);
    const [isAddOpen, setIsAddOpen] = useState(false);
    const [isOAuthModalOpen, setIsOAuthModalOpen] = useState(false);
    const [formError, setFormError] = useState("");
    const { copied, copy } = useCopy();

    const handleAddConnection = () => {
        if (provider?.requiresOAuth) {
            setIsOAuthModalOpen(true);
        } else {
            setIsAddOpen(true);
        }
    };

    const handleAddSubmit = (input: ConnectionFormInput) => {
        if (!provider) return;

        const payload: AddConnectionPayload = {
            id: `${provider.id}-${Date.now()}`,
            name: input.name,
            category: provider.category,
            protocol: provider.protocol,
            baseUrl: input.baseUrl,
            apiKey: input.apiKey,
        };

        setFormError("");
        addMutation.mutate(payload, {
            onSuccess: () => {
                setIsAddOpen(false);
                setFormError("");
            },
            onError: (err: Error) => {
                setFormError(err.message || "Failed to add connection");
            },
        });
    };

    if (isLoading) {
        return (
            <div className="max-w-7xl mx-auto p-4 md:p-6 space-y-6">
                <Skeleton className="h-6 w-36" />
                <Skeleton className="h-40 rounded-xl" />
                <Skeleton className="h-64 rounded-xl" />
            </div>
        );
    }

    if (error || !provider) {
        return (
            <div className="max-w-7xl mx-auto p-4 md:p-6 space-y-4">
                <Link
                    to="/providers"
                    className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground font-mono"
                >
                    <ArrowLeft className="size-3.5" />
                    <span>Back to Providers Catalog</span>
                </Link>
                <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-6 text-xs font-mono text-destructive space-y-2">
                    <p className="font-semibold text-sm">Provider '{providerId}' not found.</p>
                    <p className="text-muted-foreground">
                        {error instanceof Error
                            ? error.message
                            : "Provider definition missing in gateway registry."}
                    </p>
                </div>
            </div>
        );
    }

    const connections = provider.connections ?? [];
    const activeConnectionsCount = connections.filter((c) => c.enabled).length;
    const filteredModels = provider.models.filter((m) =>
        m.id.toLowerCase().includes(modelSearch.toLowerCase()),
    );

    return (
        <div className="flex flex-col gap-6 max-w-7xl mx-auto p-4 md:p-6">
            {/* Back Navigation */}
            <div>
                <Link
                    to="/providers"
                    className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground font-mono transition-colors"
                >
                    <ArrowLeft className="size-3.5" />
                    <span>Back to Providers Catalog</span>
                </Link>
            </div>

            {/* Header Section */}
            <div className="flex items-center justify-between gap-4 border-b border-border/60 pb-4">
                <div className="flex items-center gap-3">
                    <div className="flex size-12 shrink-0 items-center justify-center rounded-xl border border-border/70 bg-card p-2 shadow-2xs">
                        <ProviderIcon providerId={provider.id} className="size-8 text-foreground" />
                    </div>
                    <div>
                        <div className="flex items-center gap-2">
                            <h1 className="text-2xl font-bold tracking-tight text-foreground">
                                {provider.name}
                            </h1>
                            <Badge
                                variant={activeConnectionsCount > 0 ? "emerald" : "secondary"}
                                className="font-mono text-[10px] uppercase px-2 py-0.5"
                            >
                                <span
                                    className={`size-1.5 rounded-full ${
                                        activeConnectionsCount > 0
                                            ? "bg-emerald-500 animate-pulse"
                                            : "bg-muted-foreground"
                                    }`}
                                />
                                {activeConnectionsCount > 0 ? "Connected" : "No Connections"}
                            </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground font-mono mt-0.5">
                            {activeConnectionsCount} active connections in database
                        </p>
                    </div>
                </div>

                <a
                    href="https://antigravity.google.com"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-mono text-orange-500 hover:text-orange-400 hover:underline"
                >
                    <ExternalLink className="size-3.5" />
                    <span>Sign up / Learn more</span>
                </a>
            </div>

            {/* Risk Notice Alert Banner if OAuth */}
            {provider.requiresOAuth && (
                <div className="flex items-start gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3.5 text-amber-500 text-xs font-mono leading-relaxed">
                    <AlertTriangle className="size-4 shrink-0 mt-0.5 text-amber-500" />
                    <div>
                        <span className="font-semibold">Risk Notice:</span> This provider uses a
                        subscription/OAuth session not officially licensed for proxy/router use.
                        Account may be restricted or banned. Use at your own risk.
                    </div>
                </div>
            )}

            {/* Real Connections Card loaded from SQLite DB */}
            <ConnectionCard
                providerName={provider.name}
                connections={connections}
                roundRobin={roundRobin}
                isDeleting={deleteMutation.isPending}
                onToggleRoundRobin={() => setRoundRobin(!roundRobin)}
                onRefresh={() => void refetch()}
                onAdd={handleAddConnection}
                onDelete={(connectionId) => deleteMutation.mutate(connectionId)}
            />

            {/* Available Models Section */}
            <div className="space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border/60 pb-3">
                    <div>
                        <h2 className="text-base font-bold tracking-tight text-foreground">
                            Available Models ({provider.models.length})
                        </h2>
                        <p className="text-xs text-muted-foreground mt-0.5">
                            Model LLM yang didukung oleh {provider.name} dan siap digunakan di
                            Gateway.
                        </p>
                    </div>

                    <div className="relative w-full sm:w-64">
                        <Search className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
                        <input
                            type="text"
                            placeholder="Filter model ID…"
                            value={modelSearch}
                            onChange={(e) => setModelSearch(e.target.value)}
                            className="w-full rounded border border-border/60 bg-secondary/30 pl-8 pr-3 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring font-mono"
                        />
                    </div>
                </div>

                {filteredModels.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-border/60 p-12 text-center text-xs font-mono text-muted-foreground">
                        Tidak ada model yang sesuai dengan pencarian "{modelSearch}".
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                        {filteredModels.map((m) => (
                            <ProviderModelCard
                                key={m.id}
                                model={m}
                                copied={copied === m.id}
                                onCopy={() => void copy(m.id)}
                            />
                        ))}
                    </div>
                )}
            </div>

            {/* Add Connection Sheet */}
            <ConnectionForm
                open={isAddOpen}
                onOpenChange={setIsAddOpen}
                providerName={provider.name}
                defaultBaseUrl={provider.defaultBaseUrl}
                isSaving={addMutation.isPending}
                error={formError}
                onSubmit={handleAddSubmit}
            />

            {/* Connect OAuth Modal */}
            <ConnectOAuthModal
                provider={provider}
                open={isOAuthModalOpen}
                onOpenChange={setIsOAuthModalOpen}
            />
        </div>
    );
}
