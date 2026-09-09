import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useKeys } from "@/hooks/useKeys";
import type { CreateAPIKeyZod, APIKeyZod } from "@srouter/types";
import { Button } from "@/components/ui/button";
import { KeysSkeleton } from "@/components/skeletons";

import {
    CreateKeyDialog,
    EditKeyDialog,
    KeyDeleteDialog,
    KeyMetrics,
    KeySecretModal,
    KeyTable
} from "@/components/keys";

export const Route = createFileRoute("/keys")({
    staticData: { title: "API Keys" },
    component: KeysPage
});

function KeysPage() {
    const {
        keys,
        loading,
        creating,
        updatingId,
        deletingId,
        newlyCreatedKey,
        setNewlyCreatedKey,
        createKey,
        updateKey,
        deleteKey
    } = useKeys();

    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const [keyToDelete, setKeyToDelete] = useState<APIKeyZod | null>(null);
    const [keyToEdit, setKeyToEdit] = useState<APIKeyZod | null>(null);

    const totalUsageTokens = keys.reduce((acc, k) => acc + (k.usage_tokens || 0), 0);
    const totalUsageCost = keys.reduce((acc, k) => acc + (k.usage_cost || 0), 0);
    const activeKeysCount = keys.filter((k) => k.enabled).length;

    const handleCreateKey = async (data: CreateAPIKeyZod) => {
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
        <div className="mx-auto flex w-full max-w-[1360px] flex-col gap-8 font-mono">
            <header className="flex flex-col justify-between gap-5 border-b border-foreground/15 pb-6 sm:flex-row sm:items-end">
                <div className="min-w-0">
                    <div className="flex items-center gap-2">
                        <span className="size-1.5 shrink-0 rounded-full bg-foreground" />
                        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                            Access Control
                        </p>
                    </div>
                    <h1 className="mt-2 text-3xl font-bold tracking-[-0.04em] text-foreground sm:text-4xl">
                        API Keys
                    </h1>
                    <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
                        Credentials for client SDKs, downstream applications, and automated pipelines.
                    </p>
                </div>

                <Button
                    type="button"
                    onClick={() => setIsCreateOpen(true)}
                    className="h-9 shrink-0 gap-2 border border-foreground bg-foreground px-3 text-xs font-semibold text-background hover:bg-foreground/90 cursor-pointer"
                >
                    <Plus className="size-3.5" />
                    <span>Create Key</span>
                </Button>
            </header>

            <KeyMetrics
                totalKeys={keys.length}
                activeKeys={activeKeysCount}
                totalUsageTokens={totalUsageTokens}
                totalUsageCost={totalUsageCost}
            />

            <KeyTable
                keys={keys}
                deletingId={deletingId}
                onCreateClick={() => setIsCreateOpen(true)}
                onEditClick={(key) => setKeyToEdit(key)}
                onDeleteClick={(key) => setKeyToDelete(key)}
            />

            <CreateKeyDialog
                open={isCreateOpen}
                creating={creating}
                onOpenChange={setIsCreateOpen}
                onSubmit={handleCreateKey}
            />

            <EditKeyDialog
                api_key={keyToEdit}
                open={Boolean(keyToEdit)}
                updating={Boolean(updatingId)}
                onOpenChange={(open) => !open && setKeyToEdit(null)}
                onSubmit={async (id, data) => {
                    await updateKey(id, data);
                }}
            />

            <KeySecretModal new_key={newlyCreatedKey} onClose={() => setNewlyCreatedKey(null)} />

            <KeyDeleteDialog
                IDKey={keyToDelete}
                deleting={Boolean(deletingId)}
                onClose={() => setKeyToDelete(null)}
                onConfirm={handleDeleteKey}
            />
        </div>
    );
}
