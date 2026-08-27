import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useKeys } from "@/hooks/useKeys";
import type { DBAPIKey } from "@srouter/types";
import { Button } from "@/components/ui/button";
import { KeysSkeleton } from "@/components/skeletons";

import { KeyMetrics } from "@/components/keys/KeyMetrics";
import { KeyTable } from "@/components/keys/KeyTable";
import { CreateKeyDialog } from "@/components/keys/CreateKeyDialog";
import { KeySecretModal } from "@/components/keys/KeySecretModal";
import { KeyDeleteDialog } from "@/components/keys/KeyDeleteDialog";
import { AddCreditDialog } from "@/components/keys/AddCreditDialog";

export const Route = createFileRoute("/keys")({
    staticData: { title: "API Keys" },
    component: KeysPage
});

function KeysPage() {
    const {
        keys,
        loading,
        creating,
        deletingId,
        addingCreditId,
        newlyCreatedKey,
        setNewlyCreatedKey,
        createKey,
        addCredit,
        deleteKey
    } = useKeys();

    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const [keyToDelete, setKeyToDelete] = useState<DBAPIKey | null>(null);
    const [keyToAddCredit, setKeyToAddCredit] = useState<DBAPIKey | null>(null);

    const totalUsageTokens = keys.reduce((acc, k) => acc + (k.usageTokens || 0), 0);
    const activeKeysCount = keys.filter((k) => k.enabled).length;

    const handleCreateKey = async (data: {
        name: string;
        rateLimit?: number;
        quotaLimit?: number;
        creditLimit?: number;
        allowed_models?: string[] | null;
    }) => {
        const res = await createKey(data);
        if (res) {
            setIsCreateOpen(false);
        }
    };

    const handleDeleteKey = async (id: string) => {
        const success = await deleteKey(id);
        if (success) {
            setKeyToDelete(null);
        }
    };

    if (loading) {
        return <KeysSkeleton />;
    }

    return (
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
            {/* Header */}
            <header className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end border-b border-border/80 pb-5">
                <div className="min-w-0">
                    <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                        Access Control
                    </p>
                    <h1 className="mt-1.5 text-2xl font-bold tracking-tight text-foreground">
                        API Keys
                    </h1>
                    <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
                        Virtual bearer tokens for client SDKs, downstream applications, and
                        automated pipelines.
                    </p>
                </div>

                <Button
                    type="button"
                    onClick={() => setIsCreateOpen(true)}
                    className="h-8 gap-1.5 px-3 text-xs font-semibold cursor-pointer shrink-0 shadow-xs"
                >
                    <Plus className="size-3.5" />
                    <span>Create Key</span>
                </Button>
            </header>

            {/* Metrics */}
            <KeyMetrics
                totalKeys={keys.length}
                activeKeys={activeKeysCount}
                totalUsageTokens={totalUsageTokens}
            />

            {/* Key Management Table */}
            <KeyTable
                keys={keys}
                deletingId={deletingId}
                onCreateClick={() => setIsCreateOpen(true)}
                onAddCreditClick={(key) => setKeyToAddCredit(key)}
                onDeleteClick={(key) => setKeyToDelete(key)}
            />

            {/* Dialogs */}
            <CreateKeyDialog
                open={isCreateOpen}
                creating={creating}
                onOpenChange={setIsCreateOpen}
                onSubmit={handleCreateKey}
            />

            <AddCreditDialog
                apiKey={keyToAddCredit}
                open={Boolean(keyToAddCredit)}
                loading={Boolean(addingCreditId)}
                onOpenChange={(open) => !open && setKeyToAddCredit(null)}
                onSubmit={async (keyId, amount) => {
                    await addCredit(keyId, amount);
                }}
            />

            <KeySecretModal newKey={newlyCreatedKey} onClose={() => setNewlyCreatedKey(null)} />

            <KeyDeleteDialog
                keyToDelete={keyToDelete}
                deleting={Boolean(deletingId)}
                onClose={() => setKeyToDelete(null)}
                onConfirm={handleDeleteKey}
            />
        </div>
    );
}
